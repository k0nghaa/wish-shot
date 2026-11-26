// 계정(로그인·합치기·닉네임·삭제) 데이터 레이어 — 하위 작업 사이의 약속(docs/phases/phase-22-account-login.md 설계 2).
// 진짜 구현이다. 다만 __DEV__ 에서 개발자가 흉내 결과를 고른 함수(src/lib/accountSimulation.ts isSimulated)는
// 고른 흉내 결과를 돌려준다(화면 확인용). 화면은 이 결과의 종류(kind)마다 처리한다. 결과 타입을 바꾸려면 상위에 알린다.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { Image } from 'expo-image';

import { hasSeenOnboarding, markOnboardingSeen } from '@/components/Onboarding/onboardingStorage';
import { AppState } from 'react-native';

import {
  isSimulated,
  simulate,
  subscribeSimulatedStartState,
  type AccountSimulationMap,
  type SimulatedFunction,
} from '@/lib/accountSimulation';
import {
  readLastProvider,
  readPending,
  readPromptUsed,
  readRecord,
  readStoredUser,
  resolveStartState,
  clearPending,
  writeLastProvider,
  writePending,
  writePromptUsed,
  writeRecord,
} from '@/lib/accountDevice';
import {
  canOpenShare,
  canStartWithoutSignIn,
  classifyAuthFailure as authFailureReason,
  classifyDeleteFailure,
  decideMerge,
  decideRejection,
  isAnonInvalidCode,
  keysToRemove,
  markDeletionAnswered,
  newRecord,
  nicknameProblem,
  parseEnsureProfile,
  parseNicknameStatus,
  previousUserIdForStart,
  runMergeAttempt,
  skipCountsAsPrompt,
  type MergeTrigger,
  type PendingMerge as PendingMergeRecord,
} from '@/lib/accountLogic';
import {
  addAppleRevokeListener,
  getAppleAuthorizationCode,
  getAppleCredentialState,
  getProviderToken,
  kakaoLocalLogout,
} from '@/lib/accountProviders';
import { capture, identifyUser, resetAnalytics } from '@/lib/analytics';import { clearAllNotifications, pruneMissingItems } from '@/lib/notifications';
import { isSessionRejected, runStartOver } from '@/lib/sessionVault';
import { showSnackbar } from '@/lib/snackbar';
import { createDetachedClient, SESSION_STORAGE_KEY, sessionVault, supabase } from '@/lib/supabase';

import { isUserInitiatedSignOut, runUserSignOut } from './auth';
import { EDGE_FUNCTIONS, invokeEdge, rpcLoose } from './edge';
import { clearSignedUrlCache } from './storage';

export type SignInProvider = 'apple' | 'kakao';

/** 통신 실패(network)와 서버 오류(server). */
export type FailureReason = 'network' | 'server';

export type SignInResult =
  /** next: 새 계정 → 닉네임 화면, 기존 계정 + 익명 위시 있음 → 합치는 중 화면, 그 밖 → 원래 가려던 화면. */
  | { kind: 'success'; next: 'nickname' | 'merge' | 'done' }
  /** 사용자가 Apple·카카오 창을 닫음. 아무 안내 없이 로그인 화면에 머문다. */
  | { kind: 'cancelled' }
  /** 같은 이메일이 다른 수단으로 가입돼 있음 — "이미 Apple로 가입한 이메일입니다. Apple로 로그인하세요." */
  | { kind: 'other_provider'; provider: SignInProvider }
  | { kind: 'error'; reason: FailureReason };

export type StartWithoutSignInResult = { kind: 'success' } | { kind: 'error'; reason: 'network' };

export type MergeResult =
  | { kind: 'done'; count: number }
  /**
   * anon_session_lost: 익명 세션까지 못 쓰게 됨(설정 행이 "문의하기"로 바뀜).
   * signed_in_elsewhere: 대상 계정이 아닌 계정으로 로그인해 있어 시도하지 않음.
   */
  | { kind: 'failed'; reason: FailureReason | 'anon_session_lost' | 'signed_in_elsewhere' };

/** 합치지 못하고 남은 위시. inquiryOnly 면 다시 시도 대신 문의만 가능하다. */
export type PendingMerge = { count: number; inquiryOnly: boolean };

export type AccountInfo =
  | { kind: 'anonymous' }
  | {
      kind: 'signed_in';
      provider: SignInProvider;
      /** Apple 에서 가렸으면 중계 주소. 이메일 없이 가입했으면 null. */
      email: string | null;
      nickname: string;
      pendingMerge: PendingMerge | null;
    };

/** 서버 닉네임 검사(DB 함수 check_nickname) 결과. */
export type NicknameCheck =
  | { kind: 'available' }
  | { kind: 'taken'; suggestions: string[] }
  | { kind: 'invalid_length' }
  | { kind: 'invalid_chars' }
  | { kind: 'reserved' }
  | { kind: 'unchanged' };

export type NicknameCheckResult = NicknameCheck | { kind: 'error'; reason: FailureReason };

export type SaveNicknameResult =
  | { kind: 'saved'; nickname: string }
  | Exclude<NicknameCheck, { kind: 'available' } | { kind: 'unchanged' }>
  | { kind: 'error'; reason: FailureReason };

