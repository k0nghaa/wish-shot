import { getShareExtensionKey } from 'expo-share-intent';

// 공유 시트에서 온 딥링크를 감지하면 홈(/)으로 보낸다. 홈이 공유 인텐트를 읽어
// 등록 화면으로 넘기며, 미로그인 진입은 로그인 후 홈으로 복귀해 이미지를 유지한다(FR-1b).
// (그 외 딥링크는 원래 경로 유지)
export function redirectSystemPath({ path }: { path: string; initial: string }) {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) {
      return '/';
    }
    return path;
  } catch {
    return '/';
  }
}
