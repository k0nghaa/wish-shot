// 계정 판단 규칙. import 없는 순수 TS — 앱(src/lib/queries/account.ts·ShareIntentHandler)과
// Deno 시험(supabase/tests/account_logic_test.ts)이 함께 쓴다. 통신·저장소는 여기서 하지 않는다.
// 근거: docs/phases/phase-22-account-login.md 흐름 1~3, 설계 2·4.

export type Provider = 'apple' | 'kakao';

// ── 기기 저장 키(설계 4) ─────────────────────────────────────
export const ACCOUNT_STATE_KEY = 'wishshot.accountState';
export const LAST_PROVIDER_KEY = 'wishshot.lastSignInProvider';
export const PROMPT_USED_KEY = 'wishshot.signInPromptUsed';
export const PENDING_MERGE_KEY = 'wishshot.pendingMerge';

// ── 기기 상태 기록 ───────────────────────────────────────────

/**
 * fresh: 세션 없음 + 로그인한 적 없음. anonymous·signed_in: 지금 계정. signed_out: 로그아웃·로그인 세션 만료·Apple 연결 해제.
 * rejected: 서버가 익명 세션을 거절함(위시를 저장한 흔적 있음). deleting: 계정 삭제 도중.
 */
export type AccountStatus = 'fresh' | 'anonymous' | 'signed_in' | 'signed_out' | 'rejected' | 'deleting';

export type DeletingInfo = {
  /** 삭제 이벤트용: 시작 때 계정 종류. */
  account: 'anonymous' | 'apple' | 'kakao';
  /** 도중에 꺼진 뒤 다시 부를 때 쓴다(기기에만 있고 삭제를 마치면 지운다). */
  reason: string | null;
  reasonText: string | null;
  skipUnlink: boolean;
  /**
   * sent: 삭제 요청을 보냈고 아직 답을 받지 못함(서버가 삭제를 시작했을 수 있다 — 다음 실행에 이어서 부른다).
   * answered: 서버가 지우지 못했다고 답함(연결 해제 실패·Apple 재인증 필요·오류) — 사용자가 다시 시도할지 고르는 중.
   *   다음 실행이나 사용자가 멈추면 삭제 전 기록으로 되돌린다(확인 없이 삭제를 다시 부르지 않는다).
   */
  stage: 'sent' | 'answered';
};

export type AccountRecord = {
  v: 1;
  status: AccountStatus;
  /** 지금(또는 마지막) 계정. rejected 면 거절된 계정. */
  userId: string | null;
  /** 흔적 없는 거절(fresh)에서 "로그인 없이 시작"이 user_metadata.previous_user_id 로 남길 거절된 계정. */
  previousUserId: string | null;
  /** Apple 로그인 계정의 Apple 사용자 ID(getCredentialStateAsync 용). */
  appleUserId: string | null;
  /** 설정에 보일 닉네임 사본(오프라인 대비, 서버가 정본). */
  nickname: string | null;
  /** 방금 새 계정을 만들어 닉네임 화면(가입)을 거치는 중 — 저장하면 nickname_saved 의 mode 가 signup. */
  nicknameSignup: boolean;
  deleting: DeletingInfo | null;
};

export function newRecord(status: AccountStatus, patch: Partial<AccountRecord> = {}): AccountRecord {
  return {
    v: 1,
    status,
    userId: null,
    previousUserId: null,
    appleUserId: null,
    nickname: null,
    nicknameSignup: false,
    deleting: null,
    ...patch,
  };
}

const STATUSES: readonly string[] = ['fresh', 'anonymous', 'signed_in', 'signed_out', 'rejected', 'deleting'];

