import type { Session } from '@supabase/supabase-js';
import { Stack } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { OnboardingOverlay } from '@/components/Onboarding/OnboardingOverlay';
import { hasSeenOnboarding, markOnboardingSeen } from '@/components/Onboarding/onboardingStorage';
import { OnboardingTargetProvider } from '@/components/Onboarding/onboardingTarget';
import { ShareIntentHandler } from '@/components/ShareIntentHandler';
import { SnackbarHost } from '@/components/SnackbarHost';
import { colors } from '@/constants/theme';
import { identifyUser, initAnalytics, installJsErrorCapture } from '@/lib/analytics';
import { initMonitoring, wrapRoot } from '@/lib/monitoring';
import { hydrateNotifications } from '@/lib/notifications';
import { hydrateSignedUrlCache, signInAnonymouslyIfNeeded } from '@/lib/queries';
import { wasLaunchedByShare } from '@/lib/shareIntent';
import { supabase } from '@/lib/supabase';

// 오류·크래시 수집(Sentry): 모듈 최상단에서 가장 먼저 초기화한다. DSN 이 없거나 __DEV__ 면 no-op.
// Sentry 가 전역 JS 에러 핸들러를 먼저 설치해야, AuthGate 의 installJsErrorCapture 가 그것을 이어 호출한다
// (PostHog app_error → Sentry → RN 기본 처리(redbox·크래시) 순).
initMonitoring();

// 루트 레이아웃.
// - ShareIntentProvider: iOS 공유 시트 수신. 받은 공유는 AuthGate 안의 ShareIntentHandler 가 처리한다
//   (화면 이동도 처리기가 직접 한다 — reset 때 화면을 옮기는 onResetShareIntent 는 두지 않는다).
// - AuthGate: 세션 부트스트랩 (익명 로그인, 로그인 벽 없음)
function RootLayout() {
  return (
    <ShareIntentProvider options={{ debug: false, resetOnBackground: true }}>
      <AuthGate />
    </ShareIntentProvider>
  );
}

export default wrapRoot(RootLayout);

function AuthGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  // 첫 세션을 한 번이라도 받은 뒤에는, 세션이 잠깐 null 이 돼도(개발용 세션 리셋 등)
  // 네비게이터를 언마운트하지 않는다. 언마운트→재마운트가 라우트를 엉뚱하게(모달) 재구성해
  // register 로 튀거나 뒤로가기(GO_BACK)가 깨지는 문제를 피한다.
  const [everHadSession, setEverHadSession] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // 세션이 없으면 익명 로그인으로 부트스트랩한다(로그인 벽 없음, 기기별 세션).
    // signInAnonymously 성공 시 onAuthStateChange 가 새 세션을 흘려보낸다.
    // 세션 리셋 후의 재익명 로그인은 설정 화면 핸들러가 소유한다(중복 생성 방지).
    const apply = (next: Session | null) => {
      setSession(next);
      if (next) {
        setEverHadSession(true); // 첫 세션 확보 표시(이후 null 이어도 네비게이터 유지)
        // 익명 uid 로 identify(Phase 10) — PostHog 와 DB 지표를 같은 식별자로 조인. 실패·중복은 모듈이 흡수.
        identifyUser(next.user.id);
      }
    };
    // 계측 초기화(Phase 10): 키 미설정이면 no-op. 비차단 — 실패해도 부트스트랩을 막지 않는다.
    initAnalytics();
    installJsErrorCapture(); // 전역 JS 에러 → app_error(기존 핸들러 체이닝, 키 미설정 시 미설치)
    // 영속 signed URL 캐시 복원(Phase 9 A): 앱 시작 1회. 콜드스타트 후에도 그리드/상세가
    // 재다운로드 없이 뜨도록 인메모리 Map 을 미리 채운다(실패는 무시 — 미스 시 재발급).
    void hydrateSignedUrlCache();
    // 기기 안 알림·'못 찾은 위시' 기록 복원(탭 배지·타일 점·편집 자리표시). 실패는 빈 목록.
    void hydrateNotifications();
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) apply(data.session);
      if (!data.session) {
        try {
          await signInAnonymouslyIfNeeded();
        } catch (e) {
          // 익명 로그인 실패(예: 대시보드 토글 OFF) — 스피너에 머무르되 원인을 남긴다.
          console.error(e);
        }
      }
      if (!cancelled) setReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!cancelled) apply(next);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 최초 부트스트랩(익명 로그인 포함) 완료 전에만 스피너 — 보호 화면이 세션 없이 마운트돼
  // "permission denied for table ..." 오류가 뜨는 것을 막는다. 이후 세션이 잠깐 null 이어도
  // (개발용 리셋 중) 네비게이터는 유지한다.
  if (!ready || (!session && !everHadSession)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    // OnboardingTargetProvider: 코치마크 스포트라이트 대상(예: 탭 바의 카테고리 버튼) 등록소.
    // 스택과 온보딩 오버레이를 함께 감싸, 화면이 등록한 대상을 오버레이가 측정할 수 있게 한다.
    <OnboardingTargetProvider>
      <Stack screenOptions={{ headerShown: false }}>
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
      </Stack>
      {/* 공유 시트 처리(앱 전체 1개): 세션 준비 뒤에만 그려지고, 어느 탭·화면에서든 공유 화면을 연다. */}
      <ShareIntentHandler />
      <OnboardingGate />
      {/* 앱 전체 스낵바(1개): FullWindowOverlay 에 그려 네이티브 모달 위에도 보인다. 보일 것이 없으면 그리지 않는다. */}
      <SnackbarHost />
    </OnboardingTargetProvider>
  );
}

// 첫 실행 온보딩 게이트: 최초 마운트 1회만 판단해 오버레이를 띄운다.
// - 공유로 열렸으면 온보딩을 건너뛴다(공유 처리 우선). 플래그를 세우지 않아 다음 일반 실행에서 노출.
//   공유 데이터는 늦게 도착하므로 첫 URL(공유 딥링크인지)로도 판단한다.
// - 이미 본 적이 있으면 노출하지 않는다.
// - 온보딩이 떠 있는 중에 공유가 오면 '봤음' 표시 없이 닫는다(공유 화면이 온보딩 모달에 가리지 않게).
function OnboardingGate() {
  const { hasShareIntent } = useShareIntentContext();
  const [visible, setVisible] = useState(false);
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current) return;
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
  }, [hasShareIntent]);

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

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
});
