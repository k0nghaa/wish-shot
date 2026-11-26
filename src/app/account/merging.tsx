import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { choose } from '@/components/account/choose';
import { leaveFlow } from '@/components/account/leaveFlow';
import { colors, spacing, type } from '@/constants/theme';
import { mergeAnonymousWishes, needsNicknameSignup } from '@/lib/queries';
import { showSnackbar } from '@/lib/snackbar';

// 위시를 합치는 중(전체 화면, 닫기 없음) — 설계 3(docs/phases/phase-22-account-login.md). 화면 등록·띄우는 시점은 login-feature 가 만든다.
// 성공: 다음 화면 + 스낵바 "위시 12개를 합쳤습니다" / 실패: 확인창 "위시를 합치지 못했습니다" [확인] [다시 시도].
// 실패해도 이 기기의 위시는 지워지지 않고, 다음에 앱을 열 때 다시 시도한다(재시도 판단은 데이터 레이어).

/** 성공하거나 사용자가 [확인]을 고를 때까지 부른다. 돌려주는 값 = 합친 개수(실패로 끝내면 null). */
async function mergeUntilSettled(): Promise<number | null> {
  for (;;) {
    let count: number | null = null;
    try {
      const result = await mergeAnonymousWishes();
      if (result.kind === 'done') count = result.count;
    } catch {
      count = null;
    }
    if (count !== null) return count; // 계측 wishes_merged 는 데이터 레이어가 보낸다
    const choice = await choose(
      '위시를 합치지 못했습니다',
      '이 기기의 위시는 지워지지 않았습니다. 다음에 앱을 열 때 다시 시도합니다.',
      [
        { label: '확인', value: 'ok', style: 'cancel' },
        { label: '다시 시도', value: 'retry' },
      ],
    );
    if (choice === 'ok') return null;
  }
}

export default function MergingScreen() {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void mergeUntilSettled().then(async (count) => {
      if (count !== null && count > 0) showSnackbar({ text: `위시 ${count}개를 합쳤습니다` });
      // 새 계정 가입이라 닉네임도 남았으면 합치기 뒤 닉네임 화면(P-19). 그 화면이 마치면 원래 가려던 화면으로 간다.
      if (await needsNicknameSignup().catch(() => false)) {
        router.replace({ pathname: '/account/nickname', params: { mode: 'signup' } });
        return;
      }
      leaveFlow(router); // 원래 가려던 화면(설정·첫 실행의 전체 탭)으로
    });
  }, [router]);

  return (
    <View style={styles.root}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.text} accessibilityRole="header">
        위시를 합치는 중
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.three, backgroundColor: colors.bg },
  text: { ...type.headline, color: colors.textMain },
});
