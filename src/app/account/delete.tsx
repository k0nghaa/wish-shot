import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { setDeletionRequest } from '@/components/account/deletionRequest';
import { colors, hairlineWidth, radius, spacing, type } from '@/constants/theme';
import {
  confirmAppleForDeletion,
  getAccount,
  listItems,
  type AccountInfo,
  type DeleteAccountInput,
  type DeleteReason,
} from '@/lib/queries';

// 계정 삭제 안내(push) — 설계 3(docs/phases/phase-22-account-login.md). 화면 등록·띄우는 시점은 login-feature 가 만든다.
// 흐름: 안내(사유 선택) → [계정 삭제] → (Apple 계정만) Apple 재인증 → 삭제하는 중. 추가 확인창은 없다.
// 개발용(__DEV__): count 파라미터로 위시 개수를 정한다.

const REASONS: { value: DeleteReason; label: string }[] = [
  { value: 'rarely_used', label: '잘 쓰지 않음' },
  { value: 'missing_feature', label: '원하는 기능이 없음' },
  { value: 'other_account', label: '다른 계정으로 사용' },
  { value: 'privacy', label: '개인정보가 걱정됨' },
  { value: 'other', label: '기타' },
];

const REASON_TEXT_MAX = 200;

export default function DeleteAccountScreen() {
  const router = useRouter();
  const { count: countParam } = useLocalSearchParams<{ count?: string }>();
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [fetched, setFetched] = useState<number | null>(null);
  // 개발용 파라미터가 있으면 그 값이 먼저다.
  const count = __DEV__ && countParam !== undefined ? Number(countParam) || 0 : fetched;
  const [reason, setReason] = useState<DeleteReason | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAccount()
      .then((a) => {
        if (!cancelled) setAccount(a);
      })
      .catch(() => {});
    // 개수는 안내 문장에만 쓴다 — 못 불러오면 개수 없는 문장으로 둔다.
    listItems()
      .then((items) => {
        if (!cancelled) setFetched(items.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const isApple = account?.kind === 'signed_in' && account.provider === 'apple';
  const notice =
    count && count > 0
      ? `삭제하면 위시 ${count}개와 사진이 모두 지워지며 복구할 수 없습니다.`
      : '삭제하면 위시와 사진이 모두 지워지며 복구할 수 없습니다.';

  function baseInput(): DeleteAccountInput {
    return {
      reason,
      reasonText: reason === 'other' && reasonText.trim() ? reasonText.trim().slice(0, REASON_TEXT_MAX) : null,
    };
  }

  function startDeleting(input: DeleteAccountInput) {
    setDeletionRequest({ input });
    router.push('/account/deleting');
  }

  // 삭제하는 중 화면은 Apple 창이 닫힌 뒤에 띄운다. 취소 = 삭제 안 함(이 화면에 남는다).
  async function handleDelete() {
    if (busy || !account) return;
    if (!isApple) {
      startDeleting(baseInput());
      return;
    }
    setBusy(true);
    try {
      const result = await confirmAppleForDeletion();
      if (result.kind === 'confirmed') {
        startDeleting({ ...baseInput(), appleAuthorizationCode: result.authorizationCode });
      } else if (result.kind === 'failed') {
        showAppleRevokeFailed();
      }
    } catch {
      showAppleRevokeFailed();
    } finally {
      setBusy(false);
    }
  }

  // 재인증 실패 = 아무것도 지우지 않고 [다시 시도] [Apple 연결 해제 없이 삭제].
  function showAppleRevokeFailed() {
    Alert.alert('Apple 연결을 해제하지 못했습니다', undefined, [
      { text: '다시 시도', onPress: () => void handleDelete() },
      { text: 'Apple 연결 해제 없이 삭제', style: 'destructive', onPress: () => startDeleting({ ...baseInput(), skipUnlink: true }) },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="뒤로">
          <Text style={styles.back}>‹ 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.title} accessibilityRole="header">
          계정 삭제
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.notice}>{notice}</Text>

          <Text style={styles.sectionLabel}>삭제하는 이유(선택)</Text>
          <View style={styles.card}>
            {REASONS.map((r, i) => {
              const selected = reason === r.value;
              return (
                <View key={r.value}>
                  {i > 0 ? <View style={styles.sep} /> : null}
                  <TouchableOpacity
                    style={styles.reasonRow}
                    onPress={() => setReason(selected ? null : r.value)}
                    accessibilityRole="radio"
                    accessibilityLabel={r.label}
                    accessibilityState={{ selected }}
                  >
                    <Text style={styles.reasonLabel}>{r.label}</Text>
                    <View style={[styles.radio, selected && styles.radioOn]}>
                      {selected ? <View style={styles.radioDot} /> : null}
                    </View>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>

          {reason === 'other' ? (
            <TextInput
              style={styles.reasonInput}
              value={reasonText}
              onChangeText={setReasonText}
              placeholder="직접 입력"
              placeholderTextColor={colors.textDisabled}
              multiline
              maxLength={REASON_TEXT_MAX}
              accessibilityLabel="삭제하는 이유 직접 입력"
            />
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          {isApple ? <Text style={styles.appleNote}>다음 화면에서 Apple 계정을 한 번 더 확인합니다.</Text> : null}
          <TouchableOpacity
            style={[styles.deleteButton, (busy || !account) && styles.disabled]}
            onPress={() => void handleDelete()}
            disabled={busy || !account}
            accessibilityRole="button"
            accessibilityLabel="계정 삭제"
            accessibilityState={{ disabled: busy || !account, busy }}
          >
            <Text style={styles.deleteText}>계정 삭제</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
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
  content: { padding: spacing.three, gap: spacing.two },
  notice: { ...type.body, color: colors.textMain, marginBottom: spacing.two },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textSub, marginTop: spacing.three, marginBottom: spacing.one },
  card: { backgroundColor: colors.bgCard, borderRadius: radius.md, paddingHorizontal: spacing.three, overflow: 'hidden' },
  sep: { height: hairlineWidth, backgroundColor: colors.silver },
  reasonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  reasonLabel: { ...type.body, color: colors.textMain },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.silverDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 12, height: 12, borderRadius: radius.pill, backgroundColor: colors.primary },
  reasonInput: {
    minHeight: 96,
    padding: spacing.three,
    borderRadius: radius.md,
    backgroundColor: colors.bgCard,
    ...type.body,
    color: colors.textMain,
    textAlignVertical: 'top',
  },
  footer: { padding: spacing.three, gap: spacing.two, alignItems: 'center' },
  appleNote: { ...type.footnote, color: colors.textSub, textAlign: 'center' },
  deleteButton: {
    alignSelf: 'stretch',
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: colors.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: { ...type.headline, color: colors.error },
  disabled: { opacity: 0.5 },
});
