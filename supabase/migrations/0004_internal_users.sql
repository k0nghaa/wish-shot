-- =============================================================================
-- WishShot — 내부(개발자·테스트) 사용자 목록 (지표 집계 제외용)
--
-- 왜: 테스트 지표(supabase/tests/metrics.sql)에서 개발 기기 uid 를 걸러야 하는데,
--     uid 목록을 SQL·문서에 하드코딩하면 git 에 남는다. 목록은 DB 에만 두고
--     쿼리는 이 테이블을 참조한다(PostHog 의 $internal_or_test_user 플래그와 같은 역할).
--
-- 노출 차단: public 이 아닌 ops 스키마에 둔다 → PostgREST(API)에 노출되지 않고
--   supabase gen types 대상도 아니다. anon·authenticated 에는 아무 권한도 주지 않는다
--   (이 프로젝트는 GRANT 자동 부여가 없지만 의도를 명시하려 revoke 도 적는다).
--   SQL Editor(postgres 롤)에서만 읽고 쓴다.
--
-- 적용(사람, 대시보드 SQL Editor): 이 파일 전체 실행 → 아래 예시처럼 uid 를 insert.
--   insert into ops.internal_users (user_id, note) values
--     ('<uid>', '현 개발 기기'),
--     ('<uid>', '테스트 시작 전 개발 기기');
--   개발 기기를 재설치해 새 uid 가 생기면 여기에 추가한다(PostHog 플래그도 함께).
-- =============================================================================

create schema if not exists ops;
revoke all on schema ops from anon, authenticated;

create table if not exists ops.internal_users (
  user_id    uuid primary key,          -- auth.users.id (FK 없음: 계정이 정리돼도 기록은 유지)
  note       text,                      -- 식별 메모(예: '현 개발 기기')
  created_at timestamptz not null default now()
);

revoke all on ops.internal_users from anon, authenticated;
alter table ops.internal_users enable row level security;  -- 정책 없음 = API 롤 접근 불가(이중 차단)
