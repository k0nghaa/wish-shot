// 계정(로그인·합치기·닉네임·삭제) 데이터 레이어 — 하위 작업 사이의 약속(docs/phases/phase-22-account-login.md 설계 2).
// 지금 몸통은 개발용 결과 흉내(src/lib/accountSimulation.ts)를 돌려준다. login-feature 가 진짜로 구현하고,
// 구현한 뒤에도 __DEV__ 에서 흉내를 고른 함수는 흉내 결과를 돌려준다(화면 확인용).
// 화면은 이 결과의 종류(kind)마다 처리한다. 결과 타입을 바꾸려면 상위에 알린다.

import { simulate, subscribeSimulatedStartState } from '@/lib/accountSimulation';

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
  /** 사용자가 [Apple 연결 해제 없이 삭제]를 골랐을 때만 true. */
  skipAppleRevoke?: boolean;
};

export type DeleteAccountResult =
  /** 기기 정리까지 끝남 — 새 설치와 같은 흐름으로 간다. */
  | { kind: 'deleted' }
  /** 아무것도 지우지 않음 — [다시 시도] [Apple 연결 해제 없이 삭제]. */
  | { kind: 'apple_revoke_failed' }
  | { kind: 'error'; reason: FailureReason };

/** 앱을 켤 때 기기 저장값만으로 정하는 상태(통신 없음). */
export type StartState =
  | { kind: 'fresh' } // 세션 없음 + 로그인한 적 없음(새 설치·재설치·새 기기, 흔적 없는 거절)
  | { kind: 'signed_out'; lastProvider: SignInProvider | null } // 로그아웃·로그인 세션 만료·Apple 연결 해제
  | { kind: 'anonymous' }
  | { kind: 'signed_in' }
  | { kind: 'session_lost'; previousUserId: string | null } // 서버가 익명 세션을 거절함(위시 흔적 있음) — 알림창 C
  | { kind: 'deleting' } // 계정 삭제 도중 꺼짐 — 삭제하는 중 화면에서 다시 부른다
  | { kind: 'unreadable' }; // 저장값을 읽지 못함 — "세션 없음"이 아니다. 다시 시도

/** 로그인 화면·반시트에서 Apple·카카오 로그인. */
export async function signIn(provider: SignInProvider): Promise<SignInResult> {
  void provider;
  return simulate('signIn');
}

/** 확인창 A·B·D 뒤 "로그인 없이 시작". 끊긴 세션(D) 뒤면 user_metadata.previous_user_id 를 남긴다. */
export async function startWithoutSignIn(): Promise<StartWithoutSignInResult> {
  return simulate('startWithoutSignIn');
}

/** 합치는 중 화면, 설정 "다시 시도", 앱을 열 때 재시도. */
export async function mergeAnonymousWishes(): Promise<MergeResult> {
  return simulate('mergeAnonymousWishes');
}

/** 설정 '계정' 영역. */
export async function getAccount(): Promise<AccountInfo> {
  return simulate('getAccount', 0);
}

/** 닉네임 화면 — 입력을 멈추면. */
export async function checkNickname(name: string): Promise<NicknameCheckResult> {
  void name;
  return simulate('checkNickname', 300);
}

/** 닉네임 화면 [완료]·[저장] — 서버가 한 번 더 검사한다(동시 선점). */
export async function saveNickname(name: string): Promise<SaveNicknameResult> {
  void name;
  return simulate('saveNickname');
}

/** 로그아웃 확인창 [로그아웃] — 기기 정리(설계 4 '로그아웃' 열) 포함. */
export async function signOutAccount(): Promise<void> {
  await simulate('signOutAccount');
}

/** 계정 삭제 안내 [계정 삭제] — Apple 계정만. 삭제하는 중 화면은 이 창이 닫힌 뒤 띄운다. */
export async function confirmAppleForDeletion(): Promise<AppleConfirmResult> {
  return simulate('confirmAppleForDeletion');
}

/** 삭제하는 중 화면. 시작 때 기기에 "삭제 중"을 기록하고, 끝나면 기기 정리(설계 4 '계정 삭제' 열)까지 한다. */
export async function deleteAccount(input: DeleteAccountInput): Promise<DeleteAccountResult> {
  void input;
  return simulate('deleteAccount');
}

/** _layout.tsx 가 첫 화면을 정할 때. 통신하지 않는다. */
export async function getStartState(): Promise<StartState> {
  return simulate('getStartState', 0);
}

/** 기기 상태가 바뀔 때마다(로그인·로그아웃·거절·삭제) 알린다. 구독 해제 함수를 돌려준다. */
export function subscribeAccountState(listener: (state: StartState) => void): () => void {
  return subscribeSimulatedStartState(listener);
}

/** 전체 탭·공유 저장 뒤: 반시트를 띄울지(로그인 화면과 합쳐 통틀어 1회). 통신하지 않는다. */
export async function shouldShowSignInSheet(): Promise<boolean> {
  return simulate('shouldShowSignInSheet', 0);
}

/** 로그인 화면·반시트를 보였을 때(취소된 공유 저장에서는 부르지 않는다). */
export async function markSignInPromptUsed(): Promise<void> {
  await simulate('markSignInPromptUsed', 0);
}
