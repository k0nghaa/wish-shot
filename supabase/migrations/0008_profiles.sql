-- =============================================================================
-- WishShot — 로그인 계정의 닉네임(profiles) + 닉네임 DB 함수 3개
--
-- 근거: docs/phases/phase-22-account-login.md '확정된 결정 — 닉네임', '설계 1'.
--
-- 구성:
--   public.profiles               로그인 계정의 닉네임. 사용자당 1행. 본인 행 읽기만(직접 쓰기 권한 없음)
--   public.ensure_profile()       로그인 뒤 매번 부른다. 없으면 추천 닉네임("위시러"+숫자)으로 만들고 {nickname, created}
--   public.check_nickname(name)   입력을 멈추면 부르는 검사. {result: available|taken|invalid_length|invalid_chars|reserved|unchanged, suggestions?}
--   public.set_nickname(name)     같은 검사 뒤 저장. {result: saved|taken|invalid_length|invalid_chars|reserved, nickname?|suggestions?}
--   ops.nickname_verdict(...)     위 두 검사가 함께 쓰는 판정(API 비노출)
--   ops.nickname_suggestions(...) 사용 중일 때 돌려줄 추천 2개(API 비노출)
--
-- 규칙(문서와 같음):
--   - 닉네임은 NFC 로 정규화한 뒤 2~12자, 한글(완성형 가-힣)·영문·숫자만(띄어쓰기·특수문자 없음).
--   - 닉네임 자체가 고유: 비교 키 = lower(NFC(닉네임)) 에 UNIQUE(대소문자 무시, 한글은 NFC 뒤 비교).
--   - 예약어 6개는 키가 정확히 같을 때만 막는다: 위시샷, wishshot, 관리자, 운영자, admin, 위시샷공식 ('위시샷공식2' 는 통과).
--   - 변경 제한 없음. 바꾸거나 계정을 지우면(auth.users cascade) 그 닉네임은 바로 다시 쓸 수 있다.
--   - 검사 순서: 글자 종류 → 길이(코드 포인트 수 2~12) → 예약어 → 지금 닉네임과 같음(unchanged) → 사용 중(taken).
--     NFC 로 바꾼 뒤 앞뒤 공백도 그대로 검사한다(자르지 않음). 허용 글자 = 한글 완성형(가~힣)·ASCII 영문·숫자.
--     내 지금 닉네임과 키만 같고 글자 모양(대소문자)이 다르면 available — 대소문자만 바꿀 수 있다.
--   - set_nickname 이 지금 닉네임과 똑같은 값을 받으면 쓰지 않고 {result:'saved'} 를 돌려준다(멱등).
--   - 동시에 같은 이름을 저장하면 UNIQUE(nickname_key) 가 하나만 통과시키고 나머지는 taken(추천 포함).
--
-- 권한: profiles 는 authenticated 에 SELECT 만 + RLS(본인 행). anon·service_role 권한 없음.
--   쓰기는 security definer 함수(set search_path = '')만 한다. 세 공개 함수는 authenticated 에만 EXECUTE.
--   ensure_profile·set_nickname 은 익명 계정이면 거절한다(익명 여부는 JWT 클레임이 아니라 auth.users 로 확인 —
--   연결 직후 옛 토큰의 클레임이 낡았을 수 있다).
--
-- 적용(사람, 대시보드 SQL Editor): 이 파일 전체 실행 → supabase/tests/accounts.sql 실행 → rls.sql 테스트 6 → audit.sql.
-- 되돌리기: supabase/rollback/0008_profiles_down.sql
-- 타입 재생성(src/types/database.ts)은 적용한 뒤 사람이 한다.
-- =============================================================================

create schema if not exists ops;  -- 0004 에서 만들었다(멱등)

-- -----------------------------------------------------------------------------
-- 1) 테이블
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id      uuid        primary key references auth.users (id) on delete cascade,
  nickname     text        not null,
  nickname_key text        not null unique,   -- lower(NFC(nickname)) — 고유성 판정용
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_nickname_format
    check (char_length(nickname) between 2 and 12 and nickname ~ '^[가-힣A-Za-z0-9]+$'),
  constraint profiles_nickname_key_matches
    check (nickname_key = lower(normalize(nickname, nfc)) and nickname = normalize(nickname, nfc))
);

comment on table public.profiles is '로그인 계정의 닉네임(사용자당 1행). 쓰기는 ensure_profile·set_nickname 함수만';
comment on column public.profiles.nickname_key is 'lower(NFC(nickname)) — UNIQUE. 대소문자·NFC 만 다른 이름을 같은 이름으로 본다';

