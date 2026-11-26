// 계정 판단 규칙(src/lib/accountLogic.ts — import 없는 순수 TS) 시험. 통신·저장소·키 없음.
// 실행: deno test --no-lock supabase/tests/account_logic_test.ts
import {
  ACCOUNT_STATE_KEY,
  canOpenShare,
  canStartWithoutSignIn,
  classifyAuthFailure,
  classifyDeleteFailure,
  createShareHold,
  decideMerge,
  decideRejection,
  decideStartState,
  deletionOnLaunch,
  isAnonInvalidCode,
  keysToRemove,
  LAST_PROVIDER_KEY,
  markDeletionAnswered,
  MERGE_FOREGROUND_INTERVAL_MS,
  newRecord,
  nicknameProblem,
  parseAccountRecord,
  parseEnsureProfile,
  parseNicknameStatus,
  parsePendingMerge,
  parseStoredUser,
  PENDING_MERGE_KEY,
  previousUserIdForStart,
  PROMPT_USED_KEY,
  revertDeletion,
  runMergeAttempt,
  skipCountsAsPrompt,
  type DeletingInfo,
  type MergeAttemptDeps,
  type PendingMerge,
  type StartInputs,
} from '../../src/lib/accountLogic.ts';

function eq(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}

const ANON = '11111111-aaaa-4aaa-8aaa-111111111111';
const USER = '22222222-bbbb-4bbb-8bbb-222222222222';

const base: StartInputs = {
  record: null,
  session: 'none',
  lastProvider: null,
  hasWishTrace: false,
  copyUserId: null,
};
const decide = (patch: Partial<StartInputs>) => decideStartState({ ...base, ...patch });

// ── getStartState: 결과 7가지 ────────────────────────────────

Deno.test('첫 화면: 새 설치(기록·세션·흔적 없음) = fresh, 기록하지 않는다', () => {
  const d = decide({});
  eq(d.state, { kind: 'fresh' });
  eq(d.write, null);
});

Deno.test('첫 화면: 로그아웃 = signed_out + 최근 로그인', () => {
  const d = decide({ record: newRecord('signed_out', { userId: USER }), lastProvider: 'kakao' });
  eq(d.state, { kind: 'signed_out', lastProvider: 'kakao' });
  eq(d.write, null);
});

Deno.test('첫 화면: 로그인 세션이 없어졌으면(만료) signed_out 으로 바꿔 기록한다', () => {
  const d = decide({ record: newRecord('signed_in', { userId: USER, appleUserId: 'apple.1' }), lastProvider: 'apple' });
  eq(d.state, { kind: 'signed_out', lastProvider: 'apple' });
  eq(d.write?.status, 'signed_out');
  eq(d.write?.userId, USER);
  eq(d.write?.appleUserId, 'apple.1');
});

Deno.test('첫 화면: 익명 세션 = anonymous', () => {
  const d = decide({
    record: newRecord('anonymous', { userId: ANON }),
    session: { userId: ANON, isAnonymous: true },
  });
  eq(d.state, { kind: 'anonymous' });
  eq(d.write, null);
});

Deno.test('첫 화면: 로그인 세션 = signed_in', () => {
  const d = decide({
    record: newRecord('signed_in', { userId: USER }),
    session: { userId: USER, isAnonymous: false },
  });
  eq(d.state, { kind: 'signed_in' });
  eq(d.write, null);
});

Deno.test('첫 화면: 서버 거절 기록 + 그 계정의 세션이 남아 있음 = session_lost(이전 번호)', () => {
  const d = decide({
    record: newRecord('rejected', { userId: ANON }),
    session: { userId: ANON, isAnonymous: true },
    hasWishTrace: true,
  });
  eq(d.state, { kind: 'session_lost', previousUserId: ANON });
  eq(d.write, null);
});

Deno.test('첫 화면: 서버 거절 기록 + 세션이 다른 계정(그 뒤 새로 시작) = 세션이 사실', () => {
  const d = decide({
    record: newRecord('rejected', { userId: ANON }),
    session: { userId: USER, isAnonymous: true },
  });
  eq(d.state, { kind: 'anonymous' });
  eq(d.write?.status, 'anonymous');
  eq(d.write?.userId, USER);
});

