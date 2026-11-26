// delete-account 순수 로직 단위 검증(네트워크·DB·키 없음 — 포트를 가짜로 꽂고 호출 순서를 기록한다).
// 실행: deno test --no-lock supabase/tests/delete_account_test.ts
import {
  type DeleteDeps,
  type DeletionPorts,
  type UserLike,
  APPLE_SECRET_TTL_SEC,
  buildAppleClientSecret,
  classifyKakaoUnlink,
  decodeJwtSub,
  handleDelete,
  identifyAccount,
  parseDeleteInput,
  parsePosthogPersonId,
} from '../functions/delete-account/logic.ts';

function eq(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}

const UID = '22222222-2222-4222-8222-222222222222';
const APPLE_CLIENT = 'com.example.wishshot';
const ALLOWED = [APPLE_CLIENT, 'com.example.wishshot.dev'];

const anonUser: UserLike = { id: UID, is_anonymous: true, identities: [] };
const appleUser: UserLike = { id: UID, is_anonymous: false, identities: [{ provider: 'apple', id: 'apple-sub', identity_data: { sub: 'apple-sub' } }] };
const kakaoUser: UserLike = { id: UID, is_anonymous: false, identities: [{ provider: 'kakao', id: 'k1', identity_data: { sub: '3456789' } }] };

type Overrides = Partial<{
  appleOk: boolean;
  kakaoOk: boolean;
  photosFail: boolean;
  posthogOk: boolean;
  posthogThrows: boolean;
  finalizeResult: 'deleted' | 'already_deleted';
  finalizeThrows: boolean;
  /** 이전 호출에서 연결 해제를 이미 마쳤다(삭제 진행 상태) */
  unlinkDone: boolean;
  progressReadThrows: boolean;
  progressWriteThrows: boolean;
}>;

function fakePorts(over: Overrides = {}) {
  const log: string[] = [];
  let finalizeArgs: unknown = null;
  const state = { unlinkDone: over.unlinkDone ?? false };
  const ports: DeletionPorts = {
    appleRevoke: ({ code, clientId }) => {
      log.push(`apple_revoke(${code},${clientId})`);
      return Promise.resolve(over.appleOk ?? true);
    },
    kakaoUnlink: (memberId) => {
      log.push(`kakao_unlink(${memberId})`);
      return Promise.resolve(over.kakaoOk ?? true);
    },
    getUnlinkDone: (userId) => {
      log.push(`progress_get(${userId})`);
      return over.progressReadThrows ? Promise.reject(new Error('db')) : Promise.resolve(state.unlinkDone);
    },
    markUnlinkDone: (userId) => {
      log.push(`progress_mark(${userId})`);
      if (over.progressWriteThrows) return Promise.reject(new Error('db'));
      state.unlinkDone = true;
      return Promise.resolve();
    },
    removeAllPhotos: (userId) => {
      log.push(`photos(${userId})`);
      return over.photosFail ? Promise.reject(new Error('storage')) : Promise.resolve();
    },
    deletePosthogPerson: (userId) => {
      log.push(`posthog(${userId})`);
      if (over.posthogThrows) return Promise.reject(new Error('net'));
      return Promise.resolve(over.posthogOk ?? true);
    },
    finalize: (args) => {
      log.push('finalize');
      finalizeArgs = args;
      if (over.finalizeThrows) return Promise.reject(new Error('db'));
      return Promise.resolve(over.finalizeResult ?? 'deleted');
    },
  };
  return { ports, log, state, finalizeArgs: () => finalizeArgs };
}

function makeDeps(ports: DeletionPorts, user: UserLike | null, exists = false): DeleteDeps {
  return {
    ports,
    allowedAppleClientIds: ALLOWED,
    getUserByToken: () => Promise.resolve(user),
    userExists: () => Promise.resolve(exists),
  };
}

const AUTH = 'Bearer user-token';
const APPLE_BODY = { appleAuthorizationCode: 'code-1', appleClientId: APPLE_CLIENT };