export type AppleConfirmResult =
  | { kind: 'confirmed'; authorizationCode: string }
  | { kind: 'cancelled' }
  | { kind: 'failed' };

export type DeleteReason = 'rarely_used' | 'missing_feature' | 'other_account' | 'privacy' | 'other';

export type DeleteAccountInput = {
  reason: DeleteReason | null;
  /** reason 이 other 일 때만, 200자 이하. */
  reasonText: string | null;
  /** Apple 계정: confirmAppleForDeletion 으로 받은 코드. */
  appleAuthorizationCode?: string;
  /** 사용자가 [Apple·카카오 연결 해제 없이 삭제]를 골랐을 때만 true. */
  skipUnlink?: boolean;
};

export type DeleteAccountResult =
  /** 기기 정리까지 끝남 — 새 설치와 같은 흐름으로 간다. */
  | { kind: 'deleted' }
  /** 연결 해제(Apple 철회·카카오 해제) 실패 — 아무것도 지우지 않음. [다시 시도] [연결 해제 없이 삭제]. */
  | { kind: 'unlink_failed'; provider: SignInProvider }
  /** Apple 계정인데 재인증 코드가 없음 — Apple 재인증부터 다시 한다. */
  | { kind: 'apple_code_required' }
  | { kind: 'error'; reason: FailureReason };

export type RetryLostSessionResult = { kind: 'restored' } | { kind: 'still_lost' } | { kind: 'error'; reason: FailureReason };

/** 앱을 켤 때 기기 저장값만으로 정하는 상태(통신 없음). */
export type StartState =
  | { kind: 'fresh' } // 세션 없음 + 로그인한 적 없음(새 설치·재설치·새 기기, 흔적 없는 거절)
  | { kind: 'signed_out'; lastProvider: SignInProvider | null } // 로그아웃·로그인 세션 만료·Apple 연결 해제
  | { kind: 'anonymous' }
  | { kind: 'signed_in' }
  | { kind: 'session_lost'; previousUserId: string | null } // 서버가 익명 세션을 거절함(위시 흔적 있음) — 알림창 C
  | { kind: 'deleting' } // 계정 삭제 도중 꺼짐 — 삭제하는 중 화면에서 다시 부른다
  | { kind: 'unreadable' }; // 저장값을 읽지 못함 — "세션 없음"이 아니다. 다시 시도

// ── 기기 상태(통신 없음) ─────────────────────────────────────

let currentState: StartState | null = null;
const stateListeners = new Set<(state: StartState) => void>();

/** 상태를 바꾸고 알린다(같은 값이어도 알린다 — 화면이 거르게 둔다). */
function publishState(state: StartState): void {
  currentState = state;
  for (const listener of [...stateListeners]) listener(state);
}

// 개발용 흉내로 첫 화면 상태를 고르면 같은 길로 알린다.
if (__DEV__) subscribeSimulatedStartState(publishState);

/** 개발자가 이 함수의 결과를 골랐으면 그 결과(화면 확인용). 고르지 않았으면 null — 진짜 구현을 한다. */
async function chosen<K extends SimulatedFunction>(fn: K): Promise<{ value: AccountSimulationMap[K] } | null> {
  if (!__DEV__ || !(await isSimulated(fn))) return null;
  return { value: await simulate(fn) };
}

/** 지금 상태(아직 정해지기 전이면 null). 공유 처리기가 "앱 화면이 있는가"를 볼 때 쓴다. */
export function getCurrentAccountState(): StartState | null {
  return currentState;
}

/** 앱 화면(전체 탭 등)을 쓸 수 있는 상태(익명·로그인)인지. */
export function isAccountReady(): boolean {
  return canOpenShare(currentState);
}

/**
 * 저장 직전: 앱 화면을 쓸 수 있는 상태가 될 때까지 기다린다(등록 폼이 서버 거절 뒤 저장할 때 — 로그인하거나 로그인 없이
 * 시작하면 true). cancel() 이면 false. 이미 쓸 수 있으면 바로 true.
 */
export function waitForAccountReady(): { promise: Promise<boolean>; cancel: () => void } {
  let settle: (ready: boolean) => void = () => undefined;
  let stop: () => void = () => undefined;
  const promise = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  if (isAccountReady()) settle(true);
  else {
    stop = subscribeAccountState((next) => {
      if (!canOpenShare(next)) return;
      stop();
      settle(true);
    });
  }
  return {
    promise,
    cancel: () => {
      stop();
      settle(false);
    },
  };
}

/** 상태 읽기 훅용(useSyncExternalStore). */
export function subscribeAccountStateChange(listener: () => void): () => void {
  return subscribeAccountState(listener);
}

type CheckSignInResponse =
  | { result: 'ok'; account: 'new' | 'existing' }
  | { result: 'other_provider'; provider: SignInProvider };

/** 지금 익명 계정에 담긴 위시 수(RLS 가 본인 것만 센다). 세기에 실패하면 null. */
async function countMyWishes(): Promise<number | null> {
  const { count, error } = await supabase.from('items').select('id', { count: 'exact', head: true });
  return error ? null : (count ?? 0);
}

