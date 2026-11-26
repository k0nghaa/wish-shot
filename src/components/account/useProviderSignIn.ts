import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { signIn, type SignInProvider } from '@/lib/queries';

const PROVIDER_NAME: Record<SignInProvider, string> = { apple: 'Apple', kakao: '카카오' };

/** 로그인 결과 중 "다른 수단으로 가입됨" 안내 문구 — "이미 Apple로 가입한 이메일입니다. Apple로 로그인하세요." */
export function otherProviderMessage(provider: SignInProvider): string {
  const name = PROVIDER_NAME[provider];
  return `이미 ${name}로 가입한 이메일입니다. ${name}로 로그인하세요.`;
}

type Next = 'nickname' | 'merge' | 'done';

/**
 * 로그인 버튼 동작(로그인 화면·반시트 공용). 결과 종류(kind)마다 처리한다.
 * - success: 새 계정 → 닉네임, 기존 계정 + 익명 위시 → 합치는 중, 그 밖 → onDone(원래 가려던 화면은 호출한 쪽이 정한다).
 * - cancelled: 안내 없이 그대로 둔다.
 * - other_provider: 버튼 아래에 안내 문구.
 * - error: 통신·서버 오류 안내창.
 */
export function useProviderSignIn({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<SignInProvider | null>(null);
  const [conflict, setConflict] = useState<SignInProvider | null>(null);

  const goNext = useCallback(
    (next: Next) => {
      if (next === 'nickname') router.replace({ pathname: '/account/nickname', params: { mode: 'signup' } });
      else if (next === 'merge') router.replace('/account/merging');
      else onDone();
    },
    [router, onDone],
  );

  const press = useCallback(
    async (provider: SignInProvider) => {
      if (busy) return;
      setBusy(provider);
      setConflict(null);
      try {
        const result = await signIn(provider);
        switch (result.kind) {
          case 'success':
            goNext(result.next);
            return;
          case 'cancelled':
            return;
          case 'other_provider':
            setConflict(result.provider);
            return;
          case 'error':
            Alert.alert(
              '로그인하지 못했습니다',
              result.reason === 'network' ? '네트워크 연결을 확인하세요.' : '잠시 후 다시 시도하세요.',
            );
            return;
        }
      } catch {
        Alert.alert('로그인하지 못했습니다', '잠시 후 다시 시도하세요.');
      } finally {
        setBusy(null);
      }
    },
    [busy, goNext],
  );

  return { busy, conflict, press };
}
