// delete-account 순수 로직 — 삭제 순서·입력 판정·Apple client secret·응답 분류. 통신은 index.ts 가 포트로 주입한다.
// 근거: docs/phases/phase-22-account-login.md '확정된 결정 — 계정 삭제', 설계 1, 불변식 5·6·8.

export const DELETE_REASONS = ['rarely_used', 'missing_feature', 'other_account', 'privacy', 'other'] as const;
export type DeleteReason = typeof DELETE_REASONS[number];
export const MAX_REASON_TEXT = 200;
const MAX_APPLE_CODE_LEN = 2048;
const MAX_APPLE_CLIENT_ID_LEN = 200;

export type DeleteInput = {
  reason: DeleteReason | null;
  /** reason 이 other 일 때만 남는다(트림, 200자 이하). */
  reasonText: string | null;
  appleAuthorizationCode: string | null;
  appleClientId: string | null;
  /** 사용자가 [연결 해제 없이 삭제](Apple·카카오 공통)를 골랐을 때만 true. */
  skipUnlink: boolean;
};

/** 요청 본문 판정. 기타 글이 200자를 넘으면 거절한다. 사유가 other 가 아니면 글은 버린다. */
export function parseDeleteInput(raw: unknown): { ok: true; input: DeleteInput } | { ok: false } {
  if (raw == null) raw = {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
  const o = raw as Record<string, unknown>;

  let reason: DeleteReason | null = null;
  if (o.reason != null) {
    if (typeof o.reason !== 'string' || !(DELETE_REASONS as readonly string[]).includes(o.reason)) return { ok: false };
    reason = o.reason as DeleteReason;
  }

  let reasonText: string | null = null;
  if (o.reasonText != null) {
    if (typeof o.reasonText !== 'string') return { ok: false };
    if (o.reasonText.length > MAX_REASON_TEXT) return { ok: false };
    const t = o.reasonText.trim();
    reasonText = reason === 'other' && t !== '' ? t : null;
  }

  const str = (v: unknown, max: number): string | null | undefined => {
    if (v == null) return null;
    if (typeof v !== 'string' || v.length === 0 || v.length > max) return undefined;
    return v;
  };
  const code = str(o.appleAuthorizationCode, MAX_APPLE_CODE_LEN);
  const clientId = str(o.appleClientId, MAX_APPLE_CLIENT_ID_LEN);
  if (code === undefined || clientId === undefined) return { ok: false };

  if (o.skipUnlink != null && typeof o.skipUnlink !== 'boolean') return { ok: false };

  return {
    ok: true,
    input: {
      reason,
      reasonText,
      appleAuthorizationCode: code,
      appleClientId: clientId,
      skipUnlink: o.skipUnlink === true,
    },
  };
}

// ---------------------------------------------------------------------------
// 어떤 계정인가
// ---------------------------------------------------------------------------
export type UserLike = {
  id: string;
  is_anonymous?: boolean;
  identities?: { provider?: string; id?: string; provider_id?: string; identity_data?: Record<string, unknown> | null }[] | null;
};

export type AccountKind =
  | { kind: 'anonymous' }
  | { kind: 'apple' }
  | { kind: 'kakao'; memberId: string }
  | { kind: 'other' };

/** 소셜 연결 종류. 카카오 회원번호는 identity 의 sub(= provider id). */
export function identifyAccount(user: UserLike): AccountKind {
  const ids = user.identities ?? [];
  const apple = ids.find((i) => i.provider === 'apple');
  if (apple) return { kind: 'apple' };
  const kakao = ids.find((i) => i.provider === 'kakao');
  if (kakao) {
    const sub = kakao.identity_data?.sub;
    const memberId = typeof sub === 'string' && sub ? sub : kakao.provider_id ?? kakao.id;
    if (typeof memberId === 'string' && memberId) return { kind: 'kakao', memberId };
    return { kind: 'other' };
  }
  if (user.is_anonymous === true) return { kind: 'anonymous' };
  return { kind: 'other' };
}

// ---------------------------------------------------------------------------
// 삭제 순서
// ---------------------------------------------------------------------------
export type DeletionPorts = {
  /** Apple 토큰 철회(코드 교환 → revoke). 성공하면 true. 실패는 false(던지지 않는다). */
  appleRevoke(args: { code: string; clientId: string }): Promise<boolean>;
  /** 카카오 연결 해제. 이미 끊긴 사용자도 true. 실패는 false. */
  kakaoUnlink(memberId: string): Promise<boolean>;
  /** 삭제 진행 상태: 소셜 연결 해제를 이미 마쳤는가(0009 ops.deletion_progress). 실패하면 throw. */
  getUnlinkDone(userId: string): Promise<boolean>;
  /** 연결 해제를 마쳤다고 기록한다. 실패하면 throw. */
  markUnlinkDone(userId: string): Promise<void>;
  /** 사용자 폴더의 사진(원본·썸네일) 전부 삭제. 실패하면 throw. */
  removeAllPhotos(userId: string): Promise<void>;
  /** PostHog 프로필 삭제(이벤트는 유지). 지웠거나 프로필이 없으면 true, 실패·미설정은 false. 던지지 않는다. */
  deletePosthogPerson(userId: string): Promise<boolean>;
  /** DB 마무리(0009 finalize_account_deletion): 실패 기록 합산·탈퇴 사유·재시도 기록·사용자 삭제. */
  finalize(args: {
    userId: string;
    reason: DeleteReason | null;
    reasonText: string | null;
    posthogPending: boolean;
  }): Promise<'deleted' | 'already_deleted'>;
};

export type DeleteResponse =
  | { status: 200; body: { result: 'deleted' | 'already_deleted' } }
  | { status: 400; body: { error: 'invalid_input' | 'apple_code_required' } }
  | { status: 401; body: { error: 'unauthorized' | 'invalid_token' } }
  | { status: 500; body: { error: 'server_error' } }
  | { status: 502; body: { error: 'unlink_failed'; provider: 'apple' | 'kakao' } };

/**
 * 순서(멱등, 연결 해제 먼저): ① 본인 확인(호출 쪽) ② Apple 토큰 철회 / 카카오 연결 해제
 * ③ 사진 삭제 ④ PostHog 프로필 삭제 + DB 마무리(실패 기록 합산·탈퇴 사유·사용자 삭제).
 * 연결 해제(Apple·카카오 모두)가 실패하면 아무것도 지우지 않고 멈춘다(unlink_failed + provider). 사용자가 skipUnlink 를 고르면 해제 없이 진행한다.
 * 연결 해제를 마친 뒤엔 사용자 id 로 진행 상태를 남기고, 다시 부르면 그 단계를 건너뛴다(연결 해제를 두 번 하지 않고 Apple 코드도 다시 요구하지 않는다).
 * 사진 삭제가 실패하면 그 뒤는 하지 않는다(다시 부르면 이어서 한다).
 */
export async function runDeletion(
  ports: DeletionPorts,
  user: UserLike,
  input: DeleteInput,
  allowedAppleClientIds: string[],
): Promise<DeleteResponse> {
  const account = identifyAccount(user);

  if ((account.kind === 'apple' || account.kind === 'kakao') && !input.skipUnlink) {
    let unlinkDone: boolean;
    try {
      unlinkDone = await ports.getUnlinkDone(user.id);
    } catch {
      return { status: 500, body: { error: 'server_error' } };
    }
    if (!unlinkDone) {
      if (account.kind === 'apple') {
        if (!input.appleAuthorizationCode) return { status: 400, body: { error: 'apple_code_required' } };
        if (!input.appleClientId || !allowedAppleClientIds.includes(input.appleClientId)) {
          return { status: 400, body: { error: 'invalid_input' } };
        }
        const ok = await ports.appleRevoke({ code: input.appleAuthorizationCode, clientId: input.appleClientId });
        if (!ok) return { status: 502, body: { error: 'unlink_failed', provider: 'apple' } };
      } else {
        const ok = await ports.kakaoUnlink(account.memberId);
        if (!ok) return { status: 502, body: { error: 'unlink_failed', provider: 'kakao' } };
      }
      try {
        await ports.markUnlinkDone(user.id);
      } catch {
        return { status: 500, body: { error: 'server_error' } };
      }
    }
  }

  try {
    await ports.removeAllPhotos(user.id);
  } catch {
    return { status: 500, body: { error: 'server_error' } };
  }

  let posthogOk = false;
  try {
    posthogOk = await ports.deletePosthogPerson(user.id);
  } catch {
    posthogOk = false;
  }

  try {
    const result = await ports.finalize({
      userId: user.id,
      reason: input.reason,
      reasonText: input.reason === 'other' ? input.reasonText : null,
      posthogPending: !posthogOk,
    });
    return { status: 200, body: { result } };
  } catch {
    return { status: 500, body: { error: 'server_error' } };
  }
}

// ---------------------------------------------------------------------------
// 요청 처리(인증 포함)
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 검증하지 않고 JWT 의 sub 만 읽는다(이미 지워진 사용자인지 가려내는 데에만 쓴다 — 인증에 쓰지 않는다). */
export function decodeJwtSub(jwt: string): string | null {
  try {
    const part = jwt.split('.')[1];
    const pad = '='.repeat((4 - (part.length % 4)) % 4);
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/') + pad), (c) => c.charCodeAt(0)),
    );
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' && UUID_RE.test(sub) ? sub : null;
  } catch {
    return null;
  }
}

