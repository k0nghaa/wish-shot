import { router, useNavigationContainerRef, usePathname } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Keyboard, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';

import { colors, hairlineWidth, radius, spacing, type } from '@/constants/theme';
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

/**
 * 폼 작성 중에 받은 공유(React 밖 — 이펙트가 바꾸고 화면은 구독한다).
 * - prompt: 확인창에 띄운 공유(마지막으로 받은 것). 확인창이 떠 있는 동안 또 받으면 내용이 바뀐다.
 * - queued: [저장 후 열기]로 맡아 둔 공유. 작성 중인 폼이 닫히면(저장·취소) 이어서 연다.
 */
// ⚠️ 컴포넌트 안에서 이 변수들을 직접 읽거나 쓰지 않는다 — 아래 함수로만. React Compiler 가 모듈 변수를
//    바뀌지 않는 값으로 보고 지역 변수를 모듈 변수로 바꿔 넣어(`const next = queued; queued = null; open(next)` →
//    `queued = null; open(queued)`) 값이 틀어진 적이 있다.
let prompt: ShareTarget | null = null;
let queued: ShareTarget | null = null;
const promptListeners = new Set<() => void>();
/** 맡아 둔 공유를 꺼낸다(꺼내면 비운다). */
function takeQueued(): ShareTarget | null {
  const next = queued;
  queued = null;
  return next;
}
function setQueued(next: ShareTarget | null) {
  queued = next;
}
function setPrompt(next: ShareTarget | null) {
  prompt = next;
  for (const l of promptListeners) l();
}
function subscribePrompt(listener: () => void) {
  promptListeners.add(listener);
  return () => {
    promptListeners.delete(listener);
  };
}
const getPrompt = () => prompt;

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
 * - 등록·편집 폼이 떠 있으면 앱 자체 확인창으로 묻는다: [지금 열기](작성 중인 내용 버림) /
 *   [저장 후 열기](맡아 두고, 폼을 저장하거나 취소해 닫으면 이어서 연다). 묻는 중에 또 받으면 확인창 내용이
 *   마지막 공유로 바뀐다. 확인창은 FullWindowOverlay 에 그려 등록·편집 모달 위에 보인다.
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

  // 화면이 바뀔 때: 맡아 둔 공유가 있고 작성 중인 폼이 닫혔으면(저장·취소) 이어서 연다.
  useEffect(() => {
    pathnameRef.current = pathname;
    if (isFormPath(pathname)) return;
    const next = takeQueued();
    if (next) openShareTarget(navigationRef, next);
  }, [pathname, navigationRef]);

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

    // 작성 중인 폼이 있으면 묻는다(확인창이 이미 떠 있으면 내용만 마지막 공유로 바뀐다).
    if (isFormPath(pathnameRef.current)) {
      Keyboard.dismiss();
      setPrompt(target);
      return;
    }
    setQueued(null);
    openShareTarget(navigationRef, target);
  }, [hasShareIntent, shareIntent, resetShareIntent, navigationRef, tick]);

  return (
    <ShareConfirmDialog
      onLater={() => {
        const next = getPrompt();
        setPrompt(null);
        // 묻는 사이 폼이 이미 닫혔으면(저장이 끝남 등) 기다릴 화면 변화가 없으니 바로 연다.
        if (next && !isFormPath(pathnameRef.current)) {
          setQueued(null);
          openShareTarget(navigationRef, next);
          return;
        }
        setQueued(next);
      }}
      onOpenNow={() => {
        const next = getPrompt();
        setPrompt(null);
        setQueued(null);
        if (next) openShareTarget(navigationRef, next);
      }}
    />
  );
}

const MESSAGE = '지금 열면 작성 중인 내용은 저장되지 않습니다.';

/**
 * 폼 작성 중 새 공유 확인창(앱 자체 — iOS 기본 확인창은 띄운 뒤 내용을 바꾸거나 닫을 수 없어서).
 * iOS 확인창 모양을 따르고, 받은 것(사진·링크)에 따라 제목이 바뀐다. 바깥을 눌러도 닫히지 않는다.
 */
function ShareConfirmDialog({ onLater, onOpenNow }: { onLater: () => void; onOpenNow: () => void }) {
  const target = useSyncExternalStore(subscribePrompt, getPrompt);
  const title = target ? (target.kind === 'image' ? '새 사진을 받았습니다' : '새 링크를 받았습니다') : '';

  // 새 공유가 올 때마다(같은 종류로 바뀌어도) 제목과 본문을 읽어 준다.
  useEffect(() => {
    if (target) AccessibilityInfo.announceForAccessibility(`${title}. ${MESSAGE}`);
  }, [target, title]);

  if (!target) return null;
  return (
    <FullWindowOverlay>
      <View style={styles.backdrop} accessibilityViewIsModal>
        <View style={styles.card}>
          <View style={styles.texts}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <Text style={styles.message}>{MESSAGE}</Text>
          </View>
          <View style={styles.buttons}>
            <TouchableOpacity style={styles.button} onPress={onLater} accessibilityRole="button" accessibilityLabel="저장 후 열기">
              <Text style={styles.buttonText}>저장 후 열기</Text>
            </TouchableOpacity>
            <View style={styles.buttonSep} />
            <TouchableOpacity style={styles.button} onPress={onOpenNow} accessibilityRole="button" accessibilityLabel="지금 열기">
              <Text style={[styles.buttonText, styles.buttonStrong]}>지금 열기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </FullWindowOverlay>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
  // iOS 확인창 크기(폭 270pt)·모서리를 따른다.
  card: { width: 270, borderRadius: radius.lg, backgroundColor: colors.bg, overflow: 'hidden' },
  texts: { paddingHorizontal: spacing.three, paddingTop: spacing.three + spacing.one, paddingBottom: spacing.three, gap: spacing.one },
  title: { ...type.headline, color: colors.textMain, textAlign: 'center' },
  message: { ...type.footnote, color: colors.textMain, textAlign: 'center' },
  buttons: { flexDirection: 'row', borderTopWidth: hairlineWidth, borderTopColor: colors.silver },
  button: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.two },
  buttonSep: { width: hairlineWidth, backgroundColor: colors.silver },
  buttonText: { ...type.body, color: colors.textMain },
  buttonStrong: { fontWeight: '600' },
});