/** 기존 계정(위시가 있음)으로 로그인하거나 합쳤으면 사용 안내를 건너뛴다 — 아직 안 봤다면 건너뛴 것으로 계측한다. */
async function skipOnboardingGuide(): Promise<void> {
  if (await hasSeenOnboarding()) return;
  capture('onboarding_finished', { result: 'skipped', last_step: 'card_3' });
  await markOnboardingSeen();
}

/**
 * 로그인 화면·반시트에서 Apple·카카오 로그인.
 * 1) 로그인 창에서 ID 토큰 → 2) 서버 '가입 확인'(같은 이메일이 다른 수단이면 막음, 불변식 7) → 3) 익명 세션이 있으면
 *    처음 쓰는 수단은 linkIdentity(익명 계정이 그대로 로그인 계정이 됨, 같은 uid), 이미 계정이 있으면 익명 세션을
 *    pendingMerge 에 남긴 뒤(불변식 3) 기존 계정으로 로그인 → 4) ensure_profile(새 계정이면 닉네임 화면).
 * 익명 위시를 합치는 일은 mergeAnonymousWishes 가 한다(합치는 중 화면).
 */
export async function signIn(provider: SignInProvider): Promise<SignInResult> {
  const pick = await chosen('signIn');
  if (pick) return pick.value;

  const finish = (result: SignInResult, event: 'linked' | 'new' | 'existing' | 'cancelled' | 'other_provider' | 'error'): SignInResult => {
    capture('sign_in_result', { provider, result: event });
    return result;
  };

  const got = await getProviderToken(provider);
  if (got.kind === 'cancelled') return finish({ kind: 'cancelled' }, 'cancelled');
  if (got.kind === 'error') return finish({ kind: 'error', reason: 'server' }, 'error');
  const { idToken, nonce, appleUserId } = got.token;

  // 서버 '가입 확인' — 앱은 이 확인을 통과한 토큰만 Supabase 에 보낸다.
  const check = await invokeEdge<CheckSignInResponse>(EDGE_FUNCTIONS.checkSignIn, { provider, idToken, nonce });
  if (!check.ok) return finish({ kind: 'error', reason: check.kind === 'network' ? 'network' : 'server' }, 'error');
  if (check.data.result === 'other_provider') {
    return finish({ kind: 'other_provider', provider: check.data.provider }, 'other_provider');
  }
  const accountExists = check.data.account === 'existing';

  const {
    data: { session: current },
  } = await supabase.auth.getSession();
  const anonymous = current?.user.is_anonymous === true ? current : null;

  let kind: 'linked' | 'new' | 'existing' = accountExists ? 'existing' : 'new';
  let pending: PendingMergeRecord | null = null;

  if (anonymous && !accountExists) {
    // 처음 쓰는 수단: 익명 계정이 그대로 로그인 계정이 된다(같은 uid, 합칠 것 없음).
    const { error } = await supabase.auth.linkIdentity({ provider, token: idToken, nonce });
    if (!error) kind = 'linked';
    else if (error.code === 'identity_already_exists') kind = 'existing'; // 그 사이 같은 수단 계정이 생김 — 기존 계정으로
    else return finish({ kind: 'error', reason: authFailureReason(error) }, 'error');
  }

  if (kind !== 'linked') {
    // 기존 계정 로그인: 익명 위시가 있으면 로그인 전에 익명 세션을 기기에 남긴다(불변식 3). 남기지 못하면 로그인하지 않는다.
    if (anonymous) {
      const count = await countMyWishes();
      // 세지 못해도(통신) 합치기를 남긴다 — 위시가 0개면 서버가 done(merged 0)으로 답한다.
      if (count === null || count > 0) {
        pending = { v: 1, anonUserId: anonymous.user.id, anonRefreshToken: anonymous.refresh_token, targetUserId: null, count: count ?? 0, attempts: 0, anonLost: false };
        try {
          await writePending(pending);
        } catch {
          return finish({ kind: 'error', reason: 'server' }, 'error');
        }
      }
    }
    const { data, error } = await supabase.auth.signInWithIdToken({ provider, token: idToken, nonce });
    if (error || !data.user) {
      if (pending) await clearPending(); // 로그인하지 못했으니 익명 세션 그대로다
      return finish({ kind: 'error', reason: authFailureReason(error) }, 'error');
    }
    if (pending) {
      pending = { ...pending, targetUserId: data.user.id };
      await writePending(pending).catch(() => undefined);
    }
  }

  // 로그인 직후 프로필 확보(새 계정이면 추천 닉네임을 바로 저장). 실패해도 로그인은 끝났다 — 닉네임은 설정에서 고칠 수 있다.
  const profile = await rpcLoose('ensure_profile');
  const created = profile.ok ? (parseEnsureProfile(profile.data)?.created ?? false) : false;
  const { data: after } = await supabase.auth.getSession();
  const userId = after.session?.user.id ?? null;
  await writeRecord(
    newRecord('signed_in', {
      userId,
      appleUserId,
      nickname: profile.ok ? (parseEnsureProfile(profile.data)?.nickname ?? null) : null,
      nicknameSignup: created,
    }),
  );
  await writeLastProvider(provider);
  if (userId) identifyUser(userId);
  publishState({ kind: 'signed_in' });
  // 둘 다 해당하면 합치기 먼저, 그다음 닉네임.
  const next = pending ? 'merge' : created ? 'nickname' : 'done';
  if (kind === 'existing') await skipOnboardingGuide(); // 기존 계정이면 사용 안내 생략
  return finish({ kind: 'success', next }, kind);
}

