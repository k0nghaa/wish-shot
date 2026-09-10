import { supabase } from '@/lib/supabase';

/** private 버킷. RLS 로 경로 첫 세그먼트(=user_id)가 본인인 객체만 접근 가능. */
const BUCKET = 'item-images';

/**
 * signed URL 유효시간(초). 미결 사항 — 우선 1시간으로 둔다.
 * 캐시 효율 vs 보안(짧을수록 안전, 길수록 재발급 적음)은 화면을 붙이며 재검토한다.
 */
export const SIGNED_URL_TTL_SEC = 60 * 60;

/** Storage 객체 키 규칙: `{user_id}/{item_id}.jpg`. */
export function itemImageKey(userId: string, itemId: string): string {
  return `${userId}/${itemId}.jpg`;
}

/**
 * 이미지 바이트를 업로드하고 객체 키를 반환한다.
 * uri → 바이트(ArrayBuffer) 변환은 호출자(Step 4, expo-image-picker + 파일 읽기) 몫이다.
 * `upsert: true` 라 같은 키에 다시 올리면 덮어쓴다(Step 4 중복 덮어쓰기).
 */
export async function uploadItemImage(
  userId: string,
  itemId: string,
  bytes: ArrayBuffer,
  contentType: string = 'image/jpeg',
): Promise<string> {
  const key = itemImageKey(userId, itemId);
  const { error } = await supabase.storage.from(BUCKET).upload(key, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`이미지를 업로드하지 못했어요: ${error.message}`);
  return key;
}

/** private 객체를 볼 수 있는 임시 signed URL 을 발급한다. 썸네일/상세 렌더에 사용. */
export async function getItemImageSignedUrl(
  imageKey: string,
  expiresInSec: number = SIGNED_URL_TTL_SEC,
): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(imageKey, expiresInSec);
  if (error) throw new Error(`이미지 주소를 만들지 못했어요: ${error.message}`);
  return data.signedUrl;
}

/** Storage 객체 삭제(Step 5 아이템 삭제 시 행과 함께 지운다). */
export async function deleteItemImage(imageKey: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([imageKey]);
  if (error) throw new Error(`이미지를 삭제하지 못했어요: ${error.message}`);
}