const deletingRecord = (account: DeletingInfo['account'], stage: DeletingInfo['stage'], userId = USER) =>
  newRecord('deleting', {
    userId,
    appleUserId: account === 'apple' ? 'apple-sub' : null,
    nickname: account === 'anonymous' ? null : '민지',
    deleting: { account, reason: 'privacy', reasonText: null, skipUnlink: false, stage },
  });

Deno.test('첫 화면: 계정 삭제 요청을 보낸 뒤 답을 받기 전에 꺼짐(sent) = deleting(세션이 있어도) — 이어서 부른다', () => {
  const rec = deletingRecord('apple', 'sent', ANON);
  eq(decide({ record: rec }).state, { kind: 'deleting' });
  eq(decide({ record: rec, session: { userId: ANON, isAnonymous: false } }).state, { kind: 'deleting' });
  eq(decide({ record: rec }).write, null);
});

Deno.test('삭제 취소 되돌리기: 서버가 지우지 못했다고 답한 뒤(answered) 첫 화면은 deleting 이 아니고 삭제 전 계정으로 되돌린다', () => {
  // 로그인 계정(Apple): 재인증 취소·연결 해제 실패 창에서 멈춘 뒤 꺼짐 → 확인 없이 삭제를 다시 부르지 않는다.
  const apple = decide({ record: deletingRecord('apple', 'answered'), session: { userId: USER, isAnonymous: false } });
  eq(apple.state, { kind: 'signed_in' });
  eq(apple.write, newRecord('signed_in', { userId: USER, appleUserId: 'apple-sub', nickname: '민지' }));
  // 카카오도 같다.
  const kakao = decide({ record: deletingRecord('kakao', 'answered'), session: { userId: USER, isAnonymous: false } });
  eq(kakao.state, { kind: 'signed_in' });
  eq(kakao.write?.status, 'signed_in');
  // 익명 계정: '삭제하지 못했습니다' [취소] 뒤 → 익명으로.
  const anon = decide({ record: deletingRecord('anonymous', 'answered', ANON), session: { userId: ANON, isAnonymous: true } });
  eq(anon.state, { kind: 'anonymous' });
  eq(anon.write, newRecord('anonymous', { userId: ANON }));
});

Deno.test('삭제 취소 되돌리기: 되돌린 기록에 세션이 없으면 그 기록으로 다시 판정한다(로그인이었으면 로그아웃 화면)', () => {
  const d = decide({ record: deletingRecord('apple', 'answered'), lastProvider: 'apple' });
  eq(d.state, { kind: 'signed_out', lastProvider: 'apple' });
  eq(d.write?.status, 'signed_out');
});

Deno.test('삭제 취소 되돌리기: deletionOnLaunch — sent 는 resume, answered 는 revert, 단계가 없는 옛 기록은 resume', () => {
  eq(deletionOnLaunch(deletingRecord('apple', 'sent')), 'resume');
  eq(deletionOnLaunch(deletingRecord('kakao', 'answered')), 'revert');
  const legacy = parseAccountRecord(JSON.stringify({ v: 1, status: 'deleting', userId: USER, deleting: { account: 'kakao' } }));
  eq(legacy?.deleting?.stage, 'sent');
  eq(deletionOnLaunch(legacy!), 'resume');
});

Deno.test('삭제 취소 되돌리기: markDeletionAnswered 는 단계만 바꾸고 사유는 남긴다(다시 시도 때 쓴다), 삭제 중이 아니면 그대로', () => {
  const answered = markDeletionAnswered(deletingRecord('apple', 'sent'));
  eq(answered.deleting, { account: 'apple', reason: 'privacy', reasonText: null, skipUnlink: false, stage: 'answered' });
  eq(answered.status, 'deleting');
  const signedIn = newRecord('signed_in', { userId: USER });
  eq(markDeletionAnswered(signedIn), signedIn);
  // 저장했다 읽어도 단계가 남는다.
  eq(parseAccountRecord(JSON.stringify(answered))?.deleting?.stage, 'answered');
});

