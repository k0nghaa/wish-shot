-- =============================================================================
-- 구매처 링크 찾기 요청 한도·실패 기록 검증 SQL (0007_purchase_link_quota)
-- 실행: Supabase 대시보드 SQL Editor 에서 블록별로 실행(사람이 확인). 0007 적용 직후, 함수 배포 전.
-- 판정: 블록 1 은 결과가 주석의 기대값과 같아야 통과. 블록 2 는 마지막에
--       "모든 검사 통과"가 나오면 통과 — 하나라도 어긋나면 해당 검사 번호가 담긴 오류로 멈춘다.
-- 흔적: 블록 2 는 가짜 사용자를 만들어 시험한 뒤 블록 안에서 모든 변경을 되돌린다(남는 것 없음).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 블록 1 (권한) — 앱 쪽 롤(anon·authenticated)은 함수·테이블에 접근하지 못하고,
-- 함수는 service_role(Edge Function)만 실행할 수 있다.
-- 기대:
--   function 행 → anon false, authenticated false, service_role true
--   table 행    → 전부 false(테이블은 함수로만 접근)
--   schema 행   → anon false, authenticated false
-- -----------------------------------------------------------------------------
select kind, obj, anon, authenticated, service_role
from (
  select 'function' as kind, fn as obj,
         has_function_privilege('anon',          fn, 'EXECUTE') as anon,
         has_function_privilege('authenticated', fn, 'EXECUTE') as authenticated,
         has_function_privilege('service_role',  fn, 'EXECUTE') as service_role
  from unnest(array[
    'public.consume_purchase_link_quota(uuid,integer,integer,integer)',
    'public.record_purchase_link_failure(uuid,text,integer,integer)'
  ]) as fn
  union all
  select 'table', t,
         has_table_privilege('anon',          t, 'SELECT,INSERT,UPDATE,DELETE'),
         has_table_privilege('authenticated', t, 'SELECT,INSERT,UPDATE,DELETE'),
         has_table_privilege('service_role',  t, 'SELECT,INSERT,UPDATE,DELETE')
  from unnest(array[
    'ops.purchase_link_quota_user', 'ops.purchase_link_quota_global', 'ops.purchase_link_failures'
  ]) as t
  union all
  select 'schema', 'ops',
         has_schema_privilege('anon',          'ops', 'USAGE'),
         has_schema_privilege('authenticated', 'ops', 'USAGE'),
         null
) x;

-- -----------------------------------------------------------------------------
-- 블록 2 (동작) — 블록 전체(do ~ 마지막 select)를 한 번에 실행한다.
--   가짜 익명 사용자 2명을 만들고, 함수는 service_role 로 부른다(Edge Function 과 같은 롤).
--   한도는 시험용 값을 인자로 넘긴다(운영 값과 무관).
--   되돌리기: 시험 전체를 안쪽 블록에서 돌린 뒤 일부러 예외('purchase_link_quota_test_passed')를
--     던져 그 블록의 변경을 모두 롤백한다. 명시적 begin 을 쓰지 않으므로 검사가 실패해도
--     트랜잭션이 열린 채 남지 않는다.
--   ※ 전체 하루 검사(3번)는 "지금 전체 카운트 + 1"을 한도로 쓴다. 시험 도중 실제 요청이
--     끼어들면 드물게 3-1 이 실패할 수 있다 — 그때는 다시 실행한다.
--   ※ 정제 함수 카운터(0005)는 건드리지 않는다 — 6번에서 확인한다. 정제 함수는 운영 중이라
--     두 번 읽는 사이에 실제 정제 요청이 들어오면 드물게 6-1 이 실패할 수 있다 — 그때도 다시 실행한다.
-- -----------------------------------------------------------------------------
do $$
declare
  u1        uuid := gen_random_uuid();
  u2        uuid := gen_random_uuid();
  kst_day   date := (now() at time zone 'Asia/Seoul')::date;
  -- now() 는 트랜잭션 안에서 고정이라 함수가 계산한 Retry-After 와 정확히 같아야 한다
  to_hour   integer := greatest(1, ceil(extract(epoch from
                 (date_trunc('hour', now(), 'Asia/Seoul') + interval '1 hour' - now()))))::integer;
  to_day    integer := greatest(1, ceil(extract(epoch from
                 (date_trunc('day', now(), 'Asia/Seoul') + interval '24 hours' - now()))))::integer;
  r         jsonb;
  c         integer;
  m         integer;
  g0        integer;
  p0        integer;
  failed    boolean;
  outcome   text;
