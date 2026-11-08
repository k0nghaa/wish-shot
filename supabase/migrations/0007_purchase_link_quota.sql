-- =============================================================================
-- WishShot — 구매처 링크 찾기 함수(find-purchase-links) 요청 한도 + 실패 기록
--
-- 왜: 등록 폼이 분석 뒤 자동으로 이 함수를 부르고, 함수는 웹 검색(검색 1회 $0.01 + 토큰)을
--     쓴다. 익명 로그인이 열려 있어 공개 anon 키만 있으면 누구나 세션을 받아 함수를 부를 수
--     있으므로 호출 수에 상한을 둔다. 정제 함수(0005) 카운터와 따로 센다 — 같이 세면 링크
--     찾기가 정제 한도를 함께 써서 정제가 막힌다.
--
-- 구성(0005 와 같은 구조, 가중치 없음 — 요청 1건 = 1):
--   ops.purchase_link_quota_user    사용자별 창 카운터(매시 정각 창 + 한국 시간 하루 창)
--   ops.purchase_link_quota_global  전체 하루 카운터(한국 날짜) — 차단기
--   ops.purchase_link_failures      실패 기록(사용자·한국 날짜·사유·횟수 + Anthropic 상태 코드·상한 초과 길이)
--   public.consume_purchase_link_quota(...)   카운터 증가 + 판정(한 번의 호출, 거절이면 증가 없음)
--   public.record_purchase_link_failure(...)  실패 1건 기록
--
-- 권한(중요): 두 함수 모두 service_role 전용이다. Edge Function 이 로그인을 확인한
--   사용자 id 를 넘긴다. anon·authenticated 에 열면 앱의 공개 키로 함수를 직접 불러
--   전체 카운터를 채우거나 실패 기록을 꾸밀 수 있다.
--   테이블은 API 비노출 ops 스키마(0004)에 두고 함수(security definer)로만 접근한다.
--
-- 콘텐츠 미저장: 제품명·브랜드·도메인·URL 은 어디에도 넣지 않는다. 실패 기록의 max_len 은
--   입력 상한을 넘은 길이(숫자)만.
--
-- 계정 삭제: 카운터(purchase_link_quota_user)는 auth.users FK cascade — 빈 익명 계정 정리
--   잡(0002)과 맞물려 함께 지워진다. 실패 기록은 FK 를 두지 않아 계정이 지워져도 남는다(0005 와 같음).
-- 오래된 창: consume_purchase_link_quota 가 호출한 사용자 본인의 지난 창을 그때 지운다
--   (사용자당 최대 2행 유지, 별도 cron 불필요). 전체 하루 행은 하루 1행이라 남긴다.
--
-- 적용(사람, 대시보드 SQL Editor): 이 파일 전체 실행 → supabase/tests/purchase_link_quota.sql 실행.
--   함수(find-purchase-links)를 배포하기 전에 적용한다.
-- 되돌리기: supabase/rollback/0007_purchase_link_quota_down.sql
-- =============================================================================

create schema if not exists ops;  -- 0004 에서 만들었다(멱등)

-- -----------------------------------------------------------------------------
-- 1) 테이블
-- -----------------------------------------------------------------------------
create table if not exists ops.purchase_link_quota_user (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  window_kind  text        not null check (window_kind in ('hour', 'day')),
  window_start timestamptz not null,          -- 매시 정각 / 한국 시간 0시
  count        integer     not null check (count >= 0),
  primary key (user_id, window_kind, window_start)
);

create table if not exists ops.purchase_link_quota_global (
  day   date    primary key,                  -- 한국 날짜
  count integer not null check (count >= 0)
);

