-- =============================================================================
-- 테스트 지표 SQL (Phase 10) — 이벤트 없이 DB에서 나오는 지표 4종
-- 실행: Supabase 대시보드 SQL Editor 에 블록 단위로 붙여넣어 실행(사람이 확인).
-- 정본: docs/testing/tracking-plan.md §3. 스키마 기준: src/types/database.ts·supabase/migrations/.
--
-- 코호트 필터(전 쿼리 공통 내장): created_at >= 테스트 시작일 + 개발자 uid 제외.
-- 각 블록 맨 위 cohort CTE 의 두 값을 실행 전에 기입한다(블록마다 반복 — 독립 실행용).
--   test_start    : 테스트 시작일 (예: timestamptz '2026-10-15 00:00:00+09')
--   excluded_uids : 개발자 uid 배열 (예: array['<UID_1>','<UID_2>']::uuid[])
-- 드라이런: 현 개발 데이터로 쿼리 동작만 확인한다(수치는 버린다). 이때는
--   test_start 를 과거(예: '2026-01-01')로, excluded_uids 를 빈 배열로 두면 전 행이 잡힌다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- §1 링크 보유율 — "링크를 챙기는가"는 이벤트 대신 이 쿼리로 답한다(보류: source_link_opened)
-- items.source_link 가 비어 있지 않은 아이템 비율.
-- -----------------------------------------------------------------------------
with cohort as (
  select
    timestamptz '2026-01-01 00:00:00+09' as test_start,   -- ← 테스트 시작일 기입
    array[]::uuid[]                      as excluded_uids -- ← 개발자 uid 기입
),
scope as (
  select i.*
  from public.items i
  cross join cohort c
  where i.created_at >= c.test_start
    and not (i.user_id = any(c.excluded_uids))
)
select
  count(*)                                                              as items_total,
  count(*) filter (where nullif(btrim(source_link), '') is not null)   as items_with_link,
  round(
    100.0 * count(*) filter (where nullif(btrim(source_link), '') is not null)
      / nullif(count(*), 0),
    1
  )                                                                     as link_rate_pct
from scope;

-- -----------------------------------------------------------------------------
-- §2 AI 정제 성공률·상태 분포 — analysis_logs.status 집계 (질문 4: AI 작동률)
-- 유의: analysis_logs 는 "저장 성공 시"에만 기록된다. 저장 전 이탈 포함 전체 분포는
--       PostHog 의 analysis_completed 이벤트로 보고, 이 쿼리와 교차 검증한다.
-- status enum: parsed / low_confidence / parse_failed / ocr_empty (4종)
-- -----------------------------------------------------------------------------
with cohort as (
  select
    timestamptz '2026-01-01 00:00:00+09' as test_start,   -- ← 테스트 시작일 기입
    array[]::uuid[]                      as excluded_uids -- ← 개발자 uid 기입
),
scope as (
  select l.*
  from public.analysis_logs l
  cross join cohort c
  where l.created_at >= c.test_start
    and not (l.user_id = any(c.excluded_uids))
)
select
  status,
  count(*)                                              as cnt,
  round(100.0 * count(*) / sum(count(*)) over (), 1)    as pct,
  -- 자동채움 성공(폼이 채워짐) = parsed + low_confidence
  round(
    100.0 * sum(count(*) filter (where status in ('parsed', 'low_confidence'))) over ()
      / nullif(sum(count(*)) over (), 0),
    1
  )                                                     as autofill_rate_pct_total
from scope
group by status
order by cnt desc;

