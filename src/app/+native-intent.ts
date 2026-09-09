import { getShareExtensionKey } from 'expo-share-intent';

// 공유 시트에서 온 딥링크를 감지하면 /share 화면으로 리다이렉트한다.
// (그 외 딥링크는 원래 경로 유지)
export function redirectSystemPath({ path }: { path: string; initial: string }) {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) {
      return '/share';
    }
    return path;
  } catch {
    return '/';
  }
}
