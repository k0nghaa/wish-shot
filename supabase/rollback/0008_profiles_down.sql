-- =============================================================================
-- 0008_profiles 되돌리기 — 닉네임 표와 DB 함수 제거
--
-- 순서(사람): 앱이 ensure_profile·check_nickname·set_nickname 을 부르는 빌드가 배포돼 있으면 먼저 내린다
--   (함수가 없으면 로그인 뒤 닉네임 단계가 실패한다). 그다음 이 파일 전체를 SQL Editor 에서 실행한다.
-- 0009 보다 나중에 적용했으면 0009 를 먼저 되돌려도 되고 순서는 상관없다(서로 참조하지 않는다).
--
-- 되돌릴 수 없는 것: profiles 의 닉네임 전부(필요하면 먼저 내보낸다).
-- =============================================================================

drop function if exists public.set_nickname(text);
drop function if exists public.check_nickname(text);
drop function if exists public.ensure_profile();
drop function if exists ops.nickname_verdict(uuid, text);
drop function if exists ops.nickname_suggestions(uuid, text);
drop function if exists ops.require_signed_in(uuid);

drop table if exists public.profiles;

-- 확인: 아래 쿼리 모두 0행이어야 한다.
--   select proname from pg_proc where proname in ('ensure_profile', 'check_nickname', 'set_nickname',
--     'nickname_verdict', 'nickname_suggestions', 'require_signed_in');
--   select table_name from information_schema.tables where table_schema = 'public' and table_name = 'profiles';
