import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { SignInContent, type SkipAlert } from '@/components/account/SignInContent';
import { EmptyState } from '@/components/EmptyState';
import { colors } from '@/constants/theme';
import type { SignInEntry } from '@/lib/analytics';
import { wasLaunchedByShare } from '@/lib/shareIntent';
import { getStartState, type SignInProvider, type StartState } from '@/lib/queries';

// 로그인(세션이 없을 때 첫 화면, 닫기 없음) — 설계 3(docs/phases/phase-22-account-login.md). 화면 등록·띄우는 시점은 login-feature 가 만든다.
// 들어온 길(A·B·C·D·최근 로그인)은 파라미터 없이 기기 상태(getStartState)로 정한다.
// '로그인 화면·반시트 1회'는 이 화면을 보였다고 쓰지 않는다 — 첫 실행에서 "로그인 없이 시작"을 고를 때만 데이터 레이어가 쓴다(P-06).

type Context =
  | { kind: 'unreadable' }
  /** 다시 읽어 보니 로그인 화면이 필요 없음(익명·로그인 → 전체 탭, 삭제 중 → 삭제하는 중) — 이 화면을 떠난다. */
  | { kind: 'leave'; to: '/' | '/account/deleting' }
  | ({ kind: 'ready' } & ReadyContext);

type ReadyContext = {
  entry: SignInEntry;
  alert: SkipAlert;
  lastProvider: SignInProvider | null;
  lost: { previousUserId: string | null } | null;
};

function contextFor(state: StartState): Context {
  switch (state.kind) {
    case 'unreadable':
      // 기기 저장값을 읽지 못함 — "세션 없음"이 아니다. 로그인 화면 대신 실패 안내 + 다시 시도.
      return { kind: 'unreadable' };
    case 'anonymous':
    case 'signed_in':
      return { kind: 'leave', to: '/' };
    case 'deleting':
      return { kind: 'leave', to: '/account/deleting' };
    case 'signed_out':
      return { kind: 'ready', entry: 'signed_out', alert: 'B', lastProvider: state.lastProvider, lost: null };
    case 'session_lost':
      return {
        kind: 'ready',
        entry: 'lost',
        alert: 'D',
        lastProvider: null,
        lost: { previousUserId: state.previousUserId },
      };
    default:
      // fresh(첫 실행·공유·위시 흔적 없는 거절)와 그 밖 — 기본 화면, 확인창 A.
      return { kind: 'ready', entry: wasLaunchedByShare() ? 'share' : 'first_launch', alert: 'A', lastProvider: null, lost: null };
  }
}

export default function SignInScreen() {
  const router = useRouter();
  const [context, setContext] = useState<Context | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getStartState()
      .then((state) => {
        if (!cancelled) setContext(contextFor(state));
      })
      .catch(() => {
        if (!cancelled) setContext({ kind: 'unreadable' });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // 다시 읽기([다시 시도])가 성공해 로그인 화면이 필요 없으면 떠난다(루트가 같은 상태로 다시 그린 뒤).
  const leaveTo = context?.kind === 'leave' ? context.to : null;
  useEffect(() => {
    if (leaveTo) router.replace(leaveTo);
  }, [leaveTo, router]);

  if (context?.kind === 'unreadable') {
    return (
      <View style={styles.center}>
        <EmptyState
          title="불러오지 못했습니다"
          description="네트워크 연결을 확인하세요."
          ctaLabel="다시 시도"
          onCta={() => {
            setContext(null);
            setAttempt((n) => n + 1);
          }}
        />
      </View>
    );
  }

  if (!context || context.kind === 'leave') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <SignInContent
      entry={context.entry}
      bottom={{ kind: 'skip', alert: context.alert }}
      lastProvider={context.lastProvider}
      lostSession={context.lost}
      onDone={() => {
        // 등록 폼이 저장하려다 띄운 로그인 화면이면 폼으로 돌아가 저장을 이어 간다(P-24). 첫 화면이었으면 전체 탭으로.
        if (router.canGoBack()) router.back();
        else router.replace('/');
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
