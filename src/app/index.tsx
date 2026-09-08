import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/constants/theme';

// Phase 1 Step 2: 임시 홈 화면.
// Step 3에서 로그인된 이메일 표시 + 실제 로그아웃 동작을 연결한다.
export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>WishShot v2</Text>
        <Text style={styles.subtitle}>임시 홈 화면이에요. 로그인은 다음 단계에서 연결돼요.</Text>

        <TouchableOpacity style={styles.button} disabled accessibilityRole="button">
          <Text style={styles.buttonText}>로그아웃</Text>
        </TouchableOpacity>
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
  button: {
    marginTop: spacing.three,
    paddingVertical: spacing.two,
    paddingHorizontal: spacing.four,
    borderRadius: 10,
    backgroundColor: colors.silver,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textDisabled,
  },
});
