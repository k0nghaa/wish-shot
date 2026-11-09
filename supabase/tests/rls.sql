-- =============================================================================
-- RLS / 권한 검증 SQL — 본인 데이터만 보이는지, 비로그인은 막히는지 확인
-- 실행: Supabase 대시보드 SQL Editor 에 붙여넣고 각 블록을 실행(사람이 확인).
-- 판정: 각 결과가 기대값(주석)과 같아야 통과.
--
-- 두 개의 층을 나눠서 본다:
--   - GRANT(테이블 접근): has_table_privilege() 로 확인 (테스트 2)
--   - RLS(행 단위 필터): 다른 uid 로 위장해 0행 나오는지 확인 (테스트 1, 3)
-- 테스트 4·5 는 블록(do ~ 마지막 select)을 한 번에 실행한다. 마지막에 "통과"가 나오면 통과,
--   하나라도 어긋나면 검사 번호가 담긴 오류로 멈춘다. 가짜 사용자·행을 만들어 시험한 뒤
--   블록 안에서 모두 되돌린다(남는 것 없음, quota.sql 과 같은 방식).
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

-- -----------------------------------------------------------------------------
-- 테스트 4 (Storage 폴더 격리·anon 거부) — 사전 데이터 불필요
-- 가짜 사용자 A 로 위장해 item-images 의 본인 폴더만 읽고 쓸 수 있는지 본다.
-- storage.objects 에 메타데이터 행만 넣었다가 되돌린다(실제 파일은 만들지 않는다).
-- -----------------------------------------------------------------------------
do $$
declare
  ua      uuid := gen_random_uuid();
  ub      uuid := gen_random_uuid();
  n       integer;
  failed  boolean;
  outcome text;
begin
  begin
    -- 준비: 다른 사용자 B 의 객체 1개(postgres 롤로 넣는다)
    insert into storage.objects (bucket_id, name) values ('item-images', ub || '/b.jpg');

    -- 사용자 A 로 위장
    perform set_config('request.jwt.claims',
      json_build_object('sub', ua, 'role', 'authenticated')::text, true);
    set local role authenticated;

    -- 4-1 본인 폴더에는 쓸 수 있다(대조군)
    insert into storage.objects (bucket_id, name) values ('item-images', ua || '/a.jpg');
    select count(*) into n from storage.objects where bucket_id = 'item-images' and name = ua || '/a.jpg';
    assert n = 1, format('4-1: 본인 폴더 객체가 보여야 한다(1 기대, 실제 %s)', n);

    -- 4-2 다른 사용자 폴더는 보이지 않는다
    select count(*) into n from storage.objects where bucket_id = 'item-images' and name = ub || '/b.jpg';
    assert n = 0, format('4-2: 다른 사용자 객체가 보이면 안 된다(실제 %s)', n);

    -- 4-3 다른 사용자 폴더에 쓸 수 없다
    failed := false;
    begin
      insert into storage.objects (bucket_id, name) values ('item-images', ub || '/x.jpg');
    exception when insufficient_privilege then
      failed := true;
    end;
    assert failed, '4-3: 다른 사용자 폴더에 쓰기가 거부돼야 한다';

    -- 4-4 본인 객체를 다른 사용자 폴더로 옮길 수 없다
    failed := false;
    begin
      update storage.objects set name = ub || '/a.jpg'
       where bucket_id = 'item-images' and name = ua || '/a.jpg';
    exception when insufficient_privilege then
      failed := true;
    end;
    assert failed, '4-4: 다른 사용자 폴더로 옮기기가 거부돼야 한다';

    -- 4-5 다른 사용자 객체를 지우거나 이름을 바꿀 수 없다(대상 0행)
    delete from storage.objects where bucket_id = 'item-images' and name = ub || '/b.jpg';
    get diagnostics n = row_count;
    assert n = 0, format('4-5: 다른 사용자 객체 삭제는 0행이어야 한다(실제 %s)', n);
    update storage.objects set name = ua || '/taken.jpg'
     where bucket_id = 'item-images' and name = ub || '/b.jpg';
    get diagnostics n = row_count;
    assert n = 0, format('4-6: 다른 사용자 객체 이름 바꾸기는 0행이어야 한다(실제 %s)', n);
    reset role;

    -- 비로그인(anon)
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;

    -- 4-7 anon 은 item-images 객체를 하나도 보지 못한다
    select count(*) into n from storage.objects where bucket_id = 'item-images';
    assert n = 0, format('4-7: anon 에게 객체가 보이면 안 된다(실제 %s)', n);

    -- 4-8 anon 은 업로드할 수 없다
    failed := false;
    begin
      insert into storage.objects (bucket_id, name) values ('item-images', ua || '/anon.jpg');
    exception when insufficient_privilege then
      failed := true;
    end;
    assert failed, '4-8: anon 업로드가 거부돼야 한다';

    -- 4-9 anon 은 public 테이블을 읽을 수 없다(권한 없음)
    failed := false;
    begin
      select count(*) into n from public.items;
    exception when insufficient_privilege then
      failed := true;
    end;
    assert failed, '4-9: anon 의 public.items 조회가 거부돼야 한다';
    reset role;

    raise exception using message = 'rls_test4_passed';
  exception
    when assert_failure then
      outcome := sqlerrm;
    when others then
      outcome := sqlerrm;
  end;

  if outcome is distinct from 'rls_test4_passed' then
    raise exception 'rls.sql 테스트 4 실패 — %', outcome;
  end if;
