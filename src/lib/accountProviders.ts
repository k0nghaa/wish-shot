import Constants from 'expo-constants';

import type { Provider } from '@/lib/accountLogic';

// Apple·카카오 네이티브 로그인 창. 네이티브 모듈이 없는 환경(Expo Go·옛 개발용 앱)에서도 앱이 켜지도록 쓸 때 불러온다 —
// 모듈이 없으면 로그인 오류(error)로 끝나고 앱은 멈추지 않는다.
//
// nonce: 원래 값은 앱이 만들고, Apple·카카오에는 SHA-256 해시를, Supabase(signInWithIdToken·linkIdentity)와 가입 확인에는
// 원래 값을 보낸다(Supabase 가 넘긴 값을 sha256 해 토큰의 nonce 와 비교한다).

export type ProviderToken = {
  idToken: string;
  /** Supabase·가입 확인에 보낼 원래 nonce. */
  nonce: string;
  /** Apple 로그인이면 Apple 사용자 ID(연결 상태 확인용). */
  appleUserId: string | null;
};

export type ProviderTokenResult = { kind: 'ok'; token: ProviderToken } | { kind: 'cancelled' } | { kind: 'error' };

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

async function createNonce(): Promise<{ raw: string; hashed: string }> {
  const Crypto = await import('expo-crypto');
  const raw = toHex(await Crypto.getRandomBytesAsync(16));
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
  return { raw, hashed };
}

async function appleToken(): Promise<ProviderTokenResult> {
  const AppleAuthentication = await import('expo-apple-authentication');
  const nonce = await createNonce();
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: nonce.hashed,
    });
    if (!credential.identityToken) return { kind: 'error' };
    return { kind: 'ok', token: { idToken: credential.identityToken, nonce: nonce.raw, appleUserId: credential.user } };
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return { kind: 'cancelled' };
    return { kind: 'error' };
  }
}

let kakaoReady: Promise<void> | null = null;

/** 카카오 SDK 를 앱 키로 한 번 초기화한다(운영·개발 앱 키는 app.config.js 가 extra 로 내려 준다). */
async function initKakao(): Promise<void> {
  const appKey = Constants.expoConfig?.extra?.kakaoNativeAppKey as string | undefined;
  if (!appKey) throw new Error('kakao app key missing');
  if (!kakaoReady) {
    kakaoReady = import('@react-native-kakao/core').then((core) => core.initializeKakaoSDK(appKey));
    kakaoReady.catch(() => {
      kakaoReady = null;
    });
  }
  await kakaoReady;
}

async function kakaoToken(): Promise<ProviderTokenResult> {
  try {
    await initKakao();
    const nonce = await createNonce();
    const user = await import('@react-native-kakao/user');
    // 이메일 필수 동의는 카카오 콘솔의 동의항목 설정이 정한다. ID 토큰은 콘솔의 OpenID Connect 가 켜져 있어야 온다.
    const token = await user.login({ nonce: nonce.hashed });
    if (!token.idToken) return { kind: 'error' };
    return { kind: 'ok', token: { idToken: token.idToken, nonce: nonce.raw, appleUserId: null } };
  } catch (e) {
    // 사용자가 창을 닫거나 동의하지 않음(카카오 SDK 의 Cancelled·AccessDenied)
    const code = String((e as { code?: unknown }).code ?? '');
    if (/cancel|access_?denied/i.test(code)) return { kind: 'cancelled' };
    return { kind: 'error' };
  }
}

/** 로그인 창을 띄워 ID 토큰을 받는다. */
export async function getProviderToken(provider: Provider): Promise<ProviderTokenResult> {
  try {
    return provider === 'apple' ? await appleToken() : await kakaoToken();
  } catch {
    return { kind: 'error' };
  }
}

export type AppleCredentialState = 'authorized' | 'revoked' | 'unknown';

/** Apple 연결 상태. REVOKED·NOT_FOUND 는 revoked(iPhone 설정에서 연결을 끊음), 확인하지 못하면 unknown. */
export async function getAppleCredentialState(appleUserId: string): Promise<AppleCredentialState> {
  try {
    const AppleAuthentication = await import('expo-apple-authentication');
    const state = await AppleAuthentication.getCredentialStateAsync(appleUserId);
    const S = AppleAuthentication.AppleAuthenticationCredentialState;
    if (state === S.REVOKED || state === S.NOT_FOUND) return 'revoked';
    return state === S.AUTHORIZED ? 'authorized' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** iPhone 설정에서 Apple 연결이 끊기면 알린다. 구독 해제 함수를 돌려준다(모듈이 없으면 아무것도 하지 않는다). */
export function addAppleRevokeListener(listener: () => void): () => void {
  let remove: (() => void) | null = null;
  let stopped = false;
  void import('expo-apple-authentication')
    .then((AppleAuthentication) => {
      const subscription = AppleAuthentication.addRevokeListener(listener);
      if (stopped) subscription.remove();
      else remove = () => subscription.remove();
    })
    .catch(() => undefined);
  return () => {
    stopped = true;
    remove?.();
  };
}

/** Apple 재인증(계정 삭제 전): 철회에 쓸 인증 코드를 받는다. 코드는 한 번만, 5분 안에 쓸 수 있다. */
export async function getAppleAuthorizationCode(): Promise<
  { kind: 'ok'; authorizationCode: string } | { kind: 'cancelled' } | { kind: 'error' }
> {
  try {
    const AppleAuthentication = await import('expo-apple-authentication');
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
    });
    return credential.authorizationCode ? { kind: 'ok', authorizationCode: credential.authorizationCode } : { kind: 'error' };
  } catch (e) {
    return (e as { code?: string }).code === 'ERR_REQUEST_CANCELED' ? { kind: 'cancelled' } : { kind: 'error' };
  }
}

/** 기기에 남은 카카오 로그인 정보를 지운다(로그아웃·계정 삭제 뒤). 서버 연결 해제는 계정 삭제 서버 함수가 한다. 실패는 삼킨다. */
export async function kakaoLocalLogout(): Promise<void> {
  try {
    const user = await import('@react-native-kakao/user');
    await user.logout();
  } catch {
    /* 모듈이 없거나 이미 끊김 */
  }
}
