import { getLinkingURL } from 'expo-linking';
import { getShareExtensionKey, type ShareIntent } from 'expo-share-intent';

import { toFileUri } from '@/lib/imageBytes';

/**
 * 공유 시트로 받은 값의 판정(순수 함수). 공유 딥링크 판별(`+native-intent.ts`·온보딩 게이트)과
 * 공유 처리기(`ShareIntentHandler`)가 같은 판정을 쓰도록 한 곳에 둔다.
 */

/** 공유 확장이 앱을 여는 딥링크인지(`<scheme>://dataUrl=<key>…`). 판별 실패는 false. */
export function isShareIntentUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return url.includes(`dataUrl=${getShareExtensionKey()}`);
  } catch {
    return false;
  }
}

/**
 * 이번 실행이 공유로 시작됐는지(앱이 꺼져 있다가 공유 딥링크로 열림). 공유 데이터는 늦게 도착하므로
 * 앱을 연 URL 로 판단한다 — 온보딩 게이트가 앱 시작 직후에 쓴다. expo-router·expo-share-intent 와 같은
 * expo-linking 의 값을 읽는다(앱을 연 URL, 그 뒤 새 링크가 오면 그 링크). 조회 실패는 false.
 */
export function wasLaunchedByShare(): boolean {
  try {
    return isShareIntentUrl(getLinkingURL());
  } catch {
    return false;
  }
}

/** 공유가 text 로 올 때 첫 http(s) URL 만 뽑는다(webUrl 이 비어 있는 앱 대비). 없으면 null. */
function firstUrl(text?: string | null): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s]+/i);
  return m ? m[0] : null;
}

/** 공유 처리기가 열 화면. URL → 전체 탭 링크 저장 모드, 이미지 → 등록 폼. */
export type ShareTarget =
  | { kind: 'url'; url: string }
  | { kind: 'image'; path: string; imageUri: string; imageMime: string; mimeType: string | null };

/** 공유 값을 열 화면으로 바꾼다. URL 이 우선이고(웹페이지 공유), 쓸 수 없는 값이면 null. */
export function toShareTarget(shareIntent: ShareIntent | null | undefined): ShareTarget | null {
  if (!shareIntent) return null;
  const url = shareIntent.webUrl ?? firstUrl(shareIntent.text);
  if ((shareIntent.type === 'weburl' || shareIntent.type === 'text') && url) {
    return { kind: 'url', url };
  }
  const file = shareIntent.files?.[0];
  if (file?.path) {
    return {
      kind: 'image',
      path: file.path,
      imageUri: toFileUri(file.path),
      imageMime: file.mimeType ?? 'image/jpeg',
      mimeType: file.mimeType ?? null,
    };
  }
  return null;
}