/**
 * 확인창 A·B·D 뒤 "로그인 없이 시작" — 새 익명 계정은 이때만 만든다(불변식 1).
 * 끊긴 세션(D)·흔적 없는 거절 뒤면 user_metadata.previous_user_id 에 이전 계정 번호를 남긴다. 지금 계정은 기기에 보관한다.
 * 가입에 실패하면 error(저장된 세션·기록은 그대로).
 */
export async function startWithoutSignIn(): Promise<StartWithoutSignInResult> {
  const pick = await chosen('startWithoutSignIn');
  if (pick) return pick.value;
  try {
    const record = await readRecord();
    const known = record === 'unreadable' ? null : record;
    const stored = await readStoredUser();
    // 창 C [다시 시도]로 세션이 되살아났으면 새 계정을 만들지 않는다(세션을 덮어쓰지 않음, 불변식 3) — 그 계정으로 앱 화면에 간다.
    if (canOpenShare(currentState) || !canStartWithoutSignIn(known, typeof stored === 'object' ? stored : null)) {
      if (known?.status === 'anonymous' || known?.status === 'signed_in') publishState({ kind: known.status });
      return { kind: 'success' };
    }
    const previousUserId = previousUserIdForStart(known);
    if (!(await runStartOver(supabase.auth, sessionVault, previousUserId))) return { kind: 'error', reason: 'network' };
    const user = await readStoredUser();
    await writeRecord(newRecord('anonymous', { userId: typeof user === 'object' ? user.userId : null }));
    // 통틀어 1회는 자동으로 권한 것만 센다: 첫 실행 로그인 화면(fresh)에서 건너뛴 것. 로그아웃·거절 뒤 화면은 세지 않는다(P-06).
    if (skipCountsAsPrompt(currentState, known)) await writePromptUsed();
    publishState({ kind: 'anonymous' });
    return { kind: 'success' };
  } catch {
    return { kind: 'error', reason: 'network' };
  }
}

/**
 * 서버가 세션을 거절한 것을 지켜본다(앱을 켠 동안, _layout 이 켠다). 확실히 거절한 경우만 기기 상태를 바꾼다 —
 * 통신·서버 오류(403·429·5xx 등)는 일시적일 수 있어 건드리지 않는다. 세션 자체는 지우지 않는다(불변식 3).
 * auth-js 는 재발급이 거절되면 세션을 지우려 하며(SIGNED_OUT), 저장 어댑터가 그 삭제를 막는다. 사용자가 고른
 * 로그아웃·삭제가 아닌 SIGNED_OUT 이 오면 같은 refreshToken 의 실패(60초간 저장돼 있다)를 다시 받아 분류한다.
 */
export function watchSessionRejection(): () => void {
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event !== 'SIGNED_OUT' || isUserInitiatedSignOut()) return;
    // 콜백 안에서 auth 를 기다리면 교착하므로 한 틱 뒤에 한다.
    setTimeout(() => void handleSessionRejection(), 0);
  });
  return () => data.subscription.unsubscribe();
}

async function handleSessionRejection(): Promise<void> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (data.session || !isSessionRejected(error)) return;
    let record = await readRecord();
    if (record === null) {
      // 앱을 켠 직후(1.1.0 에서 올라온 사용자의 첫 실행)면 기록이 아직 없다 — 첫 화면 판정이 지금 세션을 보고 기록하게 한다.
      await resolveStartState();
      record = await readRecord();
    }
    if (record === 'unreadable') return;
    const hasWishTrace = await sessionVault.hasWishTrace().catch(() => true);
    const decision = decideRejection(record, hasWishTrace, await readLastProvider());
    if (!decision) return;
    if (decision.write) await writeRecord(decision.write);
    publishState(decision.state);
  } catch {
    /* 분류하지 못하면 아무것도 바꾸지 않는다 */
  }
}

type MergeResponse = { status: 'done' | 'partial'; merged: number; remaining: number };

let mergeInFlight: Promise<MergeResult | null> | null = null;
let lastMergeAttemptAt: number | null = null;