// ---------------------------------------------------------------------------
// 입력(탈퇴 사유 포함)
// ---------------------------------------------------------------------------
Deno.test('parseDeleteInput: 사유 5종·없음 허용, 기타 글은 other 일 때만 남기고 트림', () => {
  eq(parseDeleteInput({}), { ok: true, input: { reason: null, reasonText: null, appleAuthorizationCode: null, appleClientId: null, skipUnlink: false } });
  eq(parseDeleteInput(null).ok, true, '본문 없음');
  for (const r of ['rarely_used', 'missing_feature', 'other_account', 'privacy', 'other']) {
    eq(parseDeleteInput({ reason: r }).ok, true, r);
  }
  const other = parseDeleteInput({ reason: 'other', reasonText: '  기능이 부족해요  ' });
  eq(other.ok && other.input.reasonText, '기능이 부족해요');
  // other 가 아니면 글은 버린다
  const priv = parseDeleteInput({ reason: 'privacy', reasonText: '몰래 적은 글' });
  eq(priv.ok && priv.input.reasonText, null);
  // 공백뿐이면 없음
  const blank = parseDeleteInput({ reason: 'other', reasonText: '   ' });
  eq(blank.ok && blank.input.reasonText, null);
});

Deno.test('parseDeleteInput: 기타 글 200자 초과는 거절, 200자는 통과', () => {
  eq(parseDeleteInput({ reason: 'other', reasonText: 'ㄱ'.repeat(200) }).ok, true);
  eq(parseDeleteInput({ reason: 'other', reasonText: 'ㄱ'.repeat(201) }).ok, false);
  eq(parseDeleteInput({ reason: 'privacy', reasonText: 'ㄱ'.repeat(201) }).ok, false, '사유가 other 가 아니어도 길이는 본다');
});

Deno.test('parseDeleteInput: 알 수 없는 사유·잘못된 형식은 거절', () => {
  eq(parseDeleteInput({ reason: 'bored' }).ok, false);
  eq(parseDeleteInput({ reason: 5 }).ok, false);
  eq(parseDeleteInput({ reasonText: 5 }).ok, false);
  eq(parseDeleteInput({ appleAuthorizationCode: '' }).ok, false);
  eq(parseDeleteInput({ skipUnlink: 'yes' }).ok, false);
  eq(parseDeleteInput([]).ok, false);
});

Deno.test('identifyAccount: 익명·Apple·카카오(회원번호)·그 밖', () => {
  eq(identifyAccount(anonUser), { kind: 'anonymous' });
  eq(identifyAccount(appleUser), { kind: 'apple' });
  eq(identifyAccount(kakaoUser), { kind: 'kakao', memberId: '3456789' });
  eq(identifyAccount({ id: UID, identities: [{ provider: 'kakao', provider_id: '77' }] }), { kind: 'kakao', memberId: '77' });
  eq(identifyAccount({ id: UID, is_anonymous: false, identities: [{ provider: 'email' }] }), { kind: 'other' });
});

// ---------------------------------------------------------------------------
// 삭제 순서
// ---------------------------------------------------------------------------
Deno.test('삭제 순서(Apple): ② 철회 → ③ 사진 → ④ PostHog → ⑤ 마무리(사용자 삭제는 마지막)', async () => {
  const f = fakePorts();
  const res = await handleDelete(AUTH, { reason: 'privacy', ...APPLE_BODY }, makeDeps(f.ports, appleUser));
  eq([res.status, res.body], [200, { result: 'deleted' }]);
  eq(f.log, [`progress_get(${UID})`, `apple_revoke(code-1,${APPLE_CLIENT})`, `progress_mark(${UID})`, `photos(${UID})`, `posthog(${UID})`, 'finalize']);
  eq(f.finalizeArgs(), { userId: UID, reason: 'privacy', reasonText: null, posthogPending: false });
});

Deno.test('삭제 순서(카카오): 연결 해제 → 사진 → PostHog → 마무리', async () => {
  const f = fakePorts();
  const res = await handleDelete(AUTH, {}, makeDeps(f.ports, kakaoUser));
  eq(res.body, { result: 'deleted' });
  eq(f.log, [`progress_get(${UID})`, 'kakao_unlink(3456789)', `progress_mark(${UID})`, `photos(${UID})`, `posthog(${UID})`, 'finalize']);
});

Deno.test('삭제 순서(익명): 연결 해제 없이 사진 → PostHog → 마무리', async () => {
  const f = fakePorts();
  const res = await handleDelete(AUTH, {}, makeDeps(f.ports, anonUser));
  eq(res.body, { result: 'deleted' });
  eq(f.log, [`photos(${UID})`, `posthog(${UID})`, 'finalize']);
});

