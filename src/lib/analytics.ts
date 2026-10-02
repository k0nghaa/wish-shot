import AsyncStorage from '@react-native-async-storage/async-storage';
import { PostHog } from 'posthog-react-native';

/**
 * 테스트 계측(Phase 10) — PostHog 캡슐화 모듈. 화면·훅은 이 모듈만 import 한다
 * (supabase 직접 호출 금지와 같은 사상 — `posthog-react-native` 를 직접 부르지 않는다).
 *
 * 불변식:
 * - 콘텐츠 미수집: 속성은 아래 타입의 enum·boolean·수치만. 상품명·가격·URL·OCR 원문 금지.
 * - 키(EXPO_PUBLIC_POSTHOG_KEY) 미설정이면 모든 호출이 no-op — 키 없이 빌드해도 동작 불변.
 * - 수집 실패는 삼킨다(analysisLogs 패턴). 계측이 앱 흐름을 막지 않는다.
 * - __DEV__ 는 기본 옵트아웃(개발 기기 오염 방지). 설정 화면의 개발용 토글로만 켠다.
 */

/** 온보딩 스텝 식별자(캐러셀 장 번호 + 홈 코치마크). */
export type OnboardingStep = 'card_1' | 'card_2' | 'card_3' | 'category_coachmark';

/**
 * 이벤트 택소노미 — 정본은 docs/testing/tracking-plan.md.
 * 이벤트·속성을 늘릴 땐 트래킹 플랜을 먼저 고치고 여기에 반영한다.
 */
export type AnalyticsEventMap = {
  /** 홈이 공유 인텐트를 소비한 직후. */
  share_intent_received: { type: 'image' | 'url' };
  /** 등록 화면 마운트. entry=share 는 공유 인텐트 경유(이미지·URL 프리필). */
  register_opened: { entry: 'share' | 'manual' };
  /** 분석 상태머신 종료 전이(analysis_logs 와 동일 enum). */
  analysis_completed: { status: 'parsed' | 'low_confidence' | 'parse_failed' | 'ocr_empty' };
  /** AI가 채운 필드를 사용자가 바꾼 첫 변경(필드당 1회). */
  autofill_edited: { field: 'name' | 'price' | 'brand' | 'category' };
  /** 저장 성공 응답 시(버튼 탭 아님). duration_ms = 등록 화면 마운트→성공. */
  item_saved: { source: 'share' | 'picker' | 'recent_photo'; duration_ms: number; had_analysis: boolean };
  /** 온보딩 각 스텝 표시 시. */
  onboarding_step_viewed: { step: OnboardingStep };
  /** 온보딩 완주/스킵 시. */
  onboarding_finished: { result: 'completed' | 'skipped'; last_step: OnboardingStep };
};

export type AnalyticsEvent = keyof AnalyticsEventMap;

let client: PostHog | null = null;
let lastIdentifiedId: string | null = null;

/**
 * 초기화(앱 시작 1회, _layout). 키 미설정이면 클라이언트를 만들지 않는다 → 이후 전부 no-op.
 * 옵션명은 설치된 posthog-react-native@4.x 타입 정의로 확인(dist/posthog-rn.d.ts).
 */
export function initAnalytics(): void {
  if (client) return;
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  try {
    client = new PostHog(key, {
      host: process.env.EXPO_PUBLIC_POSTHOG_HOST || undefined,
      // 선택 peer 의존성(expo-file-system 자동 탐지) 대신 이미 설치된 AsyncStorage 를 명시.
      customStorage: AsyncStorage,
      // 앱 열림/백그라운드/설치 라이프사이클 자동 수집 — 방문 빈도·리텐션(질문 1).
      captureAppLifecycleEvents: true,
      // 개발 기기 이벤트 오염 방지. 설정의 __DEV__ 토글(optIn)로만 켠다 — 토글 상태는 영속된다.
      defaultOptIn: !__DEV__,
      // 개발 검증 시 이벤트를 즉시 전송해 PostHog Activity 에서 바로 확인.
      flushAt: __DEV__ ? 1 : 20,
    });
  } catch (e) {
    client = null;
    if (__DEV__) console.warn('[WishShot/analytics] 초기화 실패', e);
  }
}

/** 이벤트 전송. 이벤트명·속성은 AnalyticsEventMap 으로 컴파일 타임 강제. 실패는 삼킨다. */
export function capture<E extends AnalyticsEvent>(event: E, props: AnalyticsEventMap[E]): void {
  try {
    client?.capture(event, props);
  } catch (e) {
    if (__DEV__) console.warn('[WishShot/analytics] capture 실패', event, e);
  }
}

/**
 * Supabase 익명 uid 로 identify(가명 식별자, 추가 개인정보 없음) —
 * PostHog 퍼널과 DB(items·analysis_logs) 지표를 같은 식별자로 조인하기 위함. 같은 uid 재호출은 무시.
 */
export function identifyUser(uid: string): void {
  if (!client || lastIdentifiedId === uid) return;
  try {
    client.identify(uid);
    lastIdentifiedId = uid;
  } catch (e) {
    if (__DEV__) console.warn('[WishShot/analytics] identify 실패', e);
  }
}

/** 클라이언트 생성 여부(키 설정 여부). 설정 화면의 개발용 토글 노출 판단용. */
export function isAnalyticsAvailable(): boolean {
  return client != null;
}

/** 현재 수집 여부(옵트인 상태). 키 미설정이면 false. */
export function isCaptureEnabled(): boolean {
  return client != null && !client.optedOut;
}

/** 수집 켜기/끄기(영속). __DEV__ 계측 검증용 명시적 활성화 수단 — 설정 화면에서만 호출한다. */
export async function setCaptureEnabled(enabled: boolean): Promise<void> {
  if (!client) return;
  try {
    if (enabled) await client.optIn();
    else await client.optOut();
  } catch (e) {
    if (__DEV__) console.warn('[WishShot/analytics] 옵트인/아웃 실패', e);
  }
}