/** 저장된 문자열을 기록으로. 깨졌으면 null(= 기록 없음 취급하지 않고 호출자가 판단). */
export function parseAccountRecord(raw: string | null): AccountRecord | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.status !== 'string' || !STATUSES.includes(o.status)) return null;
    const str = (x: unknown) => (typeof x === 'string' && x ? x : null);
    const d = o.deleting;
    let deleting: DeletingInfo | null = null;
    if (typeof d === 'object' && d !== null) {
      const di = d as Record<string, unknown>;
      const account = di.account === 'apple' || di.account === 'kakao' ? di.account : 'anonymous';
      deleting = {
        account,
        reason: str(di.reason),
        reasonText: str(di.reasonText),
        skipUnlink: di.skipUnlink === true,
        stage: di.stage === 'answered' ? 'answered' : 'sent',
      };
    }
    return newRecord(o.status as AccountStatus, {
      userId: str(o.userId),
      previousUserId: str(o.previousUserId),
      appleUserId: str(o.appleUserId),
      nickname: str(o.nickname),
      nicknameSignup: o.nicknameSignup === true,
      deleting,
    });
  } catch {
    return null;
  }
}

export function parseProvider(raw: string | null): Provider | null {
  return raw === 'apple' || raw === 'kakao' ? raw : null;
}

// ── 저장된 세션 읽기 ─────────────────────────────────────────

export type StoredUser = { userId: string; isAnonymous: boolean | null };

/** 세션 저장값에서 사용자 id 와 익명 여부. 사본으로 만든 세션엔 is_anonymous 가 없어 null(모름). */
export function parseStoredUser(raw: string | null): StoredUser | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const user = (v as { user?: { id?: unknown; is_anonymous?: unknown } }).user;
    if (typeof user?.id !== 'string' || !user.id) return null;
    return { userId: user.id, isAnonymous: typeof user.is_anonymous === 'boolean' ? user.is_anonymous : null };
  } catch {
    return null;
  }
}

// ── 첫 화면 판정(설계 2 getStartState — 통신 없음) ───────────

/** 앱을 켤 때 기기 저장값만으로 정하는 상태. src/lib/queries/account.ts 의 StartState 와 같다. */
export type StartState =
  | { kind: 'fresh' }
  | { kind: 'signed_out'; lastProvider: Provider | null }
  | { kind: 'anonymous' }
  | { kind: 'signed_in' }
  | { kind: 'session_lost'; previousUserId: string | null }
  | { kind: 'deleting' }
  | { kind: 'unreadable' };

export type StartInputs = {
  /** 기기 상태 기록. 'unreadable' = 읽기 실패, null = 없음(새 설치 또는 1.1.0 에서 올라옴). */
  record: AccountRecord | null | 'unreadable';
  /** 세션 저장값: 읽기 실패 / 없음 / 깨짐 / 사용자. */
  session: 'unreadable' | 'none' | 'corrupt' | StoredUser;
  lastProvider: Provider | null;
  /** 위시를 저장해 봤을 수 있다는 흔적. 모르면(읽기 실패) true 로 넘긴다 — 잃을 수 있는 쪽으로 본다. */
  hasWishTrace: boolean;
  /** 사본에 남은 사용자 id(문의 번호용). 모르면 null. */
  copyUserId: string | null;
};

export type StartDecision = {
  state: StartState;
  /** 기기 상태 기록을 이 값으로 바꾼다. null 이면 그대로 둔다. */
  write: AccountRecord | null;
};

const sameRecord = (a: AccountRecord, status: AccountStatus, userId: string | null) => a.status === status && a.userId === userId;

/**
 * 첫 화면 상태. 읽지 못한 것은 "세션 없음"이 아니라 unreadable 이다. 새 계정은 만들지 않는다(불변식 1·2).
 * - 기록이 없고 세션이 있으면(1.1.0·OTA 에서 올라옴) 지금 세션을 보고 한 번 기록한다.
 * - 기록(rejected·signed_out)이 가리키는 계정의 세션이 기기에 남아 있어도 기록을 따른다 — 세션은 사용자가 고른
 *   로그아웃·삭제 말고는 지우지 않으므로(불변식 3) 거절·연결 해제된 세션이 남는다.
 */
