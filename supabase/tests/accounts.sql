-- =============================================================================
-- 계정 DB 부품 검증 SQL — 0008(profiles·닉네임 함수)·0009(가입 확인 조회·실패 기록 합산·삭제 마무리·재시도 표)
-- 실행: Supabase 대시보드 SQL Editor 에서 0008·0009 적용 뒤 이 파일 전체를 한 번에 실행한다(postgres 롤).
-- 판정: 마지막에 "통과" 메시지가 나오면 통과. 하나라도 어긋나면 검사 번호가 담긴 오류로 멈춘다.
--       가짜 사용자·행을 만들어 시험한 뒤 블록 안에서 모두 되돌린다(남는 것 없음 — rls.sql 테스트 5 와 같은 방식).
-- 같은 사례의 메모리 모델 시험: supabase/tests/nickname_rules_test.ts (규칙을 바꾸면 세 곳을 함께 고친다)
--
-- 한계: 하나의 트랜잭션 안에서 도는 시험이라 "정말 동시에" 두 세션이 같은 이름을 저장하는 경합은 만들 수 없다.
--   UNIQUE(nickname_key) 가 있는지(검사 8-4)와 같은 이름을 두 사용자가 차례로 저장하면 하나만 성공하는지(8-5)만 본다.
--   실제 경합은 SQL Editor 탭 두 개에서 같은 이름으로 set_nickname 을 동시에 눌러 하나만 saved 인지 확인한다(선택).
-- =============================================================================

do $$
declare
  u1      uuid := gen_random_uuid();   -- 로그인 계정 1
  u2      uuid := gen_random_uuid();   -- 로그인 계정 2
  u3      uuid := gen_random_uuid();   -- 로그인 계정 3
  ua      uuid := gen_random_uuid();   -- 익명 계정
  nil     constant uuid := '00000000-0000-0000-0000-000000000000';
  v       jsonb;
  w       jsonb;
  t       timestamptz;
  n       integer;
  s       text;
  nfd     text := chr(4358) || chr(4469) || chr(4523) || chr(4364) || chr(4469);  -- '민지' 의 분해형(NFD)
  outcome text;
  rec     record;