export type DeleteDeps = {
  ports: DeletionPorts;
  allowedAppleClientIds: string[];
  /** 토큰을 서버가 검증해 사용자를 돌려준다. 무효·만료·사용자 없음이면 null. 통신 실패는 throw. */
  getUserByToken(jwt: string): Promise<UserLike | null>;
  /** 사용자 존재 여부(service_role). 통신 실패는 throw. */
  userExists(id: string): Promise<boolean>;
};

export async function handleDelete(
  authorization: string | null,
  rawBody: unknown,
  deps: DeleteDeps,
): Promise<DeleteResponse> {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  if (!m) return { status: 401, body: { error: 'unauthorized' } };
  const jwt = m[1];

  const parsed = parseDeleteInput(rawBody);
  if (!parsed.ok) return { status: 400, body: { error: 'invalid_input' } };

  let user: UserLike | null;
  try {
    user = await deps.getUserByToken(jwt);
    if (!user) {
      // 토큰은 못 쓰지만 가리키는 사용자가 이미 없다면 삭제를 마친 것이다(앱은 완료 처리)
      const sub = decodeJwtSub(jwt);
      if (sub && !(await deps.userExists(sub))) return { status: 200, body: { result: 'already_deleted' } };
      return { status: 401, body: { error: 'invalid_token' } };
    }
  } catch {
    return { status: 500, body: { error: 'server_error' } };
  }

  return await runDeletion(deps.ports, user, parsed.input, deps.allowedAppleClientIds);
}