export function decideStartState(input: StartInputs): StartDecision {
  const { record, session, lastProvider, hasWishTrace, copyUserId } = input;
  if (record === 'unreadable' || session === 'unreadable') return { state: { kind: 'unreadable' }, write: null };
  if (record?.status === 'deleting') {
    if (deletionOnLaunch(record) === 'resume') return { state: { kind: 'deleting' }, write: null };
    // 서버가 지우지 못했다고 답한 뒤 꺼졌거나 사용자가 멈춤 — 삭제 전 기록으로 되돌리고 그 기록으로 다시 판정한다.
    const reverted = revertDeletion(record);
    const next = decideStartState({ ...input, record: reverted });
    return { state: next.state, write: next.write ?? reverted };
  }

  if (session !== 'none' && session !== 'corrupt') {
    if (record && record.userId === session.userId) {
      if (record.status === 'rejected') {
        return { state: { kind: 'session_lost', previousUserId: record.userId }, write: null };
      }
      if (record.status === 'signed_out') {
        return { state: { kind: 'signed_out', lastProvider }, write: null };
      }
    }
    // 그 밖에는 세션이 사실이다.
    const known = record && record.userId === session.userId ? record.status : null;
    const status: 'anonymous' | 'signed_in' =
      session.isAnonymous === true ? 'anonymous' : session.isAnonymous === false ? 'signed_in' : known === 'signed_in' ? 'signed_in' : 'anonymous';
    const write = record && sameRecord(record, status, session.userId) ? null : newRecord(status, {
      userId: session.userId,
      appleUserId: record?.userId === session.userId ? record.appleUserId : null,
      nickname: record?.userId === session.userId ? record.nickname : null,
    });
    return { state: { kind: status }, write };
  }

  // 세션 없음(또는 깨짐)
  if (!record || record.status === 'fresh') {
    if (!hasWishTrace) return { state: { kind: 'fresh' }, write: null };
    // 기록은 없는데 위시를 저장한 흔적만 남았다(1.1.0 에서 세션이 사라진 사용자) — 끊긴 세션으로 본다.
    return {
      state: { kind: 'session_lost', previousUserId: copyUserId },
      write: newRecord('rejected', { userId: copyUserId }),
    };
  }
  if (record.status === 'signed_in') {
    return { state: { kind: 'signed_out', lastProvider }, write: newRecord('signed_out', { userId: record.userId, appleUserId: record.appleUserId }) };
  }
  if (record.status === 'signed_out') return { state: { kind: 'signed_out', lastProvider }, write: null };
  // anonymous · rejected: 위시 흔적이 있으면 끊긴 세션 화면, 없으면 잃을 것이 없어 새 설치와 같은 화면(알림창 C 없음)
  if (hasWishTrace) {
    return {
      state: { kind: 'session_lost', previousUserId: record.userId },
      write: record.status === 'rejected' ? null : newRecord('rejected', { userId: record.userId }),
    };
  }
  return {
    state: { kind: 'fresh' },
    write: newRecord('fresh', { previousUserId: record.userId }),
  };
}

// ── 계정 삭제 도중 기록(화면 > 계정 삭제, D-14) ─────────────────

/**
 * '삭제 중' 기록이 남은 채 앱을 켰을 때. 앱은 서버의 삭제 진행 상태(ops.deletion_progress — service_role 전용)를 읽을 수 없으므로
 * 기기에 남은 단계로 정한다:
 * - sent(요청을 보냈는데 답을 받기 전에 꺼짐): 서버가 연결 해제·삭제를 시작했을 수 있다 → 이어서 부른다(resume).
 *   서버는 끝난 단계를 건너뛰고(연결 해제를 두 번 하지 않음), 이미 지웠으면 already_deleted 로 답한다.
 * - answered(서버가 지우지 못했다고 답한 뒤 — 사용자가 다시 시도·취소를 고르던 중 꺼짐): 사용자가 삭제를 이어 가겠다고 고르지
 *   않았으므로 확인 없이 다시 부르지 않는다 → 삭제 전 기록으로 되돌린다(revert).
 */
