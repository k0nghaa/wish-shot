// check-signup 순수 로직 — ID 토큰 검증과 가입 확인 판정. 네트워크·키 없음(통신은 index.ts 가 주입한다).
// 근거: docs/phases/phase-22-account-login.md 설계 1 '가입 확인', 불변식 7.

export type Provider = 'apple' | 'kakao';

export const ISSUERS: Record<Provider, string> = {
  apple: 'https://appleid.apple.com',
  kakao: 'https://kauth.kakao.com',
};

export const JWKS_URLS: Record<Provider, string> = {
  apple: 'https://appleid.apple.com/auth/keys',
  kakao: 'https://kauth.kakao.com/.well-known/jwks.json',
};

// 시계 어긋남 허용(초)
export const CLOCK_SKEW_SEC = 60;
// 요청 값 상한
export const MAX_ID_TOKEN_LEN = 8192;
export const MAX_NONCE_LEN = 256;

export type Jwk = { kty: string; kid?: string; n?: string; e?: string; alg?: string; use?: string };

export type VerifyFailure =
  | 'malformed'
  | 'alg'
  | 'kid_unknown'
  | 'signature'
  | 'iss'
  | 'aud'
  | 'exp'
  | 'nonce'
  | 'sub';

export type Claims = { sub: string; email: string | null };

export type VerifyResult = { ok: true; claims: Claims } | { ok: false; reason: VerifyFailure };

export type VerifyOptions = {
  provider: Provider;
  keys: Jwk[];
  /** 허용 클라이언트 ID: Apple = 번들 ID(운영·개발), 카카오 = 네이티브 앱 키(운영·개발). */
  audiences: string[];
  /** 앱이 만든 원래 nonce. 토큰의 nonce 클레임은 이 값의 SHA-256(hex)와 같아야 한다. */
  nonce: string;
  nowSec: number;
};

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

// 길이가 같은 두 문자열을 시간이 일정하게 비교한다(nonce 해시 비교).
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 쉼표로 나눈 환경 변수 값을 목록으로. 빈 값·공백은 버린다. */
export function parseIdList(raw: string | undefined | null): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * ID 토큰 검증: 서명(RS256)·iss·aud·exp·nonce(sha256).
 * kid 를 찾지 못하면 'kid_unknown' — 호출자가 키 목록을 새로 받아 한 번 더 시도할 수 있다.
 */
export async function verifyIdToken(token: string, opts: VerifyOptions): Promise<VerifyResult> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return { ok: false, reason: 'malformed' };
  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (!header || !payload) return { ok: false, reason: 'malformed' };

  if (header.alg !== 'RS256') return { ok: false, reason: 'alg' };
  const kid = typeof header.kid === 'string' ? header.kid : null;
  const jwk = kid ? opts.keys.find((k) => k.kid === kid && k.kty === 'RSA' && k.n && k.e) : undefined;
  if (!jwk) return { ok: false, reason: 'kid_unknown' };

  let signatureOk = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    signatureOk = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return { ok: false, reason: 'signature' };
  }
  if (!signatureOk) return { ok: false, reason: 'signature' };

  if (payload.iss !== ISSUERS[opts.provider]) return { ok: false, reason: 'iss' };

  const aud = payload.aud;
  const auds = typeof aud === 'string' ? [aud] : Array.isArray(aud) ? aud.filter((a) => typeof a === 'string') : [];
  if (opts.audiences.length === 0 || !auds.some((a) => opts.audiences.includes(a))) {
    return { ok: false, reason: 'aud' };
  }

  const exp = payload.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp + CLOCK_SKEW_SEC < opts.nowSec) {
    return { ok: false, reason: 'exp' };
  }

  if (opts.nonce.length === 0 || typeof payload.nonce !== 'string') return { ok: false, reason: 'nonce' };
  const expected = await sha256Hex(opts.nonce);
  if (!constantTimeEqual(payload.nonce.toLowerCase(), expected)) return { ok: false, reason: 'nonce' };

  const sub = payload.sub;
  if (typeof sub !== 'string' || sub.length === 0) return { ok: false, reason: 'sub' };

  const email = typeof payload.email === 'string' && payload.email.trim() !== '' ? payload.email.trim() : null;
  return { ok: true, claims: { sub, email } };
}

