import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { SignInButtons } from '@/components/account/SignInButtons';
import { otherProviderMessage, useProviderSignIn } from '@/components/account/useProviderSignIn';
import { getLoadedWishCount } from '@/components/account/wishCount';
import { colors, spacing, type } from '@/constants/theme';
import { capture } from '@/lib/analytics';
import { markSignInPromptUsed } from '@/lib/queries';

// 로그인 권유 반시트(formSheet, 기존 익명 사용자 1회) — 설계 3(docs/phases/phase-22-account-login.md). 화면 등록·띄우는 시점은 login-feature 가 만든다.
// 위시 개수를 알면 "위시 12개를 계정에 보관", 모르거나 0개면 "위시를 계정에 보관".
// 개발용(__DEV__): count 파라미터로 개수를 정해 두 상태를 모두 띄운다(0 = 없음).

function sheetTitle(count: number | null): string {
  return count && count > 0 ? `위시 ${count}개를 계정에 보관` : '위시를 계정에 보관';
}

export default function SignInSheetScreen() {
  const router = useRouter();
  const { count: countParam } = useLocalSearchParams<{ count?: string }>();
  // 개수 = 전체 탭이 이미 불러온 목록의 개수(메모리). 모르면 null. 개발용 파라미터가 있으면 그 값이 먼저다(0 = 개수 없음).
  const count = __DEV__ && countParam !== undefined ? Number(countParam) || 0 : getLoadedWishCount();
  const shown = useRef(false);
  const { busy, conflict, press } = useProviderSignIn({ onDone: () => router.dismiss() });

  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    capture('sign_in_viewed', { surface: 'sheet', entry: 'sheet' });
    // 반시트는 통틀어 1회 — 보였으면 기록한다.
    void markSignInPromptUsed().catch(() => {});
  }, []);

  function later() {
    capture('sign_in_skipped', { surface: 'sheet', entry: 'sheet' });
    router.dismiss();
  }

  return (
    <View style={styles.root}>
      <View style={styles.texts}>
        <Text style={styles.title} accessibilityRole="header">
          {sheetTitle(count)}
        </Text>
        <Text style={styles.body}>앱을 삭제하거나 기기를 바꿔도 위시를 다시 볼 수 있습니다.</Text>
      </View>

      <SignInButtons busy={busy} onPress={(p) => void press(p)} />
      {conflict ? (
        <Text style={styles.conflict} accessibilityRole="alert">
          {otherProviderMessage(conflict)}
        </Text>
      ) : null}

      <TouchableOpacity
        style={styles.later}
        onPress={later}
        disabled={busy !== null}
        accessibilityRole="button"
        accessibilityLabel="나중에"
      >
        <Text style={styles.laterText}>나중에</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: spacing.four, paddingTop: spacing.five, gap: spacing.three },
  texts: { gap: spacing.two, marginBottom: spacing.two },
  title: { ...type.title, color: colors.textMain, textAlign: 'center' },
  body: { ...type.subhead, color: colors.textSub, textAlign: 'center' },
  conflict: { ...type.footnote, color: colors.error, textAlign: 'center' },
  later: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  laterText: { ...type.body, color: colors.textSub },
});
