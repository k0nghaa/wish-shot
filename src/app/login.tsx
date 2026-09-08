import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/constants/theme';

// Phase 1 Step 2: 로그인 화면 플레이스홀더.
// Step 3에서 이메일 + 비밀번호 입력 → signInWithPassword를 구현한다. (가입 링크 없음)
export default function LoginScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>로그인</Text>
        <Text style={styles.subtitle}>로그인 화면은 다음 단계에서 만들어요.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.four,
    gap: spacing.three,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textMain,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSub,
    textAlign: 'center',
  },
});
