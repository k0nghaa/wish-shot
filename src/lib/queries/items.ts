import { normalizeName } from '@/lib/normalize';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';

import { getCurrentUserId } from './auth';

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
  if (error) throw new Error(`아이템을 불러오지 못했어요: ${error.message}`);
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
  if (error) throw new Error(`아이템을 불러오지 못했어요: ${error.message}`);
  return data ?? [];
}

/** 단건 조회. */
export async function getItem(id: string): Promise<Item> {
  const { data, error } = await supabase.from('items').select('*').eq('id', id).single();
  if (error) throw new Error(`아이템을 불러오지 못했어요: ${error.message}`);
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
  if (error) throw new Error(`아이템을 저장하지 못했어요: ${error.message}`);
  return data;
}

/** 아이템 행 삭제. Storage 객체 삭제는 별도(storage.deleteItemImage)로 호출한다(Step 5). */
export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) throw new Error(`아이템을 삭제하지 못했어요: ${error.message}`);
}