Deno.test('삭제 취소 되돌리기: revertDeletion — 계정 종류로 익명·로그인 기록, 삭제 중이 아니면 그대로', () => {
  eq(revertDeletion(deletingRecord('anonymous', 'answered', ANON)).status, 'anonymous');
  eq(revertDeletion(deletingRecord('kakao', 'sent')).status, 'signed_in');
  eq(revertDeletion(deletingRecord('kakao', 'sent')).deleting, null);
  const anon = newRecord('anonymous', { userId: ANON });
  eq(revertDeletion(anon), anon);
});

Deno.test('첫 화면: 읽지 못함 = unreadable("세션 없음"이 아니다)', () => {
  eq(decide({ record: 'unreadable' }).state, { kind: 'unreadable' });
  eq(decide({ session: 'unreadable' }).state, { kind: 'unreadable' });
  eq(decide({ record: 'unreadable', session: 'unreadable', hasWishTrace: false }).write, null);
});

// ── 1.1.0 사용자 첫 기록 ─────────────────────────────────────

Deno.test('1.1.0 에서 올라온 사용자: 기록 없음 + 익명 세션 → anonymous 로 한 번 기록', () => {
  const d = decide({ record: null, session: { userId: ANON, isAnonymous: true }, hasWishTrace: true });
  eq(d.state, { kind: 'anonymous' });
  eq(d.write?.status, 'anonymous');
  eq(d.write?.userId, ANON);
});

Deno.test('1.1.0 에서 올라온 사용자: 사본으로 만든 세션(익명 여부 모름)도 anonymous', () => {
  const d = decide({ record: null, session: { userId: ANON, isAnonymous: null } });
  eq(d.state, { kind: 'anonymous' });
  eq(d.write?.userId, ANON);
});

Deno.test('1.1.0 에서 올라온 사용자: 기록 없음 + 세션 없음 + 위시 흔적 = 끊긴 세션(알림창 C), 기록', () => {
  const d = decide({ record: null, session: 'none', hasWishTrace: true, copyUserId: ANON });
  eq(d.state, { kind: 'session_lost', previousUserId: ANON });
  eq(d.write?.status, 'rejected');
  eq(d.write?.userId, ANON);
});

Deno.test('세션이 깨졌어도(corrupt) 없는 것과 같게 본다', () => {
  eq(decide({ session: 'corrupt' }).state, { kind: 'fresh' });
  eq(decide({ record: newRecord('anonymous', { userId: ANON }), session: 'corrupt', hasWishTrace: true }).state, {
    kind: 'session_lost',
    previousUserId: ANON,
  });
});

// ── 흔적 없는 거절 ──────────────────────────────────────────

Deno.test('위시 흔적 없는 익명 세션 소실 = fresh(알림창 C 없음), 이전 번호는 기록에 남긴다', () => {
  const d = decide({ record: newRecord('anonymous', { userId: ANON }), session: 'none', hasWishTrace: false });
  eq(d.state, { kind: 'fresh' });
  eq(d.write?.status, 'fresh');
  eq(d.write?.previousUserId, ANON);
  eq(previousUserIdForStart(d.write), ANON);
});

Deno.test('위시 흔적 있는 익명 세션 소실 = session_lost, rejected 로 기록', () => {
  const d = decide({ record: newRecord('anonymous', { userId: ANON }), session: 'none', hasWishTrace: true });
  eq(d.state, { kind: 'session_lost', previousUserId: ANON });
  eq(d.write?.status, 'rejected');
});

Deno.test('실행 중 거절: 익명(흔적 있음) = session_lost, (흔적 없음) = fresh, 로그인 = signed_out, 그 밖은 무시', () => {
  const anon = newRecord('anonymous', { userId: ANON });
  eq(decideRejection(anon, true, null)?.state, { kind: 'session_lost', previousUserId: ANON });
  eq(decideRejection(anon, true, null)?.write?.status, 'rejected');
  eq(decideRejection(anon, false, null)?.state, { kind: 'fresh' });
  eq(decideRejection(anon, false, null)?.write?.previousUserId, ANON);
  eq(decideRejection(newRecord('signed_in', { userId: USER }), true, 'apple')?.state, { kind: 'signed_out', lastProvider: 'apple' });
  eq(decideRejection(newRecord('signed_out'), true, null), null);
  eq(decideRejection(newRecord('deleting'), true, null), null);
  eq(decideRejection(null, true, null), null);
});