create table if not exists ops.purchase_link_failures (
  user_id    uuid    not null,                -- auth.users.id (FK 없음: 계정이 정리돼도 기록은 유지)
  day        date    not null,                -- 한국 날짜
  reason     text    not null check (reason in (
               -- 입력 검증(400)
               'invalid_json', 'invalid_input', 'input_too_long', 'invalid_domain', 'invalid_mall',
               -- 요청 한도(429), 카운터 응답 시간 초과(503)
               'rate_limited_user', 'rate_limited_global', 'quota_unavailable',
               -- Anthropic 호출(502/504) — 검색·고르기 공통
               'llm_timeout', 'llm_unreachable', 'llm_error', 'llm_read_error',
               -- 응답은 왔지만 링크를 못 만든 경우(200 { link: null } 과 함께 기록)
               'llm_refusal', 'llm_empty', 'llm_bad_json', 'llm_max_tokens', 'search_error', 'search_paused',
               -- 고른 링크의 안전 확인: 악성 사이트 목록(Google Web Risk)에 오름 / 목록 조회 불가(키 없음·오류) /
               -- 접속 확인(https·인증서·리다이렉트·응답 코드) 실패
               'link_unsafe', 'link_check_unavailable', 'link_unverified'
             )),
  llm_status integer not null default 0 check (llm_status between 0 and 599),  -- llm_error 의 Anthropic 상태 코드, 그 외 0
  count      integer not null check (count > 0),
  max_len    integer check (max_len >= 0),    -- input_too_long 의 넘은 길이 최대값, 그 외 null
  primary key (user_id, day, reason, llm_status)
);

-- API 롤은 테이블에 직접 접근하지 못한다(함수로만). RLS 는 정책 없이 켜 이중 차단(0004 패턴).
revoke all on ops.purchase_link_quota_user, ops.purchase_link_quota_global, ops.purchase_link_failures
  from anon, authenticated, service_role;
alter table ops.purchase_link_quota_user   enable row level security;
alter table ops.purchase_link_quota_global enable row level security;
alter table ops.purchase_link_failures     enable row level security;

