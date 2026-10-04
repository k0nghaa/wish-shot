import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';

/** private 버킷. RLS 로 경로 첫 세그먼트(=user_id)가 본인인 객체만 접근 가능. */
const BUCKET = 'item-images';

/**
 * signed URL 유효시간(초) = 1일(Phase 9 A).
 * 영속 캐시(AsyncStorage)로 일 단위 재방문 egress 를 거의 0 으로 유지하면서,
 * signed URL 수명(유출 시 노출 창)은 짧게 둔다. 재발급이 필요해도 캐시 히트가 대부분이라 부담 없다.
 */
export const SIGNED_URL_TTL_SEC = 60 * 60 * 24;

/** 영속 캐시 키 접두사(AsyncStorage). 인메모리 Map 과 함께 콜드스타트/리로드를 넘어 URL 을 재사용한다. */
const PERSIST_PREFIX = 'wishshot.signedurl.';

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
  const entry = { url, expiresAt: Date.now() + expiresInSec * 1000 };
  signedUrlCache.set(key, entry);
  // 영속 저장(콜드스타트/리로드 후에도 URL 재사용 → expo-image 디스크 캐시 생존). 실패는 무시.
  void AsyncStorage.setItem(PERSIST_PREFIX + key, JSON.stringify(entry)).catch(() => undefined);
}

/** 이미지가 바뀌거나 지워지면 캐시를 비워 다음 발급이 새 URL(=새 사진)을 내도록 한다(인메모리+영속). */
export function invalidateSignedUrl(imageKey: string): void {
  signedUrlCache.delete(imageKey);
  void AsyncStorage.removeItem(PERSIST_PREFIX + imageKey).catch(() => undefined);
}

/**
 * 앱 시작 시 1회: 영속 항목을 인메모리 Map 으로 복원한다(만료된 키는 건너뛰고 정리).
 * 복원 실패는 무시한다 — 다음 캐시 미스 때 새로 발급되므로 기능에 지장 없다.
 */
export async function hydrateSignedUrlCache(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PERSIST_PREFIX));
    if (keys.length === 0) return;
    const pairs = await AsyncStorage.multiGet(keys);
    const expired: string[] = [];
    for (const [k, v] of pairs) {
      if (!v) continue;
      try {
        const e = JSON.parse(v) as { url: string; expiresAt: number };
        if (e.expiresAt > Date.now()) signedUrlCache.set(k.slice(PERSIST_PREFIX.length), e);
        else expired.push(k);
      } catch {
        expired.push(k); // 깨진 항목은 정리 대상
      }
    }
    if (expired.length) await AsyncStorage.multiRemove(expired);
  } catch {
    /* 복원 실패 무시 — 다음 미스 시 재발급 */
  }
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
    cacheControl: '604800', // 7일(Phase 9 C) — signed URL 재사용과 함께 캐시 히트를 늘린다
  });
  if (error) throw new Error(`이미지를 업로드하지 못했습니다: ${error.message}`);
  invalidateSignedUrl(key); // 덮어쓰기 시 캐시된 옛 URL 이 옛 사진을 재사용하지 않도록
  return key;
}

/**
 * 원본 키 `{uid}/{id}.jpg` → 썸네일 키 `{uid}/{id}_thumb.jpg`(파생 — DB 에 저장하지 않는다).
 * 그리드용 축소본(Phase 9 D). 원본과 달리 항상 JPEG.
 */
export function thumbKeyFromImageKey(imageKey: string): string {
  return imageKey.replace(/\.jpg$/i, '_thumb.jpg');
}

/**
 * 그리드 썸네일 업로드(항상 JPEG). 키만 원본과 다르고 나머지는 uploadItemImage 와 동일 규칙.
 * 담기·덮어쓰기·이미지 교체 시 원본과 함께 재업로드해 고아 객체를 만들지 않는다(불변식 1).
 */
export async function uploadItemImageThumb(
  userId: string,
  itemId: string,
  bytes: ArrayBuffer,
): Promise<string> {
  const key = thumbKeyFromImageKey(itemImageKey(userId, itemId));
  const { error } = await supabase.storage.from(BUCKET).upload(key, bytes, {
    contentType: 'image/jpeg',
    upsert: true,
    cacheControl: '604800',
  });
  if (error) throw new Error(`썸네일을 업로드하지 못했습니다: ${error.message}`);
  invalidateSignedUrl(key);
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

/**
 * 그리드용 썸네일 signed URL 배치 발급(Phase 9 D). 화면이 넘긴 원본 `image_key` 배열을
 * 받아 `{ 원본 image_key → 썸네일 signed URL }` 로 돌려준다(화면은 여전히 image_key 로 인덱싱).
 * signed URL 발급은 바이트 전송이 아니라 egress 가 아니므로, 폴백용 원본 URL 과 함께 발급해도 무해하다.
 */
export async function getItemThumbSignedUrls(
  imageKeys: string[],
  expiresInSec: number = SIGNED_URL_TTL_SEC,
): Promise<Record<string, string>> {
  const pairs = imageKeys.map((k) => [k, thumbKeyFromImageKey(k)] as const);
  const thumbUrls = await getItemImageSignedUrls(
    pairs.map(([, t]) => t),
    expiresInSec,
  );
  const map: Record<string, string> = {};
  for (const [orig, thumb] of pairs) if (thumbUrls[thumb]) map[orig] = thumbUrls[thumb];
  return map;
}

/**
 * Storage 객체 삭제(아이템 삭제 시 행과 함께 지운다). 원본과 썸네일을 **함께** 제거해
 * 고아 객체를 남기지 않는다(불변식 1). 두 키 모두 캐시 무효화.
 */
export async function deleteItemImage(imageKey: string): Promise<void> {
  const keys = [imageKey, thumbKeyFromImageKey(imageKey)];
  const { error } = await supabase.storage.from(BUCKET).remove(keys);
  if (error) throw new Error(`이미지를 삭제하지 못했습니다: ${error.message}`);
  keys.forEach(invalidateSignedUrl);
}

/** 여러 Storage 객체를 한 번에 삭제한다(다중 선택 삭제). 각 원본과 썸네일을 함께 제거(불변식 1). */
export async function deleteItemImages(imageKeys: string[]): Promise<void> {
  if (imageKeys.length === 0) return;
  const keys = imageKeys.flatMap((k) => [k, thumbKeyFromImageKey(k)]);
  const { error } = await supabase.storage.from(BUCKET).remove(keys);
  if (error) throw new Error(`이미지를 삭제하지 못했습니다: ${error.message}`);
  keys.forEach(invalidateSignedUrl);
}
