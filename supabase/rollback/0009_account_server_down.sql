-- =============================================================================
-- 0009_account_server 되돌리기 — 계정 서버 함수가 쓰는 DB 부품 제거
--
-- 순서(사람):
--   1) 먼저 Edge Function 3개를 지운다(이 함수들은 0009 와 함께 생겼다).
--      npx supabase@2.121.0 functions delete check-signup
--      npx supabase@2.121.0 functions delete merge-anonymous
--      npx supabase@2.121.0 functions delete delete-account
--   2) 이 파일 전체를 SQL Editor 에서 실행한다.
--
-- 되돌릴 수 없는 것: 탈퇴 사유 두 표·PostHog 재시도 표의 내용, 이미 nil uuid 행으로 합쳐진 실패 기록(사용자별로 되돌릴 수 없음).
-- 되돌리지 않는 것: 0009 7번의 service_role CRUD grant(0001 이후 이미 있었을 수 있어 회수하지 않는다.
--   회수하려면 사람이 판단해 revoke select, insert, update, delete on public.items, public.categories,
--   public.analysis_logs from service_role; 를 따로 실행한다).
-- =============================================================================

select cron.unschedule('purge-deletion-reason-texts')
where exists (select 1 from cron.job where jobname = 'purge-deletion-reason-texts');

drop function if exists public.finalize_account_deletion(uuid, text, text, boolean);
drop function if exists public.mark_deletion_unlinked(uuid);
drop function if exists public.get_deletion_progress(uuid);
drop function if exists public.resolve_posthog_delete_retry(uuid, boolean);
drop function if exists public.list_posthog_delete_retries(integer);
drop function if exists public.detach_failure_records(uuid);
drop function if exists public.lookup_signup_identity(text, text, text);

drop table if exists ops.deletion_progress;
drop table if exists ops.posthog_delete_retries;
drop table if exists ops.deletion_reason_texts;
drop table if exists ops.deletion_reason_counts;

-- 확인: 아래 쿼리 모두 0행이어야 한다.
--   select proname from pg_proc where proname in ('lookup_signup_identity', 'detach_failure_records',
--     'finalize_account_deletion', 'list_posthog_delete_retries', 'resolve_posthog_delete_retry',
--     'get_deletion_progress', 'mark_deletion_unlinked');
--   select table_name from information_schema.tables where table_schema = 'ops'
--    and table_name in ('deletion_reason_counts', 'deletion_reason_texts', 'posthog_delete_retries', 'deletion_progress');
--   select jobname from cron.job where jobname = 'purge-deletion-reason-texts';
