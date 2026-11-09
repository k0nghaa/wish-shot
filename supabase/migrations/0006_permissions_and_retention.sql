-- =============================================================================
-- WishShot — 권한 정리 · 업로드 제한 · 분석 로그 보존 규칙
--
-- 구성:
--   1) 함수 기본 실행 권한: postgres 가 새로 만드는 함수는 Postgres 기본값으로 누구나(PUBLIC)
--      실행할 수 있다 → 끈다(공식 문서 "Hardening the Data API"의 방법). postgres 가 다른
--      스키마에 만드는 함수에도 적용된다. 앞으로 앱(authenticated)·Edge Function(service_role)이
--      부를 함수는 마이그레이션에서 EXECUTE 를 직접 부여한다(테이블 GRANT 규칙 9와 같은 방식).
--      트리거·이벤트 트리거 함수는 실행 권한과 무관하게 발화한다.
--   2) public 테이블: 앱이 쓰지 않는 권한(TRUNCATE·REFERENCES·TRIGGER·MAINTAIN)을 API 롤에서
--      회수하고, 앞으로 public 에 만드는 테이블에도 붙지 않게 postgres 의 기본 권한에서 뺀다.
--      CRUD 권한·RLS 정책은 그대로다.
--   3) 함수 정리: set_updated_at(트리거 함수)의 search_path 고정 + 실행 권한 회수.
--      rls_auto_enable(새 테이블에 RLS 를 자동으로 켜는 이벤트 트리거 함수 — Supabase 가 설치,
--      있을 때만)의 실행 권한 회수.
--   4) item-images 버킷: 파일 크기 3MB · JPEG 만. 앱은 원본(긴 변 1600px)·썸네일(400px)을
--      JPEG 로만 올린다. 업로드할 때만 검사하므로 이미 저장된 파일에는 영향이 없다.
--   5) 분석 로그 보존: 위시를 지우면(외래 키가 item_id 를 비울 때) 그 위시의 분석 로그에서
--      인식 텍스트(raw_text)와 AI 결과(parsed)를 비운다. 상태·실패 사유·시각과 분석 경로
--      표시(parsed.source)만 남긴다(지표용). 개발자 계정(ops.internal_users)은 건너뛴다
--      (정답셋·재현 사례용). 이미 위시 연결이 없는 로그도 같은 기준으로 한 번 비운다.
--
-- 적용(사람, 대시보드 SQL Editor = postgres 롤): 이 파일 전체 실행 →
--   supabase/tests/rls.sql 테스트 4·5 → supabase/tests/audit.sql 재실행.
-- 되돌리기: supabase/rollback/0006_permissions_and_retention_down.sql
--   (5번에서 비운 내용은 되돌릴 수 없다)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) 함수 기본 실행 권한 — postgres 가 만드는 함수(모든 스키마)
--    전역(스키마 미지정)으로 바꿔야 Postgres 기본값(PUBLIC EXECUTE)이 빠진다.
-- -----------------------------------------------------------------------------
alter default privileges for role postgres revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- 2) public 테이블 — 앱이 쓰지 않는 권한 회수(지금 테이블 + 앞으로 만들 테이블)
-- -----------------------------------------------------------------------------
revoke truncate, references, trigger, maintain
  on public.categories, public.items, public.analysis_logs
  from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables
  from anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3) 함수 정리
-- -----------------------------------------------------------------------------
-- now() 는 pg_catalog 라 search_path 를 비워도 찾는다.
alter function public.set_updated_at() set search_path = '';
revoke all on function public.set_updated_at() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 4) item-images 버킷 — 업로드 크기·형식 제한
-- -----------------------------------------------------------------------------
update storage.buckets
   set file_size_limit    = 3145728,            -- 3MB(바이트)
       allowed_mime_types = array['image/jpeg']
 where id = 'item-images';

-- -----------------------------------------------------------------------------
-- 5) 분석 로그 보존
--    위시 삭제 → 외래 키(on delete set null)가 analysis_logs.item_id 를 비운다 →
--    이 트리거가 같은 행의 내용을 비운다. 함수는 API 비노출 ops 스키마에 두고,
--    개발자 목록(ops.internal_users)을 읽으려고 security definer 로 둔다.
-- -----------------------------------------------------------------------------
create or replace function ops.clear_analysis_log_content()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from ops.internal_users iu where iu.user_id = new.user_id) then
    new.raw_text := null;
    -- 분석 경로 표시(source)는 내용이 아니라 구분값이라 남긴다
    new.parsed := case when jsonb_typeof(old.parsed) = 'object' and old.parsed ? 'source'
                       then jsonb_build_object('source', old.parsed -> 'source')
                       else null end;
  end if;
  return new;
end;
$$;

comment on function ops.clear_analysis_log_content() is
  '위시 삭제로 analysis_logs.item_id 가 비워질 때 raw_text·parsed 를 비운다(source 표시는 유지, 개발자 계정 제외)';

revoke all on function ops.clear_analysis_log_content() from public, anon, authenticated;

drop trigger if exists analysis_logs_clear_content_on_unlink on public.analysis_logs;
create trigger analysis_logs_clear_content_on_unlink
  before update of item_id on public.analysis_logs
  for each row
  when (old.item_id is not null and new.item_id is null)
  execute function ops.clear_analysis_log_content();

-- 이미 위시 연결이 없는 로그를 같은 기준으로 한 번 비운다(개발자 계정 제외).
update public.analysis_logs l
   set raw_text = null,
       parsed   = case when jsonb_typeof(l.parsed) = 'object' and l.parsed ? 'source'
                       then jsonb_build_object('source', l.parsed -> 'source')
                       else null end
 where l.item_id is null
   and (l.raw_text is not null or l.parsed is not null)
   and not exists (select 1 from ops.internal_users iu where iu.user_id = l.user_id);
