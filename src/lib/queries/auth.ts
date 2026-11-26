import AsyncStorage from '@react-native-async-storage/async-storage';

import { startDevSimulation, type DevSimulationMode } from '@/lib/devSessionSimulation';
import { sessionVault, supabase } from '@/lib/supabase';

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
 * 문의 번호용 사용자 id(이 기기에 저장된 계정 — 세션을 읽지 못했으면 사본의 id). 모르면 null.
 * 의견 보내기·문의하기 메일의 문의 번호에 쓴다. 토큰은 쓰지 않는다.
 */
export function getInquiryUserId(): Promise<string | null> {
  return sessionVault.inquiryUserId();
}

// 사용자가 고른 로그아웃·삭제가 도는 동안의 수. auth-js 가 보내는 SIGNED_OUT 이 이 사이에 왔으면 서버 거절이 아니다.
let userInitiatedSignOuts = 0;

/** 사용자가 고른 로그아웃·삭제 동안만 세션과 사본을 지울 수 있게 하고, 그동안의 SIGNED_OUT 을 거절로 읽지 않게 한다. */
export async function runUserSignOut<T>(fn: () => Promise<T>): Promise<T> {
  userInitiatedSignOuts++;
  try {
    return await sessionVault.allowRemoval(fn);
  } finally {
    userInitiatedSignOuts--;
  }
}

/** SIGNED_OUT 이 사용자가 고른 것인지(서버 거절·재발급 실패 정리와 구별). */
export function isUserInitiatedSignOut(): boolean {
  return userInitiatedSignOuts > 0;
}

/** 개발용(설정의 세션 초기화): 세션과 사본을 지운다. 로그아웃(signOutAccount)은 account.ts 에 있다. */
export async function signOut(): Promise<void> {
  const { error } = await runUserSignOut(() => supabase.auth.signOut());
  if (error) throw new Error(`로그아웃하지 못했습니다: ${error.message}`);
}

/**
 * 세션이 없으면 익명 로그인을 수행한다. 이미 세션이 있으면 아무것도 하지 않는다.
 *
 * 세션을 읽지 못한 경우도 "없음"으로 보므로, 사용자가 고른 로그아웃(`signOut`) 바로 뒤에만 쓴다.
 * 앱 시작에는 쓰지 않는다(첫 화면 판정은 getStartState, 통신 없음). 익명 세션은 AsyncStorage 에 저장돼 재시작 후 유지되고,
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

/**
 * 개발용: 앱을 지운 것처럼 기기의 세션·기록(wishshot.*)을 모두 지운다. 다시 시작하면 새 설치와 같은 흐름(로그인 화면)으로 간다.
 * 서버의 계정은 그대로라 이전 익명 계정은 기기에서만 사라진다(사본·보관 목록도 지움).
 */
export async function devSimulateFreshInstall(): Promise<void> {
  const isAppKey = (k: string) => k.startsWith('wishshot.');
  const isSessionKey = (k: string) => /^sb-.+-auth-token/.test(k); // -code-verifier 등 딸린 키 포함
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((k) => isAppKey(k) || isSessionKey(k)));
}