export function deletionOnLaunch(record: AccountRecord): 'resume' | 'revert' {
  return record.deleting?.stage === 'answered' ? 'revert' : 'resume';
}

/** 서버가 지우지 못했다고 답함(연결 해제 실패·Apple 재인증 필요·통신·서버 오류) — '삭제 중' 기록을 answered 로. */
export function markDeletionAnswered(record: AccountRecord): AccountRecord {
  if (record.status !== 'deleting' || !record.deleting) return record;
  return { ...record, deleting: { ...record.deleting, stage: 'answered' } };
}

/** 삭제를 멈춤: '삭제 중' 기록을 삭제 전 계정 기록(익명·로그인)으로 되돌린다. */
export function revertDeletion(record: AccountRecord): AccountRecord {
  if (record.status !== 'deleting') return record;
  return newRecord(record.deleting?.account === 'anonymous' ? 'anonymous' : 'signed_in', {
    userId: record.userId,
    appleUserId: record.appleUserId,
    nickname: record.nickname,
  });
}

// ── 실행 중 서버 거절(흐름 3) ────────────────────────────────

/**
 * 서버가 지금 세션을 거절했을 때(auth-js 가 세션을 지우려 함 — SIGNED_OUT 이 로그아웃·삭제를 거치지 않고 옴)
 * 기기 상태를 어떻게 바꿀지. 익명은 위시 흔적에 따라 끊긴 세션 화면 / 새 설치 화면, 로그인은 로그인 화면.
 */
export function decideRejection(
  record: AccountRecord | null,
  hasWishTrace: boolean,
  lastProvider: Provider | null,
): StartDecision | null {
  if (!record || record.status === 'deleting' || record.status === 'fresh' || record.status === 'signed_out') return null;
  if (record.status === 'signed_in') {
    return { state: { kind: 'signed_out', lastProvider }, write: newRecord('signed_out', { userId: record.userId, appleUserId: record.appleUserId }) };
  }
  if (record.status === 'rejected') return { state: { kind: 'session_lost', previousUserId: record.userId }, write: null };
  // anonymous
  if (hasWishTrace) {
    return { state: { kind: 'session_lost', previousUserId: record.userId }, write: newRecord('rejected', { userId: record.userId }) };
  }
  return { state: { kind: 'fresh' }, write: newRecord('fresh', { previousUserId: record.userId }) };
}

/** "로그인 없이 시작"이 새 익명 계정의 previous_user_id 로 남길 값(확인창 D·흔적 없는 거절. 그 밖엔 남기지 않는다). */
export function previousUserIdForStart(record: AccountRecord | null): string | null {
  if (!record) return null;
  if (record.status === 'rejected') return record.userId;
  if (record.status === 'fresh') return record.previousUserId;
  return null;
}

/**
 * "로그인 없이 시작"(새 익명 계정)을 해도 되는지. 기기 기록이 익명·로그인이고 그 계정의 세션이 기기에 있으면(창 C [다시 시도]로
 * 세션이 되살아남) 새 계정이 그 세션을 덮으므로 하지 않는다(불변식 3). 그 밖(새 설치·로그아웃·거절)은 해도 된다.
 */
export function canStartWithoutSignIn(record: AccountRecord | null, session: StoredUser | null): boolean {
  if (!record || (record.status !== 'anonymous' && record.status !== 'signed_in')) return true;
  return !session || session.userId !== record.userId;
}

/**
 * 로그인 화면에서 "로그인 없이 시작"을 골랐을 때 '로그인 화면·반시트 1회'(signInPromptUsed)를 쓸지(P-06).
 * 자동으로 권한 것만 센다 — 첫 실행(새 설치·계정 삭제 뒤) 로그인 화면. 로그아웃·서버 거절(흔적 없는 거절 포함) 뒤 로그인 화면은 세지 않는다.
 */
