import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEV_SIMULATION_KEY,
  startDevSimulation,
  type DevSimulationMode,
} from '@/lib/devSessionSimulation';
import { runSessionBootstrap, runStartOver, type BootResult } from '@/lib/sessionVault';
import { sessionVault, supabase } from '@/lib/supabase';

export type { BootResult };

/**
 * 현재 로그인한 사용자의 id 를 반환한다. 로그인 상태가 아니면 에러를 던진다.
 *
 * INSERT 시 `user_id` 를 채우는 데 쓴다. RLS 의 `with check (user_id = auth.uid())` 가
 * DB 에서 한 번 더 강제하므로, 여기서 넣는 값은 편의일 뿐 신뢰의 근거가 아니다.
 * getSession() 은 로컬(AsyncStorage) 세션을 읽어 네트워크 왕복이 없다.
 */
export async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(`세션을 확인하지 못했습니다: ${error.message}`);
  const userId = data.session?.user.id;
  if (!userId) throw new Error('로그인이 필요합니다.');
  return userId;
}

/**
 * 앱 시작 때 1회: 저장된 세션을 확인한다. 이 기기에서 세션을 쓴 적이 없을 때만 새 익명 계정을 만든다.
 * - `ready`·`created`: 세션이 있다.
 * - `offline`: 확인하지 못했다(통신·서버·저장소 오류). auth-js 의 자동 갱신이 되살리면 onAuthStateChange 로
 *   세션이 온다. 다시 시도는 앱 새로고침으로 한다 — 같은 실행에서 이 함수를 다시 부르면 auth-js 가
 *   60초 동안 저장해 둔 실패를 돌려준다.
 * - `lost`: 서버가 세션을 거절했거나 저장값이 사라졌다. 새 계정은 사용자가 "새로 시작"을 고를 때만 만든다.
 * 판정 규칙은 src/lib/sessionVault.ts.
 */
export function bootstrapSession(): Promise<BootResult> {
  return runSessionBootstrap(supabase.auth, sessionVault);
}

/**
 * 끊긴 세션에서 사용자가 고른 "새로 시작": 지금 계정을 기기에 보관하고 새 익명 계정을 만든다.
 * 새 계정의 user_metadata.previous_user_id 에 옛 계정 id 가 남는다. 실패하면 던진다(저장된 세션은 그대로).
 */
export async function startOver(): Promise<void> {
  if (!(await runStartOver(supabase.auth, sessionVault))) throw new Error('새 계정을 만들지 못했습니다.');
}

/** 사용자가 고른 로그아웃: 세션과 사본을 지운다(지금은 __DEV__ 세션 초기화만). */
export async function signOut(): Promise<void> {
  const { error } = await sessionVault.allowRemoval(() => supabase.auth.signOut());
  if (error) throw new Error(`로그아웃하지 못했습니다: ${error.message}`);
}

/**
 * 세션이 없으면 익명 로그인을 수행한다. 이미 세션이 있으면 아무것도 하지 않는다.
 *
 * 세션을 읽지 못한 경우도 "없음"으로 보므로, 사용자가 고른 로그아웃(`signOut`) 바로 뒤에만 쓴다.
 * 앱 시작에는 `bootstrapSession` 을 쓴다. 익명 세션은 AsyncStorage 에 저장돼 재시작 후 유지되고,
 * RLS 는 익명 세션의 auth.uid() 로 행을 격리한다(익명도 authenticated 롤을 받으므로 기존 GRANT·정책
 * 그대로 적용). 대시보드의 "Anonymous sign-ins" 토글이 켜져 있어야 한다.
 */
export async function signInAnonymouslyIfNeeded(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error(`익명 로그인에 실패했습니다: ${error.message}`);
}

// ── 개발용(__DEV__) 확인 수단 — 설정 화면에서만 부른다. 부른 뒤 앱을 다시 시작해야 시작 판정을 다시 본다. ──

/**
 * 개발용: 저장된 세션을 만료된 것으로 바꾸고, 지금과 다음 실행 1회의 요청을 연결 실패(offline) 또는
 * 서버 거절(reject)처럼 보이게 한다. 실제 refreshToken 은 서버로 가지 않아 그대로 쓸 수 있다.
 */
export async function devSimulateSessionProblem(mode: DevSimulationMode): Promise<void> {
  await startDevSimulation(mode);
  await sessionVault.expireStoredSessionForDev();
}

/** 개발용: 앱을 지운 것처럼 기기의 세션·기록(wishshot.*)을 모두 지우고, 다음 실행 1회를 연결 실패로 시작한다. */
export async function devSimulateFreshInstall(): Promise<void> {
  await startDevSimulation('offline');
  const isAppKey = (k: string) => k.startsWith('wishshot.') && k !== DEV_SIMULATION_KEY;
  const isSessionKey = (k: string) => /^sb-.+-auth-token/.test(k); // -code-verifier 등 딸린 키 포함
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((k) => isAppKey(k) || isSessionKey(k)));
}
