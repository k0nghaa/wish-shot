import AsyncStorage from '@react-native-async-storage/async-storage';

// 개발용(__DEV__) 세션 확인 흉내: Supabase 요청을 연결 실패 또는 서버 거절처럼 보이게 한다.
// 개발용 앱은 Metro 에서 JS 를 받아 비행기 모드로는 다시 켤 수 없어서, 실기기 확인에 이것을 쓴다.
// 켜면 지금 실행은 다시 시작할 때까지 적용되고(그사이 자동 갱신이 세션을 되살리지 않게), 다음 실행 1회는
// 그 실행이 시작한 때부터 정해진 시간 동안 적용된다. 그다음 실행(다시 시도의 앱 새로고침 등)에는 적용되지 않는다.

export type DevSimulationMode = 'offline' | 'reject';

export const DEV_SIMULATION_KEY = 'wishshot.dev.sessionSimulation';

// offline: auth-js 의 재발급 재시도(약 27초)가 끝난 뒤 60초 제한이 지나면 저절로 돌아오는지 볼 수 있는 길이.
const DURATION_MS: Record<DevSimulationMode, number> = { offline: 40_000, reject: 10 * 60_000 };

let active: { mode: DevSimulationMode; until: number } | null = null;

// 앱 시작 때 1회: 저장해 둔 흉내를 꺼낸다(한 번만 적용).
const loaded: Promise<void> = __DEV__
  ? AsyncStorage.getItem(DEV_SIMULATION_KEY)
      .then(async (mode) => {
        if (mode !== 'offline' && mode !== 'reject') return;
        active = { mode, until: Date.now() + DURATION_MS[mode] };
        await AsyncStorage.removeItem(DEV_SIMULATION_KEY);
      })
      .catch(() => {})
  : Promise.resolve();

function rejection(): Response {
  const code = 'refresh_token_not_found';
  const body = { code, error_code: code, msg: 'Invalid Refresh Token: Refresh Token Not Found' };
  return new Response(JSON.stringify(body), {
    status: 400,
    headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
  });
}

/** supabase-js `global.fetch` 로 넣는다(__DEV__ 만). offline 은 모든 요청, reject 는 토큰 재발급만 바꾼다. */
export async function devFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  await loaded;
  if (active && Date.now() < active.until) {
    if (active.mode === 'offline') throw new TypeError('Network request failed');
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/auth/v1/token')) return rejection();
  }
  return fetch(input, init);
}

/** 흉내를 켠다: 지금 실행(다시 시작할 때까지)과 다음 실행 1회에 적용된다. */
export async function startDevSimulation(mode: DevSimulationMode): Promise<void> {
  active = { mode, until: Infinity };
  await AsyncStorage.setItem(DEV_SIMULATION_KEY, mode);
}