export function skipCountsAsPrompt(state: StartState | null, record: AccountRecord | null): boolean {
  if (state?.kind !== 'fresh') return false;
  return !(record?.status === 'fresh' && record.previousUserId !== null);
}

// ── 기기 정리(설계 4 표) ─────────────────────────────────────

export type CleanupKind = 'sign_out' | 'delete_account';

const isSessionKey = (k: string) => /^sb-.+-auth-token/.test(k); // -code-verifier·-user 등 딸린 키 포함

/**
 * 로그아웃·계정 삭제 때 지울 저장 키(설계 4 표와 키 단위로 같다). 세션 키는 사용자가 고른 이 두 경우에만 지운다.
 * - 로그아웃: 세션·세션 사본·알림 기록·사진 주소 캐시. 남김 = accountState(로그아웃으로 바꿈)·최근 로그인·1회 표시·합칠 것 남음·세션 보관·본 표시.
 * - 계정 삭제: wishshot.* 전부(개발용 wishshot.dev.* 는 도구라 남김)와 세션.
 * 다른 라이브러리의 값은 건드리지 않는다(AsyncStorage.clear 금지).
 */
export function keysToRemove(allKeys: readonly string[], kind: CleanupKind): string[] {
  return allKeys.filter((k) => {
    if (isSessionKey(k)) return true;
    if (!k.startsWith('wishshot.') || k.startsWith('wishshot.dev.')) return false;
    if (kind === 'delete_account') return true;
    return k === 'wishshot.sessionCopy' || k === 'wishshot.notifications' || k.startsWith('wishshot.signedurl.');
  });
}

// ── 합치기 재시도(설계 2·흐름 '합치기 알림') ─────────────────

export type PendingMerge = {
  v: 1;
  anonUserId: string;
  /** 합칠 때마다 새로 받은 값으로 바로 바꿔 저장한다(낡은 토큰을 거듭 쓰면 서버가 세션을 끝냄). */
  anonRefreshToken: string;
  /** 기존 계정으로 로그인한 뒤 채운다. 대상 계정으로 로그인해 있을 때만 시도한다. */
  targetUserId: string | null;
  count: number;
  /** 합치기를 시작한 횟수(분석 이벤트의 first / retry 구분). */
  attempts: number;
  /** 익명 세션까지 못 쓰게 됨 — 설정 행이 "문의하기"로 바뀐다. */
  anonLost: boolean;
};

export function parsePendingMerge(raw: string | null): PendingMerge | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.anonUserId !== 'string' || typeof o.anonRefreshToken !== 'string') return null;
    return {
      v: 1,
      anonUserId: o.anonUserId,
      anonRefreshToken: o.anonRefreshToken,
      targetUserId: typeof o.targetUserId === 'string' && o.targetUserId ? o.targetUserId : null,
      count: typeof o.count === 'number' && o.count >= 0 ? o.count : 0,
      attempts: typeof o.attempts === 'number' && o.attempts >= 0 ? o.attempts : 0,
      anonLost: o.anonLost === true,
    };
  } catch {
    return null;
  }
}

/** 앱이 켜질 때(launch)는 늘, 다른 앱에서 돌아올 때(foreground)는 1분에 1번까지. */
export const MERGE_FOREGROUND_INTERVAL_MS = 60_000;

export type MergeTrigger = 'launch' | 'foreground' | 'manual';

export type MergeDecision =
  | 'attempt'
  | 'none' // 합칠 것 없음
  | 'throttled' // 돌아올 때 재시도는 1분에 1번
  | 'other_account' // 대상 계정이 아닌 계정으로 로그인해 있음 — 시도하지 않고 설정 행만 남김
  | 'stale'; // 지금도 익명 계정(로그인이 끝나지 않음) — 남은 기록을 지운다

