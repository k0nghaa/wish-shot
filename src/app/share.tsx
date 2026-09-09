import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/constants/theme';

// Phase 1 Step 4: 공유 시트로 받은 파일의 path/mimeType를 텍스트로 확인하는 스텁.
// 실제 등록 화면(OCR·폼 자동채움 등)은 Phase 2.
export default function ShareScreen() {
  const router = useRouter();
  const { hasShareIntent, shareIntent, error, resetShareIntent } = useShareIntentContext();

  function handleClose() {
    resetShareIntent();
    router.replace('/');
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>공유로 받은 파일</Text>

        {!hasShareIntent && <Text style={styles.sub}>공유된 파일이 없어요.</Text>}

        {shareIntent?.files?.map((file, i) => (
          <View key={file.path ?? String(i)} style={styles.card}>
            <Text style={styles.label}>파일 {i + 1}</Text>
            <Text style={styles.mono}>path: {file.path}</Text>
            <Text style={styles.mono}>mimeType: {file.mimeType}</Text>
          </View>
        ))}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={handleClose} accessibilityRole="button">
          <Text style={styles.buttonText}>홈으로</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: {
    padding: spacing.four,
    gap: spacing.three,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textMain,
  },
  sub: {
    fontSize: 15,
    color: colors.textSub,
  },
  card: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.silver,
    borderRadius: 10,
    padding: spacing.three,
    gap: spacing.one,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  mono: {
    fontSize: 13,
    color: colors.textSub,
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
  },
  buttonText: {
    color: colors.bgCard,
    fontSize: 16,
    fontWeight: '600',
  },
});