-- 권한을 처음부터 다시 정한다: 본인 행 읽기만(authenticated). anon·service_role 은 없음.
revoke all on public.profiles from anon, authenticated, service_role;
grant select on public.profiles to authenticated;

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 2) 내부 함수(API 비노출 ops 스키마) — 호출자는 아래 public 함수(소유자 권한)뿐
-- -----------------------------------------------------------------------------

-- 추천 닉네임 2개: 요청한 이름에서 끝 숫자를 뗀 앞부분(최대 8자) + 숫자 2자리·3자리(예: 민지27·민지815).
-- 사용 중이거나 예약어이거나 이미 뽑은 값이면 다시 뽑는다(최대 40번). 결과는 2개보다 적을 수 있다.
create or replace function ops.nickname_suggestions(p_user_id uuid, p_name text)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base  text := left(regexp_replace(normalize(coalesce(p_name, ''), nfc), '[0-9]+$', ''), 8);
  v_out   text[] := array[]::text[];
  v_cand  text;
  v_tries int := 0;
begin
  if v_base is null or v_base = '' or v_base !~ '^[가-힣A-Za-z0-9]+$' then
    v_base := '위시러';
  end if;
  while coalesce(array_length(v_out, 1), 0) < 2 and v_tries < 40 loop
    v_tries := v_tries + 1;
    -- 첫 추천은 2자리, 둘째는 3자리
    if coalesce(array_length(v_out, 1), 0) = 0 then
      v_cand := v_base || (10 + floor(random() * 90))::int::text;
    else
      v_cand := v_base || (100 + floor(random() * 900))::int::text;
    end if;
    if v_cand = any (v_out) then
      continue;
    end if;
    if exists (select 1 from public.profiles pr
                where pr.nickname_key = lower(v_cand) and pr.user_id is distinct from p_user_id) then
      continue;
    end if;
    v_out := v_out || v_cand;
  end loop;
  return v_out;
end;
$$;

