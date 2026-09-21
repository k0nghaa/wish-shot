import AsyncStorage from '@react-native-async-storage/async-storage';

// 첫 실행 온보딩을 1회만 보여주기 위한 플래그. register.tsx 의 PRIVACY_NOTICE_KEY 와 같은 패턴.
export const ONBOARDING_KEY = 'wishshot.onboardingShown';

/** 온보딩을 이미 봤는지. 읽기 실패는 "봤음"으로 취급해(플래그 손상 시) 반복 노출을 막는다. */
export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_KEY)) != null;
  } catch {
    return true;
  }
}

/** 온보딩 완료 표시. 실패는 삼킨다(다음 실행에 다시 뜰 뿐, 흐름을 막지 않음). */
export async function markOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_KEY, '1');
  } catch {
    /* 저장 실패는 무시 */
  }
}

/** 온보딩 플래그 리셋(개발/재검증용). 다음 앱 실행 시 온보딩이 다시 노출된다. */
export async function resetOnboarding(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ONBOARDING_KEY);
  } catch {
    /* 삭제 실패는 무시 */
  }
}