-- -----------------------------------------------------------------------------
-- §3 필드 수정률(정밀) — AI 원본 정제값(analysis_logs.parsed) vs 최종 저장값(items)
-- autofill_edited 이벤트의 교차 검증용. 아이템당 최신 성공 로그 1건만 비교한다.
-- parsed JSON 키: productName / brand / price (Edge Function 출력 스키마 그대로).
-- "수정" = AI 가 값을 줬는데 최종 저장값이 다름(지운 것 포함). AI 가 못 준 필드는 모수에서 제외.
-- -----------------------------------------------------------------------------
with cohort as (
  select
    timestamptz '2026-01-01 00:00:00+09' as test_start,   -- ← 테스트 시작일 기입
    array[]::uuid[]                      as excluded_uids -- ← 개발자 uid 기입
),
latest_log as (
  select distinct on (l.item_id) l.item_id, l.parsed
  from public.analysis_logs l
  cross join cohort c
  where l.item_id is not null
    and l.status in ('parsed', 'low_confidence')
    and l.created_at >= c.test_start
    and not (l.user_id = any(c.excluded_uids))
  order by l.item_id, l.created_at desc
),
pairs as (
  select
    nullif(btrim(ll.parsed ->> 'productName'), '')        as ai_name,
    nullif(btrim(ll.parsed ->> 'brand'), '')              as ai_brand,
    (ll.parsed ->> 'price')::numeric                      as ai_price,
    nullif(btrim(i.product_name), '')                     as saved_name,
    nullif(btrim(coalesce(i.brand, '')), '')              as saved_brand,
    i.price                                               as saved_price
  from latest_log ll
  join public.items i on i.id = ll.item_id
)
select
  count(*)                                                                       as analyzed_items,
  count(*) filter (where ai_name is not null)                                    as name_filled,
  round(100.0 * count(*) filter (where ai_name is not null and ai_name is distinct from saved_name)
    / nullif(count(*) filter (where ai_name is not null), 0), 1)                 as name_edit_pct,
  count(*) filter (where ai_brand is not null)                                   as brand_filled,
  round(100.0 * count(*) filter (where ai_brand is not null and ai_brand is distinct from saved_brand)
    / nullif(count(*) filter (where ai_brand is not null), 0), 1)                as brand_edit_pct,
  count(*) filter (where ai_price is not null)                                   as price_filled,
  round(100.0 * count(*) filter (where ai_price is not null and ai_price is distinct from saved_price)
    / nullif(count(*) filter (where ai_price is not null), 0), 1)                as price_edit_pct
from pairs;

-- -----------------------------------------------------------------------------
-- §4 카테고리 추천 채택률 (FR-8) — parsed->>'suggestedCategory'(추천 이름) vs 최종 카테고리
-- 추천값은 analysis_logs.parsed JSON 에 저장돼 있다(스키마 변경 불필요 — 확인 완료).
-- 채택 = 최종 category 의 "이름"이 추천 이름과 일치. 폴더 이름변경 시 과거 건은 불일치로
-- 집계될 수 있다(소규모 테스트에선 무시 가능한 수준 — 해석 시 유의).
-- -----------------------------------------------------------------------------
with cohort as (
  select
    timestamptz '2026-01-01 00:00:00+09' as test_start,   -- ← 테스트 시작일 기입
    array[]::uuid[]                      as excluded_uids -- ← 개발자 uid 기입
),
latest_log as (
  select distinct on (l.item_id) l.item_id, l.parsed
  from public.analysis_logs l
  cross join cohort c
  where l.item_id is not null
    and l.status in ('parsed', 'low_confidence')
    and nullif(btrim(l.parsed ->> 'suggestedCategory'), '') is not null
    and l.created_at >= c.test_start
    and not (l.user_id = any(c.excluded_uids))
  order by l.item_id, l.created_at desc
),
pairs as (
  select
    btrim(ll.parsed ->> 'suggestedCategory') as suggested_name,
    cat.name                                 as final_name   -- null = 미분류
  from latest_log ll
  join public.items i on i.id = ll.item_id
  left join public.categories cat on cat.id = i.category_id
)
select
  count(*)                                                        as suggested_total,
  count(*) filter (where final_name = suggested_name)             as adopted,
  round(100.0 * count(*) filter (where final_name = suggested_name)
    / nullif(count(*), 0), 1)                                     as adoption_pct
from pairs;
