import { isShareIntentUrl } from '@/lib/shareIntent';

// 공유 시트에서 온 딥링크 처리. 공유 화면으로 옮기는 일은 루트의 공유 처리기(ShareIntentHandler)가 혼자 맡는다.
// - 첫 실행(앱이 꺼져 있다가 공유로 열림): 시작 화면이 있어야 하므로 전체 탭(/)으로 보낸다.
// - 앱이 켜져 있을 때 온 공유: null 을 돌려줘 화면을 옮기지 않는다(expo-router 는 결과가 비면 이동하지 않음).
//   딥링크 이동이 작성 중인 폼을 닫지 않고, 공유 데이터 도착과 경쟁하지도 않는다.
// 그 밖의 딥링크는 원래 경로를 유지한다.
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    if (isShareIntentUrl(path)) {
      return initial ? '/' : null;
    }
    return path;
  } catch {
    return '/';
  }
}