/** 합치기 한 번(앱의 로그인 세션 + 따로 만든 클라이언트로 새로 고친 익명 세션). 합칠 것이 없거나 건너뛰면 null. */
async function runMerge(trigger: MergeTrigger): Promise<MergeResult | null> {
  if (mergeInFlight) return mergeInFlight;
  const task = (async (): Promise<MergeResult | null> => {
    const pending = await readPending();
    const user = await readStoredUser();
    const now = Date.now();
    const decision = decideMerge({
      pending,
      currentUserId: typeof user === 'object' ? user.userId : null,
      trigger,
      now,
      lastAttemptAt: lastMergeAttemptAt,
    });
    if (decision === 'none' || decision === 'throttled') return null;
    if (decision === 'stale') {
      await clearPending(); // 로그인이 끝나지 않은 채 남은 기록
      return null;
    }
    if (decision === 'other_account' || !pending) return { kind: 'failed', reason: 'signed_in_elsewhere' };
    lastMergeAttemptAt = now;
    const attempt = pending.attempts === 0 ? 'first' : 'retry';
    const detached = createDetachedClient();
    const result = await runMergeAttempt(pending, {
      async refreshAnon(refreshToken) {
        const { data, error } = await detached.auth.refreshSession({ refresh_token: refreshToken });
        if (error || !data.session) {
          if (isSessionRejected(error)) return { ok: false, reason: 'rejected' };
          return { ok: false, reason: authFailureReason(error) };
        }
        return { ok: true, accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
      },
      savePending: writePending, // 새 refreshToken 을 합치기 호출보다 먼저 바로 저장한다
      async callMerge(anonAccessToken) {
        const r = await invokeEdge<MergeResponse>(EDGE_FUNCTIONS.mergeWishes, { anonAccessToken }, 60_000);
        if (r.ok) return { ok: true, status: r.data.status, merged: r.data.merged, remaining: r.data.remaining };
        if (r.kind === 'network') return { ok: false, reason: 'network' };
        return { ok: false, reason: isAnonInvalidCode(r.code) ? 'anon_invalid' : 'server' };
      },
    });
    if (result.kind === 'done') {
      await clearPending();
      await clearSignedUrlCache(); // 사진 경로가 바뀌었다
      void refreshNotificationsAfterMerge();
      const count = pending.count > 0 ? pending.count : result.count;
      capture('wishes_merged', { result: 'success', count, attempt });
      await skipOnboardingGuide();
      return { kind: 'done', count };
    }
    if (result.reason === 'anon_session_lost') {
      const latest = (await readPending()) ?? pending;
      await writePending({ ...latest, anonLost: true }).catch(() => undefined);
    }
    capture('wishes_merged', { result: 'failed', count: result.merged, attempt });
    return { kind: 'failed', reason: result.reason };
  })();
  mergeInFlight = task;
  try {
    return await task;
  } finally {
    mergeInFlight = null;
  }
}

/** 합친 뒤 알림 기록에서 없는 위시를 정리한다(위시 id 는 그대로라 대부분 남는다). */
async function refreshNotificationsAfterMerge(): Promise<void> {
  try {
    const { data } = await supabase.from('items').select('id');
    if (data) await pruneMissingItems(new Set(data.map((row) => row.id)));
  } catch {
    /* 정리하지 못해도 다음 목록 읽기 때 정리된다 */
  }
}

/**
 * 합치는 중 화면, 설정 "다시 시도". 익명으로 담은 위시를 지금 로그인한 계정으로 옮긴다(위시마다 멱등, 모두 옮긴 뒤에만 서버가
 * 익명 계정을 지움 — 도중에 실패하면 익명 위시는 그대로). 합칠 것이 없으면 완료(0개).
 */
export async function mergeAnonymousWishes(): Promise<MergeResult> {
  const pick = await chosen('mergeAnonymousWishes');
  if (pick) return pick.value;
  return (await runMerge('manual')) ?? { kind: 'done', count: 0 };
}

/** 설정 '계정' 영역. 통신이 안 돼도 기기에 있는 값으로 답한다(닉네임은 마지막으로 안 값). */
export async function getAccount(): Promise<AccountInfo> {
  const pick = await chosen('getAccount');
  if (pick) return pick.value;
  const [user, record, pending, lastProvider] = await Promise.all([readStoredUser(), readRecord(), readPending(), readLastProvider()]);
  const known = record === 'unreadable' ? null : record;
  if (typeof user !== 'object') return { kind: 'anonymous' };
  const signedIn = user.isAnonymous === false || (user.isAnonymous === null && known?.userId === user.userId && known.status === 'signed_in');
  if (!signedIn) return { kind: 'anonymous' };
  const { data } = await supabase.auth.getSession();
  const authUser = data.session?.user;
  const rawProvider = authUser?.app_metadata?.provider;
  const provider: SignInProvider = rawProvider === 'kakao' || rawProvider === 'apple' ? rawProvider : (lastProvider ?? 'apple');
  const profile = await rpcLoose('ensure_profile');
  const nickname = (profile.ok ? parseEnsureProfile(profile.data)?.nickname : null) ?? known?.nickname ?? '';
  if (nickname && known && known.nickname !== nickname) await writeRecord({ ...known, nickname });
  return {
    kind: 'signed_in',
    provider,
    email: authUser?.email ?? null,
    nickname,
    pendingMerge: pending && pending.targetUserId === user.userId ? { count: pending.count, inquiryOnly: pending.anonLost } : null,
  };
}

/** 닉네임 화면 — 입력을 멈추면. 서버가 규칙(2~12자·한글 영문 숫자·예약어)과 중복(대소문자 무시·NFC)을 본다. */
export async function checkNickname(name: string): Promise<NicknameCheckResult> {
  const pick = await chosen('checkNickname');
  if (pick) return pick.value;
  const r = await rpcLoose('check_nickname', { p_name: name });
  if (!r.ok) return { kind: 'error', reason: r.kind };
  const parsed = parseNicknameStatus(r.data);
  if (!parsed) return { kind: 'error', reason: 'server' };
  const problem = nicknameProblem(parsed);
  if (problem) return problem;
  if (parsed.status === 'available') return { kind: 'available' };
  if (parsed.status === 'unchanged') return { kind: 'unchanged' };
  return { kind: 'error', reason: 'server' };
}

/** 닉네임 화면 [완료]·[저장] — 서버가 한 번 더 검사한다(동시 선점). */
export async function saveNickname(name: string): Promise<SaveNicknameResult> {
  const pick = await chosen('saveNickname');
  if (pick) return pick.value;
  const r = await rpcLoose('set_nickname', { p_name: name });
  if (!r.ok) return { kind: 'error', reason: r.kind };
  const parsed = parseNicknameStatus(r.data);
  if (!parsed) return { kind: 'error', reason: 'server' };
  const problem = nicknameProblem(parsed);
  if (problem) return problem;
  if (!['saved', 'ok', 'available', 'unchanged'].includes(parsed.status)) return { kind: 'error', reason: 'server' };
  const record = await readRecord();
  const known = record === 'unreadable' ? null : record;
  capture('nickname_saved', {
    mode: known?.nicknameSignup ? 'signup' : 'edit',
    changed_from_suggested: known?.nickname !== name,
  });
  if (known) await writeRecord({ ...known, nickname: name, nicknameSignup: false });
  return { kind: 'saved', nickname: name };
}

/**
 * 기기 정리(설계 4 표). 세션은 사용자가 고른 로그아웃·삭제 때만 지운다(불변식 3) — 서버에 닿지 않아도 기기에서는 지운다.
 * 지울 저장 키는 accountLogic.keysToRemove 가 정한다(다른 라이브러리 값은 건드리지 않는다 — AsyncStorage.clear 금지).
 */
async function clearDevice(kind: 'sign_out' | 'delete_account'): Promise<void> {
  await runUserSignOut(async () => {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    await sessionVault.storage.removeItem(SESSION_STORAGE_KEY);
  });
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keysToRemove(keys, kind));
  } catch (e) {
    if (__DEV__) console.warn('[WishShot/account] 기기 정리 실패', e);
  }
  await Promise.all([clearAllNotifications(), clearSignedUrlCache()]);
  Image.clearMemoryCache();
  await Image.clearDiskCache().catch(() => undefined);
  void kakaoLocalLogout();
  resetAnalytics();
}

