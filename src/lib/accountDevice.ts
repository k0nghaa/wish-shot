import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ACCOUNT_STATE_KEY,
  decideStartState,
  LAST_PROVIDER_KEY,
  parseAccountRecord,
  parsePendingMerge,
  parseProvider,
  parseStoredUser,
  PENDING_MERGE_KEY,
  PROMPT_USED_KEY,
  type AccountRecord,
  type PendingMerge,
  type Provider,
  type StartDecision,
} from '@/lib/accountLogic';
import { SESSION_STORAGE_KEY, sessionVault } from '@/lib/supabase';

// 기기에 두는 계정 기록(설계 4)의 읽기·쓰기. 판단은 accountLogic.ts(순수), 여기는 AsyncStorage 에 닿는 부분이다.
// 쓰기 실패는 삼킨다 — 기록은 다음 실행에 세션을 다시 보고 맞출 수 있다(읽기 실패만 unreadable 로 다룬다).

/** 기기 상태 기록. 'unreadable' = 읽기 실패, null = 없음. 깨진 값은 없음으로 본다. */
export async function readRecord(): Promise<AccountRecord | null | 'unreadable'> {
  try {
    return parseAccountRecord(await AsyncStorage.getItem(ACCOUNT_STATE_KEY));
  } catch {
    return 'unreadable';
  }
}

export async function writeRecord(record: AccountRecord): Promise<void> {
  try {
    await AsyncStorage.setItem(ACCOUNT_STATE_KEY, JSON.stringify(record));
  } catch (e) {
    if (__DEV__) console.warn('[WishShot/account] 기기 상태 기록 실패', e);
  }
}

export async function readLastProvider(): Promise<Provider | null> {
  try {
    return parseProvider(await AsyncStorage.getItem(LAST_PROVIDER_KEY));
  } catch {
    return null;
  }
}

export async function writeLastProvider(provider: Provider): Promise<void> {
  await AsyncStorage.setItem(LAST_PROVIDER_KEY, provider).catch(() => undefined);
}

export async function readPromptUsed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PROMPT_USED_KEY)) !== null;
  } catch {
    return true; // 읽지 못하면 띄우지 않는다(같은 사용자에게 거듭 띄우지 않기)
  }
}

export async function writePromptUsed(): Promise<void> {
  await AsyncStorage.setItem(PROMPT_USED_KEY, '1').catch(() => undefined);
}

export async function readPending(): Promise<PendingMerge | null> {
  try {
    return parsePendingMerge(await AsyncStorage.getItem(PENDING_MERGE_KEY));
  } catch {
    return null;
  }
}

/** 합칠 것 남음 기록. 실패하면 던진다 — 익명 세션을 보관하기 전에 기존 계정으로 로그인하지 않기 위해. */
export async function writePending(pending: PendingMerge): Promise<void> {
  await AsyncStorage.setItem(PENDING_MERGE_KEY, JSON.stringify(pending));
}

export async function clearPending(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_MERGE_KEY).catch(() => undefined);
}

/**
 * 저장된 세션을 통신 없이 읽는다(세션 저장 어댑터 경유 — 사본 되살리기 포함). auth-js 를 거치지 않으므로 재발급을 기다리지 않는다.
 * 읽지 못한 것('unreadable')은 "없음"이 아니다.
 */
export async function readStoredUser() {
  const raw = await sessionVault.storage.getItem(SESSION_STORAGE_KEY);
  if (raw !== null) return parseStoredUser(raw) ?? ('corrupt' as const);
  const state = sessionVault.state();
  if (state === 'unreadable') return 'unreadable' as const;
  return state === 'corrupt' ? ('corrupt' as const) : ('none' as const);
}

async function hasWishTrace(): Promise<boolean> {
  try {
    return await sessionVault.hasWishTrace();
  } catch {
    return true; // 모르면 잃을 수 있는 쪽으로
  }
}

/** 기기에 저장된 값만으로 첫 화면 상태를 정하고(통신 없음), 바꿀 기록은 쓴다. */
export async function resolveStartState(): Promise<StartDecision> {
  const [record, session, lastProvider] = await Promise.all([readRecord(), readStoredUser(), readLastProvider()]);
  const input = {
    record,
    session,
    lastProvider,
    hasWishTrace: await hasWishTrace(),
    copyUserId: (await sessionVault.inquiryUserId()) ?? (await sessionVault.archivedUserId()),
  };
  const decision = decideStartState(input);
  if (decision.write) await writeRecord(decision.write);
  return decision;
}
