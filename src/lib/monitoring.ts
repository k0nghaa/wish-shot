import * as Sentry from '@sentry/react-native';
import type { Breadcrumb, ErrorEvent, ReactNativeOptions } from '@sentry/react-native';
import { Component, createElement, type ComponentType, type ReactNode } from 'react';

/**
 * 오류·크래시 수집(Sentry) 캡슐화 모듈. 화면·훅은 이 모듈만 import 한다
 * (`@sentry/react-native` 직접 import 금지 — analytics.ts 와 같은 사상, eslint 규칙으로 강제).
 *
 * 불변식:
 * - 오류·크래시만 수집한다. 성능 추적·세션 리플레이·스크린샷·뷰 계층은 쓰지 않는다.
 * - 콘텐츠 미수집: 사진·OCR 원문·상품명·브랜드·가격·URL·메모를 싣지 않는다. setUser 로 uid 를 붙이지 않는다.
 *   네트워크 요청 기록(xhr·fetch·http)과 콘솔 기록은 버린다. 그 밖의 기록·오류 메시지에서는 URL 을 줄인다
 *   (Supabase 는 경로만 남기고 쿼리·UUID 를 지움, 그 밖의 URL 은 통째로 지움).
 *   앱이 실제로 쓰는 URL·signed URL 캐시는 건드리지 않는다.
 * - DSN(EXPO_PUBLIC_SENTRY_DSN)이 없으면 초기화하지 않는다 → 이후 전부 no-op(루트 감싸기도 하지 않는다).
 * - __DEV__ 는 기본 비활성. EXPO_PUBLIC_SENTRY_DEV=1 일 때만 켠다(검증용).
 * - 거르기 함수가 실패하면 그 기록·이벤트를 버린다(fail closed).
 *
 * 옵션명·동작은 설치된 @sentry/react-native 7.11.0(네이티브 sentry-cocoa 8.58.0)의 코드로 확인했다.
 */

let enabled = false;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// scheme://host 경로 ?쿼리#프래그먼트. host 는 비어 있을 수 있다(file:///…).
const URL_RE = /\b([a-z][a-z0-9+.-]*):\/\/([^\s/?#"'<>]*)([^\s?#"'<>]*)[^\s"'<>]*/gi;
// 오류 메시지 안의 큰따옴표 값. Postgres 오류는 입력값을 큰따옴표로 감싸 메시지에 넣는다.
const DOUBLE_QUOTED_RE = /"[^"]*"/g;

/** URL 줄이기. Supabase(우리 백엔드)는 경로만 남기고 UUID 를 가린다. 그 밖(상품 링크·파일 경로 등)은 통째로 가린다. */
function scrubUrls(text: string): string {
  return text
    .replace(/\\\//g, '/') // JSON 이스케이프된 URL(https:\/\/…)도 잡는다
    .replace(URL_RE, (_match, scheme: string, host: string, path: string) =>
      host.endsWith('.supabase.co') ? `${scheme}://${host}${path.replace(UUID_RE, '<id>')}` : '<url>',
    );
}

/** 오류 메시지용: URL 줄이기 + UUID·큰따옴표 값 가리기. */
function scrubMessage(text: string): string {
  return scrubUrls(text).replace(UUID_RE, '<id>').replace(DOUBLE_QUOTED_RE, '"<redacted>"');
}

/** 객체 안의 문자열에 URL 줄이기를 적용한다(contexts 용, 깊이 제한). */
function scrubUrlsDeep(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return scrubUrls(value);
  if (depth <= 0 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrubUrlsDeep(v, depth - 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) out[key] = scrubUrlsDeep(v, depth - 1);
  return out;
}

/**
 * 버리는 기록 종류.
 * - console: 오류 원문(DB 오류 상세 등)에 사용자 입력이 섞일 수 있다.
 * - xhr·fetch·http(네트워크 요청): 방침 §5에 요청 주소를 수집 항목으로 두지 않았다. Expo SDK 57 은 전역 fetch 를
 *   expo/fetch 로 바꿔 Sentry(모바일 기본 XHR 만 기록)가 요청을 거의 보지 못하지만, SDK·라이브러리가 바뀌어도
 *   방침과 어긋나지 않게 여기서 확정적으로 버린다. 켜려면 방침을 먼저 고친다(고지 선행).
 */
function isDroppedBreadcrumb(breadcrumb: Breadcrumb): boolean {
  const { category, type } = breadcrumb;
  return category === 'console' || category === 'xhr' || category === 'fetch' || type === 'http';
}

function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (isDroppedBreadcrumb(breadcrumb)) return null;
  const next: Breadcrumb = { ...breadcrumb };
  if (typeof next.message === 'string') next.message = scrubUrls(next.message);
  if (next.data) {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(next.data)) {
      if (key === 'http.query' || key === 'http.fragment') continue;
      data[key] = typeof value === 'string' ? scrubUrls(value) : value;
    }
    next.data = data;
  }
  return next;
}

function scrubEvent(event: ErrorEvent): ErrorEvent {
  // 네이티브에서 합쳐 온 기록도 여기서 한 번 더 거른다.
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map(scrubBreadcrumb)
      .filter((b): b is Breadcrumb => b !== null);
  }
  if (typeof event.message === 'string') event.message = scrubMessage(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value === 'string') exception.value = scrubMessage(exception.value);
  }
  // 앱은 extra 를 쓰지 않는다. SDK 는 Error 가 아닌 값을 throw 하면 그 객체를 통째로 extra 에 넣는다(DB 오류 상세 등).
  delete event.extra;
  if (event.contexts) event.contexts = scrubUrlsDeep(event.contexts, 4) as ErrorEvent['contexts'];
  if (event.request) {
    const { url, headers } = event.request;
    event.request = { headers, url: typeof url === 'string' ? scrubUrls(url) : undefined };
  }
  if (event.user?.ip_address !== undefined) {
    const user = { ...event.user };
    delete user.ip_address;
    event.user = user;
  }
  return event;
}

function beforeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  try {
    return scrubBreadcrumb(breadcrumb);
  } catch {
    return null;
  }
}

function beforeSend(event: ErrorEvent): ErrorEvent | null {
  try {
    return scrubEvent(event);
  } catch {
    return null;
  }
}

/**
 * 네이티브(sentry-cocoa) 전용 키. RN 타입에는 없지만 함수가 아닌 옵션은 네이티브로 그대로 전달된다.
 * 네이티브 크래시 보고에는 JS 필터(beforeBreadcrumb·beforeSend)가 적용되지 않으므로 네이티브 자동 기록을 끈다.
 * - enableNetworkBreadcrumbs: 네이티브는 요청마다 URL 과 쿼리(http.query, signed URL token 포함)를 기록한다.
 * - enableAutoBreadcrumbTracking: 화면 제목(navigationItem.title)·버튼 제목을 기록한다(폴더·태그 이름 유입 가능).
 * JS 기록(터치·fetch/xhr)은 걸러진 뒤 네이티브로 동기화되므로 네이티브 크래시에도 남는다.
 */
const NATIVE_ONLY_OPTIONS = {
  enableNetworkBreadcrumbs: false,
  enableAutoBreadcrumbTracking: false,
};

/** 앱 시작 1회(_layout 모듈 최상단). DSN 이 없거나 __DEV__(검증 플래그 제외)면 아무것도 하지 않는다. */
export function initMonitoring(): void {
  if (enabled) return;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return;
  if (__DEV__ && process.env.EXPO_PUBLIC_SENTRY_DEV !== '1') return;
  try {
    const options: ReactNativeOptions = {
      ...NATIVE_ONLY_OPTIONS,
      dsn,
      environment: __DEV__ ? 'development' : 'production',
      // IP 를 보내지 않는다(SDK 가 infer_ip: 'never' 를 함께 보낸다). 서버 설정으로도 저장을 막았다.
      sendDefaultPii: false,
      // 성능 추적 끔: tracesSampleRate 키가 있으면(0 이어도) 추적 통합이 등록되므로 아예 넣지 않는다.
      enableAutoPerformanceTracing: false,
      // 리플레이 끔: replays*SampleRate 키도 같은 이유로 넣지 않는다.
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableCaptureFailedRequests: false,
      beforeBreadcrumb,
      beforeSend,
    };
    Sentry.init(options);
    // DSN 형식이 틀리면 init 이 조용히 클라이언트를 비활성으로 만든다 → 실제 DSN 이 잡혔을 때만 켜진 것으로 본다.
    enabled = Sentry.getClient()?.getDsn() !== undefined;
  } catch (e) {
    enabled = false;
    if (__DEV__) console.warn('[WishShot/monitoring] 초기화 실패', e);
  }
}

/**
 * 렌더링 중 오류를 전역 오류 처리로 넘기는 루트 경계.
 * React Native 0.86 은 처리되지 않은 렌더 오류를 ErrorUtils 전역 핸들러를 거치지 않고 바로 치명 오류로 처리한다
 * (renderer onUncaughtError → ExceptionsManager.handleException). 그러면 Sentry·PostHog 핸들러가 못 보고,
 * 네이티브 SDK 는 "Unhandled JS Exception" 을 JS 가 이미 보냈다고 보고 버린다.
 * 여기서 받아 전역 핸들러 체인(PostHog app_error → Sentry → RN 기본: redbox·크래시)으로 넘겨 기존처럼 치명 오류로 끝낸다.
 */
class RenderErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    const reported = error instanceof Error ? error : new Error(String(error));
    ErrorUtils.getGlobalHandler()(reported, true);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** 루트 컴포넌트 감싸기(렌더 오류 경계 + Sentry.wrap). 초기화되지 않았으면 그대로 돌려준다. */
export function wrapRoot<P extends Record<string, unknown>>(component: ComponentType<P>): ComponentType<P> {
  if (!enabled) return component;
  const WithRenderErrorBoundary = (props: P) =>
    createElement(RenderErrorBoundary, null, createElement(component, props));
  return Sentry.wrap(WithRenderErrorBoundary);
}

/** 초기화 여부. 설정 화면의 개발용 버튼 안내용. */
export function isMonitoringEnabled(): boolean {
  return enabled;
}

/** 네이티브 크래시 테스트(__DEV__ 설정 화면 전용). 초기화되지 않았으면 아무것도 하지 않는다. */
export function triggerNativeCrashForTest(): void {
  if (!enabled) return;
  Sentry.nativeCrash();
}