/** 로그아웃 확인창 [로그아웃] — 기기 정리(설계 4 '로그아웃' 열) 포함. 익명 위시·합칠 것 남음 기록은 남긴다. */
export async function signOutAccount(): Promise<void> {
  if (await chosen('signOutAccount')) return;
  const record = await readRecord();
  const known = record === 'unreadable' ? null : record;
  const user = await readStoredUser();
  capture('signed_out', {});
  await clearDevice('sign_out');
  await writeRecord(
    newRecord('signed_out', {
      userId: known?.userId ?? (typeof user === 'object' ? user.userId : null),
      appleUserId: known?.appleUserId ?? null,
    }),
  );
  publishState({ kind: 'signed_out', lastProvider: await readLastProvider() });
}

/** 계정 삭제 안내 [계정 삭제] — Apple 계정만. 삭제하는 중 화면은 이 창이 닫힌 뒤 띄운다. */
export async function confirmAppleForDeletion(): Promise<AppleConfirmResult> {
  const pick = await chosen('confirmAppleForDeletion');
  if (pick) return pick.value;
  const r = await getAppleAuthorizationCode();
  if (r.kind === 'ok') return { kind: 'confirmed', authorizationCode: r.authorizationCode };
  return r.kind === 'cancelled' ? { kind: 'cancelled' } : { kind: 'failed' };
}

/** 합치지 못한 익명 계정이 남아 있으면 그 익명 세션으로 계정 삭제를 한 번 더 부른다. 실패는 삼킨다(남은 계정은 문의로 처리). */
async function deleteLeftoverAnonymous(): Promise<void> {
  try {
    const pending = await readPending();
    if (!pending) return;
    const detached = createDetachedClient();
    const { data, error } = await detached.auth.refreshSession({ refresh_token: pending.anonRefreshToken });
    if (error || !data.session) return;
    await invokeEdge(EDGE_FUNCTIONS.deleteAccount, {}, 60_000, detached, data.session.access_token);
  } catch {
    /* 사용자에게는 완료로 보인다 */
  }
}

type DeleteAccountResponse = { result?: 'deleted' | 'already_deleted' };

/**
 * 삭제하는 중 화면. 시작 때 기기에 "삭제 중"을 먼저 기록하고(도중에 꺼지면 다음 실행에 다시 부른다), 서버가
 * 연결 해제 → 사진 → 기록 → 사용자 순서로 지운다. 서버가 "사용자 없음"(already_deleted)이어도 완료로 본다.
 * 연결 해제(Apple 철회·카카오 해제)에 실패하면 아무것도 지우지 않는다(unlink_failed). 끝나면 기기 정리(설계 4 '계정 삭제' 열)까지 한다.
 * 도중에 꺼졌다 다시 부를 때는 reason·reasonText 를 null 로 넘겨도 처음 기록한 값을 쓴다.
 * 지우지 못했다는 답을 받으면 기록을 answered 로 바꾼다 — 사용자가 멈춘 뒤 getStartState 를 부르면(또는 다음 실행) 삭제 전 기록으로 되돌아간다.
 */
