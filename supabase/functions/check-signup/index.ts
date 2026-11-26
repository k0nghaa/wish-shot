// check-signup(가입 확인) — Apple·카카오 ID 토큰을 Supabase 에 보내기 전에 거치는 Edge Function (Deno).
// 근거: docs/phases/phase-22-account-login.md 설계 1, 불변식 7(한 계정 = 수단 하나).
//
// 계약:
//   입력:  { "provider": "apple" | "kakao", "idToken": string, "nonce": string }
//          nonce 는 앱이 만든 원래 값(Apple·카카오에는 SHA-256 해시를 보냈다). 토큰의 nonce 클레임 = sha256(nonce) hex.
//   출력:  200 { "result": "ok", "account": "new" | "existing" }
//          200 { "result": "other_provider", "provider": "apple" | "kakao" | "google" }  — 같은 이메일이 다른 수단으로 가입돼 있음
//          401 { "error": "invalid_token" }  — 서명·iss·aud·exp·nonce 중 하나라도 틀림
//          400 { "error": "invalid_json" | "invalid_input" }, 502 { "error": "provider_unavailable" }(공개 키를 못 받음),
//          500 { "error": "server_error" }(DB 조회 실패), 405 { "error": "method_not_allowed" }
//   토큰에 이메일이 없으면 이메일 검사를 건너뛴다(그 수단의 기존 계정 여부만 본다).
//
// 인증: 증거는 ID 토큰 하나다. 세션이 없는 호출(로그인 전)이라 verify_jwt = false 로 둔다(supabase/config.toml).
//   앱 키(anon·publishable 키 형식에 상관없이)로 부르든 키 없이 부르든 같다 — 서명 검증된 토큰이 없으면 아무 정보도 주지 않는다.
//   DB 조회는 service_role 전용 함수 public.lookup_signup_identity(0009).
//
// 환경 변수(시크릿, 사람이 등록 — 값은 공개 식별자지만 배포 환경별로 다르다):
//   APPLE_CLIENT_IDS  = Apple 앱 번들 ID 쉼표 목록(운영·개발)
//   KAKAO_CLIENT_IDS  = 카카오 네이티브 앱 키 쉼표 목록(운영·개발)
//
// 로그: 결과 종류만. 토큰·이메일·식별자는 남기지 않는다.
// 이 함수는 소셜 토큰을 저장하지 않는다(불변식 6).
// 배포(사람): npx supabase@2.121.0 functions deploy check-signup  (0009 적용 뒤)

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  type CheckSignupResponse,
  type Jwk,
  type LookupResult,
  type Provider,
  JWKS_URLS,
  handleCheckSignup,
  parseIdList,
} from './logic.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const DB_TIMEOUT_MS = 3_000;
const JWKS_TIMEOUT_MS = 4_000;
// 공개 키 캐시(함수 인스턴스 안). 키가 바뀌면 kid_unknown 때 새로 받는다.
const JWKS_TTL_MS = 60 * 60 * 1000;
// 새로 받기 폭주 방지: 같은 공급자는 이 간격 안에 다시 받지 않는다.
const JWKS_MIN_REFRESH_MS = 30_000;

const admin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const jwksCache = new Map<Provider, { keys: Jwk[]; fetchedAt: number }>();

async function getKeys(provider: Provider, refresh: boolean): Promise<Jwk[]> {
  const cached = jwksCache.get(provider);
  const now = Date.now();
  if (cached) {
    const age = now - cached.fetchedAt;
    if (!refresh && age < JWKS_TTL_MS) return cached.keys;
    if (refresh && age < JWKS_MIN_REFRESH_MS) return cached.keys;
  }
  const res = await fetch(JWKS_URLS[provider], { signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`jwks_status_${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) throw new Error('jwks_empty');
  jwksCache.set(provider, { keys: body.keys, fetchedAt: now });
  return body.keys;
}

async function lookup(args: { p_provider: string; p_provider_id: string; p_email: string | null }): Promise<LookupResult> {
  if (!admin) throw new Error('no_service_key');
  const { data, error } = await admin
    .rpc('lookup_signup_identity', args)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (error) throw new Error(`lookup_error_${error.code ?? 'unknown'}`);
  const d = data as { account?: unknown; other_provider?: unknown } | null;
  if (d?.account !== 'new' && d?.account !== 'existing') throw new Error('lookup_bad_response');
  return {
    account: d.account,
    other_provider: typeof d.other_provider === 'string' ? d.other_provider : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const res: CheckSignupResponse = await handleCheckSignup(body, {
    nowSec: Math.floor(Date.now() / 1000),
    audiences: (p) => parseIdList(Deno.env.get(p === 'apple' ? 'APPLE_CLIENT_IDS' : 'KAKAO_CLIENT_IDS')),
    getKeys,
    lookup,
  });
  // 결과 종류만 남긴다
  console.log(`check-signup: status=${res.status} ${'result' in res.body ? `result=${res.body.result}` : `error=${res.body.error}`}`);
  return json(res.body, res.status);
});
