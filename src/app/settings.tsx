import { useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PRIVACY_NOTICE } from '@/constants/privacy';
import { colors, spacing } from '@/constants/theme';
import { signInAnonymouslyIfNeeded, signOut } from '@/lib/queries';

export default function SettingsScreen() {
  const router = useRouter();

  // 개발용 세션 리셋: 현재 세션을 버리고 새 익명 세션으로 시작한다. 익명 경로를 재설치 없이
  // 즉시 테스트하기 위한 것 — __DEV__ 에서만 노출된다.
  // 재익명 로그인까지 await 한 뒤 홈으로 이동해, 홈이 새 세션으로 재로드되게 한다(레이스 방지).
  async function handleDevReset() {
    try {
      await signOut();
      await signInAnonymouslyIfNeeded();
      router.replace('/');
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : '세션 초기화에 실패했습니다.');
    }
  }

  // 익명 로그인(Phase 5 Step 6)이라 계정·로그아웃 개념이 없다 — 개인정보 안내만 둔다.
  // 이메일 가입/계정 승격·로그아웃은 Phase 6.
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="뒤로">
          <Text style={styles.back}>‹ 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.title}>설정</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>개인정보 안내</Text>
        <View style={styles.card}>
          <Text style={styles.noticeTitle}>{PRIVACY_NOTICE.title}</Text>
          <Text style={styles.noticeBody}>{PRIVACY_NOTICE.body}</Text>
        </View>

        {__DEV__ ? (
          <View style={styles.devSection}>
            <TouchableOpacity
              style={styles.devButton}
              onPress={handleDevReset}
              accessibilityRole="button"
              accessibilityLabel="세션 초기화(개발용)"
            >
              <Text style={styles.devButtonText}>세션 초기화(개발용)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devButton}
              onPress={() => router.push('/login')}
              accessibilityRole="button"
              accessibilityLabel="이메일 로그인(개발용)"
            >
              <Text style={styles.devButtonText}>이메일 로그인(개발용)</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.three,
    paddingTop: spacing.two,
    paddingBottom: spacing.two,
  },
  back: { fontSize: 16, color: colors.primary, width: 72 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.textMain, textAlign: 'center' },
  headerSpacer: { width: 72 },
  content: { padding: spacing.three, gap: spacing.two, paddingBottom: spacing.six },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSub,
    marginTop: spacing.three,
    marginBottom: spacing.one,
  },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.silver,
    padding: spacing.three,
    gap: spacing.two,
  },
  noticeTitle: { fontSize: 15, fontWeight: '600', color: colors.textMain },
  noticeBody: { fontSize: 14, color: colors.textSub, lineHeight: 21 },
  devSection: {
    marginTop: spacing.four,
    gap: spacing.two,
  },
  devButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.silver,
    paddingVertical: spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  devButtonText: { fontSize: 15, color: colors.textSub },
});