export async function deleteAccount(input: DeleteAccountInput): Promise<DeleteAccountResult> {
  const pick = await chosen('deleteAccount');
  if (pick) return pick.value;
  const record = await readRecord();
  const known = record === 'unreadable' ? null : record;
  const resumed = known?.status === 'deleting' ? known.deleting : null;
  const user = await readStoredUser();
  const rawProvider = (await supabase.auth.getSession()).data.session?.user.app_metadata?.provider;
  const account: 'anonymous' | 'apple' | 'kakao' =
    resumed?.account ??
    (typeof user === 'object' && user.isAnonymous === false
      ? rawProvider === 'kakao'
        ? 'kakao'
        : 'apple'
      : 'anonymous');
  const reason = input.reason ?? resumed?.reason ?? null;
  const reasonText = input.reasonText ?? resumed?.reasonText ?? null;
  const skipUnlink = input.skipUnlink ?? resumed?.skipUnlink ?? false;
  // 요청을 보내기 전에 '삭제 중'(sent)을 기록한다 — 답을 받기 전에 꺼지면 다음 실행에 이어서 부른다(accountLogic.deletionOnLaunch).
  const deletingRecord = newRecord('deleting', {
    userId: known?.userId ?? (typeof user === 'object' ? user.userId : null),
    appleUserId: known?.appleUserId ?? null,
    nickname: known?.nickname ?? null,
    deleting: { account, reason, reasonText, skipUnlink, stage: 'sent' },
  });
  await writeRecord(deletingRecord);
  let r: Awaited<ReturnType<typeof invokeEdge<DeleteAccountResponse>>>;
  try {
    r = await invokeEdge<DeleteAccountResponse>(
      EDGE_FUNCTIONS.deleteAccount,
      {
        ...(reason ? { reason } : {}),
        ...(reasonText ? { reasonText } : {}),
        ...(input.appleAuthorizationCode ? { appleAuthorizationCode: input.appleAuthorizationCode } : {}),
        ...(account === 'apple' ? { appleClientId: Application.applicationId } : {}),
        ...(skipUnlink ? { skipUnlink: true } : {}),
      },
      60_000,
    );
  } catch {
    await writeRecord(markDeletionAnswered(deletingRecord));
    return { kind: 'error', reason: 'server' };
  }
  if (!r.ok) {
    // 지우지 못했다는 답 — 사용자가 다시 시도·취소를 고른다. 멈추거나 꺼지면 다음 판정(getStartState)이 삭제 전 기록으로 되돌린다.
    await writeRecord(markDeletionAnswered(deletingRecord));
    if (r.kind === 'network') return { kind: 'error', reason: 'network' };
    return classifyDeleteFailure(r.code, r.body);
  }
  capture('account_deleted', { account, apple_revoked: account === 'apple' && !skipUnlink });
  await deleteLeftoverAnonymous(); // 합치지 못하고 남은 익명 위시도 함께 지운다(실패해도 완료로 본다)
  await clearDevice('delete_account');
  publishState({ kind: 'fresh' }); // 새 설치와 같은 흐름(온보딩 카드부터)
  return { kind: 'deleted' };
}

/**
 * _layout.tsx 가 첫 화면을 정할 때. 기기에 저장된 값(기기 상태 기록·세션 저장값)만 읽는다 — 통신하지 않고 새 계정도 만들지 않는다.
 * 세션 재발급은 기다리지 않는다(만료 토큰 + 나쁜 통신이면 auth-js 가 30초 안팎 재시도해 첫 화면이 멈춘다).
 * 읽지 못한 것은 unreadable — "세션 없음"이 아니다. 기록이 없는 1.1.0 사용자는 지금 세션을 보고 한 번 기록한다.
 */
export async function getStartState(): Promise<StartState> {
  const pick = await chosen('getStartState');
  if (pick) {
    publishState(pick.value);
    return pick.value;
  }
  const { state } = await resolveStartState();
  publishState(state);
  return state;
}

/**
 * 알림창 C [다시 시도]: 서버가 거절했다고 기록된 세션을 서버에 다시 확인한다(통신 — 저장된 access token 이 만료 전이어도 재발급으로). 살아 있으면 기기 상태를 되돌리고
 * (익명이면 anonymous, 로그인이면 signed_in) 알린다 → restored. 여전히 거절이면 기기 상태 그대로 → still_lost.
 * 앱 새로고침이 아니다(기기 상태가 그대로라 같은 창이 다시 뜬다). 같은 refreshToken 의 실패는 auth-js 가 60초 동안 저장해 둔다.
 */
export async function retryLostSession(): Promise<RetryLostSessionResult> {
  const pick = await chosen('retryLostSession');
  if (pick) {
    if (pick.value.kind === 'restored') publishState({ kind: 'anonymous' });
    return pick.value;
  }
  try {
    // getSession 은 access token 이 만료 전이면 서버에 묻지 않고 저장값을 돌려준다(거절된 세션도 restored 로 보임) → 재발급으로
    // 서버에 확인한다. 같은 refreshToken 이 60초 안에 실패했으면 auth-js 가 그 실패를 그대로 돌려준다(통신 없음):
    // 거절이었으면 still_lost(맞다 — 같은 토큰은 다시 받아 주지 않는다), 통신 실패였으면 error(잠시 뒤 다시 시도).
    const { data, error } = await supabase.auth.refreshSession();
    const user = data.session?.user;
    if (user) {
      const status = user.is_anonymous === false ? 'signed_in' : 'anonymous';
      await writeRecord(newRecord(status, { userId: user.id }));
      publishState({ kind: status });
      return { kind: 'restored' };
    }
    if (!error || isSessionRejected(error)) return { kind: 'still_lost' };
    return { kind: 'error', reason: authFailureReason(error) };
  } catch {
    return { kind: 'error', reason: 'network' };
  }
}