// ---------------------------------------------------------------------------
// 가입 확인 흐름
// ---------------------------------------------------------------------------

/** DB 함수 lookup_signup_identity(0009)의 반환. */
export type LookupResult = { account: 'existing' | 'new'; other_provider: string | null };

export type LookupArgs = { p_provider: Provider; p_provider_id: string; p_email: string | null };

export type CheckSignupDeps = {
  nowSec: number;
  /** 허용 클라이언트 ID(환경 변수에서). */
  audiences: (provider: Provider) => string[];
  /** 공급자의 공개 키 목록. refresh=true 면 캐시를 무시하고 새로 받는다. 받지 못하면 throw. */
  getKeys: (provider: Provider, refresh: boolean) => Promise<Jwk[]>;
  /** DB 조회(service_role). 실패하면 throw. */
  lookup: (args: LookupArgs) => Promise<LookupResult>;
};

export type CheckSignupResponse =
  | { status: 200; body: { result: 'ok'; account: 'new' | 'existing' } }
  | { status: 200; body: { result: 'other_provider'; provider: string } }
  | { status: 400; body: { error: 'invalid_json' | 'invalid_input' } }
  | { status: 401; body: { error: 'invalid_token' } }
  | { status: 500; body: { error: 'server_error' } }
  | { status: 502; body: { error: 'provider_unavailable' } };

export function parseCheckSignupInput(
  input: unknown,
): { ok: true; provider: Provider; idToken: string; nonce: string } | { ok: false } {
  if (!input || typeof input !== 'object') return { ok: false };
  const o = input as Record<string, unknown>;
  if (o.provider !== 'apple' && o.provider !== 'kakao') return { ok: false };
  if (typeof o.idToken !== 'string' || o.idToken.length === 0 || o.idToken.length > MAX_ID_TOKEN_LEN) {
    return { ok: false };
  }
  if (typeof o.nonce !== 'string' || o.nonce.length === 0 || o.nonce.length > MAX_NONCE_LEN) return { ok: false };
  return { ok: true, provider: o.provider, idToken: o.idToken, nonce: o.nonce };
}

/** 조회 결과 → 응답. 같은 이메일이 다른 수단으로 이미 있으면 막는다(불변식 7). */
export function decideSignup(provider: Provider, lookup: LookupResult): CheckSignupResponse {
  if (lookup.account === 'existing') return { status: 200, body: { result: 'ok', account: 'existing' } };
  if (lookup.other_provider && lookup.other_provider !== provider) {
    return { status: 200, body: { result: 'other_provider', provider: lookup.other_provider } };
  }
  return { status: 200, body: { result: 'ok', account: 'new' } };
}

export async function handleCheckSignup(rawBody: unknown, deps: CheckSignupDeps): Promise<CheckSignupResponse> {
  const input = parseCheckSignupInput(rawBody);
  if (!input.ok) return { status: 400, body: { error: 'invalid_input' } };
  const { provider, idToken, nonce } = input;

  const opts = (keys: Jwk[]): VerifyOptions => ({
    provider,
    keys,
    audiences: deps.audiences(provider),
    nonce,
    nowSec: deps.nowSec,
  });

  let verified: VerifyResult;
  try {
    verified = await verifyIdToken(idToken, opts(await deps.getKeys(provider, false)));
    // 키가 바뀌었을 수 있으니 kid 를 못 찾으면 새로 받아 한 번만 더 본다
    if (!verified.ok && verified.reason === 'kid_unknown') {
      verified = await verifyIdToken(idToken, opts(await deps.getKeys(provider, true)));
    }
  } catch {
    return { status: 502, body: { error: 'provider_unavailable' } };
  }
  if (!verified.ok) return { status: 401, body: { error: 'invalid_token' } };

  // 토큰에 이메일이 없으면 이메일 검사를 건너뛴다(조회는 이 수단의 기존 계정 여부만 본다)
  let lookup: LookupResult;
  try {
    lookup = await deps.lookup({
      p_provider: provider,
      p_provider_id: verified.claims.sub,
      p_email: verified.claims.email,
    });
  } catch {
    return { status: 500, body: { error: 'server_error' } };
  }
  return decideSignup(provider, lookup);
}