export function decideMerge(input: {
  pending: PendingMerge | null;
  currentUserId: string | null;
  trigger: MergeTrigger;
  now: number;
  lastAttemptAt: number | null;
}): MergeDecision {
  const { pending, currentUserId, trigger, now, lastAttemptAt } = input;
  if (!pending) return 'none';
  if (currentUserId === pending.anonUserId) return 'stale';
  if (!currentUserId || !pending.targetUserId || currentUserId !== pending.targetUserId) return 'other_account';
  if (trigger === 'foreground' && lastAttemptAt !== null && now - lastAttemptAt < MERGE_FOREGROUND_INTERVAL_MS) return 'throttled';
  return 'attempt';
}

export type MergeAttemptDeps = {
  /** 익명 세션을 새로 고친다(따로 만든 클라이언트). */
  refreshAnon(refreshToken: string): Promise<
    { ok: true; accessToken: string; refreshToken: string } | { ok: false; reason: 'rejected' | 'network' | 'server' }
  >;
  /** 새로 받은 refreshToken 을 기기에 바로 저장한다. */
  savePending(next: PendingMerge): Promise<void>;
  /** 합치기 서버 함수 한 번(정한 개수씩). */
  callMerge(anonAccessToken: string): Promise<
    | { ok: true; status: 'done' | 'partial'; merged: number; remaining: number }
    | { ok: false; reason: 'anon_invalid' | 'network' | 'server' }
  >;
  /** 처리 도중 돌려받은 한 번의 상한(무한 반복 방지). */
  maxRounds?: number;
};

export type MergeAttemptResult =
  | { kind: 'done'; count: number }
  | { kind: 'failed'; reason: 'network' | 'server' | 'anon_session_lost'; merged: number; remaining: number | null };

/**
 * 합치기 한 번: 익명 세션을 새로 고쳐 새 refreshToken 을 **합치기 호출보다 먼저** 저장한 뒤, 서버가 done 이라고 할 때까지 이어 부른다.
 * 위시마다 서버가 멱등이라 도중에 끊겨도 다시 부르면 이어서 한다.
 */
export async function runMergeAttempt(pending: PendingMerge, deps: MergeAttemptDeps): Promise<MergeAttemptResult> {
  const refreshed = await deps.refreshAnon(pending.anonRefreshToken);
  if (!refreshed.ok) {
    return { kind: 'failed', reason: refreshed.reason === 'rejected' ? 'anon_session_lost' : refreshed.reason, merged: 0, remaining: null };
  }
  await deps.savePending({ ...pending, anonRefreshToken: refreshed.refreshToken, attempts: pending.attempts + 1 });
  let merged = 0;
  for (let round = 0; round < (deps.maxRounds ?? 50); round++) {
    const r = await deps.callMerge(refreshed.accessToken);
    if (!r.ok) {
      return { kind: 'failed', reason: r.reason === 'anon_invalid' ? 'anon_session_lost' : r.reason, merged, remaining: null };
    }
    merged += r.merged;
    if (r.status === 'done') return { kind: 'done', count: merged };
    if (r.merged === 0 && r.remaining > 0) break; // 진전이 없으면 멈춘다
  }
  return { kind: 'failed', reason: 'server', merged, remaining: null };
}

// ── 로그인 중 공유 맡아 두기(흐름 2) ─────────────────────────

/**
 * 로그인 화면이 떠 있는 동안 온 공유를 맡아 두는 곳(마지막 1개, 메모리에만).
 * expo-share-intent 는 앱이 inactive/background 가 되면 값을 지우므로 처리기가 먼저 꺼내 여기에 맡긴다.
 */
export function createShareHold<T>() {
  let held: T | null = null;
  return {
    hold(value: T): void {
      held = value;
    },
    take(): T | null {
      const next = held;
      held = null;
      return next;
    },
    peek: (): T | null => held,
  };
}

