-- =============================================================================
-- WishShot Phase 2 — 데이터 계약 (스키마 + RLS + Storage)
-- PRD §11 ERD 기준. 이 파일이 계약의 기준선이며, 변경 시 타입(gen types) 재생성.
--
-- 규칙:
--   - 모든 테이블 RLS 강제: user_id = auth.uid() (SELECT/INSERT/UPDATE/DELETE).
--   - price 는 numeric(통화 KRW 고정).
--   - normalized_name 은 서버 전용 중복 판정 컬럼(화면 비노출).
--   - Storage private 버킷 + 경로 첫 세그먼트 = auth.uid() 정책.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 공용: updated_at 자동 갱신 트리거 함수
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- categories — 사용자별 카테고리
-- -----------------------------------------------------------------------------
create table public.categories (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  name       text        not null,
  created_at timestamptz not null default now(),
  -- 같은 사용자 안에서 카테고리 이름 중복 금지
  unique (user_id, name)
);

comment on table public.categories is '사용자별 위시리스트 카테고리';

-- -----------------------------------------------------------------------------
-- items — 위시리스트 아이템
-- category_id 는 nullable(미분류). 카테고리 삭제 시 아이템은 미분류로(SET NULL).
-- -----------------------------------------------------------------------------
create table public.items (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users (id) on delete cascade,
  category_id     uuid        references public.categories (id) on delete set null,
  image_key       text        not null,            -- Storage 객체 키 ({user_id}/{item_id}.jpg)
  product_name    text        not null,            -- 화면 노출(필수)
  brand           text,                            -- 화면 노출(선택)
  normalized_name text        not null,            -- 서버 전용 중복 판정(brand+'|'+product_name 정규화)
  price           numeric,                          -- KRW, nullable
  source_link     text,
  memo            text,
  tags            text[],
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- 같은 사용자 안에서 브랜드+제품명(정규화) 재저장 하드 차단.
  -- 브랜드가 다르면 값이 달라 허용. 브랜드 빈 값은 앱에서 '' 로 정규화.
  unique (user_id, normalized_name)
);

comment on table public.items is '위시리스트 아이템. normalized_name 은 서버 전용 중복 판정 컬럼';
comment on column public.items.normalized_name is '정규화(brand + ''|'' + product_name). 화면 비노출, UNIQUE(user_id, normalized_name) 로 중복 차단';

-- 목록 조회 최적화: 카테고리별 최신순
create index items_user_category_created_idx
  on public.items (user_id, category_id, created_at desc);

-- updated_at 자동 갱신
create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- analysis_logs — 개발자용 OCR/LLM 분석 로그 (Phase 3에서 채움, 지금은 테이블만)
-- -----------------------------------------------------------------------------
create table public.analysis_logs (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  item_id     uuid        references public.items (id) on delete set null,
  raw_text    text,
  parsed      jsonb,
  status      text,
  fail_reason text,
  created_at  timestamptz not null default now()
);

comment on table public.analysis_logs is '개발자용 OCR/LLM 분석 로그 (Phase 3)';

create index analysis_logs_user_idx on public.analysis_logs (user_id);
create index analysis_logs_item_idx on public.analysis_logs (item_id);

-- =============================================================================
-- GRANT — 테이블 접근 권한 (RLS 와 별개의 층)
-- RLS 는 '행' 단위 필터일 뿐, 테이블 접근 자체는 GRANT 가 있어야 한다.
-- 로그인 사용자(authenticated)에게만 부여 → RLS 가 다시 본인 행으로 제한.
-- anon(비로그인)에는 부여하지 않아 아예 차단한다. (grant 는 멱등)
-- =============================================================================
grant select, insert, update, delete on public.categories    to authenticated;
grant select, insert, update, delete on public.items         to authenticated;
grant select, insert, update, delete on public.analysis_logs to authenticated;

-- =============================================================================
-- RLS — 세 테이블 모두 본인 행만 접근 가능
-- =============================================================================
-- 정책의 auth.uid() 는 (select auth.uid()) 로 감싼다 — Supabase RLS 성능 권장 패턴
-- (유저 ID를 행마다 재평가하지 않고 initPlan 으로 1회만 계산).
alter table public.categories    enable row level security;
alter table public.items         enable row level security;
alter table public.analysis_logs enable row level security;

-- categories -----------------------------------------------------------------
create policy "categories_select_own" on public.categories
  for select to authenticated using (user_id = (select auth.uid()));
create policy "categories_insert_own" on public.categories
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "categories_update_own" on public.categories
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "categories_delete_own" on public.categories
  for delete to authenticated using (user_id = (select auth.uid()));

-- items ----------------------------------------------------------------------
create policy "items_select_own" on public.items
  for select to authenticated using (user_id = (select auth.uid()));
create policy "items_insert_own" on public.items
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "items_update_own" on public.items
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "items_delete_own" on public.items
  for delete to authenticated using (user_id = (select auth.uid()));

-- analysis_logs --------------------------------------------------------------
create policy "analysis_logs_select_own" on public.analysis_logs
  for select to authenticated using (user_id = (select auth.uid()));
create policy "analysis_logs_insert_own" on public.analysis_logs
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "analysis_logs_update_own" on public.analysis_logs
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "analysis_logs_delete_own" on public.analysis_logs
  for delete to authenticated using (user_id = (select auth.uid()));

-- =============================================================================
-- Storage — private 버킷 item-images
-- 경로 규칙: {user_id}/{item_id}.jpg → 첫 세그먼트가 본인 uid 인 객체만 접근.
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('item-images', 'item-images', false)
on conflict (id) do nothing;

-- 정책은 create policy 가 멱등이 아니라, 재실행 대비 먼저 정리 후 생성.
drop policy if exists "item_images_select_own" on storage.objects;
drop policy if exists "item_images_insert_own" on storage.objects;
drop policy if exists "item_images_update_own" on storage.objects;
drop policy if exists "item_images_delete_own" on storage.objects;

create policy "item_images_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'item-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "item_images_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'item-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "item_images_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'item-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'item-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "item_images_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'item-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
