-- =============================================================================
-- 0006_permissions_and_retention 되돌리기 — 적용 전 권한·설정으로 돌린다
--
-- 순서(사람): 이 파일 전체를 SQL Editor 에서 실행한 뒤 supabase/tests/audit.sql 로 확인한다.
-- 앱·Edge Function 은 0006 에 의존하지 않아 함께 되돌릴 것이 없다.
--
-- 되돌릴 수 없는 것: 0006 의 5번이 비운 분석 로그 내용(raw_text·parsed)과, 0006 적용 뒤
--   위시 삭제로 비워진 내용. 트리거만 없어지고 비운 값은 돌아오지 않는다.
-- 권한은 적용 전과 실효 권한이 같아지게 다시 부여한다(ACL 표기는 기본값 대신 명시 항목이 될 수 있다).
-- =============================================================================

-- 5) 분석 로그 보존 트리거·함수
drop trigger if exists analysis_logs_clear_content_on_unlink on public.analysis_logs;
drop function if exists ops.clear_analysis_log_content();

-- 4) 버킷 제한 해제
update storage.buckets
   set file_size_limit = null, allowed_mime_types = null
 where id = 'item-images';

-- 3) 함수 정리 되돌리기
alter function public.set_updated_at() reset search_path;
grant execute on function public.set_updated_at() to public;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    grant execute on function public.rls_auto_enable() to public;
  end if;
end
$$;

-- 2) public 테이블 권한·기본 권한 되돌리기
grant truncate, references, trigger, maintain
  on public.categories, public.items, public.analysis_logs
  to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant truncate, references, trigger, maintain on tables
  to anon, authenticated, service_role;

-- 1) 함수 기본 실행 권한 되돌리기(Postgres 기본값으로)
alter default privileges for role postgres grant execute on functions to public;
