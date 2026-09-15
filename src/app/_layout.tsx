import type { Session } from '@supabase/supabase-js';
import { Stack, useRouter, useSegments } from 'expo-router';
import { ShareIntentProvider } from 'expo-share-intent';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

// Phase 1: 루트 레이아웃.
// - ShareIntentProvider: iOS 공유 시트 수신 (Step 4)
// - AuthGate: 세션 유무에 따른 라우팅 가드 (Step 3)
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
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const onLogin = segments[0] === 'login';

  useEffect(() => {
    if (!ready) return;
    if (!session && !onLogin) {
      router.replace('/login');
    } else if (session && onLogin) {
      router.replace('/');
    }
  }, [ready, session, onLogin, router]);

  // 세션을 아직 모르거나(!ready), 로그아웃 상태로 로그인 화면으로 리다이렉트되는 중이면 스피너.
  // 후자를 스피너로 막지 않으면 홈 등 보호 화면이 잠깐 마운트돼 DB를 조회하다
  // anon 권한 부족으로 "permission denied for table ..." 오류가 뜬다.
  if (!ready || (!session && !onLogin)) {
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