Deno.test('Apple 철회 실패면 아무것도 지우지 않고 멈춘다(unlink_failed + apple)', async () => {
  const f = fakePorts({ appleOk: false });
  const res = await handleDelete(AUTH, APPLE_BODY, makeDeps(f.ports, appleUser));
  eq([res.status, res.body], [502, { error: 'unlink_failed', provider: 'apple' }]);
  eq(f.log, [`progress_get(${UID})`, `apple_revoke(code-1,${APPLE_CLIENT})`], '철회만 시도하고 진행 기록·사진·PostHog·DB 는 건드리지 않는다');
  eq(f.state.unlinkDone, false, '실패하면 해제 완료로 기록하지 않는다');
});

Deno.test('skipUnlink 면 철회 없이 진행한다(Apple)', async () => {
  const f = fakePorts({ appleOk: false });
  const res = await handleDelete(AUTH, { skipUnlink: true }, makeDeps(f.ports, appleUser));
  eq(res.body, { result: 'deleted' });
  eq(f.log, [`photos(${UID})`, `posthog(${UID})`, 'finalize']);
});

Deno.test('Apple 계정이고 해제 전인데 코드도 skipUnlink 도 없으면 apple_code_required, 허용 목록 밖 클라이언트 ID 는 invalid_input', async () => {
  const f = fakePorts();
  const noCode = await handleDelete(AUTH, {}, makeDeps(f.ports, appleUser));
  eq([noCode.status, noCode.body], [400, { error: 'apple_code_required' }]);
  const badClient = await handleDelete(AUTH, { appleAuthorizationCode: 'c', appleClientId: 'com.attacker' }, makeDeps(f.ports, appleUser));
  eq([badClient.status, badClient.body], [400, { error: 'invalid_input' }]);
  const noClient = await handleDelete(AUTH, { appleAuthorizationCode: 'c' }, makeDeps(f.ports, appleUser));
  eq(noClient.status, 400);
  eq(f.log.filter((l) => !l.startsWith('progress_get')), [], '진행 상태 조회 말고는 아무 동작도 하지 않았다');
});

Deno.test('Apple 코드는 Apple 계정이 아니면 쓰지 않는다(익명·카카오에서 무시)', async () => {
  const f = fakePorts();
  await handleDelete(AUTH, APPLE_BODY, makeDeps(f.ports, anonUser));
  eq(f.log.some((l) => l.startsWith('apple_revoke')), false);
});

Deno.test('카카오 연결 해제 실패도 Apple 과 같다: 아무것도 지우지 않고 멈춘다(unlink_failed + kakao)', async () => {
  const fail = fakePorts({ kakaoOk: false });
  const res = await handleDelete(AUTH, {}, makeDeps(fail.ports, kakaoUser));
  eq([res.status, res.body], [502, { error: 'unlink_failed', provider: 'kakao' }]);
  eq(fail.log, [`progress_get(${UID})`, 'kakao_unlink(3456789)']);
  // [카카오 연결 해제 없이 삭제] = skipUnlink
  const skip = fakePorts({ kakaoOk: false });
  const res2 = await handleDelete(AUTH, { skipUnlink: true }, makeDeps(skip.ports, kakaoUser));
  eq(res2.body, { result: 'deleted' });
  eq(skip.log, [`photos(${UID})`, `posthog(${UID})`, 'finalize']);
});

Deno.test('classifyKakaoUnlink: 200 성공, -101(이미 끊김)은 성공 취급, 그 밖은 실패', () => {
  eq(classifyKakaoUnlink(200, { id: 3456789 }), 'ok');
  eq(classifyKakaoUnlink(400, { msg: 'NotRegisteredUserException', code: -101 }), 'already_unlinked');
  eq(classifyKakaoUnlink(401, { msg: 'invalid admin key', code: -401 }), 'failed');
  eq(classifyKakaoUnlink(500, null), 'failed');
  eq(classifyKakaoUnlink(400, 'text'), 'failed');
});

