// check-signup 순수 로직 단위 검증(네트워크·키 없음 — 시험용 키 쌍을 그 자리에서 만든다).
// 실행: deno test --no-lock supabase/tests/check_signup_test.ts
import {
  type CheckSignupDeps,
  type Jwk,
  type LookupArgs,
  type LookupResult,
  type Provider,
  decideSignup,
  handleCheckSignup,
  parseIdList,
  sha256Hex,
  verifyIdToken,
} from '../functions/check-signup/logic.ts';

function eq(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}

const NOW = 1_800_000_000;
const NONCE = 'raw-nonce-0123456789abcdef';
const APPLE_AUD = ['com.example.wishshot', 'com.example.wishshot.dev'];
const KAKAO_AUD = ['kakao-native-key-prod', 'kakao-native-key-dev'];

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const te = new TextEncoder();

async function makeKey(kid: string) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const pub = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as Jwk;
  return { kid, privateKey: pair.privateKey, jwk: { ...pub, kid, alg: 'RS256', use: 'sig' } as Jwk };
}

type TestKey = Awaited<ReturnType<typeof makeKey>>;

async function sign(
  key: TestKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
): Promise<string> {
  const h = b64url(te.encode(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header })));
  const p = b64url(te.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, te.encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url(sig)}`;
}

async function goodClaims(provider: Provider, over: Record<string, unknown> = {}) {
  return {
    iss: provider === 'apple' ? 'https://appleid.apple.com' : 'https://kauth.kakao.com',
    aud: provider === 'apple' ? APPLE_AUD[0] : KAKAO_AUD[0],
    sub: 'provider-user-1',
    exp: NOW + 600,
    iat: NOW - 10,
    nonce: await sha256Hex(NONCE),
    email: 'Minji@Example.com',
    ...over,
  };
}

const keyA = await makeKey('kid-a');
const keyB = await makeKey('kid-b'); // 다른 키 쌍

function verifyOpts(provider: Provider, keys: Jwk[] = [keyA.jwk]) {
  return {
    provider,
    keys,
    audiences: provider === 'apple' ? APPLE_AUD : KAKAO_AUD,
    nonce: NONCE,
    nowSec: NOW,
  };
}

// ---------------------------------------------------------------------------
// 토큰 검증
// ---------------------------------------------------------------------------
Deno.test('verifyIdToken: 올바른 Apple·카카오 토큰은 통과하고 sub·이메일을 돌려준다', async () => {
  for (const provider of ['apple', 'kakao'] as const) {
    const token = await sign(keyA, await goodClaims(provider));
    const r = await verifyIdToken(token, verifyOpts(provider));
    eq(r, { ok: true, claims: { sub: 'provider-user-1', email: 'Minji@Example.com' } }, provider);
  }
});

Deno.test('verifyIdToken: aud 가 배열이어도 허용 목록과 겹치면 통과, 개발용 클라이언트 ID 도 통과', async () => {
  const t1 = await sign(keyA, await goodClaims('apple', { aud: ['other', APPLE_AUD[1]] }));
  eq((await verifyIdToken(t1, verifyOpts('apple'))).ok, true);
  const t2 = await sign(keyA, await goodClaims('kakao', { aud: KAKAO_AUD[1] }));
  eq((await verifyIdToken(t2, verifyOpts('kakao'))).ok, true);
});

Deno.test('verifyIdToken: 서명이 틀리면 signature(같은 kid 를 단 다른 키로 서명)', async () => {
  const forged = await sign({ ...keyB, kid: 'kid-a' }, await goodClaims('apple'));
  eq(await verifyIdToken(forged, verifyOpts('apple')), { ok: false, reason: 'signature' });
});

Deno.test('verifyIdToken: 내용을 바꾸면 signature', async () => {
  const token = await sign(keyA, await goodClaims('apple'));
  const [h, , s] = token.split('.');
  const tampered = `${h}.${b64url(te.encode(JSON.stringify(await goodClaims('apple', { sub: 'attacker' }))))}.${s}`;
  eq(await verifyIdToken(tampered, verifyOpts('apple')), { ok: false, reason: 'signature' });
});

Deno.test('verifyIdToken: aud 불일치(허용 목록 밖·빈 목록)는 aud', async () => {
  const token = await sign(keyA, await goodClaims('apple', { aud: 'com.attacker.app' }));
  eq(await verifyIdToken(token, verifyOpts('apple')), { ok: false, reason: 'aud' });
  const ok = await sign(keyA, await goodClaims('apple'));
  eq(await verifyIdToken(ok, { ...verifyOpts('apple'), audiences: [] }), { ok: false, reason: 'aud' });
  // 카카오 토큰의 aud(네이티브 앱 키)를 Apple 목록으로 검증하면 실패
  const kakao = await sign(keyA, await goodClaims('kakao', { iss: 'https://appleid.apple.com' }));
  eq(await verifyIdToken(kakao, verifyOpts('apple')), { ok: false, reason: 'aud' });
});

Deno.test('verifyIdToken: 만료는 exp(시계 어긋남 60초는 허용)', async () => {
  const expired = await sign(keyA, await goodClaims('apple', { exp: NOW - 61 }));
  eq(await verifyIdToken(expired, verifyOpts('apple')), { ok: false, reason: 'exp' });
  const justExpired = await sign(keyA, await goodClaims('apple', { exp: NOW - 30 }));
  eq((await verifyIdToken(justExpired, verifyOpts('apple'))).ok, true, '어긋남 허용 안');
  const noExp = await sign(keyA, await goodClaims('apple', { exp: undefined }));
  eq(await verifyIdToken(noExp, verifyOpts('apple')), { ok: false, reason: 'exp' });
});

Deno.test('verifyIdToken: nonce 불일치·없음·원래 값을 그대로 넣은 경우는 nonce', async () => {
  const wrong = await sign(keyA, await goodClaims('apple', { nonce: await sha256Hex('other-nonce') }));
  eq(await verifyIdToken(wrong, verifyOpts('apple')), { ok: false, reason: 'nonce' });
  const missing = await sign(keyA, await goodClaims('apple', { nonce: undefined }));
  eq(await verifyIdToken(missing, verifyOpts('apple')), { ok: false, reason: 'nonce' });
  // 토큰에 해시가 아니라 원래 값이 들어 있으면 거절(앱은 해시를 보내야 한다)
  const raw = await sign(keyA, await goodClaims('apple', { nonce: NONCE }));
  eq(await verifyIdToken(raw, verifyOpts('apple')), { ok: false, reason: 'nonce' });
  // 요청의 nonce 가 비어 있으면 거절
  const good = await sign(keyA, await goodClaims('apple'));
  eq(await verifyIdToken(good, { ...verifyOpts('apple'), nonce: '' }), { ok: false, reason: 'nonce' });
});

Deno.test('verifyIdToken: iss·alg·kid·형식 오류', async () => {
  const badIss = await sign(keyA, await goodClaims('apple', { iss: 'https://evil.example.com' }));
  eq(await verifyIdToken(badIss, verifyOpts('apple')), { ok: false, reason: 'iss' });
  const hs = await sign(keyA, await goodClaims('apple'), { alg: 'HS256' });
  eq(await verifyIdToken(hs, verifyOpts('apple')), { ok: false, reason: 'alg' });
  const none = await sign(keyA, await goodClaims('apple'), { alg: 'none' });
  eq(await verifyIdToken(none, verifyOpts('apple')), { ok: false, reason: 'alg' });
  const unknownKid = await sign({ ...keyA, kid: 'kid-zzz' }, await goodClaims('apple'));
  eq(await verifyIdToken(unknownKid, verifyOpts('apple')), { ok: false, reason: 'kid_unknown' });
  eq(await verifyIdToken('not-a-jwt', verifyOpts('apple')), { ok: false, reason: 'malformed' });
  eq(await verifyIdToken('a.b.c', verifyOpts('apple')), { ok: false, reason: 'malformed' });
  const noSub = await sign(keyA, await goodClaims('apple', { sub: '' }));
  eq(await verifyIdToken(noSub, verifyOpts('apple')), { ok: false, reason: 'sub' });
});

Deno.test('verifyIdToken: 이메일이 없거나 비어 있으면 null', async () => {
  const none = await sign(keyA, await goodClaims('kakao', { email: undefined }));
  eq((await verifyIdToken(none, verifyOpts('kakao'))), { ok: true, claims: { sub: 'provider-user-1', email: null } });
  const blank = await sign(keyA, await goodClaims('kakao', { email: '  ' }));
  eq((await verifyIdToken(blank, verifyOpts('kakao'))), { ok: true, claims: { sub: 'provider-user-1', email: null } });
});

Deno.test('parseIdList: 쉼표 목록 정리', () => {
  eq(parseIdList(' a, b ,,c '), ['a', 'b', 'c']);
  eq(parseIdList(undefined), []);
  eq(parseIdList(''), []);
});

// ---------------------------------------------------------------------------
// 가입 확인 결과
// ---------------------------------------------------------------------------
Deno.test('decideSignup: existing / new / other_provider', () => {
  eq(decideSignup('apple', { account: 'existing', other_provider: null }).body, { result: 'ok', account: 'existing' });
  eq(decideSignup('apple', { account: 'new', other_provider: null }).body, { result: 'ok', account: 'new' });
  eq(decideSignup('apple', { account: 'new', other_provider: 'kakao' }).body, { result: 'other_provider', provider: 'kakao' });
  eq(decideSignup('kakao', { account: 'new', other_provider: 'apple' }).body, { result: 'other_provider', provider: 'apple' });
  // 이 수단의 기존 계정이면 다른 수단 이메일이 겹쳐도 막지 않는다(이미 가입된 사람의 재로그인)
  eq(decideSignup('apple', { account: 'existing', other_provider: 'kakao' }).body, { result: 'ok', account: 'existing' });
  // 같은 수단이 other 로 올 일은 없지만 오면 막지 않는다
  eq(decideSignup('apple', { account: 'new', other_provider: 'apple' }).body, { result: 'ok', account: 'new' });
});

function makeDeps(over: Partial<CheckSignupDeps> & { lookupResult?: LookupResult } = {}) {
  const calls = { lookup: [] as LookupArgs[], keys: [] as boolean[] };
  const deps: CheckSignupDeps = {
    nowSec: NOW,
    audiences: (p) => (p === 'apple' ? APPLE_AUD : KAKAO_AUD),
    getKeys: (_p, refresh) => {
      calls.keys.push(refresh);
      return Promise.resolve([keyA.jwk]);
    },
    lookup: (args) => {
      calls.lookup.push(args);
      return Promise.resolve(over.lookupResult ?? { account: 'new', other_provider: null });
    },
    ...over,
  };
  return { deps, calls };
}

Deno.test('handleCheckSignup: 틀린 토큰은 401 invalid_token 이고 DB 를 조회하지 않는다', async () => {
  const cases: [string, Record<string, unknown>][] = [
    ['aud', { aud: 'com.attacker.app' }],
    ['expired', { exp: NOW - 3600 }],
    ['nonce', { nonce: await sha256Hex('x') }],
  ];
  for (const [name, over] of cases) {
    const { deps, calls } = makeDeps();
    const token = await sign(keyA, await goodClaims('apple', over));
    const res = await handleCheckSignup({ provider: 'apple', idToken: token, nonce: NONCE }, deps);
    eq([res.status, res.body], [401, { error: 'invalid_token' }], name);
    eq(calls.lookup.length, 0, `${name}: 조회 없음`);
  }
  // 서명
  const { deps, calls } = makeDeps();
  const forged = await sign({ ...keyB, kid: 'kid-a' }, await goodClaims('apple'));
  const res = await handleCheckSignup({ provider: 'apple', idToken: forged, nonce: NONCE }, deps);
  eq([res.status, res.body], [401, { error: 'invalid_token' }], 'signature');
  eq(calls.lookup.length, 0);
});

Deno.test('handleCheckSignup: 같은 이메일이 다른 수단이면 other_provider + 수단', async () => {
  const { deps, calls } = makeDeps({ lookupResult: { account: 'new', other_provider: 'apple' } });
  const token = await sign(keyA, await goodClaims('kakao'));
  const res = await handleCheckSignup({ provider: 'kakao', idToken: token, nonce: NONCE }, deps);
  eq([res.status, res.body], [200, { result: 'other_provider', provider: 'apple' }]);
  eq(calls.lookup, [{ p_provider: 'kakao', p_provider_id: 'provider-user-1', p_email: 'Minji@Example.com' }]);
});

Deno.test('handleCheckSignup: 같은 수단의 기존 identity 는 existing, 없으면 new', async () => {
  const token = await sign(keyA, await goodClaims('apple'));
  const a = makeDeps({ lookupResult: { account: 'existing', other_provider: null } });
  eq((await handleCheckSignup({ provider: 'apple', idToken: token, nonce: NONCE }, a.deps)).body, { result: 'ok', account: 'existing' });
  const b = makeDeps({ lookupResult: { account: 'new', other_provider: null } });
  eq((await handleCheckSignup({ provider: 'apple', idToken: token, nonce: NONCE }, b.deps)).body, { result: 'ok', account: 'new' });
});

Deno.test('handleCheckSignup: 토큰에 이메일이 없으면 이메일 없이 조회한다(이메일 검사 건너뜀)', async () => {
  const { deps, calls } = makeDeps();
  const token = await sign(keyA, await goodClaims('apple', { email: undefined }));
  const res = await handleCheckSignup({ provider: 'apple', idToken: token, nonce: NONCE }, deps);
  eq(res.body, { result: 'ok', account: 'new' });
  eq(calls.lookup[0].p_email, null);
});

Deno.test('handleCheckSignup: kid 를 못 찾으면 키를 새로 받아 한 번 더 본다', async () => {
  const calls = { keys: [] as boolean[] };
  const { deps } = makeDeps({
    getKeys: (_p, refresh) => {
      calls.keys.push(refresh);
      return Promise.resolve(refresh ? [keyA.jwk] : [keyB.jwk]);
    },
  });
  const token = await sign(keyA, await goodClaims('apple'));
  const res = await handleCheckSignup({ provider: 'apple', idToken: token, nonce: NONCE }, deps);
  eq(res.status, 200);
  eq(calls.keys, [false, true]);
});

Deno.test('handleCheckSignup: 입력 오류 400, 공개 키 못 받음 502, DB 실패 500', async () => {
  const { deps } = makeDeps();
  const token = await sign(keyA, await goodClaims('apple'));
  eq((await handleCheckSignup(null, deps)).status, 400);
  eq((await handleCheckSignup({ provider: 'google', idToken: token, nonce: NONCE }, deps)).status, 400);
  eq((await handleCheckSignup({ provider: 'apple', idToken: '', nonce: NONCE }, deps)).status, 400);
  eq((await handleCheckSignup({ provider: 'apple', idToken: token }, deps)).status, 400, 'nonce 없음');
  eq((await handleCheckSignup({ provider: 'apple', idToken: 'x'.repeat(9000), nonce: NONCE }, deps)).status, 400);

  const down = makeDeps({ getKeys: () => Promise.reject(new Error('net')) });
  eq((await handleCheckSignup({ provider: 'apple', idToken: token, nonce: NONCE }, down.deps)).body, { error: 'provider_unavailable' });

  const dbFail = makeDeps({ lookup: () => Promise.reject(new Error('db')) });
  const r = await handleCheckSignup({ provider: 'apple', idToken: token, nonce: NONCE }, dbFail.deps);
  eq([r.status, r.body], [500, { error: 'server_error' }]);
});
