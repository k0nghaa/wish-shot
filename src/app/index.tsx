import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

// Phase 1 Step 3: 로그인된 이메일 표시 + 로그아웃.
// (실제 화면 — 카테고리/목록/상세 — 은 Phase 2)
export default function HomeScreen() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  async function handleLogout() {
    // 로그아웃하면 라우팅 가드가 자동으로 /login 으로 보낸다.
    await supabase.auth.signOut();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>WishShot v2</Text>
        <Text style={styles.email}>{email ? `${email} 님, 환영해요.` : '로그인됨'}</Text>

        <TouchableOpacity
          style={styles.button}
          onPress={handleLogout}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>로그아웃</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
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
  email: {
    fontSize: 15,
    color: colors.textSub,
    textAlign: 'center',
  },
  button: {
    marginTop: spacing.three,
    paddingVertical: spacing.two,
    paddingHorizontal: spacing.four,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.silver,
    backgroundColor: colors.bgCard,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.accent,
  },
});