Deno.test('previous_user_id: 끊긴 세션(D)·흔적 없는 거절만 남기고 A·B 는 남기지 않는다', () => {
  eq(previousUserIdForStart(newRecord('rejected', { userId: ANON })), ANON);
  eq(previousUserIdForStart(newRecord('fresh', { previousUserId: ANON })), ANON);
  eq(previousUserIdForStart(newRecord('fresh')), null);
  eq(previousUserIdForStart(newRecord('signed_out', { userId: USER })), null);
  eq(previousUserIdForStart(null), null);
});

Deno.test('기록 해석: 깨진 값·모르는 상태는 null, 닫힌 필드는 보존', () => {
  eq(parseAccountRecord(null), null);
  eq(parseAccountRecord('{'), null);
  eq(parseAccountRecord(JSON.stringify({ status: 'weird' })), null);
  const rec = newRecord('signed_in', { userId: USER, appleUserId: 'a.1', nickname: '위시러1234' });
  eq(parseAccountRecord(JSON.stringify(rec)), rec);
  eq(parseStoredUser(JSON.stringify({ access_token: 'x', user: { id: ANON, is_anonymous: true } })), { userId: ANON, isAnonymous: true });
  eq(parseStoredUser(JSON.stringify({ user: { id: ANON } })), { userId: ANON, isAnonymous: null });
  eq(parseStoredUser('x'), null);
});

// ── 기기 정리: 설계 4 표와 키 단위로 대조 ─────────────────────

// 설계 4 표를 그대로 옮긴 기대값(구현과 따로 적는다). 'sign_out' 열 / 'delete' 열: true = 지움.
const TABLE: { key: string; signOut: boolean; deleteAccount: boolean }[] = [
  { key: ACCOUNT_STATE_KEY, signOut: false, deleteAccount: true }, // 로그아웃: 지우지 않고 "로그아웃"으로 바꿈
  { key: LAST_PROVIDER_KEY, signOut: false, deleteAccount: true },
  { key: PROMPT_USED_KEY, signOut: false, deleteAccount: true },
  { key: PENDING_MERGE_KEY, signOut: false, deleteAccount: true },
  { key: 'wishshot.sessionCopy', signOut: true, deleteAccount: true },
  { key: 'wishshot.sessionArchive', signOut: false, deleteAccount: true },
  { key: 'wishshot.onboardingShown', signOut: false, deleteAccount: true },
  { key: 'wishshot.privacyNoticeShown.v2', signOut: false, deleteAccount: true },
  { key: 'wishshot.regionNoticeShown', signOut: false, deleteAccount: true },
  { key: 'wishshot.notifications', signOut: true, deleteAccount: true },
  { key: 'wishshot.signedurl.abc/def.jpg', signOut: true, deleteAccount: true },
  { key: 'sb-abcd-auth-token', signOut: true, deleteAccount: true },
  { key: 'sb-abcd-auth-token-code-verifier', signOut: true, deleteAccount: true },
];
// 지우면 안 되는 것: 다른 라이브러리 값, 개발용 도구 값.
const FOREIGN = ['posthog_abc_distinct_id', '@react-native-async-storage/x', 'wishshotNotes', 'wishshot.dev.accountSimulation', 'wishshot.dev.sessionSimulation'];

Deno.test('기기 정리: 로그아웃 열이 설계 4 표와 키 단위로 같다', () => {
  const all = [...TABLE.map((r) => r.key), ...FOREIGN];
  eq(keysToRemove(all, 'sign_out').sort(), TABLE.filter((r) => r.signOut).map((r) => r.key).sort());
});

Deno.test('기기 정리: 계정 삭제 열이 설계 4 표와 키 단위로 같다(다른 값·개발 도구 값은 남김)', () => {
  const all = [...TABLE.map((r) => r.key), ...FOREIGN];
  eq(keysToRemove(all, 'delete_account').sort(), TABLE.filter((r) => r.deleteAccount).map((r) => r.key).sort());
});

// ── 합치기 재시도 ────────────────────────────────────────────