end
$$;

select 'rls.sql 테스트 4: 모든 검사 통과(시험 데이터는 롤백되어 남지 않음)' as result;

-- -----------------------------------------------------------------------------
-- 테스트 5 (0006 적용 확인) — 권한 정리·버킷 제한·분석 로그 보존
-- 0006_permissions_and_retention 적용 뒤 실행한다.
-- -----------------------------------------------------------------------------
do $$
declare
  u_ext     uuid := gen_random_uuid();   -- 일반 사용자
  u_int     uuid := gen_random_uuid();   -- 개발자 계정(ops.internal_users)
  i_ext     uuid := gen_random_uuid();
  i_ext2    uuid := gen_random_uuid();
  i_int     uuid := gen_random_uuid();
  l_ext     uuid;
  l_ext2    uuid;
  l_int     uuid;
  r         record;
  n         integer;
  t         timestamptz;
  outcome   text;
begin
  begin
    -- ── 5-1 public 테이블: 앱이 쓰지 않는 권한이 API 롤에 없다 ──
    for r in
      select tbl, rl, pv
      from unnest(array['public.categories', 'public.items', 'public.analysis_logs']) tbl
      cross join unnest(array['anon', 'authenticated', 'service_role']) rl
      cross join unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) pv
    loop
      assert not has_table_privilege(r.rl, r.tbl, r.pv),
        format('5-1: %s 의 %s 에 %s 권한이 남아 있다', r.rl, r.tbl, r.pv);
    end loop;
    -- CRUD 는 그대로(authenticated)
    assert has_table_privilege('authenticated', 'public.items', 'SELECT,INSERT,UPDATE,DELETE'),
      '5-1: authenticated 의 public.items CRUD 권한이 있어야 한다';

    -- ── 5-2 함수: 앱 쪽 롤은 실행할 수 없고, set_updated_at 은 search_path 가 고정돼 있다 ──
    for r in
      select fn, rl
      from unnest(array['public.set_updated_at()', 'ops.clear_analysis_log_content()']
                  || case when to_regprocedure('public.rls_auto_enable()') is not null
                          then array['public.rls_auto_enable()'] else array[]::text[] end) fn
      cross join unnest(array['public', 'anon', 'authenticated']) rl
    loop
      assert not has_function_privilege(r.rl, r.fn, 'EXECUTE'),
        format('5-2: %s 가 %s 를 실행할 수 있다', r.rl, r.fn);
    end loop;
    assert exists (select 1 from pg_proc
                    where oid = 'public.set_updated_at()'::regprocedure
                      and 'search_path=""' = any(proconfig)),
      '5-2: set_updated_at 의 search_path 가 고정돼 있어야 한다';

    -- ── 5-3 기본 권한: 새로 만드는 public 테이블·함수에 API 롤 권한이 자동으로 붙지 않는다 ──
    create table public.zz_audit_probe (id int);
    create function public.zz_audit_probe_fn() returns int language sql as 'select 1';
    for r in select rl from unnest(array['anon', 'authenticated', 'service_role']) rl loop
      assert not has_table_privilege(r.rl, 'public.zz_audit_probe', 'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'),
        format('5-3: 새 테이블에 %s 의 비CRUD 권한이 붙었다', r.rl);
      assert not has_function_privilege(r.rl, 'public.zz_audit_probe_fn()', 'EXECUTE'),
        format('5-3: 새 함수를 %s 가 실행할 수 있다', r.rl);
    end loop;

    -- ── 5-4 버킷 제한 ──
    select count(*) into n from storage.buckets
     where id = 'item-images' and file_size_limit = 3145728 and allowed_mime_types = array['image/jpeg'];
    assert n = 1, '5-4: item-images 의 크기(3MB)·형식(image/jpeg) 제한이 있어야 한다';

    -- ── 준비: 가짜 사용자 2명(그중 1명은 개발자)과 위시·분석 로그 ──
    insert into auth.users (id, aud, role, is_anonymous)
    values (u_ext, 'authenticated', 'authenticated', true),
           (u_int, 'authenticated', 'authenticated', true);
    insert into ops.internal_users (user_id, note) values (u_int, 'rls.sql 테스트 5');
    insert into public.items (id, user_id, image_key, product_name, normalized_name, updated_at)
    values (i_ext,  u_ext, u_ext || '/' || i_ext  || '.jpg', 'p1', 'p1', now() - interval '1 day'),
           (i_ext2, u_ext, u_ext || '/' || i_ext2 || '.jpg', 'p2', 'p2', now() - interval '1 day'),
           (i_int,  u_int, u_int || '/' || i_int  || '.jpg', 'p3', 'p3', now() - interval '1 day');
    insert into public.analysis_logs (user_id, item_id, raw_text, parsed, status)
    values (u_ext, i_ext, 'ocr', '{"productName": "p1", "source": "image_region"}', 'parsed')
    returning id into l_ext;
    insert into public.analysis_logs (user_id, item_id, raw_text, parsed, status)
    values (u_ext, i_ext2, 'ocr', '{"productName": "p2"}', 'low_confidence')
    returning id into l_ext2;
    insert into public.analysis_logs (user_id, item_id, raw_text, parsed, status)
    values (u_int, i_int, 'ocr', '{"productName": "p3"}', 'parsed')
    returning id into l_int;

    -- ── 5-5 updated_at 트리거는 그대로 동작한다(일반 사용자로 수정) ──
    perform set_config('request.jwt.claims',
      json_build_object('sub', u_ext, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.items set memo = 'm' where id = i_ext;
    reset role;
    select updated_at into t from public.items where id = i_ext;
    assert t = now(), '5-5: 수정하면 updated_at 이 갱신돼야 한다';

    -- ── 5-6 일반 사용자가 위시를 지우면 로그 내용이 비워지고 상태·경로 표시는 남는다 ──
    set local role authenticated;
    delete from public.items where id in (i_ext, i_ext2);
    reset role;
    select * into r from public.analysis_logs where id = l_ext;
    assert r.item_id is null and r.raw_text is null and r.status = 'parsed'
           and r.parsed = '{"source": "image_region"}'::jsonb,
      format('5-6: 원문·AI 결과는 비우고 상태·source 는 남아야 한다(raw_text=%s, parsed=%s)', r.raw_text, r.parsed);
    select * into r from public.analysis_logs where id = l_ext2;
    assert r.raw_text is null and r.parsed is null and r.status = 'low_confidence',
      format('5-7: source 가 없으면 parsed 를 모두 비워야 한다(parsed=%s)', r.parsed);

    -- ── 5-8 개발자 계정은 건너뛴다 ──
    perform set_config('request.jwt.claims',
      json_build_object('sub', u_int, 'role', 'authenticated')::text, true);
    set local role authenticated;
    delete from public.items where id = i_int;
    reset role;
    select * into r from public.analysis_logs where id = l_int;
    assert r.item_id is null and r.raw_text = 'ocr' and r.parsed ? 'productName',
      '5-8: 개발자 계정의 로그 내용은 남아야 한다';

    raise exception using message = 'rls_test5_passed';
  exception
    when assert_failure then
      outcome := sqlerrm;
    when others then
      outcome := sqlerrm;
  end;

  if outcome is distinct from 'rls_test5_passed' then
    raise exception 'rls.sql 테스트 5 실패 — %', outcome;
  end if;
end
$$;

select 'rls.sql 테스트 5: 모든 검사 통과(시험 데이터는 롤백되어 남지 않음)' as result;
