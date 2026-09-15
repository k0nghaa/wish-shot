import { normalizeName } from '@/lib/normalize';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';

import { getCurrentUserId } from './auth';
import { DuplicateItemError } from './errors';

export type Item = Tables<'items'>;

/**
 * 아이템 생성 입력. `normalized_name` 은 여기서 받지 않고 저장 시 brand+product_name 으로
 * 자동 계산한다(정규화 소스 1개 원칙).
 *
 * `id` 는 선택: Step 4 는 Storage 경로(`{user_id}/{item_id}.jpg`)와 행 id 를 맞추기 위해
 * 아이템 id 를 미리 만들어 넘긴다. 생략하면 DB 가 생성한다.
 */
export interface NewItemInput {
  id?: string;
  categoryId: string | null;
  imageKey: string;
  productName: string;
  brand?: string | null;
  price?: number | null;
  sourceLink?: string | null;
  memo?: string | null;
  tags?: string[] | null;
}

/** 전체 아이템(최신순). 홈에서 카테고리별 개수/대표 썸네일 계산에 쓴다. */
export async function listItems(): Promise<Item[]> {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`아이템을 불러오지 못했습니다: ${error.message}`);
  return data ?? [];
}

/**
 * 카테고리별 아이템(최신순). `categoryId === null` 이면 미분류(category_id is null)만 조회.
 */
export async function listItemsByCategory(categoryId: string | null): Promise<Item[]> {
  const base = supabase
    .from('items')
    .select('*')
    .order('created_at', { ascending: false });
  const query = categoryId === null ? base.is('category_id', null) : base.eq('category_id', categoryId);
  const { data, error } = await query;
  if (error) throw new Error(`아이템을 불러오지 못했습니다: ${error.message}`);
  return data ?? [];
}

/**
 * 내가 쓴 모든 태그를 빈도 내림차순(동률은 가나다순)으로 반환한다.
 * 등록·편집 화면의 "기존 태그 선택" 칩에 쓴다. RLS로 본인 아이템만 집계된다.
 */
export async function listAllTags(): Promise<string[]> {
  const { data, error } = await supabase.from('items').select('tags');
  if (error) throw new Error(`태그를 불러오지 못했습니다: ${error.message}`);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    for (const t of row.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .map(([tag]) => tag);
}

/** 특정 태그가 달린 아이템(최신순). 카테고리와 무관하게 모아 본다(FR-15a 태그 필터 보기). */
export async function listItemsByTag(tag: string): Promise<Item[]> {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .contains('tags', [tag])
    .order('created_at', { ascending: false });
  if (error) throw new Error(`아이템을 불러오지 못했습니다: ${error.message}`);
  return data ?? [];
}

/** 단건 조회. */
export async function getItem(id: string): Promise<Item> {
  const { data, error } = await supabase.from('items').select('*').eq('id', id).single();
  if (error) throw new Error(`아이템을 불러오지 못했습니다: ${error.message}`);
  return data;
}

/**
 * 아이템 생성. `normalized_name` 을 brand+product_name 으로 계산해 함께 저장한다.
 * 같은 (user_id, normalized_name) 이 이미 있으면 UNIQUE 위반(23505)이 난다 —
 * Step 4 는 이를 덮어쓰기 모달로 폴백한다.
 */
export async function createItem(input: NewItemInput): Promise<Item> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('items')
    .insert({
      id: input.id,
      user_id: userId,
      category_id: input.categoryId,
      image_key: input.imageKey,
      product_name: input.productName,
      brand: input.brand ?? null,
      normalized_name: normalizeName(input.brand, input.productName),
      price: input.price ?? null,
      source_link: input.sourceLink ?? null,
      memo: input.memo ?? null,
      tags: input.tags ?? null,
    })
    .select()
    .single();
  if (error) {
    // 사전조회를 놓친 중복(경합)은 23505 로 잡아 덮어쓰기 모달로 폴백한다.
    if (error.code === '23505') throw new DuplicateItemError();
    throw new Error(`아이템을 저장하지 못했습니다: ${error.message}`);
  }
  return data;
}

/** 아이템 수정 입력. `normalized_name` 은 brand+product_name 으로 재계산한다. 이미지는 건드리지 않는다. */
export interface UpdateItemInput {
  categoryId: string | null;
  productName: string;
  brand?: string | null;
  price?: number | null;
  sourceLink?: string | null;
  memo?: string | null;
  tags?: string[] | null;
}

/**
 * 아이템 수정(덮어쓰기 저장·편집 화면에서 사용). 필드와 normalized_name 을 갱신하고
 * updated_at 은 트리거가 자동 갱신한다. 이미지(image_key)는 그대로 두고, 필요하면 같은 키에
 * 새로 업로드한다.
 *
 * 편집으로 brand/product_name 을 **다른 아이템**과 같은 정규화명이 되게 바꾸면
 * UNIQUE(user_id, normalized_name) 위반(23505)이 난다 → `DuplicateItemError` 로 변환해
 * 던진다(편집 화면은 이를 잡아 덮어쓰기 없이 안내·차단한다). 값이 그대로면(자기 자신)
 * 위반이 나지 않는다.
 */
export async function updateItem(id: string, input: UpdateItemInput): Promise<Item> {
  const { data, error } = await supabase
    .from('items')
    .update({
      category_id: input.categoryId,
      product_name: input.productName,
      brand: input.brand ?? null,
      normalized_name: normalizeName(input.brand, input.productName),
      price: input.price ?? null,
      source_link: input.sourceLink ?? null,
      memo: input.memo ?? null,
      tags: input.tags ?? null,
    })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    if (error.code === '23505') throw new DuplicateItemError();
    throw new Error(`아이템을 수정하지 못했습니다: ${error.message}`);
  }
  return data;
}

/**
 * 아이템의 카테고리만 바꾼다(FR-15 빠른 이동). `categoryId === null` 이면 미분류로 이동.
 * 다른 필드·normalized_name 은 건드리지 않으므로 중복 위험이 없다. updated_at 은 트리거가 갱신.
 */
export async function moveItemCategory(id: string, categoryId: string | null): Promise<Item> {
  const { data, error } = await supabase
    .from('items')
    .update({ category_id: categoryId })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`카테고리를 옮기지 못했습니다: ${error.message}`);
  return data;
}

/**
 * 같은 (본인, brand+제품명 정규화) 아이템이 이미 있는지 사전 조회한다. 저장 전 중복 판정용.
 * 저장과 반드시 같은 normalizeName 을 써서 판정 소스를 일치시킨다.
 */
export async function findDuplicateItem(
  brand: string | null | undefined,
  productName: string,
): Promise<Item | null> {
  const normalized = normalizeName(brand, productName);
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('normalized_name', normalized)
    .maybeSingle();
  if (error) throw new Error(`중복 확인에 실패했습니다: ${error.message}`);
  return data;
}

/** 아이템 행 삭제. Storage 객체 삭제는 별도(storage.deleteItemImage)로 호출한다(Step 5). */
export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) throw new Error(`아이템을 삭제하지 못했습니다: ${error.message}`);
}
