-- =============================================================================
-- WishShot — 계정 서버 함수(가입 확인·합치기·계정 삭제)가 쓰는 DB 부품
--
-- 근거: docs/phases/phase-22-account-login.md '설계 1', '확정된 결정 — 계정 삭제', 불변식 4~9.
--
-- 구성:
--   public.lookup_signup_identity(...)   가입 확인용 조회: 이 로그인 수단의 기존 계정인지 / 같은 이메일이 다른 수단인지(auth.identities)
--   public.detach_failure_records(uid)   실패 기록(ops.parse_failures·ops.purchase_link_failures)에서 사용자 id 를 떼어
--                                         nil uuid(00000000-…) 행에 날짜·사유별 합계로 합친다
--   ops.deletion_reason_counts           탈퇴 사유: 날짜·사유별 횟수(사용자 id 없음, 계속 보관)
--   ops.deletion_reason_texts            탈퇴 사유 "기타" 직접 입력 글(200자 이하, 사용자 id 없음, 3년 뒤 주간 작업이 지움)
--   ops.posthog_delete_retries           PostHog 프로필 삭제에 실패한 식별자(주간 정리 작업이 다시 지우고 비움)
--   ops.deletion_progress                삭제 진행 상태: 소셜 연결 해제(Apple 철회·카카오 해제)를 마친 사용자 id. 다시 부르면 그 단계를 건너뛴다(두 번 해제하지 않음).
--                                         삭제 마무리(finalize_account_deletion)가 같은 트랜잭션에서 행을 지우므로 삭제를 마치면 사용자 id 가 남지 않는다
--   public.finalize_account_deletion(...) 삭제의 DB 쪽 마무리 — 한 트랜잭션: 실패 기록 합산 → 탈퇴 사유 기록 → 재시도 표 기록 → 사용자 삭제(cascade)
--   public.list_posthog_delete_retries / resolve_posthog_delete_retry   재시도 표 읽기·정리
--   public.get_deletion_progress / mark_deletion_unlinked               삭제 진행 상태 읽기·기록
--   pg_cron 주간 잡 purge-deletion-reason-texts   3년 지난 "기타" 글, 포기한 재시도 기록, 30일 넘게 멈춘 삭제 진행 기록 삭제
--
-- 사용자 id 를 남기지 않는 것(불변식 8): 탈퇴 사유 두 표에는 사용자 id·계정 정보 열이 없다. 실패 기록은 id 를 떼고 합계만 남긴다.
--   PostHog 재시도 표만 지우지 못한 식별자(Supabase uid = PostHog distinct id)를 잠시 가진다 — 지우면 그 행도 지운다.
--
-- 권한: 새 함수는 모두 service_role 전용(Edge Function 이 부른다). 앱의 공개 키로는 부를 수 없다. 새 ops 표는 API 롤 권한 없음 + RLS 켬(0004 패턴).
--   public.items·categories·analysis_logs 에는 service_role 의 CRUD 를 명시한다(합치기 함수가 다룬다 — 이미 있으면 변화 없음).
--
-- 적용(사람, 대시보드 SQL Editor): 0008 다음에 이 파일 전체 실행 → supabase/tests/accounts.sql → rls.sql 테스트 6 → audit.sql.
--   0002 처럼 pg_cron 확장이 켜져 있어야 한다. Edge Function 3개(check-signup·merge-anonymous·delete-account)는 이 파일을 적용한 뒤 배포한다.
-- 되돌리기: supabase/rollback/0009_account_server_down.sql
-- =============================================================================

create schema if not exists ops;  -- 0004 에서 만들었다(멱등)

-- -----------------------------------------------------------------------------
-- 1) 표
-- -----------------------------------------------------------------------------
create table if not exists ops.deletion_reason_counts (
  day    date    not null,                    -- 한국 날짜
  reason text    not null check (reason in ('rarely_used', 'missing_feature', 'other_account', 'privacy', 'other')),
  count  integer not null check (count > 0),
  primary key (day, reason)
);

create table if not exists ops.deletion_reason_texts (
  id         bigint      generated always as identity primary key,
  created_at timestamptz not null default now(),
  text       text        not null check (char_length(text) between 1 and 200)
);
create index if not exists deletion_reason_texts_created_idx on ops.deletion_reason_texts (created_at);