begin
  begin
    -- ── 준비 ──────────────────────────────────────────────────────────────
    insert into auth.users (id, aud, role, is_anonymous)
    values (u1, 'authenticated', 'authenticated', false),
           (u2, 'authenticated', 'authenticated', false),
           (u3, 'authenticated', 'authenticated', false),
           (ua, 'authenticated', 'authenticated', true);

    -- ── 8-1 check_nickname: 글자 수·글자 종류·예약어 ──────────────────────
    perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    set local role authenticated;

    assert public.check_nickname('a') ->> 'result' = 'invalid_length', '8-1: 1자';
    assert public.check_nickname('') ->> 'result' = 'invalid_length', '8-1: 빈 값';
    assert public.check_nickname('abcdefghijklm') ->> 'result' = 'invalid_length', '8-1: 13자';
    assert public.check_nickname('가나다라마바사아자차카타파') ->> 'result' = 'invalid_length', '8-1: 한글 13자';
    assert public.check_nickname(null) ->> 'result' = 'invalid_length', '8-1: null';
    assert public.check_nickname('ab') ->> 'result' = 'available', '8-1: 2자';
    assert public.check_nickname('abcdefghijkl') ->> 'result' = 'available', '8-1: 12자';
    assert public.check_nickname('민 지') ->> 'result' = 'invalid_chars', '8-1: 띄어쓰기';
    assert public.check_nickname('민지 ') ->> 'result' = 'invalid_chars', '8-1: 뒤 공백';
    assert public.check_nickname('min!ji') ->> 'result' = 'invalid_chars', '8-1: 특수문자';
    assert public.check_nickname('min_ji') ->> 'result' = 'invalid_chars', '8-1: 밑줄';
    assert public.check_nickname('ㅋㅋㅋ') ->> 'result' = 'invalid_chars', '8-1: 자모 낱글자';
    assert public.check_nickname('민지27') ->> 'result' = 'available', '8-1: 한글+숫자';
    -- 검사 순서: 글자 종류 → 길이 → 예약어 → 중복(자르지 않음, NFC 뒤 코드 포인트 수)
    assert public.check_nickname('a b c d e f g h i j') ->> 'result' = 'invalid_chars', '8-1: 길이도 넘지만 종류가 먼저';
    assert public.check_nickname('!') ->> 'result' = 'invalid_chars', '8-1: 1자여도 종류가 먼저';
    assert public.check_nickname('é') ->> 'result' = 'invalid_chars', '8-1: 악센트';
    assert public.check_nickname('Ａbc') ->> 'result' = 'invalid_chars', '8-1: 전각';
    assert public.check_nickname(' ') ->> 'result' = 'invalid_chars', '8-1: 공백만';
    assert public.check_nickname(repeat(chr(4358) || chr(4469) || chr(4523), 6)) ->> 'result' = 'available', '8-1: 분해형 6자는 NFC 뒤 6자';
    assert public.check_nickname(repeat(chr(4358) || chr(4469) || chr(4523), 13)) ->> 'result' = 'invalid_length', '8-1: 분해형 13자';
    foreach s in array array['위시샷', 'wishshot', 'WishShot', 'WISHSHOT', '관리자', '운영자', 'admin', 'ADMIN', 'Admin', '위시샷공식'] loop
      assert public.check_nickname(s) ->> 'result' = 'reserved', format('8-1: 예약어 %s', s);
    end loop;
    assert public.check_nickname('위시샷공식2') ->> 'result' = 'available', '8-1: 위시샷공식2 는 통과(정확 일치만 차단)';
    assert public.check_nickname('admin1') ->> 'result' = 'available', '8-1: admin1';
    assert not (public.check_nickname('민지27') ? 'nickname'), '8-1: check 결과에 nickname 키가 없다';

    -- ── 8-2 ensure_profile: 두 번 불러도 created 는 한 번만 ───────────────
    v := public.ensure_profile();
    w := public.ensure_profile();
    assert (v ->> 'created')::boolean = true, '8-2: 첫 호출은 created=true';
    assert (w ->> 'created')::boolean = false, '8-2: 둘째 호출은 created=false';
    assert v ->> 'nickname' = w ->> 'nickname', '8-2: 같은 닉네임';
    assert (v ->> 'nickname') ~ '^위시러[0-9]{4}$', format('8-2: 추천값 형식(%s)', v ->> 'nickname');
    assert public.check_nickname(v ->> 'nickname') ->> 'result' = 'unchanged', '8-2: 내 닉네임은 unchanged';

    -- ── 8-3 set_nickname: 저장·NFC·taken·대소문자 ─────────────────────────
    v := public.set_nickname(nfd);                       -- u1 이 분해형으로 저장 → NFC 로 저장
    assert v ->> 'result' = 'saved' and v ->> 'nickname' = '민지', format('8-3: NFC 저장(%s)', v);
    reset role;
    assert (select nickname from public.profiles where user_id = u1) = '민지', '8-3: 저장된 값은 NFC';
    assert (select nickname_key from public.profiles where user_id = u1) = '민지', '8-3: 키';

    perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.ensure_profile();
    v := public.check_nickname('민지');
    assert v ->> 'result' = 'taken', '8-3: 같은 이름은 taken';
    assert jsonb_array_length(v -> 'suggestions') = 2, format('8-3: 추천 2개(%s)', v);
    for s in select jsonb_array_elements_text(v -> 'suggestions') loop
      assert s ~ '^[가-힣A-Za-z0-9]{2,12}$', format('8-3: 추천값 형식 %s', s);
      assert public.check_nickname(s) ->> 'result' = 'available', format('8-3: 추천값은 쓸 수 있다 %s', s);
    end loop;
    assert (v -> 'suggestions' ->> 0) <> (v -> 'suggestions' ->> 1), '8-3: 추천 2개는 서로 다르다';
    assert public.check_nickname(nfd) ->> 'result' = 'taken', '8-3: NFC 만 다른 같은 이름은 taken';
    assert public.set_nickname('민지') ->> 'result' = 'taken', '8-3: set 도 taken';
    assert jsonb_array_length(public.set_nickname('민지') -> 'suggestions') = 2, '8-3: set 의 taken 에도 추천';

    -- 대소문자만 다른 이름
    assert public.set_nickname('Minji') ->> 'result' = 'saved', '8-3: u2 가 Minji 저장';
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.ensure_profile();
    assert public.check_nickname('minji') ->> 'result' = 'taken', '8-3: 대소문자만 다른 이름은 taken';
    assert public.check_nickname('MINJI') ->> 'result' = 'taken', '8-3: MINJI';
    assert public.set_nickname('wishshot') ->> 'result' = 'reserved', '8-3: set 도 예약어 거절';
    assert public.set_nickname('a') ->> 'result' = 'invalid_length', '8-3: set 도 길이 거절';
    assert public.set_nickname('a b') ->> 'result' = 'invalid_chars', '8-3: set 도 글자 거절';
    reset role;

    -- 본인: 같은 값은 unchanged(set 은 saved 로 돌려주되 쓰지 않음), 대소문자만 바꾸기는 available
    perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
    set local role authenticated;
    assert public.check_nickname('Minji') ->> 'result' = 'unchanged', '8-3: 내 이름 그대로';
    select updated_at into t from public.profiles where user_id = u2;
    assert public.set_nickname('Minji') ->> 'result' = 'saved', '8-3: 같은 값 저장은 saved';
    assert (select updated_at from public.profiles where user_id = u2) = t, '8-3: 같은 값은 쓰지 않는다';
    assert public.check_nickname('minji') ->> 'result' = 'available', '8-3: 내 이름의 대소문자만 바꾸기';
    assert public.set_nickname('minji') ->> 'result' = 'saved', '8-3: 대소문자만 바꿔 저장';
    reset role;
    assert (select nickname from public.profiles where user_id = u2) = 'minji', '8-3: 바뀐 모양으로 저장';

    -- 바꾸면 옛 이름을 바로 쓸 수 있다
    perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    set local role authenticated;
    assert public.set_nickname('지민') ->> 'result' = 'saved', '8-3: u1 이 이름을 바꿈';
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
    set local role authenticated;
    assert public.set_nickname('민지') ->> 'result' = 'saved', '8-3: 바꾼 뒤 옛 닉네임을 바로 쓸 수 있다';
    reset role;

    -- ── 8-4 UNIQUE 와 형식 제약 ───────────────────────────────────────────
    assert exists (select 1 from pg_constraint
                    where conrelid = 'public.profiles'::regclass and contype = 'u'
                      and pg_get_constraintdef(oid) = 'UNIQUE (nickname_key)'),
      '8-4: nickname_key UNIQUE 가 있어야 한다(동시 선점은 이것이 막는다)';
    begin
      insert into public.profiles (user_id, nickname, nickname_key) values (ua, '민지', '민지');
      raise exception 'unique 위반이 나야 한다';
    exception when unique_violation then null; end;
    begin
      insert into public.profiles (user_id, nickname, nickname_key) values (ua, 'a b', 'a b');
      raise exception '형식 제약 위반이 나야 한다';
    exception when check_violation then null; end;

    -- ── 8-5 같은 이름을 두 사용자가 차례로 저장하면 하나만 성공 ─────────────
    perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v := public.set_nickname('같은이름');
    perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
    w := public.set_nickname('같은이름');
    reset role;
    assert (v ->> 'result' = 'saved') and (w ->> 'result' = 'taken'), format('8-5: 하나만 성공(%s / %s)', v, w);

    -- ── 8-6 익명 계정: ensure_profile·set_nickname 거절, check 는 가능 ────────
    perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated', 'is_anonymous', false)::text, true);
    set local role authenticated;
    begin
      perform public.ensure_profile();
      raise exception '익명이 ensure_profile 을 부를 수 있다';
    exception when insufficient_privilege then null; end;   -- 클레임이 낡아도(is_anonymous=false) DB 로 판정한다
    begin
      perform public.set_nickname('익명시도');
      raise exception '익명이 set_nickname 을 부를 수 있다';
    exception when insufficient_privilege then null; end;
    assert public.check_nickname('익명시도') ->> 'result' = 'available', '8-6: check 는 가능';
    reset role;
    assert not exists (select 1 from public.profiles where user_id = ua), '8-6: 익명 계정에 프로필이 생기지 않았다';

    -- ── 8-7 계정을 지우면 프로필이 cascade 로 사라지고 닉네임을 바로 쓸 수 있다 ─
    delete from auth.users where id = u1;
    assert not exists (select 1 from public.profiles where user_id = u1), '8-7: 프로필 cascade';
    perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
    set local role authenticated;
    assert public.check_nickname('같은이름') ->> 'result' = 'available', '8-7: 지운 계정의 닉네임을 바로 쓸 수 있다';
    reset role;

    -- ── 9 권한: profiles ──────────────────────────────────────────────────
    assert not has_table_privilege('anon', 'public.profiles', 'SELECT,INSERT,UPDATE,DELETE'), '9: anon 은 profiles 권한이 없다';
    assert not has_table_privilege('service_role', 'public.profiles', 'SELECT,INSERT,UPDATE,DELETE'), '9: service_role 도 없다';
    assert has_table_privilege('authenticated', 'public.profiles', 'SELECT'), '9: authenticated 는 읽기';
    assert not has_table_privilege('authenticated', 'public.profiles', 'INSERT'), '9: 직접 insert 불가';
    assert not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'), '9: 직접 update 불가';
    assert not has_table_privilege('authenticated', 'public.profiles', 'DELETE'), '9: 직접 delete 불가';

    perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.profiles where user_id <> u3;
    assert n = 0, '9: 남의 profiles 를 읽을 수 없다';
    select count(*) into n from public.profiles where user_id = u3;
    assert n = 1, '9: 내 profiles 는 읽는다';
    begin
      update public.profiles set nickname = '해킹' where user_id = u3;
      raise exception '직접 update 가 통과했다';
    exception when insufficient_privilege then null; end;
    reset role;

    -- ── 10 함수 권한과 search_path 고정 ───────────────────────────────────
    for rec in
      select p.oid::regprocedure::text as fn, p.prosecdef, p.proconfig, p.oid
        from pg_proc p
       where p.pronamespace in ('public'::regnamespace, 'ops'::regnamespace)
         and p.proname in ('ensure_profile', 'check_nickname', 'set_nickname', 'nickname_verdict', 'nickname_suggestions',
                           'require_signed_in', 'lookup_signup_identity', 'detach_failure_records',
                           'finalize_account_deletion', 'list_posthog_delete_retries', 'resolve_posthog_delete_retry',
                           'get_deletion_progress', 'mark_deletion_unlinked')
    loop
      assert rec.prosecdef, format('10: %s 는 security definer', rec.fn);
      assert 'search_path=""' = any (rec.proconfig), format('10: %s 의 search_path 가 고정돼 있어야 한다', rec.fn);
      assert not has_function_privilege('public', rec.oid, 'EXECUTE') and not has_function_privilege('anon', rec.oid, 'EXECUTE'),
        format('10: %s 를 anon·PUBLIC 이 실행할 수 있다', rec.fn);
    end loop;
    assert (select count(*) from pg_proc
             where pronamespace in ('public'::regnamespace, 'ops'::regnamespace)
               and proname in ('ensure_profile', 'check_nickname', 'set_nickname', 'nickname_verdict', 'nickname_suggestions',
                               'require_signed_in', 'lookup_signup_identity', 'detach_failure_records',
                               'finalize_account_deletion', 'list_posthog_delete_retries', 'resolve_posthog_delete_retry',
                           'get_deletion_progress', 'mark_deletion_unlinked')) = 13,
      '10: 새 함수 13개가 모두 있어야 한다';
    -- 닉네임 3개는 authenticated, 서버용은 service_role 전용(authenticated 불가), ops 내부 함수는 둘 다 불가
    assert has_function_privilege('authenticated', 'public.ensure_profile()', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.check_nickname(text)', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.set_nickname(text)', 'EXECUTE'), '10: 닉네임 함수는 authenticated 가 실행';
    for rec in select unnest(array[
        'public.lookup_signup_identity(text,text,text)', 'public.detach_failure_records(uuid)',
        'public.finalize_account_deletion(uuid,text,text,boolean)', 'public.list_posthog_delete_retries(integer)',
        'public.resolve_posthog_delete_retry(uuid,boolean)', 'public.get_deletion_progress(uuid)',
        'public.mark_deletion_unlinked(uuid)']) as fn
    loop
      assert has_function_privilege('service_role', rec.fn, 'EXECUTE'), format('10: service_role 가 %s 를 실행', rec.fn);
      assert not has_function_privilege('authenticated', rec.fn, 'EXECUTE'), format('10: authenticated 는 %s 불가', rec.fn);
    end loop;
    for rec in select unnest(array['ops.nickname_verdict(uuid,text)', 'ops.nickname_suggestions(uuid,text)', 'ops.require_signed_in(uuid)']) as fn loop
      assert not has_function_privilege('authenticated', rec.fn, 'EXECUTE') and not has_function_privilege('service_role', rec.fn, 'EXECUTE'),
        format('10: %s 는 내부 전용', rec.fn);
    end loop;

    -- ── 11 새 ops 표: API 롤 권한 없음 + RLS 켬 ───────────────────────────
    for rec in select unnest(array['ops.deletion_reason_counts', 'ops.deletion_reason_texts', 'ops.posthog_delete_retries', 'ops.deletion_progress']) as tbl loop
      assert not has_table_privilege('anon', rec.tbl, 'SELECT,INSERT,UPDATE,DELETE')
         and not has_table_privilege('authenticated', rec.tbl, 'SELECT,INSERT,UPDATE,DELETE')
         and not has_table_privilege('service_role', rec.tbl, 'SELECT,INSERT,UPDATE,DELETE'),
        format('11: %s 는 API 롤이 접근할 수 없다', rec.tbl);
      assert (select relrowsecurity from pg_class where oid = rec.tbl::regclass), format('11: %s RLS', rec.tbl);
    end loop;
    -- 탈퇴 사유 두 표에는 사용자 식별 열이 없다(사용자 id 없이 저장)
    assert not exists (select 1 from information_schema.columns
                        where table_schema = 'ops' and table_name in ('deletion_reason_counts', 'deletion_reason_texts')
                          and column_name ~* '(user|uid|account|email)'),
      '11: 탈퇴 사유 표에 사용자 식별 열이 있다';

    -- ── 12 lookup_signup_identity ─────────────────────────────────────────
    insert into auth.identities (provider_id, user_id, identity_data, provider)
    values ('apple-sub-' || u2, u2, jsonb_build_object('sub', 'apple-sub-' || u2, 'email', 'Same.Mail@Example.com'), 'apple');
    assert public.lookup_signup_identity('apple', 'apple-sub-' || u2, null) = '{"account": "existing", "other_provider": null}'::jsonb,
      '12: 같은 수단의 기존 identity 는 existing';
    assert public.lookup_signup_identity('apple', 'apple-sub-' || u2, 'other@x.com') ->> 'account' = 'existing', '12: existing 이면 이메일은 보지 않는다';
    v := public.lookup_signup_identity('kakao', 'kakao-sub-new', 'same.mail@example.COM');
    assert v ->> 'account' = 'new' and v ->> 'other_provider' = 'apple', format('12: 같은 이메일 다른 수단(%s)', v);
    v := public.lookup_signup_identity('kakao', 'kakao-sub-new', null);
    assert v ->> 'account' = 'new' and v -> 'other_provider' = 'null'::jsonb, '12: 이메일 없으면 이메일 검사를 건너뛴다';
    v := public.lookup_signup_identity('kakao', 'kakao-sub-new', 'nobody@example.com');
    assert v ->> 'account' = 'new' and v -> 'other_provider' = 'null'::jsonb, '12: 겹치는 이메일 없음';
    v := public.lookup_signup_identity('apple', 'apple-sub-another', 'same.mail@example.com');
    assert v ->> 'account' = 'new' and v -> 'other_provider' = 'null'::jsonb, '12: 같은 수단이면 막지 않는다';
    begin
      perform public.lookup_signup_identity('kakao', '', null);
      raise exception '빈 provider_id 가 통과했다';
    exception when raise_exception then
      if sqlerrm like '%통과했다' then raise; end if;
    end;

    -- ── 13 detach_failure_records: 사용자 id 를 떼고 날짜·사유별 합계로 ─────
    insert into ops.parse_failures (user_id, day, reason, llm_status, count, max_len) values
      (u2, date '2026-11-01', 'text_too_long', 0, 2, 100),
      (u2, date '2026-11-01', 'llm_error', 529, 1, null),
      (u3, date '2026-11-01', 'text_too_long', 0, 5, 300),
      (nil, date '2026-11-01', 'text_too_long', 0, 10, 50);
    insert into ops.purchase_link_failures (user_id, day, reason, llm_status, count, max_len) values
      (u2, date '2026-11-01', 'link_unsafe', 0, 3, null);
    perform public.detach_failure_records(u2);
    assert not exists (select 1 from ops.parse_failures where user_id = u2), '13: 사용자 행이 사라진다';
    assert not exists (select 1 from ops.purchase_link_failures where user_id = u2), '13: 구매처 실패 기록도';
    select count, max_len into rec from ops.parse_failures where user_id = nil and day = date '2026-11-01' and reason = 'text_too_long';
    assert rec.count = 12 and rec.max_len = 100, format('13: 합계(count=%s max_len=%s)', rec.count, rec.max_len);
    assert (select count from ops.parse_failures where user_id = nil and reason = 'llm_error' and llm_status = 529) = 1, '13: 새 행으로 합쳐진다';
    assert (select count from ops.purchase_link_failures where user_id = nil and reason = 'link_unsafe') = 3, '13: 구매처 합계';
    assert (select count from ops.parse_failures where user_id = u3) = 5, '13: 다른 사용자 기록은 그대로';
    perform public.detach_failure_records(u2);
    perform public.detach_failure_records(nil);
    assert (select count from ops.parse_failures where user_id = nil and reason = 'text_too_long') = 12, '13: 두 번 불러도 합계가 늘지 않는다';

    -- ── 14 finalize_account_deletion ──────────────────────────────────────
    insert into public.items (user_id, image_key, product_name, normalized_name)
    values (u3, u3 || '/x.jpg', 'x', 'x');
    insert into ops.parse_failures (user_id, day, reason, llm_status, count) values (u3, date '2026-11-02', 'llm_timeout', 0, 4);

    begin
      perform public.finalize_account_deletion(u3, 'bored', null, false);
      raise exception '잘못된 사유가 통과했다';
    exception when raise_exception then
      if sqlerrm like '%통과했다' then raise; end if;
    end;
    begin
      perform public.finalize_account_deletion(u3, 'other', repeat('가', 201), false);
      raise exception '긴 글이 통과했다';
    exception when raise_exception then
      if sqlerrm like '%통과했다' then raise; end if;
    end;
    assert exists (select 1 from auth.users where id = u3), '14: 거절된 호출은 아무것도 지우지 않는다';

    -- 삭제 진행 상태: 연결 해제를 마친 기록은 다시 불러도 그대로(멱등), 삭제 마무리가 지운다
    assert public.get_deletion_progress(u3) = false, '14: 처음엔 진행 기록이 없다';
    perform public.mark_deletion_unlinked(u3);
    perform public.mark_deletion_unlinked(u3);
    assert public.get_deletion_progress(u3) = true, '14: 연결 해제 완료가 기록된다';
    assert (select count(*) from ops.deletion_progress where user_id = u3) = 1, '14: 두 번 기록해도 한 행';
    assert public.get_deletion_progress(gen_random_uuid()) = false, '14: 다른 사용자는 영향 없다';

    select count(*) into n from ops.deletion_reason_counts where reason = 'other' and day = (now() at time zone 'Asia/Seoul')::date;
    assert public.finalize_account_deletion(u3, 'other', '  기능이 부족합니다  ', true) = 'deleted', '14: 삭제됨';
    assert not exists (select 1 from auth.users where id = u3), '14: 사용자 삭제';
    assert not exists (select 1 from ops.deletion_progress where user_id = u3), '14: 삭제를 마치면 진행 기록(사용자 id)도 지워진다';
    perform public.mark_deletion_unlinked(u3);
    assert not exists (select 1 from ops.deletion_progress where user_id = u3), '14: 이미 지워진 사용자의 진행 기록은 만들지 않는다';
    assert not exists (select 1 from public.items where user_id = u3), '14: 위시 cascade';
    assert not exists (select 1 from public.profiles where user_id = u3), '14: 닉네임 cascade';
    assert not exists (select 1 from ops.parse_failures where user_id = u3), '14: 실패 기록에서 사용자 id 가 떨어졌다';
    assert (select count from ops.parse_failures where user_id = nil and reason = 'llm_timeout') = 4, '14: 합계로 남았다';
    assert (select count from ops.deletion_reason_counts where reason = 'other' and day = (now() at time zone 'Asia/Seoul')::date) = n + 1,
      '14: 사유 횟수 +1';
    assert (select count(*) from ops.deletion_reason_texts where text = '기능이 부족합니다') = 1, '14: 기타 글(트림)이 저장된다';
    assert exists (select 1 from ops.posthog_delete_retries where distinct_id = u3), '14: PostHog 실패면 재시도 표에 남는다';

    -- 다시 부르면 already_deleted 이고 사유가 두 번 세어지지 않는다
    assert public.finalize_account_deletion(u3, 'other', '기능이 부족합니다', true) = 'already_deleted', '14: 다시 부르면 already_deleted';
    assert (select count from ops.deletion_reason_counts where reason = 'other' and day = (now() at time zone 'Asia/Seoul')::date) = n + 1,
      '14: 다시 불러도 사유 횟수가 늘지 않는다';
    assert (select count(*) from ops.deletion_reason_texts where text = '기능이 부족합니다') = 1, '14: 다시 불러도 글이 늘지 않는다';

    -- 사유 없는 삭제, other 가 아닌 사유의 글은 저장하지 않음
    assert public.finalize_account_deletion(u2, 'privacy', '저장되면 안 되는 글', false) = 'deleted', '14: u2 삭제';
    assert not exists (select 1 from ops.deletion_reason_texts where text = '저장되면 안 되는 글'), '14: other 가 아니면 글을 저장하지 않는다';
    assert not exists (select 1 from ops.posthog_delete_retries where distinct_id = u2), '14: PostHog 성공이면 재시도 기록 없음';
    assert public.finalize_account_deletion(ua, null, null, false) = 'deleted', '14: 사유 없는 익명 계정 삭제';

    -- ── 15 PostHog 재시도 표 읽기·정리 ────────────────────────────────────
    assert exists (select 1 from public.list_posthog_delete_retries(50) where distinct_id = u3), '15: 목록에 있다';
    perform public.resolve_posthog_delete_retry(u3, false);
    assert (select attempts from ops.posthog_delete_retries where distinct_id = u3) = 1, '15: 실패하면 횟수 증가';
    perform public.resolve_posthog_delete_retry(u3, true);
    assert not exists (select 1 from ops.posthog_delete_retries where distinct_id = u3), '15: 지웠으면 기록도 지운다';

    -- ── 16 주간 정리 잡 등록 ──────────────────────────────────────────────
    assert exists (select 1 from cron.job where jobname = 'purge-deletion-reason-texts' and active), '16: purge-deletion-reason-texts 잡이 등록돼 있어야 한다';

    raise exception using message = 'accounts_test_passed';
  exception
    when assert_failure then
      outcome := sqlerrm;
    when others then
      outcome := sqlerrm;
  end;

  if outcome is distinct from 'accounts_test_passed' then
    raise exception 'accounts.sql 실패 — %', outcome;
  end if;
end
$$;

select 'accounts.sql: 모든 검사 통과(시험 데이터는 롤백되어 남지 않음)' as result;