-- 판정. 반환: {result, nickname?(available 일 때 NFC 로 정규화한 값), suggestions?(taken 일 때)}
create or replace function ops.nickname_verdict(p_user_id uuid, p_raw text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name    text;
  v_key     text;
  v_current text;
begin
  -- 아주 긴 입력은 정규화하지 않고 길이 오류로 본다
  if p_raw is null or char_length(p_raw) > 1000 then
    return jsonb_build_object('result', 'invalid_length');
  end if;
  -- NFC 로 바꾼 뒤 앞뒤 공백도 그대로 검사한다(자르지 않음)
  v_name := normalize(p_raw, nfc);

  -- 검사 순서: 글자 종류 → 길이(코드 포인트 수 2~12) → 예약어 → 중복
  -- 허용 = 한글 완성형(가~힣)·ASCII 영문·숫자. 자모 단독·전각·악센트·공백·특수문자는 invalid_chars.
  if v_name !~ '^[가-힣A-Za-z0-9]*$' then
    return jsonb_build_object('result', 'invalid_chars');
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 12 then
    return jsonb_build_object('result', 'invalid_length');
  end if;

  v_key := lower(v_name);
  -- 예약어는 정확히 같을 때만(대소문자 무시)
  if v_key = any (array['위시샷', 'wishshot', '관리자', '운영자', 'admin', '위시샷공식']) then
    return jsonb_build_object('result', 'reserved');
  end if;

  select pr.nickname into v_current from public.profiles pr where pr.user_id = p_user_id;
  if v_current is not null and v_current = v_name then
    return jsonb_build_object('result', 'unchanged');
  end if;

  if exists (select 1 from public.profiles pr
              where pr.nickname_key = v_key and pr.user_id is distinct from p_user_id) then
    return jsonb_build_object('result', 'taken',
                              'suggestions', to_jsonb(ops.nickname_suggestions(p_user_id, v_name)));
  end if;

  return jsonb_build_object('result', 'available', 'nickname', v_name);
end;
$$;

-- 로그인 확인: 익명이면 거절(익명 계정에는 닉네임이 없다)
create or replace function ops.require_signed_in(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if coalesce((select u.is_anonymous from auth.users u where u.id = p_user_id), true) then
    raise exception 'anonymous_not_allowed' using errcode = '42501';
  end if;
end;
$$;

revoke all on function ops.nickname_suggestions(uuid, text) from public, anon, authenticated;
revoke all on function ops.nickname_verdict(uuid, text)     from public, anon, authenticated;
revoke all on function ops.require_signed_in(uuid)          from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) 앱이 부르는 함수 3개(authenticated)
-- -----------------------------------------------------------------------------

-- 로그인 뒤 매번. 프로필이 없으면 "위시러"+숫자 4자리로 만든다(겹치면 다시 뽑고, 10번 겹치면 자릿수를 늘림).
-- 반환: {nickname, created} — created 면 닉네임 화면. 동시에 두 번 불러도 created 는 한 번만 true.
create or replace function public.ensure_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_digits int  := 4;
  v_try    int  := 0;
  v_name   text;
  v_new    text;
begin
  perform ops.require_signed_in(v_uid);

  select pr.nickname into v_name from public.profiles pr where pr.user_id = v_uid;
  if v_name is not null then
    return jsonb_build_object('nickname', v_name, 'created', false);
  end if;

  loop
    v_try := v_try + 1;
    if v_try > 10 and v_digits < 8 then
      v_digits := v_digits + 1;  -- 자릿수를 늘려 다시 뽑는다
      v_try := 1;
    end if;
    v_new := '위시러' || lpad(floor(random() * power(10, v_digits))::bigint::text, v_digits, '0');
    begin
      insert into public.profiles (user_id, nickname, nickname_key)
      values (v_uid, v_new, lower(v_new))
      on conflict (user_id) do nothing;
      if found then
        return jsonb_build_object('nickname', v_new, 'created', true);
      end if;
      -- 같은 사용자의 다른 호출이 먼저 만들었다
      select pr.nickname into v_name from public.profiles pr where pr.user_id = v_uid;
      return jsonb_build_object('nickname', v_name, 'created', false);
    exception
      when unique_violation then
        -- 닉네임 키가 겹쳤거나(다시 뽑는다) 동시 호출이 끼어들었다(이미 있으면 그것을 돌려준다)
        select pr.nickname into v_name from public.profiles pr where pr.user_id = v_uid;
        if v_name is not null then
          return jsonb_build_object('nickname', v_name, 'created', false);
        end if;
    end;
  end loop;
end;
$$;

comment on function public.ensure_profile() is
  '로그인 뒤 매번 호출. 닉네임이 없으면 추천값으로 만들고 {nickname, created} 를 돌려준다(익명 계정은 거절)';

-- 닉네임 검사(쓰지 않음). 익명 계정도 부를 수 있지만 저장은 못 한다.
create or replace function public.check_nickname(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return ops.nickname_verdict(v_uid, p_name) - 'nickname';
end;
$$;

comment on function public.check_nickname(text) is
  '닉네임 검사: {result: available|taken|invalid_length|invalid_chars|reserved|unchanged, suggestions?}';

-- 닉네임 저장: 같은 검사 뒤 쓴다. UNIQUE 위반(동시 선점)은 taken + 추천.
create or replace function public.set_nickname(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_verdict jsonb;
  v_name    text;
begin
  perform ops.require_signed_in(v_uid);

  v_verdict := ops.nickname_verdict(v_uid, p_name);

  if v_verdict ->> 'result' = 'unchanged' then
    select pr.nickname into v_name from public.profiles pr where pr.user_id = v_uid;
    return jsonb_build_object('result', 'saved', 'nickname', v_name);
  end if;
  if v_verdict ->> 'result' <> 'available' then
    return v_verdict - 'nickname';
  end if;

  v_name := v_verdict ->> 'nickname';
  begin
    insert into public.profiles as pr (user_id, nickname, nickname_key)
    values (v_uid, v_name, lower(v_name))
    on conflict (user_id) do update
      set nickname = excluded.nickname, nickname_key = excluded.nickname_key, updated_at = now();
  exception
    when unique_violation then
      -- 검사와 저장 사이에 다른 사람이 같은 이름을 가져갔다
      return jsonb_build_object('result', 'taken',
                                'suggestions', to_jsonb(ops.nickname_suggestions(v_uid, v_name)));
  end;
  return jsonb_build_object('result', 'saved', 'nickname', v_name);
end;
$$;

comment on function public.set_nickname(text) is
  '닉네임 저장: {result: saved|taken|invalid_length|invalid_chars|reserved, nickname?|suggestions?}(익명 계정은 거절)';

revoke all on function public.ensure_profile()      from public, anon, authenticated;
revoke all on function public.check_nickname(text)  from public, anon, authenticated;
revoke all on function public.set_nickname(text)    from public, anon, authenticated;
grant execute on function public.ensure_profile()     to authenticated;
grant execute on function public.check_nickname(text) to authenticated;
grant execute on function public.set_nickname(text)   to authenticated;