begin
  begin
    -- 준비: 가짜 익명 사용자(이 블록 끝에서 롤백되어 사라진다)
    insert into auth.users (id, aud, role, is_anonymous)
    values (u1, 'authenticated', 'authenticated', true),
           (u2, 'authenticated', 'authenticated', true);

    -- ── 1. 사용자 시간당 한도 2: 1·2번째 허용, 3번째 거절(scope=user) ──
    set local role service_role;
    r := public.consume_purchase_link_quota(u1, 2, 100, 1000000);
    assert (r->>'allowed')::boolean, '1-1: 첫 요청이 허용돼야 한다';
    r := public.consume_purchase_link_quota(u1, 2, 100, 1000000);
    assert (r->>'allowed')::boolean, '1-2: 두 번째 요청이 허용돼야 한다';
    r := public.consume_purchase_link_quota(u1, 2, 100, 1000000);
    assert not (r->>'allowed')::boolean and r->>'scope' = 'user', '1-3: 세 번째 요청은 scope=user 로 거절돼야 한다';
    assert (r->>'retry_after_sec')::integer = to_hour,
      format('1-4: Retry-After 는 다음 정각까지(%s 기대, 실제 %s)', to_hour, r->>'retry_after_sec');
    reset role;
    select count into c from ops.purchase_link_quota_user where user_id = u1 and window_kind = 'hour';
    assert c = 2, format('1-5: 거절된 요청은 세지 않는다(시간 창 2 기대, 실제 %s)', c);
    select count into c from ops.purchase_link_quota_user where user_id = u1 and window_kind = 'day';
    assert c = 2, format('1-6: 시간 한도에 걸린 요청은 하루 창 증가도 되돌린다(2 기대, 실제 %s)', c);

    -- ── 2. 사용자 하루 한도: 하루 창 2인 상태에서 한도 2 → 거절, 한도 3 → 허용 ──
    set local role service_role;
    r := public.consume_purchase_link_quota(u1, 100, 2, 1000000);
    assert not (r->>'allowed')::boolean and r->>'scope' = 'user', '2-1: 하루 한도 초과는 scope=user 로 거절돼야 한다';
    assert (r->>'retry_after_sec')::integer = to_day,
      format('2-2: Retry-After 는 한국 시간 0시까지(%s 기대, 실제 %s)', to_day, r->>'retry_after_sec');
    r := public.consume_purchase_link_quota(u1, 100, 3, 1000000);
    assert (r->>'allowed')::boolean, '2-3: 하루 한도 3이면 허용돼야 한다';
    reset role;
    select count into c from ops.purchase_link_quota_user where user_id = u1 and window_kind = 'hour';
    assert c = 3, format('2-4: 시간 창 3 기대(하루 한도 거절은 시간 창을 올리지 않음), 실제 %s', c);
    select count into c from ops.purchase_link_quota_user where user_id = u1 and window_kind = 'day';
    assert c = 3, format('2-5: 하루 창 3 기대, 실제 %s', c);

    -- ── 2b. 시간·하루 한도를 둘 다 넘으면 Retry-After 는 한국 시간 0시(정각이 아님) ──
    set local role service_role;
    r := public.consume_purchase_link_quota(u1, 3, 3, 1000000);  -- 시간 창 3, 하루 창 3 → 둘 다 초과
    assert not (r->>'allowed')::boolean and (r->>'retry_after_sec')::integer = to_day,
      format('2b-1: 둘 다 넘으면 0시까지(%s 기대, 실제 %s)', to_day, r->>'retry_after_sec');
    reset role;

    -- ── 3. 전체 하루 한도: 지금 전체 카운트 + 1 을 한도로 → 1번 허용, 다음은 scope=global 거절 ──
    select coalesce((select count from ops.purchase_link_quota_global where day = kst_day), 0) into g0;
    set local role service_role;
    r := public.consume_purchase_link_quota(u2, 100, 100, g0 + 1);
    assert (r->>'allowed')::boolean, '3-1: 전체 한도 안이면 허용돼야 한다(실제 요청이 끼어들었으면 다시 실행)';
    r := public.consume_purchase_link_quota(u2, 100, 100, g0 + 1);
    assert not (r->>'allowed')::boolean and r->>'scope' = 'global', '3-2: 전체 한도 초과는 scope=global 로 거절돼야 한다';
    assert (r->>'retry_after_sec')::integer = to_day,
      format('3-3: Retry-After 는 한국 시간 0시까지(%s 기대, 실제 %s)', to_day, r->>'retry_after_sec');
    reset role;
    select count into c from ops.purchase_link_quota_global where day = kst_day;
    assert c = g0 + 1, format('3-4: 거절된 요청은 전체 카운터를 올리지 않는다(%s 기대, 실제 %s)', g0 + 1, c);
    select count into c from ops.purchase_link_quota_user where user_id = u2 and window_kind = 'hour';
    assert c = 1, format('3-5: 전체 한도에 걸린 요청은 사용자 카운터 증가도 되돌린다(1 기대, 실제 %s)', c);

    -- ── 4. 사용자 한도에 걸린 요청은 전체 카운터를 올리지 않는다(계정 하나로 차단기 채우기 방지) ──
    select count into g0 from ops.purchase_link_quota_global where day = kst_day;
    set local role service_role;
    r := public.consume_purchase_link_quota(u1, 1, 100, 1000000);  -- u1 시간 창은 이미 3 > 1
    assert not (r->>'allowed')::boolean and r->>'scope' = 'user', '4-1: 사용자 한도 초과로 거절돼야 한다';
    reset role;
    select count into c from ops.purchase_link_quota_global where day = kst_day;
    assert c = g0, format('4-2: 전체 카운터가 그대로여야 한다(%s 기대, 실제 %s)', g0, c);

    -- ── 5. 한도 인자 검사: 0 이하는 오류 ──
    failed := false;
    begin
      set local role service_role;
      r := public.consume_purchase_link_quota(u2, 0, 100, 100);
    exception when others then
      failed := true;
    end;
    reset role;
    assert failed, '5-1: 한도 0 은 오류여야 한다';

    -- ── 6. 정제 함수 카운터(0005)는 그대로 ──
    select coalesce((select count from ops.parse_quota_global where day = kst_day), 0) into p0;
    set local role service_role;
    r := public.consume_purchase_link_quota(u2, 100, 100, 1000000);
    reset role;
    select coalesce((select count from ops.parse_quota_global where day = kst_day), 0) into c;
    assert c = p0, format('6-1: 정제 전체 카운터가 그대로여야 한다(%s 기대, 실제 %s)', p0, c);
    assert not exists (select 1 from ops.parse_quota_user where user_id in (u1, u2)),
      '6-2: 정제 사용자 카운터에 행이 생기면 안 된다';

    -- ── 7. 지난 창 정리: 2시간 전 시간 창은 본인의 다음 호출 때 지워진다 ──
    insert into ops.purchase_link_quota_user (user_id, window_kind, window_start, count)
    values (u2, 'hour', date_trunc('hour', now(), 'Asia/Seoul') - interval '2 hours', 5);
    set local role service_role;
    r := public.consume_purchase_link_quota(u2, 100, 100, 1000000);
    reset role;
    select count(*) into c from ops.purchase_link_quota_user
     where user_id = u2 and window_kind = 'hour' and window_start < date_trunc('hour', now(), 'Asia/Seoul');
    assert c = 0, format('7-1: 지난 시간 창이 지워져야 한다(남은 행 %s)', c);

    -- ── 8. 실패 기록: 같은 사유는 횟수가 오르고, 넘은 길이는 최대값만, 상태 코드별로 따로 ──
    set local role service_role;
    perform public.record_purchase_link_failure(u1, 'input_too_long', 0, 300);
    perform public.record_purchase_link_failure(u1, 'input_too_long', 0, 250);
    perform public.record_purchase_link_failure(u1, 'llm_error', 529, null);
    perform public.record_purchase_link_failure(u1, 'search_error');
    failed := false;
    begin
      perform public.record_purchase_link_failure(u1, 'not_a_reason');
    exception when others then
      failed := true;
    end;
    assert failed, '8-1: 목록에 없는 사유는 거절돼야 한다';
    reset role;
    select count, max_len into c, m from ops.purchase_link_failures where user_id = u1 and reason = 'input_too_long';
    assert c = 2 and m = 300, format('8-2: input_too_long 2건·최대 300 기대, 실제 %s건·%s', c, m);
    select count into c from ops.purchase_link_failures where user_id = u1 and reason = 'llm_error' and llm_status = 529;
    assert c = 1, '8-3: llm_error(529) 1건이어야 한다';
    select count into c from ops.purchase_link_failures
     where user_id = u1 and reason = 'search_error' and llm_status = 0 and max_len is null;
    assert c = 1, '8-4: search_error 1건(상태 코드 0, 길이 없음)이어야 한다';

    -- ── 9. 계정이 지워지면 카운터는 함께 지워지고(FK cascade), 실패 기록은 남는다(FK 없음) ──
    delete from auth.users where id in (u1, u2);
    assert not exists (select 1 from ops.purchase_link_quota_user where user_id in (u1, u2)),
      '9-1: 사용자 카운터가 남으면 안 된다';
    select count(*) into c from ops.purchase_link_failures where user_id = u1;
    assert c = 3, format('9-2: 실패 기록은 계정 삭제 뒤에도 남아야 한다(3행 기대, 실제 %s)', c);

    -- 여기까지 오면 전부 통과 → 일부러 예외를 던져 이 블록의 변경을 모두 롤백한다
    raise exception using message = 'purchase_link_quota_test_passed';
  exception
    -- assert 실패(assert_failure)는 others 에 잡히지 않아 따로 적는다
    when assert_failure then
      outcome := sqlerrm;
    when others then
      outcome := sqlerrm;
  end;

  if outcome is distinct from 'purchase_link_quota_test_passed' then
    raise exception 'purchase_link_quota.sql 블록 2 실패 — %', outcome;
  end if;
end
$$;

select 'purchase_link_quota.sql 블록 2: 모든 검사 통과(시험 데이터는 롤백되어 남지 않음)' as result;
