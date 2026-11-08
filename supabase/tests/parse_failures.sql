-- =============================================================================
-- AI 정제 실패 기록 조회 SQL (0005_parse_quota) — 읽기만
-- 실행: Supabase 대시보드 SQL Editor 에 블록 단위로 붙여넣어 실행(사람이 확인).
-- 기록: 함수 parse-screenshot-text 가 로그인 확인 뒤의 실패 응답마다 남긴다
--       (사용자·한국 날짜·사유·횟수, llm_error 는 Anthropic 상태 코드, 상한 초과는 넘은 길이 최대값).
--       성공은 세지 않는다. 텍스트·이미지 내용은 없다. 계정이 정리(0002)돼도 기록은 남는다 —
--       에러를 만나고 저장 없이 떠난 사용자도 집계에 들어간다.
-- 제외: 개발자 uid 는 0004 의 ops.internal_users 로 뺀다(§1·§2·§4). 비어 있으면 아무도 제외되지 않는다.
-- 사유: invalid_json / invalid_text / invalid_image / invalid_media_type / image_too_large /
--       text_too_long / categories_too_long / rate_limited_user / rate_limited_global /
--       quota_unavailable(카운터 응답 3초 초과로 503 — 몰아치기 공격이나 DB 지연) /
--       llm_timeout / llm_unreachable / llm_error / llm_refusal / llm_empty / llm_bad_json /
--       llm_read_error(LLM 응답 본문 읽기 실패 — 앱은 런타임 500 을 받음)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- §1 최근 30일 날짜·사유별 실패 — 횟수와 사용자 수
-- -----------------------------------------------------------------------------
with excluded as (
  select coalesce(array_agg(user_id), '{}') as uids from ops.internal_users
)
select
  f.day,
  f.reason,
  f.llm_status,                         -- llm_error 의 Anthropic 상태 코드(그 외 0)
  sum(f.count)              as failures,
  count(distinct f.user_id) as users,
  max(f.max_len)            as max_len  -- 상한 초과 사유만 값이 있다
from ops.parse_failures f
cross join excluded e
where f.day >= (now() at time zone 'Asia/Seoul')::date - 30
  and not (f.user_id = any(e.uids))
group by f.day, f.reason, f.llm_status
order by f.day desc, failures desc;

-- -----------------------------------------------------------------------------
-- §2 입력 상한 초과(전 기간) — 상한(텍스트 2,000자·카테고리 2,000자)을 조정할지 판단
--   읽는 법: users 가 여러 명이고 max_len 이 상한을 조금 넘는 수준이면 정상 사용자가
--   걸린 것일 가능성이 크다 → 상한 상향 검토(index.ts MAX_TEXT_LEN / MAX_CATEGORIES_JSON_LEN).
--   한 사용자에 몰려 있고 길이가 매우 크면 비정상 요청일 가능성이 크다.
-- -----------------------------------------------------------------------------
with excluded as (
  select coalesce(array_agg(user_id), '{}') as uids from ops.internal_users
)
select
  f.reason,
  sum(f.count)              as failures,
  count(distinct f.user_id) as users,
  count(distinct f.day)     as days,
  max(f.max_len)            as max_len,
  min(f.day)                as first_day,
  max(f.day)                as last_day
from ops.parse_failures f
cross join excluded e
where f.reason in ('text_too_long', 'categories_too_long')
  and not (f.user_id = any(e.uids))
group by f.reason
order by f.reason;

-- -----------------------------------------------------------------------------
-- §3 최근 30일 LLM 실패율 — 분모는 전체 하루 카운터(허용돼 LLM 을 부른 요청)
--   유의: 전체 카운터는 사용자 구분이 없어 개발자 요청도 포함하므로, 이 블록은 개발자를
--   빼지 않는다(분자·분모 기준을 맞춤). 카운터는 가중치를 적용한 값이다(이미지 가중치 1이면 요청 수와 같다).
--   rate_limited_*·quota_unavailable 은 LLM 을 부르지 않아 분모에 없다 — 횟수만 따로 본다.
-- -----------------------------------------------------------------------------
select
  g.day,
  g.count                                                                    as llm_calls_weighted,
  coalesce(sum(f.count) filter (where f.reason like 'llm\_%'), 0)            as llm_failures,
  round(100.0 * coalesce(sum(f.count) filter (where f.reason like 'llm\_%'), 0)
        / nullif(g.count, 0), 1)                                             as llm_failure_pct,
  coalesce(sum(f.count) filter (where f.reason = 'rate_limited_user'), 0)    as rate_limited_user,
  coalesce(sum(f.count) filter (where f.reason = 'rate_limited_global'), 0)  as rate_limited_global,
  coalesce(sum(f.count) filter (where f.reason = 'quota_unavailable'), 0)    as quota_unavailable
from ops.parse_quota_global g
left join ops.parse_failures f on f.day = g.day
where g.day >= (now() at time zone 'Asia/Seoul')::date - 30
group by g.day, g.count
order by g.day desc;

-- -----------------------------------------------------------------------------
-- §4 한 사용자의 오늘 기록 — 실제 동작 시험(Step 5) 확인용
--   <UID> 를 시험 스크립트가 출력한 사용자 id 로 바꿔 실행한다.
--   기대(사용자 시간당 한도 2로 낮춘 parse_quota_live.ts 시험): rate_limited_user 1건, text_too_long 1건(max_len 2001).
-- -----------------------------------------------------------------------------
select reason, llm_status, count, max_len
from ops.parse_failures
where user_id = '<UID>'
  and day = (now() at time zone 'Asia/Seoul')::date
order by reason;