// ---------------------------------------------------------------------------
// Apple client secret(JWT, ES256)
// ---------------------------------------------------------------------------
/** Apple 문서: exp 는 iat 로부터 최대 15777000초(6개월). 요청마다 만들어 짧게(5분) 쓴다. */
export const APPLE_SECRET_TTL_SEC = 300;

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function buildAppleClientSecret(args: {
  teamId: string;
  keyId: string;
  clientId: string;
  privateKeyPem: string;
  nowSec: number;
}): Promise<string> {
  const header = { alg: 'ES256', kid: args.keyId, typ: 'JWT' };
  const claims = {
    iss: args.teamId,
    iat: args.nowSec,
    exp: args.nowSec + APPLE_SECRET_TTL_SEC,
    aud: 'https://appleid.apple.com',
    sub: args.clientId,
  };
  const enc = new TextEncoder();
  const signingInput = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(enc.encode(JSON.stringify(claims)))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(args.privateKeyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // WebCrypto 의 ECDSA 서명은 JWT 가 요구하는 r||s(IEEE P1363) 형식이다
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput)));
  return `${signingInput}.${b64url(sig)}`;
}

// ---------------------------------------------------------------------------
// 외부 응답 분류
// ---------------------------------------------------------------------------
/**
 * 카카오 연결 해제 응답: 200 이면 성공. 이미 연결이 끊겼거나 가입하지 않은 사용자(-101)는 성공으로 본다.
 * ※ -101 의 의미는 카카오 REST API 문서 기준이며 실제 호출로 확인하지 못했다(보고에 [미확인]으로 적음).
 */
export const KAKAO_ALREADY_UNLINKED_CODE = -101;
export function classifyKakaoUnlink(httpStatus: number, body: unknown): 'ok' | 'already_unlinked' | 'failed' {
  if (httpStatus >= 200 && httpStatus < 300) return 'ok';
  const code = body && typeof body === 'object' ? (body as { code?: unknown }).code : undefined;
  if (code === KAKAO_ALREADY_UNLINKED_CODE) return 'already_unlinked';
  return 'failed';
}

/** PostHog 사람 조회 응답(`/persons/?distinct_id=`)에서 사람 id 를 꺼낸다. 없으면 null(지울 것 없음). */
export function parsePosthogPersonId(body: unknown): string | number | null {
  const results = body && typeof body === 'object' ? (body as { results?: unknown }).results : undefined;
  if (!Array.isArray(results) || results.length === 0) return null;
  const id = (results[0] as { id?: unknown } | null)?.id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}
