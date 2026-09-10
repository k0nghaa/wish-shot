-- =============================================================================
-- RLS / 권한 검증 SQL — 본인 데이터만 보이는지, 비로그인은 막히는지 확인
-- 실행: Supabase 대시보드 SQL Editor 에 붙여넣고 각 블록을 실행(사람이 확인).
-- 판정: 각 결과가 기대값(주석)과 같아야 통과.
--
-- 두 개의 층을 나눠서 본다:
--   - GRANT(테이블 접근): has_table_privilege() 로 확인 (테스트 2)
--   - RLS(행 단위 필터): 다른 uid 로 위장해 0행 나오는지 확인 (테스트 1, 3)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 테스트 1 (핵심, 사전 데이터 불필요) — 로그인 사용자가 '남의 행'을 못 본다
-- 존재하지 않는 임의 uid 로 위장 → RLS 가 본인(=임의 uid) 행만 통과시키므로 0행.
-- (남의 데이터가 있어도 임의 uid 소유가 아니라 한 행도 안 보여야 한다.)
-- -----------------------------------------------------------------------------
begin;
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000000000', 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  select 'categories'    as tbl, count(*) as visible_rows from public.categories     -- 기대: 0
  union all
  select 'items',              count(*) from public.items                             -- 기대: 0
  union all
  select 'analysis_logs',      count(*) from public.analysis_logs;                    -- 기대: 0
rollback;

-- -----------------------------------------------------------------------------
-- 테스트 2 (권한 층) — 역할별 테이블 접근 권한 확인
-- anon(비로그인)은 아무 권한도 없어야 하고, authenticated 는 CRUD 가 있어야 한다.
-- (anon 은 GRANT 가 없어 select 자체가 permission denied 로 막히므로, 여기서는
--  select 를 실제로 실행하지 않고 has_table_privilege 로 권한만 조회한다.)
-- -----------------------------------------------------------------------------
select
  tbl,
  has_table_privilege('anon',          'public.' || tbl, 'SELECT') as anon_select,          -- 기대: false
  has_table_privilege('authenticated', 'public.' || tbl, 'SELECT') as authed_select,        -- 기대: true
  has_table_privilege('authenticated', 'public.' || tbl, 'INSERT') as authed_insert,        -- 기대: true
  has_table_privilege('authenticated', 'public.' || tbl, 'UPDATE') as authed_update,        -- 기대: true
  has_table_privilege('authenticated', 'public.' || tbl, 'DELETE') as authed_delete         -- 기대: true
from unnest(array['categories', 'items', 'analysis_logs']) as tbl;

-- -----------------------------------------------------------------------------
-- 테스트 3 (교차 검증 — 실제 두 계정으로 확인, 선택)
-- 두 계정으로 로그인해 각자 아이템을 1개 이상 만든 뒤,
-- 아래 <UID_A>/<UID_B> 를 실제 auth.users.id 로 바꿔 실행한다.
-- (auth.users.id 확인: 대시보드 Authentication → Users, 또는 select id, email from auth.users;)
-- -----------------------------------------------------------------------------
-- 사용자 A 컨텍스트: A 본인 아이템만 보여야 함(>0), B 것은 절대 안 보임(0).
begin;
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', '<UID_A>', 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  select 'A sees own items' as check, count(*) from public.items;                            -- 기대: >0
  select 'A sees B items'   as check, count(*) from public.items where user_id = '<UID_B>';  -- 기대: 0
rollback;

-- 사용자 B 컨텍스트: 반대로 확인.
begin;
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', '<UID_B>', 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  select 'B sees own items' as check, count(*) from public.items;                            -- 기대: >0
  select 'B sees A items'   as check, count(*) from public.items where user_id = '<UID_A>';  -- 기대: 0
rollback;
