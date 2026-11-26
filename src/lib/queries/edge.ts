import { supabase } from '@/lib/supabase';

// 계정 서버 함수(Edge Function) 호출 — 설계 1의 서버 함수 3개. 이름은 서버 워크트리가 정하면 여기만 고친다.
export const EDGE_FUNCTIONS = {
  /** 가입 확인: 같은 이메일이 다른 수단으로 가입돼 있는지(앱이 Supabase 에 토큰을 보내기 전에 거친다). */
  checkSignIn: 'check-signup',
  /** 합치기: 익명 위시를 로그인 계정으로 옮긴다. */
  mergeWishes: 'merge-anonymous',
  /** 계정 삭제. */
  deleteAccount: 'delete-account',
} as const;

/** 서버 함수 호출 결과: 통신 실패(network)와 서버가 돌려준 오류(http — 상태 코드와 { error: "<code>" } 의 코드). */
export type EdgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'network' }
  | { ok: false; kind: 'http'; status: number; code: string | null; body: unknown };

/** 서버 함수를 부른다. throw 하지 않는다. 세션이 있으면 그 토큰, 없으면 앱 키로 부른다(supabase-js 가 정한다). */
export async function invokeEdge<T>(
  name: string,
  body: unknown,
  timeoutMs = 30_000,
  client: Pick<typeof supabase, 'functions'> = supabase,
  accessToken?: string,
): Promise<EdgeResult<T>> {
  try {
    const { data, error } = await client.functions.invoke<T>(name, {
      body: body as Record<string, unknown>,
      timeout: timeoutMs,
      ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
    });
    if (!error) return { ok: true, data: data as T };
    const context: unknown = (error as { context?: unknown }).context;
    if ((error as { name?: string }).name === 'FunctionsHttpError' && context instanceof Response) {
      let code: string | null = null;
      let body: unknown = null;
      try {
        body = await context.clone().json();
        const err = (body as { error?: unknown } | null)?.error;
        if (typeof err === 'string') code = err;
      } catch {
        /* 본문이 JSON 이 아니면 코드 없음 */
      }
      return { ok: false, kind: 'http', status: context.status, code, body };
    }
    if ((error as { name?: string }).name === 'FunctionsRelayError') return { ok: false, kind: 'http', status: 502, code: null, body: null };
    return { ok: false, kind: 'network' };
  } catch {
    return { ok: false, kind: 'network' };
  }
}

/** 서버 DB 함수(rpc). 마이그레이션 적용·타입 재생성 전에도 컴파일되도록 이름으로 부른다. throw 하지 않는다. */
export async function rpcLoose(
  name: string,
  args?: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; kind: 'network' | 'server'; code: string | null }> {
  try {
    const client = supabase as unknown as {
      rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
    };
    const { data, error } = await client.rpc(name, args);
    if (!error) return { ok: true, data };
    const message = (error.message ?? '').toLowerCase();
    // supabase-js 는 통신 실패를 code 없는 오류(메시지에 fetch 실패)로 돌려준다.
    const network = !error.code && (message.includes('network') || message.includes('fetch') || message.includes('timeout'));
    return { ok: false, kind: network ? 'network' : 'server', code: error.code ?? null };
  } catch {
    return { ok: false, kind: 'network', code: null };
  }
}
