import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { choose } from '@/components/account/choose';
import { takeDeletionRequest } from '@/components/account/deletionRequest';
import { colors, spacing, type } from '@/constants/theme';
import {
  confirmAppleForDeletion,
  deleteAccount,
  getStartState,
  type DeleteAccountInput,
  type DeleteAccountResult,
  type SignInProvider,
} from '@/lib/queries';

// 삭제하는 중(전체 화면, 닫기 없음) — 설계 3(docs/phases/phase-22-account-login.md). 화면 등록·띄우는 시점은 login-feature 가 만든다.
// 안내 화면에서 넘어온 요청으로 deleteAccount 를 부른다. 앱이 도중에 꺼져 다시 켠 경우엔 요청이 없으므로 사유 없이 이어서 부른다
// (요청을 보낸 뒤 답을 받기 전에 꺼진 경우만 — 그 밖의 '삭제 중' 기록은 첫 화면 판정이 되돌린다, accountLogic.deletionOnLaunch).
// 사용자가 멈추면(Apple 재인증 취소, '삭제하지 못했습니다' [취소]) 기록을 되돌리고 안내 화면 또는 설정으로 간다.
// 결과: 삭제됨 → 완료 확인창 → 처음 설치한 것과 같은 흐름(기기 정리는 deleteAccount 가 이미 했다) /
//       연결 해제 실패(Apple·카카오) → [다시 시도] [연결 해제 없이 삭제] / Apple 재인증 필요 → 재인증부터 다시 / 통신·서버 오류 → 안내창.

const EMPTY_INPUT: DeleteAccountInput = { reason: null, reasonText: null };

const PROVIDER_NAME: Record<SignInProvider, string> = { apple: 'Apple', kakao: '카카오' };
// 연결 해제 없이 삭제했을 때 완료 창에 더하는 안내(직접 끊는 길).
const UNLINK_NOTE: Record<SignInProvider, string> = {
  apple: 'iPhone 설정의 Apple 계정 > 로그인 및 보안에서 위시샷 연결을 해제할 수 있습니다',
  kakao: '카카오계정의 연결된 서비스 관리에서 위시샷 연결을 해제할 수 있습니다',
};

async function callDelete(input: DeleteAccountInput): Promise<DeleteAccountResult> {
  try {
    return await deleteAccount(input);
  } catch {
    return { kind: 'error', reason: 'server' };
  }
}

type AppleCode = { kind: 'code'; code: string } | { kind: 'cancelled' } | { kind: 'failed' };

// Apple 재인증(인증 코드는 한 번만 쓸 수 있어 매번 새로 받는다).
async function reconfirmApple(): Promise<AppleCode> {
  try {
    const r = await confirmAppleForDeletion();
    if (r.kind === 'confirmed') return { kind: 'code', code: r.authorizationCode };
    return r.kind === 'cancelled' ? { kind: 'cancelled' } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * 연결 해제 실패 뒤(아무것도 지우지 않은 상태): [다시 시도] [연결 해제 없이 삭제]. 취소 = null(삭제 안 함).
 * Apple 은 다시 시도하면 Apple 창이 또 뜬다. 카카오는 같은 요청을 다시 보낸다.
 */
async function resolveUnlinkFailure(provider: SignInProvider, input: DeleteAccountInput): Promise<DeleteAccountInput | null> {
  const name = PROVIDER_NAME[provider];
  for (;;) {
    const choice = await choose(`${name} 연결을 해제하지 못했습니다`, undefined, [
      { label: '다시 시도', value: 'retry' },
      { label: `${name} 연결 해제 없이 삭제`, value: 'skip', style: 'destructive' },
    ]);
    if (choice === 'skip') return { ...input, appleAuthorizationCode: undefined, skipUnlink: true };
    if (provider === 'kakao') return { ...input, skipUnlink: undefined };
    const confirm = await reconfirmApple();
    if (confirm.kind === 'cancelled') return null;
    if (confirm.kind === 'code') return { ...input, appleAuthorizationCode: confirm.code, skipUnlink: undefined };
  }
}

/** 삭제를 끝낼 때까지 부른다. true = 삭제됨, false = 사용자가 멈춤. */
async function runDeletion(first: DeleteAccountInput): Promise<boolean> {
  let input = first;
  // 연결 해제 없이 삭제를 고른 수단(완료 창 안내용). 안내 화면의 Apple 재인증 실패 선택도 Apple 이다.
  let skipped: SignInProvider | null = first.skipUnlink ? 'apple' : null;
  for (;;) {
    const result = await callDelete(input);
    if (result.kind === 'deleted') {
      await choose('계정을 삭제했습니다', skipped ? UNLINK_NOTE[skipped] : undefined, [{ label: '확인', value: 'ok' }]);
      return true;
    }
    if (result.kind === 'apple_code_required') {
      // Apple 재인증부터 다시 한다. 취소 = 삭제 안 함.
      const confirm = await reconfirmApple();
      if (confirm.kind === 'cancelled') return false;
      if (confirm.kind === 'code') {
        input = { ...input, appleAuthorizationCode: confirm.code };
        continue;
      }
      const next = await resolveUnlinkFailure('apple', input);
      if (!next) return false;
      if (next.skipUnlink) skipped = 'apple';
      input = next;
      continue;
    }
    if (result.kind === 'unlink_failed') {
      const next = await resolveUnlinkFailure(result.provider, input); // 아무것도 지우지 않은 상태
      if (!next) return false;
      if (next.skipUnlink) skipped = result.provider;
      input = next;
      continue;
    }
    const again = await choose(
      '삭제하지 못했습니다',
      result.reason === 'network' ? '네트워크 연결을 확인하세요.' : '잠시 후 다시 시도하세요.',
      [
        { label: '취소', value: 'cancel', style: 'cancel' },
        { label: '다시 시도', value: 'retry' },
      ],
    );
    if (again === 'cancel') return false;
  }
}

export default function DeletingScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const started = useRef(false);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const request = takeDeletionRequest();
    void runDeletion(request?.input ?? EMPTY_INPUT).then(async (deleted) => {
      if (deleted) {
        router.replace('/'); // 새로 설치한 것과 같은 흐름(첫 화면 결정은 루트가 한다)
        return;
      }
      // 삭제 안 함: 기기 상태를 다시 판정해 '삭제 중' 기록을 삭제 전 기록으로 되돌리고 알린다(다음 실행에 삭제를 다시 부르지 않게).
      await getStartState().catch(() => undefined);
      setStopped(true);
    });
  }, [router]);

  // 되돌린 상태로 화면이 다시 그려진 뒤 떠난다: 안내 화면에서 왔으면 그리로, 다시 켠 첫 화면이었으면(아래 화면 없음) 설정으로.
  useEffect(() => {
    if (!stopped) return;
    if (router.canGoBack()) router.back();
    else navigation.reset({ index: 1, routes: [{ name: '(tabs)' as never }, { name: 'settings' as never }] });
  }, [stopped, router, navigation]);

  return (
    <View style={styles.root}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.text} accessibilityRole="header">
        삭제하는 중
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.three, backgroundColor: colors.bg },
  text: { ...type.headline, color: colors.textMain },
});