const pending = (patch: Partial<PendingMerge> = {}): PendingMerge => ({
  v: 1,
  anonUserId: ANON,
  anonRefreshToken: 'rt-old',
  targetUserId: USER,
  count: 12,
  attempts: 0,
  anonLost: false,
  ...patch,
});

Deno.test('합치기 재시도: 앱이 켜질 때마다 시도, 돌아올 때는 1분에 1번', () => {
  const t0 = 1_000_000;
  const input = { pending: pending(), currentUserId: USER, now: t0, lastAttemptAt: null };
  eq(decideMerge({ ...input, trigger: 'launch' }), 'attempt');
  eq(decideMerge({ ...input, trigger: 'launch', lastAttemptAt: t0 - 1 }), 'attempt');
  eq(decideMerge({ ...input, trigger: 'foreground' }), 'attempt');
  eq(decideMerge({ ...input, trigger: 'foreground', lastAttemptAt: t0 - (MERGE_FOREGROUND_INTERVAL_MS - 1) }), 'throttled');
  eq(decideMerge({ ...input, trigger: 'foreground', lastAttemptAt: t0 - MERGE_FOREGROUND_INTERVAL_MS }), 'attempt');
  eq(decideMerge({ ...input, trigger: 'manual', lastAttemptAt: t0 - 1 }), 'attempt'); // 설정 "다시 시도"는 늘
});

Deno.test('합치기 재시도: 대상 계정으로 로그인해 있을 때만', () => {
  const input = { trigger: 'launch' as const, now: 1, lastAttemptAt: null };
  eq(decideMerge({ ...input, pending: null, currentUserId: USER }), 'none');
  eq(decideMerge({ ...input, pending: pending(), currentUserId: 'other-user' }), 'other_account');
  eq(decideMerge({ ...input, pending: pending(), currentUserId: null }), 'other_account');
  eq(decideMerge({ ...input, pending: pending({ targetUserId: null }), currentUserId: USER }), 'other_account');
  eq(decideMerge({ ...input, pending: pending(), currentUserId: ANON }), 'stale'); // 로그인이 끝나지 않음
});

function mergeDeps(log: string[], over: Partial<MergeAttemptDeps> = {}): MergeAttemptDeps {
  return {
    async refreshAnon(rt) {
      log.push(`refresh:${rt}`);
      return { ok: true, accessToken: 'at-new', refreshToken: 'rt-new' };
    },
    async savePending(next) {
      log.push(`save:${next.anonRefreshToken}#${next.attempts}`);
    },
    async callMerge(at) {
      log.push(`merge:${at}`);
      return { ok: true, status: 'done', merged: 12, remaining: 0 };
    },
    ...over,
  };
}

Deno.test('합치기 재시도: 새로 받은 refreshToken 을 합치기 호출보다 먼저 저장한다', async () => {
  const log: string[] = [];
  const r = await runMergeAttempt(pending(), mergeDeps(log));
  eq(r, { kind: 'done', count: 12 });
  eq(log, ['refresh:rt-old', 'save:rt-new#1', 'merge:at-new']);
});

Deno.test('합치기 재시도: partial 이면 done 까지 이어 부르고 개수를 더한다', async () => {
  const log: string[] = [];
  let n = 0;
  const r = await runMergeAttempt(
    pending(),
    mergeDeps(log, {
      async callMerge() {
        n++;
        return n < 3 ? { ok: true, status: 'partial', merged: 5, remaining: 20 } : { ok: true, status: 'done', merged: 2, remaining: 0 };
      },
    }),
  );
  eq(r, { kind: 'done', count: 12 });
  eq(n, 3);
});

Deno.test('합치기 재시도: 진전 없는 partial 은 멈춘다', async () => {
  const r = await runMergeAttempt(
    pending(),
    mergeDeps([], { async callMerge() { return { ok: true, status: 'partial', merged: 0, remaining: 3 }; } }),
  );
  eq(r.kind, 'failed');
});