/** 기기 상태가 바뀔 때마다(로그인·로그아웃·거절·삭제) 알린다. 구독 해제 함수를 돌려준다. */
export function subscribeAccountState(listener: (state: StartState) => void): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

/** 전체 탭·공유 저장 뒤: 반시트를 띄울지(로그인 화면과 합쳐 통틀어 1회). 통신하지 않는다. */
export async function shouldShowSignInSheet(): Promise<boolean> {
  const pick = await chosen('shouldShowSignInSheet');
  if (pick) return pick.value;
  // 익명 세션을 쓰는 사람에게만(로그인 화면을 이미 봤거나 반시트를 한 번 보였으면 다시 띄우지 않는다).
  if (currentState?.kind !== 'anonymous') return false;
  return !(await readPromptUsed());
}

/** 반시트를 보였을 때(취소된 공유 저장에서는 부르지 않는다). 첫 실행 로그인 화면의 건너뛰기는 startWithoutSignIn 이 쓴다. */
export async function markSignInPromptUsed(): Promise<void> {
  if (await chosen('markSignInPromptUsed')) return;
  await writePromptUsed();
}

/**
 * 합치는 중 화면이 합치기를 마친 뒤: 새 계정 가입의 닉네임 화면이 아직 남았는지(합치기와 닉네임이 둘 다 해당하면 합치기 먼저,
 * 그다음 닉네임 — P-19). 기기 기록만 읽는다(통신 없음). 닉네임을 저장하면 saveNickname 이 기록을 지운다.
 */
export async function needsNicknameSignup(): Promise<boolean> {
  const pick = await chosen('needsNicknameSignup');
  if (pick) return pick.value;
  const record = await readRecord();
  return record !== 'unreadable' && record?.status === 'signed_in' && record.nicknameSignup;
}

/**
 * 개발용(__DEV__ 설정의 이메일 로그인): 이메일·비밀번호로 로그인한다. 성공하면 true — 기기 상태를 새 세션에 맞춘다.
 * 정상 흐름(Apple·카카오 로그인)에서는 부르지 않는다.
 */
export async function devSignInWithPassword(email: string, password: string): Promise<boolean> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return false;
  await getStartState();
  return true;
}

/**
 * 앱을 켠 동안 계정 상태를 지켜보는 일을 시작한다(_layout 이 한 번 켠다). 끄는 함수를 돌려준다.
 */
export function startAccountWatchers(): () => void {
  const stopRejection = watchSessionRejection();
  // 이 구독이 생기기 전에 이미 거절됐을 수 있으니(앱을 켜자마자 재발급이 거절됨) 한 번 확인한다. 세션이 멀쩡하면 아무 일도 없다.
  void handleSessionRejection();
  // 앱이 켜질 때마다, 다른 앱에서 돌아올 때(1분에 1번까지) 합치지 못한 위시를 다시 시도하고 Apple 연결 상태를 확인한다.
  void retryPendingMerge('launch');
  void checkAppleConnection();
  const appState = AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    void retryPendingMerge('foreground');
    void checkAppleConnection();
  });
  const stopRevoke = addAppleRevokeListener(() => void markAppleRevoked());
  return () => {
    stopRejection();
    appState.remove();
    stopRevoke();
  };
}

async function retryPendingMerge(trigger: MergeTrigger): Promise<void> {
  try {
    const result = await runMerge(trigger);
    if (result?.kind === 'done' && result.count > 0) {
      showSnackbar({ text: `위시 ${result.count}개를 합쳤습니다` });
    }
  } catch {
    /* 실패는 기록이 남아 다음에 다시 시도한다 */
  }
}

/** 앱이 켜질 때·돌아올 때: Apple 로 로그인한 계정의 연결이 iPhone 설정에서 끊겼는지 본다. */
async function checkAppleConnection(): Promise<void> {
  const record = await readRecord();
  if (record === 'unreadable' || record?.status !== 'signed_in' || !record.appleUserId) return;
  if ((await getAppleCredentialState(record.appleUserId)) === 'revoked') await markAppleRevoked();
}

/** Apple 연결이 끊김 → 로그아웃 상태로만 바꾸고 데이터는 둔다. 같은 Apple ID 로 다시 로그인하면 같은 계정이다. */
async function markAppleRevoked(): Promise<void> {
  const record = await readRecord();
  if (record === 'unreadable' || record?.status !== 'signed_in' || !record.appleUserId) return;
  await writeRecord(newRecord('signed_out', { userId: record.userId, appleUserId: record.appleUserId, nickname: record.nickname }));
  capture('apple_credential_revoked', {});
  publishState({ kind: 'signed_out', lastProvider: 'apple' });
}
