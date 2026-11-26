import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { DisclosureRow, FormCard, FormRow } from '@/components/FormField';
import { colors, spacing, type } from '@/constants/theme';
import {
  getAccount,
  getInquiryUserId,
  mergeAnonymousWishes,
  signOutAccount,
  type AccountInfo,
  type PendingMerge,
  type SignInProvider,
} from '@/lib/queries';
import { showSnackbar } from '@/lib/snackbar';
import { inquiryNumber, lostAccountMailUrl, SUPPORT_EMAIL } from '@/lib/supportMail';

// 설정 맨 위 '계정' 영역(설정 화면이 그린다).
// 로그인했을 때: 닉네임 · 이메일(표시만) · 로그인 방법(누를 수 없음) · 로그아웃 · 계정 삭제(빨간 글자)
// 익명일 때: 로그인(값 "로그인 안 함") · 계정 삭제
// 합치지 못한 위시가 남아 있으면 "합치지 못한 위시 12개 · 다시 시도" 행(익명 세션까지 못 쓰게 되면 "문의하기").

const PROVIDER_LABEL: Record<SignInProvider, string> = { apple: 'Apple', kakao: '카카오' };

function ActionRow({ label, color, onPress, busy }: { label: string; color?: string; onPress: () => void; busy?: boolean }) {
  return (
    <TouchableOpacity
      style={styles.actionRow}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!busy, busy: !!busy }}
    >
      <Text style={[styles.actionLabel, color ? { color } : null, busy && styles.dim]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <FormRow label={label}>
      <Text style={styles.value} numberOfLines={1} accessibilityLabel={`${label}: ${value}`}>
        {value}
      </Text>
    </FormRow>
  );
}

export function AccountSection() {
  const router = useRouter();
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [merging, setMerging] = useState(false);

  const load = useCallback(async () => {
    try {
      setAccount(await getAccount());
    } catch {
      setAccount(null);
    }
  }, []);

  // 설정에 들어올 때마다(로그인·닉네임 변경·삭제 안내에서 돌아올 때) 다시 읽는다.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function confirmSignOut() {
    Alert.alert('로그아웃할까요?', '다시 로그인하면 위시를 볼 수 있습니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        style: 'destructive',
        onPress: () => {
          signOutAccount()
            .then(() => load()) // 계측 signed_out 은 데이터 레이어가 보낸다
            .catch(() => Alert.alert('로그아웃하지 못했습니다', '잠시 후 다시 시도하세요.'));
        },
      },
    ]);
  }

  async function retryMerge() {
    if (merging) return;
    setMerging(true);
    let failed = false;
    try {
      const result = await mergeAnonymousWishes();
      if (result.kind === 'done') {
        if (result.count > 0) showSnackbar({ text: `위시 ${result.count}개를 합쳤습니다` });
      } else {
        failed = true;
      }
    } catch {
      failed = true;
    } finally {
      setMerging(false);
      void load();
    }
    // 실패 창은 합치는 중 화면과 같다: [확인] [다시 시도].
    if (failed) {
      Alert.alert('위시를 합치지 못했습니다', '이 기기의 위시는 지워지지 않았습니다. 다음에 앱을 열 때 다시 시도합니다.', [
        { text: '확인', style: 'cancel' },
        { text: '다시 시도', onPress: () => void retryMerge() },
      ]);
    }
  }

  // 익명 세션까지 못 쓰게 됨 — 문의 메일(본문에 이전 계정 번호).
  async function inquire() {
    const userId = await getInquiryUserId().catch(() => null);
    Linking.openURL(lostAccountMailUrl(userId)).catch(() => {
      const number = inquiryNumber(userId);
      Alert.alert('메일 열기 실패', `문의 주소: ${SUPPORT_EMAIL}${number ? `\n문의 번호: ${number}` : ''}`);
    });
  }

  function pendingRow(pending: PendingMerge) {
    const action = pending.inquiryOnly ? '문의하기' : '다시 시도';
    return (
      <TouchableOpacity
        style={styles.pendingRow}
        onPress={() => void (pending.inquiryOnly ? inquire() : retryMerge())}
        disabled={merging}
        accessibilityRole="button"
        accessibilityLabel={`합치지 못한 위시 ${pending.count}개 · ${action}`}
        accessibilityState={{ disabled: merging, busy: merging }}
      >
        <Text style={[styles.pendingText, merging && styles.dim]}>
          합치지 못한 위시 {pending.count}개 · {action}
        </Text>
        <SymbolView name="chevron.right" size={14} tintColor={colors.silverDark} weight="semibold" />
      </TouchableOpacity>
    );
  }

  const deleteRow = <ActionRow key="delete" label="계정 삭제" color={colors.error} onPress={() => router.push('/account/delete')} />;

  if (!account) return null;

  return (
    <View>
      <Text style={styles.sectionLabel}>계정</Text>
      {account.kind === 'signed_in' ? (
        <FormCard>
          <DisclosureRow
            label="닉네임"
            value={account.nickname}
            onPress={() => router.push({ pathname: '/account/nickname', params: { mode: 'edit' } })}
          />
          {account.email ? <ValueRow label="이메일" value={account.email} /> : null}
          <ValueRow label="로그인 방법" value={PROVIDER_LABEL[account.provider]} />
          {account.pendingMerge ? pendingRow(account.pendingMerge) : null}
          <ActionRow label="로그아웃" onPress={confirmSignOut} />
          {deleteRow}
        </FormCard>
      ) : (
        <FormCard>
          <DisclosureRow
            label="로그인"
            value="로그인 안 함"
            onPress={() => router.push({ pathname: '/account/sign-in', params: { from: 'settings' } })}
          />
          {deleteRow}
        </FormCard>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSub,
    marginTop: spacing.three,
    marginBottom: spacing.one,
  },
  value: { ...type.body, color: colors.textSub, textAlign: 'right' },
  actionRow: { minHeight: 48, justifyContent: 'center' },
  actionLabel: { ...type.body, color: colors.textMain },
  pendingRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.three,
  },
  pendingText: { ...type.body, color: colors.textMain, flexShrink: 1 },
  dim: { opacity: 0.5 },
});