Deno.test('합치기 재시도: 실패 종류 — 익명 세션 거절·통신·서버', async () => {
  const lost = await runMergeAttempt(pending(), mergeDeps([], { async refreshAnon() { return { ok: false, reason: 'rejected' }; } }));
  eq(lost.kind === 'failed' && lost.reason, 'anon_session_lost');
  const net = await runMergeAttempt(pending(), mergeDeps([], { async refreshAnon() { return { ok: false, reason: 'network' }; } }));
  eq(net.kind === 'failed' && net.reason, 'network');
  const log: string[] = [];
  const bad = await runMergeAttempt(pending(), mergeDeps(log, { async callMerge() { return { ok: false, reason: 'anon_invalid' }; } }));
  eq(bad.kind === 'failed' && bad.reason, 'anon_session_lost');
  eq(log, ['refresh:rt-old', 'save:rt-new#1']); // 실패해도 새 토큰은 이미 저장됨
  const srv = await runMergeAttempt(pending(), mergeDeps([], { async callMerge() { return { ok: false, reason: 'server' }; } }));
  eq(srv.kind === 'failed' && srv.reason, 'server');
});

Deno.test('합칠 것 남음 기록 해석', () => {
  eq(parsePendingMerge(null), null);
  eq(parsePendingMerge('{'), null);
  eq(parsePendingMerge(JSON.stringify(pending())), pending());
  eq(parsePendingMerge(JSON.stringify({ anonUserId: ANON, anonRefreshToken: 'x' }))?.targetUserId, null);
});

// ── 로그인 중 공유 맡아 두기 ────────────────────────────────

Deno.test('로그인 중 공유: 마지막 1개만 맡고, 꺼내면 비운다', () => {
  const hold = createShareHold<{ kind: string; id: number }>();
  eq(hold.take(), null);
  hold.hold({ kind: 'image', id: 1 });
  hold.hold({ kind: 'url', id: 2 });
  eq(hold.peek(), { kind: 'url', id: 2 });
  eq(hold.take(), { kind: 'url', id: 2 });
  eq(hold.take(), null);
});

Deno.test('로그인 중 공유: 앱 화면이 있는 상태에서만 연다(로그인 화면·읽는 중·삭제 중엔 맡아 둔다)', () => {
  eq(canOpenShare({ kind: 'anonymous' }), true);
  eq(canOpenShare({ kind: 'signed_in' }), true);
  for (const state of [
    { kind: 'fresh' },
    { kind: 'signed_out', lastProvider: null },
    { kind: 'session_lost', previousUserId: null },
    { kind: 'deleting' },
    { kind: 'unreadable' },
  ] as const) {
    eq(canOpenShare(state), false, state.kind);
  }
  eq(canOpenShare(null), false);
});


// ── 서버 응답 읽기(서버 함수 배포 전이라 흉내 낸 응답으로 시험) ──

Deno.test('서버 응답: ensure_profile — 객체·한 줄 배열·모르는 모양', () => {
  eq(parseEnsureProfile({ nickname: '위시러1234', created: true }), { nickname: '위시러1234', created: true });
  eq(parseEnsureProfile([{ nickname: '민지', created: false }]), { nickname: '민지', created: false });
  eq(parseEnsureProfile({ nickname: '민지' }), { nickname: '민지', created: false });
  eq(parseEnsureProfile(null), null);
  eq(parseEnsureProfile('x'), null);
  eq(parseEnsureProfile({ created: true }), null);
});

Deno.test('서버 응답: 닉네임 검사 결과 6가지가 앱 결과로 대응한다', () => {
  const shapes = (status: string, suggestions?: string[]) => [status, { status, suggestions }, { result: status, suggestions }, [{ code: status, suggestions }]];
  for (const data of shapes('taken', ['민지27', '민지815', '민지999']).slice(1)) {
    // (문자열만 오면 추천 없음)
    eq(nicknameProblem(parseNicknameStatus(data)!), { kind: 'taken', suggestions: ['민지27', '민지815'] }, '추천은 2개까지');
  }
  for (const status of ['invalid_length', 'invalid_chars', 'reserved'] as const) {
    for (const data of shapes(status)) eq(nicknameProblem(parseNicknameStatus(data)!), { kind: status });
  }
  // 문제가 아닌 결과(사용 가능·그대로·저장됨)는 호출한 함수가 처리한다
  for (const status of ['available', 'unchanged', 'saved']) eq(nicknameProblem(parseNicknameStatus(status)!), null);
  eq(parseNicknameStatus(42), null);
  eq(parseNicknameStatus({}), null);
});