create table if not exists ops.deletion_progress (
  user_id     uuid        primary key,       -- 삭제를 시작한 사용자(FK 없음: 마무리 함수가 사용자와 함께 지운다)
  unlinked_at timestamptz not null default now()  -- 소셜 연결 해제를 마친 시각
);

create table if not exists ops.posthog_delete_retries (
  distinct_id     uuid        primary key,    -- Supabase uid(= PostHog distinct id). FK 없음: 사용자는 이미 지워졌다
  created_at      timestamptz not null default now(),
  attempts        integer     not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz
);

revoke all on ops.deletion_reason_counts, ops.deletion_reason_texts, ops.posthog_delete_retries, ops.deletion_progress
  from anon, authenticated, service_role;
alter table ops.deletion_reason_counts enable row level security;
alter table ops.deletion_reason_texts  enable row level security;
alter table ops.posthog_delete_retries enable row level security;
alter table ops.deletion_progress      enable row level security;

-- -----------------------------------------------------------------------------
-- 2) 가입 확인 조회 — 같은 이메일 + 다른 수단이면 막기 위한 근거
--    반환: {"account": "existing"|"new", "other_provider": "apple"|"kakao"|"google"|null}
--      - 이 수단(provider)의 기존 identity(provider_id 일치)가 있으면 existing.
--      - 아니면 new. 이메일이 주어졌고 같은 이메일(대소문자 무시)의 다른 수단 identity 가 있으면 other_provider 에 그 수단.
--    google 은 아직 안 쓰지만 같은 자동 연결이 적용되므로 미리 막는다. 개발용 email 수단은 보지 않는다.
-- -----------------------------------------------------------------------------
create or replace function public.lookup_signup_identity(
  p_provider    text,
  p_provider_id text,
  p_email       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_other text;
begin
  if coalesce(p_provider, '') = '' or coalesce(p_provider_id, '') = '' then
    raise exception 'lookup_signup_identity: provider and provider_id are required';
  end if;

  if exists (select 1 from auth.identities i
              where i.provider = p_provider and i.provider_id = p_provider_id) then
    return jsonb_build_object('account', 'existing', 'other_provider', null);
  end if;

  if coalesce(btrim(p_email), '') <> '' then
    select i.provider into v_other
      from auth.identities i
     where i.provider in ('apple', 'kakao', 'google')
       and i.provider <> p_provider
       and lower(coalesce(i.identity_data ->> 'email', i.email)) = lower(btrim(p_email))
     order by i.created_at
     limit 1;
  end if;

  return jsonb_build_object('account', 'new', 'other_provider', v_other);
end;
$$;

comment on function public.lookup_signup_identity(text, text, text) is
  '가입 확인 조회: 이 수단의 기존 계정이면 existing, 같은 이메일의 다른 수단이 있으면 other_provider. service_role(Edge Function) 전용';

-- -----------------------------------------------------------------------------
-- 3) 실패 기록에서 사용자 id 떼기: 날짜·사유별 합계로 nil uuid 행에 합친다.
--    두 표 모두. nil uuid 자신에게는 아무것도 하지 않는다(멱등 — 두 번 불러도 합계가 늘지 않는다).
-- -----------------------------------------------------------------------------
create or replace function public.detach_failure_records(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nil constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  if p_user_id is null then
    raise exception 'detach_failure_records: p_user_id is required';
  end if;
  if p_user_id = v_nil then
    return;
  end if;

  insert into ops.parse_failures as f (user_id, day, reason, llm_status, count, max_len)
  select v_nil, s.day, s.reason, s.llm_status, s.count, s.max_len
    from ops.parse_failures s
   where s.user_id = p_user_id
  on conflict (user_id, day, reason, llm_status)
    do update set count   = f.count + excluded.count,
                  max_len = greatest(f.max_len, excluded.max_len);  -- greatest 는 null 을 무시
  delete from ops.parse_failures where user_id = p_user_id;

  insert into ops.purchase_link_failures as f (user_id, day, reason, llm_status, count, max_len)
  select v_nil, s.day, s.reason, s.llm_status, s.count, s.max_len
    from ops.purchase_link_failures s
   where s.user_id = p_user_id
  on conflict (user_id, day, reason, llm_status)
    do update set count   = f.count + excluded.count,
                  max_len = greatest(f.max_len, excluded.max_len);
  delete from ops.purchase_link_failures where user_id = p_user_id;
end;
$$;

comment on function public.detach_failure_records(uuid) is
  '실패 기록(정제·구매처 링크)에서 사용자 id 를 떼고 날짜·사유별 합계를 nil uuid 행에 합친다. service_role 전용';

-- -----------------------------------------------------------------------------
-- 4) 삭제 마무리(한 트랜잭션) — 문서 순서 ④의 DB 부분 + ⑤
--    Edge Function 이 연결 해제(②)·사진 삭제(③)·PostHog 삭제를 마친 뒤 부른다.
--    반환: 'deleted' | 'already_deleted'(사용자 없음 — 아무것도 기록하지 않는다 → 다시 불러도 사유가 두 번 세어지지 않는다)
--    p_reason: 사용자가 고른 사유(없으면 null). 'other' 일 때만 p_reason_text(200자 이하)를 저장한다.
--    p_posthog_pending: PostHog 프로필을 못 지웠으면 true → 재시도 표에 식별자를 남긴다.
-- -----------------------------------------------------------------------------
create or replace function public.finalize_account_deletion(
  p_user_id          uuid,
  p_reason           text,
  p_reason_text      text,
  p_posthog_pending  boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day  date := (now() at time zone 'Asia/Seoul')::date;
  v_text text;
begin
  if p_user_id is null then
    raise exception 'finalize_account_deletion: p_user_id is required';
  end if;
  if p_reason is not null and p_reason not in ('rarely_used', 'missing_feature', 'other_account', 'privacy', 'other') then
    raise exception 'finalize_account_deletion: invalid reason';
  end if;
  v_text := nullif(btrim(coalesce(p_reason_text, '')), '');
  if v_text is not null and char_length(v_text) > 200 then
    raise exception 'finalize_account_deletion: reason text too long';
  end if;

  -- 같은 사용자를 동시에 지우려는 호출이 겹치지 않게 행을 잠근다
  perform 1 from auth.users where id = p_user_id for update;
  if not found then
    return 'already_deleted';
  end if;

  perform public.detach_failure_records(p_user_id);

  if p_reason is not null then
    insert into ops.deletion_reason_counts as c (day, reason, count)
    values (v_day, p_reason, 1)
    on conflict (day, reason) do update set count = c.count + 1;
    if p_reason = 'other' and v_text is not null then
      insert into ops.deletion_reason_texts (text) values (v_text);
    end if;
  end if;

  if coalesce(p_posthog_pending, false) then
    insert into ops.posthog_delete_retries (distinct_id) values (p_user_id)
    on conflict (distinct_id) do nothing;
  end if;

  -- 삭제 진행 기록(사용자 id)도 함께 지운다 — 삭제를 마치면 사용자 id 가 어디에도 남지 않는다
  delete from ops.deletion_progress where user_id = p_user_id;

  -- 위시·카테고리·분석 기록·닉네임·로그인 정보(identities)·세션이 cascade 로 함께 지워진다
  delete from auth.users where id = p_user_id;
  return 'deleted';
end;
$$;

comment on function public.finalize_account_deletion(uuid, text, text, boolean) is
  '계정 삭제의 DB 마무리(실패 기록 합산·탈퇴 사유 기록·PostHog 재시도 기록·사용자 삭제 — 한 트랜잭션). 사용자 없으면 already_deleted. service_role 전용';

-- -----------------------------------------------------------------------------
-- 5) PostHog 재시도 표 읽기·정리 (주간 정리 작업이 부른다)
-- -----------------------------------------------------------------------------
create or replace function public.list_posthog_delete_retries(p_limit integer default 50)
returns table (distinct_id uuid, attempts integer)
language sql
security definer
set search_path = ''
as $$
  select r.distinct_id, r.attempts
    from ops.posthog_delete_retries r
   order by r.created_at
   limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

