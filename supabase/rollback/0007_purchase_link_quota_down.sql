-- =============================================================================
-- 0007_purchase_link_quota 되돌리기 — 구매처 링크 찾기 요청 한도 카운터·실패 기록 테이블과 함수 제거
--
-- 순서(사람):
--   1) 먼저 Edge Function find-purchase-links 를 지운다(이 함수는 0007 과 함께 생겼다).
--      npx supabase functions delete find-purchase-links
--      ※ 함수를 남긴 채 이 파일만 실행해도 함수는 카운터 오류로 모든 요청을 거절한다(fail-closed —
--        링크만 빈칸). 그래도 요청마다 오류 로그가 남으므로 함수를 먼저 지운다.
--   2) 이 파일 전체를 SQL Editor 에서 실행한다.
--
-- ops 스키마는 0004(ops.internal_users) 소유라 지우지 않는다.
-- 테이블을 지우면 카운터·실패 기록은 복구할 수 없다(필요하면 먼저 내보낸다).
-- =============================================================================

drop function if exists public.consume_purchase_link_quota(uuid, integer, integer, integer);
drop function if exists public.record_purchase_link_failure(uuid, text, integer, integer);

drop table if exists ops.purchase_link_failures;
drop table if exists ops.purchase_link_quota_global;
drop table if exists ops.purchase_link_quota_user;

-- 확인: 아래 두 쿼리 모두 0행이어야 한다.
--   select proname from pg_proc where proname in ('consume_purchase_link_quota', 'record_purchase_link_failure');
--   select table_name from information_schema.tables
--    where table_schema = 'ops'
--      and table_name in ('purchase_link_quota_user', 'purchase_link_quota_global', 'purchase_link_failures');
