import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  AccountInfo,
  AppleConfirmResult,
  DeleteAccountResult,
  MergeResult,
  NicknameCheckResult,
  SaveNicknameResult,
  SignInResult,
  StartState,
  StartWithoutSignInResult,
} from '@/lib/queries/account';

// 개발용(__DEV__) 계정 결과 흉내: src/lib/queries/account.ts 의 함수마다 돌려줄 결과를 골라 화면의 모든 상태를 본다.
// 가짜 DB 는 없다 — 함수가 돌려주는 결과만 바꾼다. 고른 값은 기기에 저장돼 앱을 다시 켜도 남는다(첫 화면 확인용).
// 고르는 버튼은 설정 화면의 __DEV__ 영역에 둔다. 진짜 구현 뒤에도 개발 도구로 남긴다.

export type AccountSimulationMap = {
  signIn: SignInResult;
  startWithoutSignIn: StartWithoutSignInResult;
  mergeAnonymousWishes: MergeResult;
  getAccount: AccountInfo;
  checkNickname: NicknameCheckResult;
  saveNickname: SaveNicknameResult;
  signOutAccount: null;
  confirmAppleForDeletion: AppleConfirmResult;
  deleteAccount: DeleteAccountResult;
  getStartState: StartState;
  shouldShowSignInSheet: boolean;
  markSignInPromptUsed: null;
};

export type SimulatedFunction = keyof AccountSimulationMap;

/** 함수마다 고를 수 있는 결과. 첫 값이 기본이다. 화면은 여기 있는 결과를 모두 처리해야 한다. */
export const ACCOUNT_SIMULATION_CHOICES: { readonly [K in SimulatedFunction]: readonly AccountSimulationMap[K][] } = {
  signIn: [
    { kind: 'success', next: 'done' },
    { kind: 'success', next: 'nickname' },
    { kind: 'success', next: 'merge' },
    { kind: 'cancelled' },
    { kind: 'other_provider', provider: 'apple' },
    { kind: 'other_provider', provider: 'kakao' },
    { kind: 'error', reason: 'network' },
    { kind: 'error', reason: 'server' },
  ],
  startWithoutSignIn: [{ kind: 'success' }, { kind: 'error', reason: 'network' }],
  mergeAnonymousWishes: [
    { kind: 'done', count: 12 },
    { kind: 'failed', reason: 'network' },
    { kind: 'failed', reason: 'server' },
    { kind: 'failed', reason: 'anon_session_lost' },
    { kind: 'failed', reason: 'signed_in_elsewhere' },
  ],
  getAccount: [
    { kind: 'signed_in', provider: 'apple', email: 'abc123@privaterelay.appleid.com', nickname: '위시러1234', pendingMerge: null },
    { kind: 'signed_in', provider: 'kakao', email: 'wish@example.com', nickname: '위시러5678', pendingMerge: null },
    {
      kind: 'signed_in',
      provider: 'kakao',
      email: 'wish@example.com',
      nickname: '위시러5678',
      pendingMerge: { count: 12, inquiryOnly: false },
    },
    {
      kind: 'signed_in',
      provider: 'apple',
      email: null,
      nickname: '위시러1234',
      pendingMerge: { count: 12, inquiryOnly: true },
    },
    { kind: 'anonymous' },
  ],
  checkNickname: [
    { kind: 'available' },
    { kind: 'taken', suggestions: ['민지27', '민지815'] },
    { kind: 'invalid_length' },
    { kind: 'invalid_chars' },
    { kind: 'reserved' },
    { kind: 'unchanged' },
    { kind: 'error', reason: 'network' },
  ],
  saveNickname: [
    { kind: 'saved', nickname: '민지' },
    { kind: 'taken', suggestions: ['민지27', '민지815'] },
    { kind: 'invalid_length' },
    { kind: 'invalid_chars' },
    { kind: 'reserved' },
    { kind: 'error', reason: 'network' },
  ],
  signOutAccount: [null],
  confirmAppleForDeletion: [{ kind: 'confirmed', authorizationCode: 'dev-code' }, { kind: 'cancelled' }, { kind: 'failed' }],
  deleteAccount: [
    { kind: 'deleted' },
    { kind: 'apple_revoke_failed' },
    { kind: 'error', reason: 'network' },
    { kind: 'error', reason: 'server' },
  ],
  getStartState: [
    { kind: 'anonymous' },
    { kind: 'fresh' },
    { kind: 'signed_out', lastProvider: 'apple' },
    { kind: 'signed_out', lastProvider: 'kakao' },
    { kind: 'signed_in' },
    { kind: 'session_lost', previousUserId: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90' },
    { kind: 'deleting' },
    { kind: 'unreadable' },
  ],
  shouldShowSignInSheet: [false, true],
  markSignInPromptUsed: [null],
};

export const ACCOUNT_SIMULATION_KEY = 'wishshot.dev.accountSimulation';

/** 로딩 화면(합치는 중·삭제하는 중 등)을 볼 수 있게 기다리는 시간. */
const DEFAULT_DELAY_MS = 800;

type Chosen = { [K in SimulatedFunction]?: AccountSimulationMap[K] };

let chosen: Chosen = {};
const startStateListeners = new Set<(state: StartState) => void>();

// 앱 시작 때 1회: 저장해 둔 선택을 꺼낸다.
const loaded: Promise<void> = __DEV__
  ? AsyncStorage.getItem(ACCOUNT_SIMULATION_KEY)
      .then((raw) => {
        if (raw) chosen = JSON.parse(raw) as Chosen;
      })
      .catch(() => {})
  : Promise.resolve();

function current<K extends SimulatedFunction>(fn: K): AccountSimulationMap[K] {
  const value = chosen[fn];
  return value === undefined ? ACCOUNT_SIMULATION_CHOICES[fn][0] : (value as AccountSimulationMap[K]);
}

/** 고른 결과(고르지 않았으면 기본값)를 잠시 기다린 뒤 돌려준다. */
export async function simulate<K extends SimulatedFunction>(
  fn: K,
  delayMs: number = DEFAULT_DELAY_MS,
): Promise<AccountSimulationMap[K]> {
  await loaded;
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  return current(fn);
}

/** 이 함수의 결과를 개발자가 골랐는지. 진짜 구현은 `__DEV__ && isSimulated(fn)` 이면 흉내 결과를 돌려준다. */
export async function isSimulated(fn: SimulatedFunction): Promise<boolean> {
  await loaded;
  return chosen[fn] !== undefined;
}

/** 설정의 개발용 버튼: 지금 고른 결과. */
export async function getSimulatedChoice<K extends SimulatedFunction>(fn: K): Promise<AccountSimulationMap[K]> {
  await loaded;
  return current(fn);
}

/** 설정의 개발용 버튼: 결과를 고른다. null 을 주면 고른 것을 지운다(기본값·진짜 구현으로). */
export async function setSimulatedChoice<K extends SimulatedFunction>(
  fn: K,
  value: AccountSimulationMap[K] | null,
): Promise<void> {
  await loaded;
  const next: Chosen = { ...chosen };
  if (value === null) delete next[fn];
  else next[fn] = value;
  chosen = next;
  await AsyncStorage.setItem(ACCOUNT_SIMULATION_KEY, JSON.stringify(next));
  if (fn === 'getStartState') {
    const state = current('getStartState');
    startStateListeners.forEach((listener) => listener(state));
  }
}

/** 흉내 낸 기기 상태가 바뀌면 알린다. */
export function subscribeSimulatedStartState(listener: (state: StartState) => void): () => void {
  startStateListeners.add(listener);
  return () => {
    startStateListeners.delete(listener);
  };
}