Deno.test('다시 부르면 끝난 단계를 건너뛴다: 사진 삭제가 실패한 뒤 재호출은 연결 해제를 다시 하지 않고 Apple 코드도 요구하지 않는다', async () => {
  const f = fakePorts({ photosFail: true });
  const first = await handleDelete(AUTH, APPLE_BODY, makeDeps(f.ports, appleUser));
  eq([first.status, first.body], [500, { error: 'server_error' }]);
  eq(f.state.unlinkDone, true, '해제는 마쳤고 기록됐다');
  eq(f.log.filter((l) => l.startsWith('apple_revoke')).length, 1);
  // 재호출: 코드 없이, 이번엔 사진 삭제 성공
  const g = fakePorts({ unlinkDone: true });
  const second = await handleDelete(AUTH, {}, makeDeps(g.ports, appleUser));
  eq(second.body, { result: 'deleted' });
  eq(g.log, [`progress_get(${UID})`, `photos(${UID})`, `posthog(${UID})`, 'finalize'], '해제는 건너뛴다');
  // 카카오도 같다
  const k = fakePorts({ unlinkDone: true, kakaoOk: false });
  eq((await handleDelete(AUTH, {}, makeDeps(k.ports, kakaoUser))).body, { result: 'deleted' });
  eq(k.log.some((l) => l.startsWith('kakao_unlink')), false, '카카오 해제도 두 번 하지 않는다');
});

Deno.test('진행 상태를 읽지 못하거나 기록하지 못하면 server_error(사진·DB 는 건드리지 않는다)', async () => {
  const r = fakePorts({ progressReadThrows: true });
  eq((await handleDelete(AUTH, APPLE_BODY, makeDeps(r.ports, appleUser))).body, { error: 'server_error' });
  eq(r.log, [`progress_get(${UID})`]);
  const w = fakePorts({ progressWriteThrows: true });
  eq((await handleDelete(AUTH, APPLE_BODY, makeDeps(w.ports, appleUser))).body, { error: 'server_error' });
  eq(w.log.includes(`photos(${UID})`), false);
  // 익명 계정은 진행 상태를 쓰지 않는다
  const a = fakePorts();
  await handleDelete(AUTH, {}, makeDeps(a.ports, anonUser));
  eq(a.log.some((l) => l.startsWith('progress_')), false);
});

Deno.test('사진 삭제 실패면 멈추고(사용자 삭제 없음) server_error — 다시 부르면 이어서 한다', async () => {
  const f = fakePorts({ photosFail: true });
  const res = await handleDelete(AUTH, {}, makeDeps(f.ports, anonUser));
  eq([res.status, res.body], [500, { error: 'server_error' }]);
  eq(f.log, [`photos(${UID})`]);
});

Deno.test('PostHog 삭제가 실패(또는 던져도)하면 삭제는 진행하고 재시도 기록을 남기게 한다', async () => {
  for (const over of [{ posthogOk: false }, { posthogThrows: true }] as Overrides[]) {
    const f = fakePorts(over);
    const res = await handleDelete(AUTH, {}, makeDeps(f.ports, anonUser));
    eq(res.body, { result: 'deleted' });
    eq(f.log, [`photos(${UID})`, `posthog(${UID})`, 'finalize']);
    eq((f.finalizeArgs() as { posthogPending: boolean }).posthogPending, true);
  }
});

Deno.test('DB 마무리가 실패하면 500, 사용자가 이미 없으면 already_deleted(다시 부름)', async () => {
  const f = fakePorts({ finalizeThrows: true });
  const res = await handleDelete(AUTH, {}, makeDeps(f.ports, anonUser));
  eq([res.status, res.body], [500, { error: 'server_error' }]);
  const g = fakePorts({ finalizeResult: 'already_deleted' });
  eq((await handleDelete(AUTH, {}, makeDeps(g.ports, anonUser))).body, { result: 'already_deleted' });
});

Deno.test('이미 지워진 사용자의 토큰으로 다시 부르면 already_deleted(아무것도 하지 않음)', async () => {
  const sub = UID;
  const payload = btoa(JSON.stringify({ sub })).replace(/=+$/, '');
  const jwt = `h.${payload}.s`;
  const f = fakePorts();
  const res = await handleDelete(`Bearer ${jwt}`, {}, makeDeps(f.ports, null, false));
  eq([res.status, res.body], [200, { result: 'already_deleted' }]);
  eq(f.log, []);
  // 사용자는 있는데 토큰이 무효(만료·위조)면 401
  const g = fakePorts();
  eq((await handleDelete(`Bearer ${jwt}`, {}, makeDeps(g.ports, null, true))).body, { error: 'invalid_token' });
  // sub 를 읽을 수 없는 토큰도 401
  eq((await handleDelete('Bearer garbage', {}, makeDeps(g.ports, null, false))).body, { error: 'invalid_token' });
  eq(g.log, []);
});

