import { router, useNavigationContainerRef, usePathname } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { capture } from '@/lib/analytics';
import { logImageDiag } from '@/lib/imageBytes';
import { toShareTarget, type ShareTarget } from '@/lib/shareIntent';

// 앱 스택이 아직 없을 때 다시 볼 간격·횟수(약 5초). 그 뒤에도 없으면 이번 공유는 버린다.
const NAV_RETRY_MS = 100;
const NAV_RETRY_MAX = 50;
// 같은 공유가 짧은 사이에 두 번 오면(네이티브 값을 두 곳에서 읽는 경우) 두 번째는 버린다.
const DUPLICATE_WINDOW_MS = 3000;

// 내비게이션 상태에서 쓰는 부분만(expo-router 상태를 이 모양으로 읽는다).
type NavRoute = { key?: string; name: string; params?: object; state?: NavState };
type NavState = { index?: number; routes: NavRoute[] };
type NavRef = ReturnType<typeof useNavigationContainerRef>;

/** 루트 레이아웃의 앱 스택. expo-router 내부 루트(__root) 화면 아래에 있고, 스택이 마운트돼야 상태가 생긴다. */
function findAppStack(navigationRef: NavRef): NavState | null {
  if (!navigationRef.isReady()) return null;
  const root = navigationRef.getRootState() as unknown as NavState | undefined;
  const stack = root?.routes[root.index ?? 0]?.state;
  return stack && stack.routes.length > 0 ? stack : null;
}

/** 작성 중인 폼(등록·편집)이 떠 있는지 — 새 공유를 열기 전에 묻는다. */
function isFormPath(pathname: string): boolean {
  return pathname === '/register' || /^\/item\/[^/]+\/edit$/.test(pathname);
}

/** 같은 공유인지 가르는 값(종류 + URL 또는 파일 경로). */
function shareSignature(target: ShareTarget): string {
  return target.kind === 'url' ? `url:${target.url}` : `image:${target.path}`;
}

/** 전체 탭이 링크 저장 모드면 끈다(배경 탭은 바꾸지 않는다). 이미지 공유로 등록 폼을 열 때 쓴다. */
function clearAttachMode(navigationRef: NavRef) {
  const stack = findAppStack(navigationRef);
  const tabs = stack?.routes.find((r) => r.name === '(tabs)')?.state;
  const all = tabs?.routes.find((r) => r.name === 'index');
  const attachLink = (all?.params as { attachLink?: string } | undefined)?.attachLink;
  if (all?.key && attachLink) {
    navigationRef.dispatch({ type: 'SET_PARAMS', payload: { params: { attachLink: '' } }, source: all.key });
  }
}

/** 위에 뜬 화면을 모두 닫고 공유 화면을 연다. URL → 전체 탭 링크 저장 모드, 이미지 → 등록 폼. */
function openShareTarget(navigationRef: NavRef, target: ShareTarget) {
  if (target.kind === 'image') clearAttachMode(navigationRef);
  if (router.canDismiss()) router.dismissAll();
  if (target.kind === 'url') {
    router.navigate({ pathname: '/', params: { attachLink: target.url } });
  } else {
    router.push({ pathname: '/register', params: { imageUri: target.imageUri, imageMime: target.imageMime } });
  }
}

/**
 * 공유 시트 처리(앱 전체에 1개 — 루트 레이아웃이 세션 준비 뒤에 그린다). 어느 탭·화면을 보고 있든 동작한다.
 * - 앱 스택이 준비될 때까지 기다린 뒤 처리한다(첫 실행 직후 등).
 * - 같은 공유를 두 번 처리하지 않는다: 처리 시작 때 잠그고 바로 resetShareIntent()로 네이티브 값까지 지운다.
 *   공유 값이 비면(hasShareIntent=false) 잠금을 푼다. 같은 공유가 3초 안에 다시 와도 버린다.
 * - 등록·편집 폼이 떠 있으면 새 공유를 열지 먼저 묻는다([계속 작성]이면 새 공유는 버린다).
 *   묻는 중에 공유가 또 오면 확인창을 더 띄우지 않고, 마지막으로 받은 공유를 연다.
 * 화면 이동은 이 처리기만 한다(+native-intent.ts 는 앱이 켜져 있을 때 온 공유 딥링크로 이동하지 않음).
 */
export function ShareIntentHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const navigationRef = useNavigationContainerRef();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const handlingRef = useRef(false);
  // 앱 스택을 기다린 횟수(공유마다 처음부터 센다). tick 은 다시 보게 하는 신호일 뿐이다.
  const waitedRef = useRef(0);
  const [tick, setTick] = useState(0);
  const lastHandledRef = useRef<{ sig: string; at: number } | null>(null);
  // "새 공유를 열까요?" 확인창에서 열 공유(확인창이 떠 있는 동안에만 값이 있다).
  const pendingRef = useRef<ShareTarget | null>(null);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!hasShareIntent) {
      handlingRef.current = false;
      waitedRef.current = 0;
      return;
    }
    if (handlingRef.current) return;

    // 앱 스택이 아직 없으면 잠시 뒤 다시 본다(끝내 없으면 이번 공유는 버린다).
    if (!findAppStack(navigationRef)) {
      if (waitedRef.current >= NAV_RETRY_MAX) {
        handlingRef.current = true;
        resetShareIntent();
        return;
      }
      waitedRef.current += 1;
      const timer = setTimeout(() => setTick((n) => n + 1), NAV_RETRY_MS);
      return () => clearTimeout(timer);
    }

    handlingRef.current = true;
    waitedRef.current = 0;
    const target = toShareTarget(shareIntent);
    resetShareIntent(); // 네이티브 값까지 지워, 앱이 다시 활성화돼도 같은 공유가 다시 오지 않게 한다
    if (!target) return;

    const sig = shareSignature(target);
    const now = Date.now();
    const last = lastHandledRef.current;
    if (last && last.sig === sig && now - last.at < DUPLICATE_WINDOW_MS) return;
    lastHandledRef.current = { sig, at: now };

    capture('share_intent_received', { type: target.kind }); // 공유 진입 전체량(질문 3)
    if (target.kind === 'image') logImageDiag('shareIntent', target.path, { mimeType: target.mimeType });

    // 확인창이 이미 떠 있으면 열 공유만 바꾼다(확인창을 겹쳐 띄우지 않는다).
    if (pendingRef.current) {
      pendingRef.current = target;
      return;
    }
    if (isFormPath(pathnameRef.current)) {
      pendingRef.current = target;
      Alert.alert('새 공유를 열까요?', '작성 중인 내용은 저장되지 않습니다.', [
        {
          text: '계속 작성',
          style: 'cancel',
          onPress: () => {
            pendingRef.current = null;
          },
        },
        {
          text: '열기',
          onPress: () => {
            const next = pendingRef.current;
            pendingRef.current = null;
            if (next) openShareTarget(navigationRef, next);
          },
        },
      ]);
      return;
    }
    openShareTarget(navigationRef, target);
  }, [hasShareIntent, shareIntent, resetShareIntent, navigationRef, tick]);

  return null;
}
