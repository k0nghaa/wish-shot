-- =============================================================================
-- Claude API 호출량 조회 SQL — 읽기만 (정제·구매처 찾기 호출 수 vs 실제 저장 수)
-- 실행: Supabase 대시보드 SQL Editor 에 블록(§1~§3) 단위로 붙여넣어 실행.
-- 보는 것: 저장으로 이어지지 않은 호출이 얼마나 되는지. 금액은 Anthropic Console(모델별 토큰 비용·웹 검색 비용)에서 본다.
--
-- 기준 맞춤: 전체 하루 카운터(ops.parse_quota_global / ops.purchase_link_quota_global)는
--   사용자 구분이 없어 개발자 호출도 들어 있다. 그래서 저장 수도 개발자를 빼지 않는다.
-- 저장 수: public.analysis_logs 로 센다(분석을 거친 저장 1건 = 1행). 위시를 지워도 행·상태·
--   분석 경로(parsed.source)는 남으므로(0006 은 원문·결과만 비움) 나중에 지운 위시도 센다.
-- 유의:
--   - 카운터는 한도를 통과해 실제로 Claude 를 부른 요청만 센다(한도 거절은 빠짐).
--   - 정제 카운터는 이미지 가중치를 곱한 값이다(PARSE_IMAGE_WEIGHT 기본 1 = 요청 수와 같음).
--   - 로컬 측정 스크립트(eval·goldset-eval)는 DB 를 거치지 않아 여기 없다(Console 에는 보일 수 있음).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- §1 최근 30일 날짜별 — 호출 수 vs 저장 수
--   parse_calls_per_save   : 저장 1건당 정제 호출. 1에 가까우면 낭비가 적다.
--                            (영역 다시 분석·저장 안 하고 닫은 폼이 많을수록 커진다)
--   link_calls_per_ai_save : AI 가 채운 저장 1건당 링크 찾기 호출. 1에 가까우면 낭비가 적고,
--                            2면 링크 찾기의 절반이 저장으로 이어지지 않았다.
--   링크 찾기 함수 배포 전 날짜는 link_calls 가 0 이다.
-- -----------------------------------------------------------------------------
with days as (
  select d::date as day
  from generate_series(
    (now() at time zone 'Asia/Seoul')::date - 29,
    (now() at time zone 'Asia/Seoul')::date,
    interval '1 day'
  ) as d
),
saves as (
  select
    (l.created_at at time zone 'Asia/Seoul')::date                   as day,
    count(*)                                                         as saves_analyzed,     -- 분석을 거친 저장
    count(*) filter (where l.status in ('parsed', 'low_confidence')) as saves_ai_filled,    -- AI 가 채운 저장
    count(*) filter (where l.parsed ->> 'source' = 'image_region')   as saves_image_region  -- 영역 이미지로 채운 저장
  from public.analysis_logs l
  where l.created_at >= now() - interval '31 days'
  group by 1
)
select
  d.day,
  coalesce(p.count, 0)                                         as parse_calls,
  coalesce(pl.count, 0)                                        as link_calls,
  coalesce(s.saves_analyzed, 0)                                as saves_analyzed,
  coalesce(s.saves_ai_filled, 0)                               as saves_ai_filled,
  coalesce(s.saves_image_region, 0)                            as saves_image_region,
  round(p.count::numeric  / nullif(s.saves_analyzed, 0), 2)    as parse_calls_per_save,
  round(pl.count::numeric / nullif(s.saves_ai_filled, 0), 2)   as link_calls_per_ai_save
from days d
left join ops.parse_quota_global p          on p.day = d.day
left join ops.purchase_link_quota_global pl on pl.day = d.day
left join saves s                           on s.day = d.day
order by d.day desc;

-- -----------------------------------------------------------------------------
-- §2 합계 한 줄 — 링크 찾기 카운터가 처음 생긴 날(배포일)부터, 최대 최근 30일
--   두 함수를 같은 기간으로 맞춰 비율을 본다.
-- -----------------------------------------------------------------------------
with bounds as (
  select greatest(
    (now() at time zone 'Asia/Seoul')::date - 29,
    coalesce((select min(day) from ops.purchase_link_quota_global),
             (now() at time zone 'Asia/Seoul')::date - 29)
  ) as start_day
),
s as (
  select
    count(*)                                                       as saves_analyzed,
    count(*) filter (where l.status in ('parsed', 'low_confidence')) as saves_ai_filled,
    count(*) filter (where l.parsed ->> 'source' = 'image_region')   as saves_image_region
  from public.analysis_logs l
  cross join bounds b
  where (l.created_at at time zone 'Asia/Seoul')::date >= b.start_day
),
p as (
  select coalesce(sum(g.count), 0) as parse_calls
  from ops.parse_quota_global g
  cross join bounds b
  where g.day >= b.start_day
),
pl as (
  select coalesce(sum(g.count), 0) as link_calls
  from ops.purchase_link_quota_global g
  cross join bounds b
  where g.day >= b.start_day
)
select
  b.start_day,
  p.parse_calls,
  pl.link_calls,
  s.saves_analyzed,
  s.saves_ai_filled,
  s.saves_image_region,
  round(p.parse_calls::numeric / nullif(s.saves_analyzed, 0), 2) as parse_calls_per_save,
  round(pl.link_calls::numeric / nullif(s.saves_ai_filled, 0), 2) as link_calls_per_ai_save
from bounds b, p, pl, s;

-- -----------------------------------------------------------------------------
-- §3 최근 30일 링크 찾기 실패·중단 사유 — 돈은 썼는데 결과가 없던 호출
--   'link: null'(검색은 했지만 맞는 상품이 없음)은 정상 결과라 기록되지 않는다 — 여기 없는 만큼이 그것이다.
--   search_error / search_paused / llm_max_tokens / link_* 는 검색 요금이 이미 나간 뒤의 실패다.
--   rate_limited_* · quota_unavailable · invalid_* 는 Claude 를 부르기 전에 끝나 비용이 없다.
-- -----------------------------------------------------------------------------
select
  f.reason,
  sum(f.count)              as failures,
  count(distinct f.user_id) as users
from ops.purchase_link_failures f
where f.day >= (now() at time zone 'Asia/Seoul')::date - 29
group by f.reason
order by failures desc;