Deno.test('인증·입력 오류: 헤더 없음 401, 본문 오류 400, 인증 서버 장애 500', async () => {
  const f = fakePorts();
  eq((await handleDelete(null, {}, makeDeps(f.ports, anonUser))).body, { error: 'unauthorized' });
  eq((await handleDelete(AUTH, { reason: 'other', reasonText: 'ㄱ'.repeat(201) }, makeDeps(f.ports, anonUser))).body, { error: 'invalid_input' });
  const down: DeleteDeps = { ...makeDeps(f.ports, anonUser), getUserByToken: () => Promise.reject(new Error('auth')) };
  eq((await handleDelete(AUTH, {}, down)).body, { error: 'server_error' });
  eq(f.log, [], '거절된 요청은 아무것도 지우지 않는다');
});

// ---------------------------------------------------------------------------
// 탈퇴 사유: 사용자 id 없이 DB 로 보낸다
// ---------------------------------------------------------------------------
Deno.test('탈퇴 사유: 기타 글은 other 일 때만 마무리에 넘기고, 사유 없으면 둘 다 null', async () => {
  const a = fakePorts();
  await handleDelete(AUTH, { reason: 'other', reasonText: '기능 부족' }, makeDeps(a.ports, anonUser));
  eq(a.finalizeArgs(), { userId: UID, reason: 'other', reasonText: '기능 부족', posthogPending: false });
  const b = fakePorts();
  await handleDelete(AUTH, { reason: 'rarely_used', reasonText: '무시됨' }, makeDeps(b.ports, anonUser));
  eq((b.finalizeArgs() as { reasonText: unknown }).reasonText, null);
  const c = fakePorts();
  await handleDelete(AUTH, {}, makeDeps(c.ports, anonUser));
  eq([(c.finalizeArgs() as { reason: unknown }).reason, (c.finalizeArgs() as { reasonText: unknown }).reasonText], [null, null]);
});

// ---------------------------------------------------------------------------
// Apple client secret, 보조 판정
// ---------------------------------------------------------------------------
function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.test('buildAppleClientSecret: ES256·kid·iss·iat·exp·aud·sub 와 서명(r||s)이 맞는다', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let bin = '';
  for (const b of pkcs8) bin += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;

  for (const keyText of [pem, pem.trim().replace(/\n/g, '\\n')]) { // 줄바꿈이 \n 글자로 등록된 경우도
    const jwt = await buildAppleClientSecret({ teamId: 'TEAM123456', keyId: 'KEY1234567', clientId: APPLE_CLIENT, privateKeyPem: keyText, nowSec: 1_800_000_000 });
    const [h, p, s] = jwt.split('.');
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
    eq(header, { alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' });
    eq(claims, { iss: 'TEAM123456', iat: 1_800_000_000, exp: 1_800_000_000 + APPLE_SECRET_TTL_SEC, aud: 'https://appleid.apple.com', sub: APPLE_CLIENT });
    eq(APPLE_SECRET_TTL_SEC <= 15_777_000, true, 'Apple 상한(15777000초) 이하');
    const sig = b64urlToBytes(s);
    eq(sig.length, 64, 'ES256 서명은 r||s 64바이트');
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, sig, new TextEncoder().encode(`${h}.${p}`));
    eq(ok, true, '서명 검증');
  }
});

Deno.test('decodeJwtSub·parsePosthogPersonId', () => {
  const p = btoa(JSON.stringify({ sub: UID })).replace(/=+$/, '');
  eq(decodeJwtSub(`h.${p}.s`), UID);
  eq(decodeJwtSub(`h.${btoa(JSON.stringify({ sub: 'not-uuid' }))}.s`), null);
  eq(decodeJwtSub('x'), null);
  eq(parsePosthogPersonId({ results: [{ id: 'p-1' }] }), 'p-1');
  eq(parsePosthogPersonId({ results: [{ id: 42 }] }), 42);
  eq(parsePosthogPersonId({ results: [] }), null, '프로필 없음 = 지울 것 없음');
  eq(parsePosthogPersonId(null), null);
});