-- -----------------------------------------------------------------------------
-- 2) 카운터: 증가 + 판정 (0005 consume_parse_quota 와 같은 규칙, 가중치 없음)
--   - 사용자 하루 창 → 사용자 시간 창 → 전체 하루 순으로 올리고, 하나라도 한도를
--     넘으면 블록 안의 증가를 모두 되돌린다(PL/pgSQL EXCEPTION 블록). 카운터에는
--     "허용된" 요청만 쌓인다.
--   - 사용자 창을 먼저 봐서 사용자 한도에 걸린 요청이 전체 카운터를 올리지 못하게 한다.
--     하루 창을 시간 창보다 먼저 봐야 둘 다 넘었을 때 Retry-After 가 한국 시간 0시를 가리킨다.
--   - 반환: {"allowed": true} 또는
--           {"allowed": false, "scope": "user"|"global", "retry_after_sec": n}
-- -----------------------------------------------------------------------------
create or replace function public.consume_purchase_link_quota(
  p_user_id            uuid,
  p_limit_user_hourly  integer,
  p_limit_user_daily   integer,
  p_limit_global_daily integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now        timestamptz := now();
  v_hour_start timestamptz := date_trunc('hour', v_now, 'Asia/Seoul');
  v_day_start  timestamptz := date_trunc('day',  v_now, 'Asia/Seoul');
  v_kst_day    date        := (v_now at time zone 'Asia/Seoul')::date;
  v_count      integer;
begin
  if p_user_id is null then
    raise exception 'consume_purchase_link_quota: p_user_id is required';
  end if;
  if coalesce(p_limit_user_hourly, 0) < 1
     or coalesce(p_limit_user_daily, 0) < 1
     or coalesce(p_limit_global_daily, 0) < 1 then
    raise exception 'consume_purchase_link_quota: limits must be >= 1';
  end if;

  -- 본인의 지난 창 정리(현재 시간 창·오늘 창만 남김). 판정과 무관하게 먼저 한다.
  delete from ops.purchase_link_quota_user
   where user_id = p_user_id
     and ((window_kind = 'hour' and window_start < v_hour_start)
       or (window_kind = 'day'  and window_start < v_day_start));

  begin
    -- 사용자 하루 창(한국 시간 0시 기준)
    insert into ops.purchase_link_quota_user as q (user_id, window_kind, window_start, count)
    values (p_user_id, 'day', v_day_start, 1)
    on conflict (user_id, window_kind, window_start)
      do update set count = q.count + 1
    returning q.count into v_count;
    if v_count > p_limit_user_daily then
      raise exception using message = 'purchase_link_quota:user_day';
    end if;

    -- 사용자 시간 창
    insert into ops.purchase_link_quota_user as q (user_id, window_kind, window_start, count)
    values (p_user_id, 'hour', v_hour_start, 1)
    on conflict (user_id, window_kind, window_start)
      do update set count = q.count + 1
    returning q.count into v_count;
    if v_count > p_limit_user_hourly then
      raise exception using message = 'purchase_link_quota:user_hour';
    end if;

    -- 전체 하루(차단기)
    insert into ops.purchase_link_quota_global as g (day, count)
    values (v_kst_day, 1)
    on conflict (day)
      do update set count = g.count + 1
    returning g.count into v_count;
    if v_count > p_limit_global_daily then
      raise exception using message = 'purchase_link_quota:global';
    end if;
  exception
    when raise_exception then
      -- 여기 오면 블록 안의 증가는 모두 롤백된 상태다(거절된 요청은 세지 않는다).
      if sqlerrm = 'purchase_link_quota:user_hour' then
        return jsonb_build_object(
          'allowed', false, 'scope', 'user',
          'retry_after_sec', greatest(1, ceil(extract(epoch from (v_hour_start + interval '1 hour' - v_now))))::integer);
      elsif sqlerrm = 'purchase_link_quota:user_day' then
        return jsonb_build_object(
          'allowed', false, 'scope', 'user',
          'retry_after_sec', greatest(1, ceil(extract(epoch from (v_day_start + interval '24 hours' - v_now))))::integer);
      elsif sqlerrm = 'purchase_link_quota:global' then
        return jsonb_build_object(
          'allowed', false, 'scope', 'global',
          'retry_after_sec', greatest(1, ceil(extract(epoch from (v_day_start + interval '24 hours' - v_now))))::integer);
      else
        raise;  -- 예상 밖 오류는 그대로 올린다(Edge Function 이 거절 처리 — fail-closed)
      end if;
  end;

  return jsonb_build_object('allowed', true);
end;
$$;

comment on function public.consume_purchase_link_quota(uuid, integer, integer, integer) is
  '구매처 링크 찾기 요청 한도: 사용자 시간·하루 + 전체 하루 카운터 증가·판정(거절이면 증가 없음). service_role(Edge Function) 전용';

-- -----------------------------------------------------------------------------
-- 3) 실패 기록: (사용자, 한국 날짜, 사유, Anthropic 상태 코드) 행의 횟수를 올린다.
--    사유·상태 코드·길이의 범위는 테이블 check 가 막는다.
-- -----------------------------------------------------------------------------
create or replace function public.record_purchase_link_failure(
  p_user_id    uuid,
  p_reason     text,
  p_llm_status integer default 0,
  p_len        integer default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into ops.purchase_link_failures as f (user_id, day, reason, llm_status, count, max_len)
  values (p_user_id, (now() at time zone 'Asia/Seoul')::date, p_reason, coalesce(p_llm_status, 0), 1, p_len)
  on conflict (user_id, day, reason, llm_status)
    do update set count   = f.count + 1,
                  max_len = greatest(f.max_len, excluded.max_len);  -- greatest 는 null 을 무시
$$;

comment on function public.record_purchase_link_failure(uuid, text, integer, integer) is
  '구매처 링크 찾기 실패 1건 기록(내용 없음 — 사유·횟수·상태 코드·상한 초과 길이). service_role(Edge Function) 전용';

-- -----------------------------------------------------------------------------
-- 4) 함수 권한: service_role(Edge Function)만. 함수는 기본으로 누구나 실행할 수
--    있으므로 public·anon·authenticated 에서 반드시 revoke 한다(0003·0005 패턴).
-- -----------------------------------------------------------------------------
revoke all on function public.consume_purchase_link_quota(uuid, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_purchase_link_quota(uuid, integer, integer, integer)
  to service_role;

revoke all on function public.record_purchase_link_failure(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_purchase_link_failure(uuid, text, integer, integer)
  to service_role;
