import type { useRouter } from 'expo-router';

type Router = ReturnType<typeof useRouter>;

/**
 * 로그인 뒤 닉네임·합치는 중 화면을 마치고 "원래 가려던 화면"으로 돌아간다.
 * 설정·반시트처럼 아래에 화면이 있으면 그 화면으로 닫고, 첫 실행처럼 아래가 없으면 전체 탭으로 간다.
 */
export function leaveFlow(router: Router): void {
  if (router.canDismiss()) router.dismiss();
  else router.replace('/');
}