/** 앱 화면(전체 탭 등)이 있어 공유를 열 수 있는 상태인지. 그 밖(로그인 화면·읽는 중·삭제 중)에는 맡아 둔다. */
export function canOpenShare(state: StartState | null): boolean {
  return state?.kind === 'anonymous' || state?.kind === 'signed_in';
}

// ── 서버 응답 읽기(통신 없이 흉내 낸 응답으로 시험한다) ─────────

/** supabase-js 인증 오류를 통신 실패와 서버 오류로 나눈다. */
export function classifyAuthFailure(error: { name?: string; message?: string } | null): 'network' | 'server' {
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`.toLowerCase();
  return text.includes('retryablefetch') || text.includes('network') || text.includes('fetch failed') ? 'network' : 'server';
}

/** ensure_profile 의 응답({ nickname, created } 객체 또는 한 줄짜리 배열). 모르는 모양이면 null. */
export function parseEnsureProfile(data: unknown): { nickname: string; created: boolean } | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (typeof row !== 'object' || row === null) return null;
  const r = row as { nickname?: unknown; created?: unknown };
  return typeof r.nickname === 'string' ? { nickname: r.nickname, created: r.created === true } : null;
}

/** 서버 닉네임 함수의 결과(문자열 또는 { status | result | code, suggestions })를 읽는다. 모르는 모양이면 null. */
export function parseNicknameStatus(data: unknown): { status: string; suggestions: string[] } | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (typeof row === 'string') return { status: row, suggestions: [] };
  if (typeof row !== 'object' || row === null) return null;
  const r = row as { status?: unknown; result?: unknown; code?: unknown; suggestions?: unknown };
  const status = [r.status, r.result, r.code].find((v): v is string => typeof v === 'string');
  if (!status) return null;
  const suggestions = Array.isArray(r.suggestions) ? r.suggestions.filter((v): v is string => typeof v === 'string') : [];
  return { status, suggestions };
}

/** 닉네임 검사 결과 중 사용자에게 보일 문제(사용 중·길이·글자·예약어). 문제가 아니면 null. */
export function nicknameProblem(parsed: { status: string; suggestions: string[] }):
  | { kind: 'taken'; suggestions: string[] }
  | { kind: 'invalid_length' }
  | { kind: 'invalid_chars' }
  | { kind: 'reserved' }
  | null {
  switch (parsed.status) {
    case 'taken':
      return { kind: 'taken', suggestions: parsed.suggestions.slice(0, 2) };
    case 'invalid_length':
    case 'invalid_chars':
    case 'reserved':
      return { kind: parsed.status };
    default:
      return null;
  }
}

/** 합치기 서버 함수가 익명 쪽 토큰 문제로 돌려주는 오류 코드(서버 워크트리가 정하면 여기만 고친다). */
const ANON_INVALID_CODES = ['invalid_anon_token', 'not_anonymous'];
export function isAnonInvalidCode(code: string | null): boolean {
  return code !== null && ANON_INVALID_CODES.includes(code);
}

/**
 * 계정 삭제 서버 함수가 http 오류로 답했을 때: 연결 해제(Apple 철회·카카오 해제) 실패(아무것도 지우지 않음, 502 unlink_failed + provider),
 * Apple 재인증 필요(400 apple_code_required), 그 밖의 서버 오류.
 */
export function classifyDeleteFailure(
  code: string | null,
  body: unknown = null,
): { kind: 'unlink_failed'; provider: Provider } | { kind: 'apple_code_required' } | { kind: 'error'; reason: 'server' } {
  if (code === 'apple_code_required') return { kind: 'apple_code_required' };
  if (code === 'unlink_failed') {
    const provider = (body as { provider?: unknown } | null)?.provider;
    return { kind: 'unlink_failed', provider: provider === 'kakao' ? 'kakao' : 'apple' };
  }
  return { kind: 'error', reason: 'server' };
}
