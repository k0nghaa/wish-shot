import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

// Phase 1 Step 3: 이메일 + 비밀번호 로그인. 가입 링크는 없다 (본인 계정은 대시보드에서 수동 생성).
// Phase 5 Step 6: 익명 로그인 도입으로 정상 흐름에선 도달하지 않는다. 개발용 왕복(설정의
// "이메일 로그인(개발용)")으로 열려, 이메일 계정으로 되돌아오는 경로를 연다.
export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError('이메일과 비밀번호를 입력하세요.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (signInError) {
      setError('이메일 또는 비밀번호를 확인하세요.');
      return;
    }
    // 로그인 성공 → 홈으로. AuthGate 는 /login 을 자동 이동시키지 않으므로 직접 이동한다.
    router.replace('/');
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        {router.canGoBack() ? (
          <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="취소">
            <Text style={styles.cancel}>취소</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          <Text style={styles.title}>WishShot</Text>
          <Text style={styles.subtitle}>이메일로 로그인</Text>

          <TextInput
            style={styles.input}
            placeholder="이메일"
            placeholderTextColor={colors.textDisabled}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            editable={!loading}
          />
          <TextInput
            style={styles.input}
            placeholder="비밀번호"
            placeholderTextColor={colors.textDisabled}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            editable={!loading}
            onSubmitEditing={handleLogin}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color={colors.bgCard} />
            ) : (
              <Text style={styles.buttonText}>로그인</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.three,
  },
  cancel: { fontSize: 16, color: colors.primary },
  flex: { flex: 1 },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.four,
    gap: spacing.two,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSub,
    textAlign: 'center',
    marginBottom: spacing.three,
  },
  input: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.silver,
    borderRadius: 10,
    paddingVertical: spacing.three,
    paddingHorizontal: spacing.three,
    fontSize: 16,
    color: colors.textMain,
  },
  error: {
    color: colors.error,
    fontSize: 13,
  },
  button: {
    marginTop: spacing.two,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.bgCard,
    fontSize: 16,
    fontWeight: '600',
  },
});
