-- =============================================================================
-- 0005_parse_quota 되돌리기 — 요청 한도 카운터·실패 기록 테이블과 함수 제거
--
-- 순서(사람):
--   1) 먼저 Edge Function parse-screenshot-text 를 이전 버전으로 되돌려 재배포한다
--      (git 에서 0005 이전 index.ts 로 → npx supabase functions deploy parse-screenshot-text).
--      ※ 순서를 바꿔도 사용자 영향은 없다 — 새 함수는 카운터 오류 시 호출을 허용하고
--        (fail-open) 기록 오류는 무시한다. 다만 그동안 요청마다 오류 로그가 남는다.
--   2) 이 파일 전체를 SQL Editor 에서 실행한다.
--
-- ops 스키마는 0004(ops.internal_users) 소유라 지우지 않는다.
-- 테이블을 지우면 카운터·실패 기록은 복구할 수 없다(필요하면 먼저 내보낸다).
-- =============================================================================

drop function if exists public.consume_parse_quota(uuid, integer, integer, integer, integer);
drop function if exists public.record_parse_failure(uuid, text, integer, integer);

drop table if exists ops.parse_failures;
drop table if exists ops.parse_quota_global;
drop table if exists ops.parse_quota_user;

-- 확인: 아래 두 쿼리 모두 0행이어야 한다.
--   select proname from pg_proc where proname in ('consume_parse_quota', 'record_parse_failure');
--   select table_name from information_schema.tables
--    where table_schema = 'ops' and table_name in ('parse_quota_user', 'parse_quota_global', 'parse_failures');