create or replace function public.resolve_posthog_delete_retry(p_distinct_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_done, false) then
    delete from ops.posthog_delete_retries where distinct_id = p_distinct_id;  -- 지웠으면 그 기록도 지운다
  else
    update ops.posthog_delete_retries
       set attempts = attempts + 1, last_attempt_at = now()
     where distinct_id = p_distinct_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5-2) 삭제 진행 상태: 소셜 연결 해제를 마쳤는지. 다시 부르면 끝난 단계를 건너뛴다(연결 해제를 두 번 하지 않는다).
-- -----------------------------------------------------------------------------
create or replace function public.get_deletion_progress(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (select 1 from ops.deletion_progress p where p.user_id = p_user_id)
$$;

create or replace function public.mark_deletion_unlinked(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'mark_deletion_unlinked: p_user_id is required';
  end if;
  -- 이미 지워진 사용자의 기록이 새로 생기지 않게 사용자가 있을 때만 남긴다
  if exists (select 1 from auth.users u where u.id = p_user_id) then
    insert into ops.deletion_progress (user_id) values (p_user_id) on conflict (user_id) do nothing;
  end if;
end;
$$;

comment on function public.get_deletion_progress(uuid) is '계정 삭제 진행 상태: 소셜 연결 해제를 이미 마쳤는지. service_role 전용';
comment on function public.mark_deletion_unlinked(uuid) is '계정 삭제 진행 상태 기록: 소셜 연결 해제 완료. 삭제 마무리가 지운다. service_role 전용';
comment on function public.list_posthog_delete_retries(integer) is 'PostHog 프로필 삭제 재시도 대상(오래된 순). service_role 전용';
comment on function public.resolve_posthog_delete_retry(uuid, boolean) is 'PostHog 삭제 재시도 결과 반영(성공이면 행 삭제, 실패면 횟수 증가). service_role 전용';

-- -----------------------------------------------------------------------------
-- 6) 함수 권한: service_role 만(0005·0007 패턴)
-- -----------------------------------------------------------------------------
revoke all on function public.lookup_signup_identity(text, text, text)               from public, anon, authenticated;
revoke all on function public.detach_failure_records(uuid)                           from public, anon, authenticated;
revoke all on function public.finalize_account_deletion(uuid, text, text, boolean)   from public, anon, authenticated;
revoke all on function public.list_posthog_delete_retries(integer)                   from public, anon, authenticated;
revoke all on function public.resolve_posthog_delete_retry(uuid, boolean)            from public, anon, authenticated;
revoke all on function public.get_deletion_progress(uuid)                            from public, anon, authenticated;
revoke all on function public.mark_deletion_unlinked(uuid)                           from public, anon, authenticated;
grant execute on function public.lookup_signup_identity(text, text, text)             to service_role;
grant execute on function public.detach_failure_records(uuid)                         to service_role;
grant execute on function public.finalize_account_deletion(uuid, text, text, boolean) to service_role;
grant execute on function public.list_posthog_delete_retries(integer)                 to service_role;
grant execute on function public.resolve_posthog_delete_retry(uuid, boolean)          to service_role;
grant execute on function public.get_deletion_progress(uuid)                          to service_role;
grant execute on function public.mark_deletion_unlinked(uuid)                         to service_role;

-- -----------------------------------------------------------------------------
-- 7) 합치기 함수(merge-anonymous)가 service_role 로 위시·카테고리·분석 기록을 읽고 옮긴다 → CRUD 를 명시한다.
--    (grant 는 멱등. TRUNCATE·REFERENCES·TRIGGER·MAINTAIN 은 0006 대로 주지 않는다.)
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.items         to service_role;
grant select, insert, update, delete on public.categories    to service_role;
grant select, insert, update, delete on public.analysis_logs to service_role;

-- -----------------------------------------------------------------------------
-- 8) 주간 정리 잡: 3년 지난 탈퇴 사유 "기타" 글, 12번 실패해 포기한 PostHog 재시도 기록, 30일 넘게 멈춘 삭제 진행 기록
--    토요일 18:05 UTC = 한국 일요일 03:05(0002 의 03:00 잡 직후). 같은 이름이 있으면 먼저 내리고 다시 등록한다(멱등).
-- -----------------------------------------------------------------------------
select cron.unschedule('purge-deletion-reason-texts')
where exists (select 1 from cron.job where jobname = 'purge-deletion-reason-texts');

select cron.schedule(
  'purge-deletion-reason-texts',
  '5 18 * * 6',
  $$
    delete from ops.deletion_reason_texts where created_at < now() - interval '3 years';
    delete from ops.posthog_delete_retries where attempts >= 12;
    delete from ops.deletion_progress where unlinked_at < now() - interval '30 days';
  $$
);

-- 등록 확인:  select jobname, schedule, active from cron.job;
