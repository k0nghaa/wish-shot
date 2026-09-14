import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PRIVACY_NOTICE } from '@/constants/privacy';
import { colors, spacing } from '@/constants/theme';
import { getCurrentUserEmail, signOut } from '@/lib/queries';

export default function SettingsScreen() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    getCurrentUserEmail()
      .then(setEmail)
      .catch(() => setEmail(null));
  }, []);

  function confirmLogout() {
    Alert.alert('로그아웃', '로그아웃할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: doLogout },
    ]);
  }

  async function doLogout() {
    setLoggingOut(true);
    try {
      // 세션이 사라지면 _layout 의 AuthGate 가 로그인 화면으로 보낸다(별도 내비게이션 불필요).
      await signOut();
    } catch (e) {
      setLoggingOut(false);
      Alert.alert('오류', e instanceof Error ? e.message : '로그아웃하지 못했어요.');
    }
  }

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
        <Text style={styles.sectionLabel}>계정</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>이메일</Text>
            <Text style={styles.rowValue} numberOfLines={1}>
              {email ?? '-'}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>개인정보 안내</Text>
        <View style={styles.card}>
          <Text style={styles.noticeTitle}>{PRIVACY_NOTICE.title}</Text>
          <Text style={styles.noticeBody}>{PRIVACY_NOTICE.body}</Text>
        </View>

        <TouchableOpacity
          style={styles.logout}
          onPress={confirmLogout}
          disabled={loggingOut}
          accessibilityRole="button"
          accessibilityLabel="로그아웃"
        >
          {loggingOut ? (
            <ActivityIndicator color={colors.error} />
          ) : (
            <Text style={styles.logoutText}>로그아웃</Text>
          )}
        </TouchableOpacity>
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
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.three },
  rowLabel: { fontSize: 14, color: colors.textSub },
  rowValue: { flex: 1, fontSize: 15, color: colors.textMain, textAlign: 'right' },
  noticeTitle: { fontSize: 15, fontWeight: '600', color: colors.textMain },
  noticeBody: { fontSize: 14, color: colors.textSub, lineHeight: 21 },
  logout: {
    marginTop: spacing.four,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error,
    paddingVertical: spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutText: { fontSize: 16, fontWeight: '600', color: colors.error },
});
