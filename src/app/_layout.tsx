import type { Session } from '@supabase/supabase-js';
import { Stack, useRouter } from 'expo-router';
import { ShareIntentProvider } from 'expo-share-intent';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors } from '@/constants/theme';
import { signInAnonymouslyIfNeeded } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

// Phase 1: 루트 레이아웃.
// - ShareIntentProvider: iOS 공유 시트 수신 (Step 4)
// - AuthGate: 세션 부트스트랩 (Phase 5 Step 6 — 익명 로그인, 로그인 벽 없음)
export default function RootLayout() {
  const router = useRouter();
  return (
    <ShareIntentProvider
      options={{
        debug: false,
        resetOnBackground: true,
        onResetShareIntent: () => router.replace('/'),
      }}
    >
      <AuthGate />
    </ShareIntentProvider>
  );
}

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
      if (next) setEverHadSession(true); // 첫 세션 확보 표시(이후 null 이어도 네비게이터 유지)
    };
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
