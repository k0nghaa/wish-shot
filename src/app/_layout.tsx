import { Stack, usePathname } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';

import { OnboardingOverlay } from '@/components/Onboarding/OnboardingOverlay';
import { hasSeenOnboarding, markOnboardingSeen } from '@/components/Onboarding/onboardingStorage';
import { OnboardingTargetProvider } from '@/components/Onboarding/onboardingTarget';
import { ShareIntentHandler } from '@/components/ShareIntentHandler';
import { SnackbarHost } from '@/components/SnackbarHost';
import { identifyUser, initAnalytics, installJsErrorCapture } from '@/lib/analytics';
import { initMonitoring, wrapRoot } from '@/lib/monitoring';
import { hydrateNotifications } from '@/lib/notifications';
import {
  getStartState,
  hydrateSignedUrlCache,
  startAccountWatchers,
  subscribeAccountState,
  type StartState,
} from '@/lib/queries';
import { wasLaunchedByShare } from '@/lib/shareIntent';
import { supabase } from '@/lib/supabase';

// 오류·크래시 수집(Sentry): 모듈 최상단에서 가장 먼저 초기화한다. DSN 이 없거나 __DEV__ 면 no-op.
// Sentry 가 전역 JS 에러 핸들러를 먼저 설치해야, AuthGate 의 installJsErrorCapture 가 그것을 이어 호출한다
// (PostHog app_error → Sentry → RN 기본 처리(redbox·크래시) 순).
initMonitoring();

// 첫 화면이 정해질 때까지 스플래시를 유지한다(모듈 최상단에서 await 없이). 첫 화면은 기기에 저장된 값만 읽어 정하므로
// 통신을 기다리지 않는다 — 풀리지 않는 일은 없다. 숨기는 곳은 AuthGate.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

// 루트 레이아웃.
// - ShareIntentProvider: iOS 공유 시트 수신. 받은 공유는 AuthGate 안의 ShareIntentHandler 가 처리한다
//   (화면 이동도 처리기가 직접 한다 — reset 때 화면을 옮기는 onResetShareIntent 는 두지 않는다).
// - AuthGate: 첫 화면 결정(로그인 화면·전체 탭·삭제하는 중). 새 계정은 만들지 않는다 — 익명 계정은 사용자가 고를 때만.
function RootLayout() {
  return (
    <ShareIntentProvider options={{ debug: false, resetOnBackground: true }}>
      <AuthGate />
    </ShareIntentProvider>
  );
}

export default wrapRoot(RootLayout);

