-- =============================================================================
-- WishShot — 고아 이미지 열거 함수 (주 1회 스윕의 "판정부")
--
-- 왜: Storage 파일은 auth.users 삭제 cascade 의 대상이 아니다. 계정이 지워져도
--     item-images/{옛uid}/*.jpg 바이트는 그대로 남고(0002 의 빈 계정 삭제 후,
--     또는 과거 "업로드 성공 후 items INSERT 실패"로도) 아무도 접근하지 못한 채
--     용량을 차지한다. 이 함수가 "살아있는 아이템이 참조하지 않는" 객체 키를
--     열거하면, Edge Function(cleanup-orphan-images)이 Storage API 로만 삭제한다.
--     (불변식 3: storage.objects 행을 SQL 로 직접 DELETE 하면 메타데이터만 사라지고
--      실제 파일 바이트가 S3 에 남아 더 추적 불가능한 고아가 된다 — 열거만 SQL.)
--
-- ⚠️ 불변식 2(가장 치명적): 썸네일 키 {uid}/{id}_thumb.jpg 는 DB 에 저장되지 않는
--    파생 키다(Phase 9, src/lib/queries/storage.ts 의 thumbKeyFromImageKey).
--    items.image_key 만으로 "고아"를 판정하면 모든 썸네일이 고아로 오인돼 전부
--    삭제된다. 살아있는 키 집합은 반드시 "원본 ∪ 썸네일" union 이어야 한다.
--
-- 적용(사람, 대시보드 SQL Editor):
--   1) 이 파일 전체를 실행해 함수를 만든다(삭제 아님 — 함수는 조회만 한다).
--   2) dry-run 으로 건수·샘플을 확인한다(불변식 5). 샘플에 "살아있는 아이템"의
--      원본/썸네일 키가 섞여 있지 않은지 반드시 눈으로 본다:
--
--      select
--        (select count(*) from public.list_orphan_item_images()) as orphan_count,
--        (select array_agg(k) from (
--           select k from public.list_orphan_item_images() k limit 20
--        ) s) as sample;
--
--   3) 실제 삭제는 Edge Function cleanup-orphan-images 가 수행한다(스케줄 등록도
--      사람 — supabase/functions/cleanup-orphan-images/index.ts 참고).
-- =============================================================================

-- item-images 버킷에서 "살아있는 아이템이 참조하지 않는" 객체 키를 돌려준다.
-- security definer: 함수 소유자(postgres) 권한으로 storage.objects 를 읽는다
-- (일반 롤은 storage 스키마 접근 불가). search_path 고정은 definer 함수의
-- 스키마 위장 공격 방지 기본기.
create or replace function public.list_orphan_item_images()
returns setof text
language sql
security definer
set search_path = public, storage
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'item-images'
    and o.name not in (
      -- 살아있는 키 집합 = 원본 image_key ∪ 파생 썸네일 키 (union 누락 금지 — 불변식 2)
      select image_key from public.items
      union all
      -- src/lib/queries/storage.ts thumbKeyFromImageKey 와 동일 규칙:
      -- imageKey.replace(/\.jpg$/i, '_thumb.jpg')
      select regexp_replace(image_key, '\.jpg$', '_thumb.jpg', 'i') from public.items
    )
$$;

comment on function public.list_orphan_item_images() is
  '고아 Storage 키 열거(살아있는 원본∪썸네일 밖). 삭제는 Edge Function cleanup-orphan-images 가 Storage API 로만 수행';

-- 호출 권한: service_role(Edge Function)만. 함수는 기본으로 public 에
-- EXECUTE 가 열리므로 반드시 revoke 로 닫는다(anon/authenticated 노출 금지).
revoke all on function public.list_orphan_item_images() from public, anon, authenticated;
grant execute on function public.list_orphan_item_images() to service_role;
