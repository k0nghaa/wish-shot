import { useLocalSearchParams, useRouter } from 'expo-router';

import { SignInContent } from '@/components/account/SignInContent';
import type { SignInEntry } from '@/lib/analytics';

// 로그인(설정·반시트·로그인 전용 기능에서 연 모달, 닫기 X). 파라미터 from: settings | sheet | feature — 설계 3(docs/phases/phase-22-account-login.md).
// 첫 화면의 로그인(sign-in)과 같은 화면 부품(SignInContent)을 쓴다. 화면 등록·띄우는 시점은 login-feature 가 만든다.

const ENTRY: Record<string, SignInEntry> = { settings: 'settings', sheet: 'sheet', feature: 'feature' };

export default function AccountSignInScreen() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const entry = ENTRY[from ?? ''] ?? 'settings';
  const close = () => router.dismiss();

  return <SignInContent entry={entry} bottom={{ kind: 'close', onClose: close }} onDone={close} />;
}