function AuthGate() {
  const [state, setState] = useState<StartState | null>(null); // null = 기기 값을 읽는 중(스플래시)
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    // 계측 초기화: 키 미설정이면 no-op. 비차단 — 실패해도 시작을 막지 않는다.
    initAnalytics();
    installJsErrorCapture(); // 전역 JS 에러 → app_error(기존 핸들러 체이닝, 키 미설정 시 미설치)
    // 영속 signed URL 캐시 복원: 앱 시작 1회. 콜드스타트 후에도 그리드/상세가
    // 재다운로드 없이 뜨도록 인메모리 Map 을 미리 채운다(실패는 무시 — 미스 시 재발급).
    void hydrateSignedUrlCache();
    // 기기 안 알림·'못 찾은 위시' 기록 복원(탭 배지·타일 점·편집 자리표시). 실패는 빈 목록.
    void hydrateNotifications();
    // 기기 상태가 바뀌면(로그인·로그아웃·서버 거절·삭제) 알림을 받아 화면을 바꾼다.
    const unsubscribe = subscribeAccountState((next) => {
      if (!cancelled) setState(next);
    });
    void loadStartState().then((first) => {
      if (!cancelled) setState(first);
    });
    // 서버 거절 지켜보기·합치기 재시도·Apple 연결 확인.
    const stopWatchers = startAccountWatchers();
    // 사용자 id 로 identify — PostHog 와 DB 지표를 같은 식별자로 조인. 구독하면 auth-js 가 지금 세션을
    // INITIAL_SESSION 으로 먼저 보낸다. 콜백 안에서 getSession 을 기다리지 않는다(교착). 실패·중복은 모듈이 흡수.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!cancelled && next) identifyUser(next.user.id);
    });
    return () => {
      cancelled = true;
      unsubscribe();
      stopWatchers();
      sub.subscription.unsubscribe();
    };
  }, []);

  // 첫 화면이 정해지면 스플래시를 숨긴다.
  useEffect(() => {
    if (state) SplashScreen.hideAsync().catch(() => undefined);
  }, [state]);

  const kind = state?.kind;
  const appReady = kind === 'anonymous' || kind === 'signed_in';
  // unreadable(3번 읽어도 실패)도 로그인 화면 자리가 그린다 — 새 계정을 만들지도, 세션 없음으로 보지도 않는다.
  const needsSignIn = kind === 'fresh' || kind === 'signed_out' || kind === 'session_lost' || kind === 'unreadable';
  // 로그인·삭제가 끝나 상태가 바뀐 순간에도, 그 결과를 처리하는 화면은 다음 화면으로 옮겨 갈 때까지 둔다
  // (화면이 사라지면 결과를 처리하던 코드가 끊긴다).
  const keepSignIn = pathname === '/sign-in';
  // 등록·편집 폼이 떠 있는 동안 서버가 세션을 거절해도 폼은 닫지 않는다(작성 내용 유지) — 저장할 때 로그인 화면을 띄운다.
  const formOpen = pathname === '/register' || /^\/item\/[^/]+\/edit$/.test(pathname);
  const keepDeleting = pathname === '/account/deleting';

  if (!state) return null; // 스플래시 유지

  return (
    // OnboardingTargetProvider: 코치마크 스포트라이트 대상(예: 탭 바의 카테고리 버튼) 등록소.
    // 스택과 온보딩 오버레이를 함께 감싸, 화면이 등록한 대상을 오버레이가 측정할 수 있게 한다.
    <OnboardingTargetProvider>
      {/* 화면 등록은 상태가 정한다(Stack.Protected). 로그인 화면은 오버레이가 아니라 상태가 정하는 경로다. */}
      <Stack screenOptions={{ headerShown: false }}>
        {/* 로그인 화면: 세션 없음(새 설치·로그아웃·거절). 닫기 없음. */}
        <Stack.Protected guard={needsSignIn || (appReady && keepSignIn)}>
          <Stack.Screen name="sign-in" options={{ gestureEnabled: false }} />
        </Stack.Protected>
        {/* 삭제하는 중: 계정 삭제 도중 꺼졌다 켜지면 첫 화면. 닫기 없음. */}
        <Stack.Protected guard={appReady || kind === 'deleting' || (kind === 'fresh' && keepDeleting)}>
          <Stack.Screen name="account/deleting" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
        </Stack.Protected>
        <Stack.Protected guard={appReady || (needsSignIn && formOpen)}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="category/[id]" />
          <Stack.Screen name="tag/[name]" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="dev/email-login" />
          {/* 등록·편집 = 모달 시트(아래서 위로). 취소/저장 헤더 관습과 맞춤. */}
          <Stack.Screen name="register" options={{ presentation: 'modal' }} />
          <Stack.Screen name="item/[id]/edit" options={{ presentation: 'modal' }} />
          {/* 상세 사진 뷰어 — 세로 모달(열 때 위로, 닫을 때 아래로). 갤러리의 아래 스와이프 닫기와 이어짐. */}
          <Stack.Screen name="item/[id]/index" options={{ presentation: 'fullScreenModal' }} />
          {/* 정보(i) 하프시트 — react-native-screens 네이티브 반시트(formSheet). 재빌드 불필요. */}
          <Stack.Screen
            name="item/[id]/info"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: [0.5, 1],
              sheetGrabberVisible: true,
            }}
          />
          {/* 계정: 로그인(설정·반시트·로그인 전용 기능 — 닫기 X)·반시트·닉네임·합치는 중·삭제 안내 */}
          <Stack.Screen name="account/sign-in" options={{ presentation: 'modal' }} />
          <Stack.Screen
            name="account/sign-in-sheet"
            options={{ presentation: 'formSheet', sheetAllowedDetents: [0.5], sheetGrabberVisible: true }}
          />
          {/* 닉네임: 가입 때(mode=signup)는 끌어내려도 닫히지 않는다. */}
          <Stack.Screen
            name="account/nickname"
            options={({ route }) => ({
              presentation: 'modal',
              gestureEnabled: (route.params as { mode?: string } | undefined)?.mode !== 'signup',
            })}
          />
          <Stack.Screen name="account/merging" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
          <Stack.Screen name="account/delete" />
        </Stack.Protected>
      </Stack>
      {/* 공유 시트 처리(앱 전체 1개): 로그인 화면이 떠 있는 동안 온 공유는 맡아 두었다가 앱 화면이 생기면 연다. */}
      <ShareIntentHandler />
      <OnboardingGate ready={appReady} />
      {/* 앱 전체 스낵바(1개): FullWindowOverlay 에 그려 네이티브 모달 위에도 보인다. 보일 것이 없으면 그리지 않는다. */}
      <SnackbarHost />
    </OnboardingTargetProvider>
  );
}

// 첫 화면 상태 읽기. 읽지 못하면(unreadable) "세션 없음"이 아니므로 스플래시를 유지한 채 다시 읽고, 3번 실패하면
// 그 상태 그대로 첫 화면(로그인 화면 자리)에 보인다.
async function loadStartState(): Promise<StartState> {
  let state = await getStartState();
  for (let attempt = 1; attempt < 3 && state.kind === 'unreadable'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    state = await getStartState();
  }
  return state;
}

// 첫 실행 온보딩 게이트: 앱 화면이 생긴 뒤(ready) 최초 1회만 판단해 오버레이를 띄운다.
// - 공유로 열렸으면 온보딩을 건너뛴다(공유 처리 우선). 플래그를 세우지 않아 다음 일반 실행에서 노출.
//   공유 데이터는 늦게 도착하므로 첫 URL(공유 딥링크인지)로도 판단한다.
// - 이미 본 적이 있으면 노출하지 않는다.
// - 온보딩이 떠 있는 중에 공유가 오면 '봤음' 표시 없이 닫는다(공유 화면이 온보딩 모달에 가리지 않게).
function OnboardingGate({ ready }: { ready: boolean }) {
  const { hasShareIntent } = useShareIntentContext();
  const [visible, setVisible] = useState(false);
  const decided = useRef(false);

  useEffect(() => {
    if (!ready || decided.current) return;
    // 공유 값이 이미 와 있으면 이번엔 스킵(다음 실행에 노출).
    if (hasShareIntent) {
      decided.current = true;
      return;
    }
    let cancelled = false;
    (async () => {
      const seen = await hasSeenOnboarding();
      // 판단 사이에 공유가 도착했거나(effect 정리) 언마운트됐으면 스킵.
      if (cancelled || decided.current) return;
      decided.current = true;
      if (!seen && !wasLaunchedByShare()) setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hasShareIntent, ready]);

  // 온보딩 중 공유 도착 → 닫기(렌더 중 상태 조정 — 이 컴포넌트 자신의 상태만 바꾼다).
  if (visible && hasShareIntent) setVisible(false);

  if (!visible) return null;
  return (
    <OnboardingOverlay
      onDone={() => {
        setVisible(false);
        void markOnboardingSeen();
      }}
    />
  );
}
