import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';

import { getCurrentUserId } from './auth';

export type Category = Tables<'categories'>;

/** 카테고리 목록(생성 순). RLS 로 본인 것만 조회된다. */
export async function listCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`카테고리를 불러오지 못했어요: ${error.message}`);
  return data ?? [];
}

/** 카테고리 생성. 같은 이름이 이미 있으면 UNIQUE(user_id, name) 위반으로 에러가 난다. */
export async function createCategory(name: string): Promise<Category> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('categories')
    .insert({ user_id: userId, name })
    .select()
    .single();
  if (error) throw new Error(`카테고리를 만들지 못했어요: ${error.message}`);
  return data;
}

/** 카테고리 이름 변경. */
export async function renameCategory(id: string, name: string): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .update({ name })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`카테고리 이름을 바꾸지 못했어요: ${error.message}`);
  return data;
}

/**
 * 카테고리 삭제. 스키마의 `ON DELETE SET NULL` 로 안의 아이템은 삭제되지 않고
 * `category_id = null`(미분류)로 바뀐다.
 */
export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw new Error(`카테고리를 삭제하지 못했어요: ${error.message}`);
}
