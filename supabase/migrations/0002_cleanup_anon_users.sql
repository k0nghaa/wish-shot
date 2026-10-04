-- =============================================================================
-- WishShot — 빈 익명 계정 자동 삭제 (pg_cron, 주 1회)
--
-- 왜: 익명 로그인 특성상 앱 설치→삭제→재설치마다 접근 불가능한 옛 익명 계정이
--     auth.users 에 계속 쌓인다(앱 삭제 = AsyncStorage 세션 소실, 옛 uid 복구 불가).
--     이 중 "잃을 게 없는" 빈 계정만 주기적으로 삭제해 auth.users 비대화를 막는다.
--
-- 삭제 조건(승인된 범위 — 임의 변경 금지):
--   is_anonymous = true  AND  created_at < now() - 30일  AND  items 0건
--   - "아이템이 있는 계정은 절대 삭제하지 않는다"(불변식 1).
--     not exists(items) 조건 누락 = 전 사용자 데이터 삭제 사고. 반드시 유지.
--   - 카테고리만 있는 계정은 라벨뿐이므로 함께 삭제된다(cascade).
--   - 30일 대기는 데이터 보호가 아니라 "버려진 계정" 확신용 — 빈 계정이라
--     삭제돼도 재접속 시 새 익명 세션이 투명하게 발급돼 사용자는 잃는 게 없다.
--
-- 동작 범위:
--   - auth.users 행 삭제 → public.categories/items/analysis_logs 는 FK cascade 로
--     함께 삭제(0001_init.sql). GoTrue 내부 테이블(auth.identities·auth.sessions·
--     auth.refresh_tokens 등)의 cascade 는 적용 후 1건 타깃 삭제로 사람이 확인한다.
--   - Storage 파일은 cascade 대상이 아니다 → 0003 의 고아 파일 스윕이 따로 정리.
--
-- 적용(사람, 대시보드 SQL Editor — 불변식 5):
--   1) 먼저 아래 dry-run 조회로 삭제 대상 건수가 합리적인지 눈으로 확인한다.
--   2) 합리적이면 이 파일 전체를 실행해 확장 활성화 + 주간 잡을 등록한다.
--   ※ 반드시 SQL Editor(= postgres 롤)에서 실행한다. pg_cron 잡은 "등록한 롤의
--     권한"으로 실행되므로(auth.users DELETE 권한 필요), 다른 롤로 등록하면
--     권한 오류가 날 수 있다.
-- =============================================================================

-- 1) pg_cron 활성화 (멱등)
create extension if not exists pg_cron;

-- 2) dry-run — 잡 등록 전에 사람이 먼저 실행해 확인한다(삭제 아님, 조회만):
--
--   select count(*) as to_delete
--   from auth.users u
--   where u.is_anonymous = true
--     and u.created_at < now() - interval '30 days'
--     and not exists (select 1 from public.items i where i.user_id = u.id);
--
--   ※ "합리적"인지 맥락 확인 — 전체 익명 유저 대비 "오래되고 빈" 일부만이어야 한다:
--
--   select
--     count(*)                                                        as anon_total,
--     count(*) filter (where u.created_at < now() - interval '30 days') as anon_30d_plus,
--     count(*) filter (where u.created_at < now() - interval '30 days'
--       and not exists (select 1 from public.items i where i.user_id = u.id)) as to_delete
--   from auth.users u
--   where u.is_anonymous = true;
--

-- 3) 주 1회 삭제 잡 (토요일 18:00 UTC = 한국 일요일 03:00 — 심야 저트래픽.
--    지시서 예시였던 '일 03:00 UTC'는 한국 기준 정오(활동 시간대)라 조정, 2026-10-04)
--    같은 이름의 잡이 있으면 먼저 내리고 다시 등록한다(재실행 멱등 —
--    pg_cron 은 동일 이름 upsert 를 보장하지 않으므로 조건부 unschedule).
select cron.unschedule('delete-empty-anon-users')
where exists (select 1 from cron.job where jobname = 'delete-empty-anon-users');

select cron.schedule(
  'delete-empty-anon-users',
  '0 18 * * 6',
  $$
    delete from auth.users u
    where u.is_anonymous = true
      and u.created_at < now() - interval '30 days'
      and not exists (select 1 from public.items i where i.user_id = u.id)
  $$
);

-- 등록 확인:  select jobname, schedule, active from cron.job;
-- 실행 이력:  select * from cron.job_run_details order by start_time desc limit 10;
-- 해제(조건·주기 변경 시 재등록 전):  select cron.unschedule('delete-empty-anon-users');
