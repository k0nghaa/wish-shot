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
 * signed URL 캐시(키 → URL, 만료시각).
 * `createSignedUrl(s)` 은 호출마다 토큰이 다른 새 URL 을 만든다. 매 로드마다 새로 발급하면
 * 같은 이미지인데도 URI 가 바뀌어 expo-image 가 재요청·재렌더(깜빡)한다.
 * 유효한 동안 같은 URL 을 재사용해 URI 를 안정시킨다(썸네일 flicker 제거 + 발급 호출 절감).
 * 이미지 교체(upsert)·삭제 시에는 해당 키를 무효화해 새 사진이 반영되게 한다.
 */
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const REFRESH_MARGIN_MS = 60_000; // 만료 60초 전이면 재발급(경계 실패 방지)

function getCachedSignedUrl(key: string): string | undefined {
  const entry = signedUrlCache.get(key);
  if (entry && entry.expiresAt - REFRESH_MARGIN_MS > Date.now()) return entry.url;
  return undefined;
}

function putCachedSignedUrl(key: string, url: string, expiresInSec: number): void {
  signedUrlCache.set(key, { url, expiresAt: Date.now() + expiresInSec * 1000 });
}

/** 이미지가 바뀌거나 지워지면 캐시를 비워 다음 발급이 새 URL(=새 사진)을 내도록 한다. */
export function invalidateSignedUrl(imageKey: string): void {
  signedUrlCache.delete(imageKey);
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
  if (error) throw new Error(`이미지를 업로드하지 못했습니다: ${error.message}`);
  invalidateSignedUrl(key); // 덮어쓰기 시 캐시된 옛 URL 이 옛 사진을 재사용하지 않도록
  return key;
}

/** private 객체를 볼 수 있는 임시 signed URL 을 발급한다. 썸네일/상세 렌더에 사용. */
export async function getItemImageSignedUrl(
  imageKey: string,
  expiresInSec: number = SIGNED_URL_TTL_SEC,
): Promise<string> {
  const cached = getCachedSignedUrl(imageKey);
  if (cached) return cached;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(imageKey, expiresInSec);
  if (error) throw new Error(`이미지 주소를 만들지 못했습니다: ${error.message}`);
  putCachedSignedUrl(imageKey, data.signedUrl, expiresInSec);
  return data.signedUrl;
}

/**
 * 여러 객체의 signed URL 을 한 번에 발급한다(목록/홈 썸네일용). 키 → URL 맵을 반환.
 * 실패한 개별 키는 맵에서 빠진다(그 자리 썸네일은 플레이스홀더로 표시됨).
 */
export async function getItemImageSignedUrls(
  imageKeys: string[],
  expiresInSec: number = SIGNED_URL_TTL_SEC,
): Promise<Record<string, string>> {
  const unique = [...new Set(imageKeys)];
  if (unique.length === 0) return {};

  // 유효한 캐시는 재사용하고, 없는(또는 만료 임박) 키만 새로 발급한다.
  const map: Record<string, string> = {};
  const misses: string[] = [];
  for (const key of unique) {
    const cached = getCachedSignedUrl(key);
    if (cached) map[key] = cached;
    else misses.push(key);
  }
  if (misses.length === 0) return map; // 전부 캐시 히트 → 네트워크 호출 없음(재렌더 시 flicker 없음)

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(misses, expiresInSec);
  if (error) throw new Error(`이미지 주소를 만들지 못했습니다: ${error.message}`);
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) {
      map[row.path] = row.signedUrl;
      putCachedSignedUrl(row.path, row.signedUrl, expiresInSec);
    }
  }
  return map;
}

/** Storage 객체 삭제(Step 5 아이템 삭제 시 행과 함께 지운다). */
export async function deleteItemImage(imageKey: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([imageKey]);
  if (error) throw new Error(`이미지를 삭제하지 못했습니다: ${error.message}`);
  invalidateSignedUrl(imageKey);
}