Deno.test('서버 응답: 합치기 익명 토큰 오류 코드와 삭제 실패 분류', () => {
  eq(isAnonInvalidCode('invalid_anon_token'), true);
  eq(isAnonInvalidCode('invalid_target_token'), false);
  eq(isAnonInvalidCode('not_anonymous'), true);
  eq(isAnonInvalidCode('same_user'), false);
  eq(isAnonInvalidCode(null), false);
  eq(classifyDeleteFailure('unlink_failed', { error: 'unlink_failed', provider: 'kakao' }), { kind: 'unlink_failed', provider: 'kakao' });
  eq(classifyDeleteFailure('unlink_failed', { provider: 'apple' }), { kind: 'unlink_failed', provider: 'apple' });
  eq(classifyDeleteFailure('apple_code_required'), { kind: 'apple_code_required' });
  eq(classifyDeleteFailure('server_error'), { kind: 'error', reason: 'server' });
  eq(classifyDeleteFailure(null), { kind: 'error', reason: 'server' });
});

Deno.test('서버 응답: 인증 오류를 통신 실패와 서버 오류로 나눈다', () => {
  eq(classifyAuthFailure({ name: 'AuthRetryableFetchError', message: 'Network request failed' }), 'network');
  eq(classifyAuthFailure({ name: 'AuthApiError', message: 'Invalid token' }), 'server');
  eq(classifyAuthFailure(null), 'server');
});

Deno.test('로그인 없이 시작: 창 C [다시 시도]로 되살아난 세션(기록 익명·로그인 + 같은 계정 세션)은 새 계정으로 덮지 않는다', () => {
  // 되살아남: retryLostSession 이 기록을 익명으로 되돌렸고 그 세션이 기기에 있다 → 하지 않는다.
  eq(canStartWithoutSignIn(newRecord('anonymous', { userId: ANON }), { userId: ANON, isAnonymous: true }), false);
  eq(canStartWithoutSignIn(newRecord('signed_in', { userId: USER }), { userId: USER, isAnonymous: false }), false);
  // 거절·로그아웃·새 설치·흔적 없는 거절: 해도 된다(거절된 세션은 보관한 뒤 새로 시작 — 확인창 D).
  eq(canStartWithoutSignIn(newRecord('rejected', { userId: ANON }), { userId: ANON, isAnonymous: true }), true);
  eq(canStartWithoutSignIn(newRecord('signed_out', { userId: USER }), { userId: USER, isAnonymous: false }), true);
  eq(canStartWithoutSignIn(newRecord('fresh', { previousUserId: ANON }), null), true);
  eq(canStartWithoutSignIn(null, null), true);
  // 기록과 다른 계정의 세션이거나 세션이 없으면 덮을 것이 없다.
  eq(canStartWithoutSignIn(newRecord('anonymous', { userId: ANON }), null), true);
  eq(canStartWithoutSignIn(newRecord('anonymous', { userId: ANON }), { userId: USER, isAnonymous: true }), true);
});

Deno.test('1회 표시(P-06): 첫 실행 로그인 화면의 건너뛰기만 센다 — 로그아웃·거절 뒤 로그인 화면은 세지 않는다', () => {
  eq(skipCountsAsPrompt({ kind: 'fresh' }, null), true); // 새 설치·계정 삭제 뒤(기록 없음)
  eq(skipCountsAsPrompt({ kind: 'fresh' }, newRecord('fresh')), true);
  eq(skipCountsAsPrompt({ kind: 'fresh' }, newRecord('fresh', { previousUserId: ANON })), false); // 흔적 없는 거절
  eq(skipCountsAsPrompt({ kind: 'signed_out', lastProvider: 'apple' }, newRecord('signed_out', { userId: USER })), false);
  eq(skipCountsAsPrompt({ kind: 'session_lost', previousUserId: ANON }, newRecord('rejected', { userId: ANON })), false);
  eq(skipCountsAsPrompt(null, null), false);
});
