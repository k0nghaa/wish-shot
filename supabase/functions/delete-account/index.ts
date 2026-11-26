// delete-account(계정 삭제) — 앱 안 계정 삭제를 서버에서 마무리하는 Edge Function (Deno, service_role).
// 근거: docs/phases/phase-22-account-login.md '확정된 결정 — 계정 삭제', 설계 1, 불변식 5·6·8·9. 심사 지침 5.1.1(v).
//
// 계약:
//   호출: Authorization: Bearer <사용자 access token>(익명 포함), 본문
//         { "reason"?: "rarely_used"|"missing_feature"|"other_account"|"privacy"|"other", "reasonText"?: string(≤200, reason=other 일 때만 저장),
//           "appleAuthorizationCode"?: string, "appleClientId"?: string(번들 ID), "skipUnlink"?: boolean(Apple·카카오 공통) }
//   응답:  200 { "result": "deleted" }        — 모두 지움
//          200 { "result": "already_deleted" } — 사용자가 이미 없음(앱은 완료 처리)
//          400 { "error": "apple_code_required" } — Apple 계정이고 연결 해제를 아직 못 했는데 코드도 skipUnlink 도 없음(앱은 Apple 재인증부터 다시)
//          400 { "error": "invalid_input" }  — 본문 오류(기타 글 200자 초과, 허용되지 않은 appleClientId 포함)
//          502 { "error": "unlink_failed", "provider": "apple" | "kakao" }  — 연결 해제(Apple 철회·카카오 해제) 실패: 아무것도 지우지 않았다
//              ([다시 시도] · [연결 해제 없이 삭제] = skipUnlink: true 로 다시 부름)
//          401 { "error": "unauthorized" | "invalid_token" }, 500 { "error": "server_error" }, 405 method_not_allowed
//
// 순서(멱등 — 어느 단계에서 끊겨도 다시 부르면 이어서 한다):
//   ① 본인 확인(토큰을 Auth 서버로 검증)
//   ② Apple 철회(재인증으로 받은 코드를 /auth/token 으로 교환 → /auth/revoke, 받은 토큰은 저장하지 않음) 또는
//      카카오 연결 해제(어드민 키 + 회원번호, 이미 끊긴 사용자는 성공). 실패하면 여기서 멈춘다(unlink_failed). 익명은 건너뜀.
//      해제를 마치면 사용자 id 로 진행 상태(0009 ops.deletion_progress)를 남기고, 다시 부르면 이 단계를 건너뛴다(두 번 해제하지 않음).
//   ③ 사진 삭제(item-images/{uid}/ 전부 — 사용자를 지워도 Storage 파일은 남기 때문). 실패하면 멈춘다.
//   ④ PostHog 프로필 삭제(이벤트는 유지 — delete_events 를 붙이지 않는다). 실패해도 진행하고 식별자를 재시도 표에 남긴다.
//   ⑤ DB 마무리 public.finalize_account_deletion(0009, 한 트랜잭션): 실패 기록에서 사용자 id 를 떼 합계로, 탈퇴 사유 기록
//      (사용자 id 없이), 재시도 표 기록, 사용자 삭제 → 위시·카테고리·분석 기록·닉네임·로그인 정보 cascade.
//
// 추가 경로(주간 정리 작업 — 스케줄러 전용): 헤더 x-cron-secret(= CRON_SECRET)과 함께 부르면 PostHog 재시도 표의
//   식별자를 다시 지우고 성공한 것은 표에서 뺀다. 응답 { "retried": n, "cleared": m }. 호출 일정은 사람이 정한다(cleanup-orphan-images 와 같은 방식).
//
// 인증: verify_jwt = false(supabase/config.toml) — 토큰은 함수 안에서 Auth 서버로 검증한다(이미 삭제된 사용자의 만료 전 토큰으로 다시
//   불려도 already_deleted 로 답하려면 함수가 직접 판정해야 한다).
//
// 환경 변수(시크릿 — 사람이 등록. 비밀 값은 앱·커밋·채팅에 두지 않는다):
//   APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY(.p8 본문 — 줄바꿈은 \n 으로도 가능), APPLE_CLIENT_IDS(번들 ID 쉼표 목록 — 운영·개발)
//   KAKAO_ADMIN_KEY(서비스 앱 어드민 키)
//   POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_ID, POSTHOG_HOST(기본 https://us.posthog.com — 프로젝트 지역에 맞게)
//   CRON_SECRET(주간 정리 호출용, cleanup-orphan-images 와 같은 값)
// 로그: 단계·결과 종류만. 토큰·코드·식별자·이메일·사유 글은 남기지 않는다. 소셜 토큰은 저장하지 않는다(불변식 6).
// 배포(사람): npx supabase@2.121.0 functions deploy delete-account  (0009 적용 뒤)

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  type DeletionPorts,
  type UserLike,
  buildAppleClientSecret,
  classifyKakaoUnlink,
  handleDelete,
  parsePosthogPersonId,
} from './logic.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BUCKET = 'item-images';
const EXTERNAL_TIMEOUT_MS = 8_000;
const DB_TIMEOUT_MS = 8_000;

const admin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorKind(e: unknown): string {
  if (e && typeof e === 'object') {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
    const name = (e as { name?: unknown }).name;
    if (typeof name === 'string' && name) return name;
  }
  return 'unknown';
}

// 쉼표 목록 환경 변수
function parseIdList(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((v) => v.trim()).filter((v) => v.length > 0);
}

function db() {
  if (!admin) throw new Error('no_service_key');
  return admin;
}

// ---------------------------------------------------------------------------
// Apple 철회: 코드 → 토큰 교환 → 철회. 받은 토큰은 이 함수 안에서만 쓰고 저장하지 않는다.
// ---------------------------------------------------------------------------
async function appleRevoke({ code, clientId }: { code: string; clientId: string }): Promise<boolean> {
  const teamId = Deno.env.get('APPLE_TEAM_ID');
  const keyId = Deno.env.get('APPLE_KEY_ID');
  const pem = Deno.env.get('APPLE_PRIVATE_KEY');
  if (!teamId || !keyId || !pem) {
    console.log('delete: apple_not_configured');
    return false;
  }
  try {
    const secret = await buildAppleClientSecret({
      teamId,
      keyId,
      clientId,
      privateKeyPem: pem,
      nowSec: Math.floor(Date.now() / 1000),
    });
    const form = (fields: Record<string, string>) => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
    });

    const tokenRes = await fetch(
      'https://appleid.apple.com/auth/token',
      form({ client_id: clientId, client_secret: secret, code, grant_type: 'authorization_code' }),
    );
    if (!tokenRes.ok) {
      console.log(`delete: apple_token status=${tokenRes.status}`);
      return false;
    }
    const tokens = (await tokenRes.json()) as { refresh_token?: unknown; access_token?: unknown };
    const token = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : tokens.access_token;
    const hint = typeof tokens.refresh_token === 'string' ? 'refresh_token' : 'access_token';
    if (typeof token !== 'string' || !token) {
      console.log('delete: apple_token_missing');
      return false;
    }

    const revokeRes = await fetch(
      'https://appleid.apple.com/auth/revoke',
      form({ client_id: clientId, client_secret: secret, token, token_type_hint: hint }),
    );
    if (!revokeRes.ok) {
      console.log(`delete: apple_revoke status=${revokeRes.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.log(`delete: apple_error ${errorKind(e)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 카카오 연결 해제: 어드민 키 + 회원번호
// ---------------------------------------------------------------------------
async function kakaoUnlink(memberId: string): Promise<boolean> {
  const adminKey = Deno.env.get('KAKAO_ADMIN_KEY');
  if (!adminKey) {
    console.log('delete: kakao_not_configured');
    return false;
  }
  try {
    const res = await fetch('https://kapi.kakao.com/v1/user/unlink', {
      method: 'POST',
      headers: { Authorization: `KakaoAK ${adminKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ target_id_type: 'user_id', target_id: memberId }).toString(),
      signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => null);
    const verdict = classifyKakaoUnlink(res.status, body);
    console.log(`delete: kakao_unlink ${verdict}`);
    return verdict !== 'failed';
  } catch (e) {
    console.log(`delete: kakao_error ${errorKind(e)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 사진: item-images/{uid}/ 아래 전부(원본·썸네일)
// ---------------------------------------------------------------------------
async function removeAllPhotos(userId: string): Promise<void> {
  const bucket = db().storage.from(BUCKET);
  for (let round = 0; round < 50; round++) {
    const { data, error } = await bucket.list(userId, { limit: 1000, offset: 0 });
    if (error) throw new Error('storage_list');
    const files = (data ?? []).filter((o: { id: string | null; name: string }) => o.id != null && o.name);
    if (files.length === 0) return;
    const { error: rmError } = await bucket.remove(files.map((f: { name: string }) => `${userId}/${f.name}`));
    if (rmError) throw new Error('storage_remove');
  }
  throw new Error('storage_too_many');
}

// ---------------------------------------------------------------------------
// PostHog: 사람(프로필)만 지운다 — delete_events 를 붙이지 않아 이벤트는 남는다.
// ---------------------------------------------------------------------------
async function deletePosthogPerson(userId: string): Promise<boolean> {
  const key = Deno.env.get('POSTHOG_PERSONAL_API_KEY');
  const projectId = Deno.env.get('POSTHOG_PROJECT_ID');
  const host = (Deno.env.get('POSTHOG_HOST') ?? 'https://us.posthog.com').replace(/\/+$/, '');
  if (!key || !projectId) {
    console.log('delete: posthog_not_configured');
    return false;
  }
  try {
    const headers = { Authorization: `Bearer ${key}` };
    const find = await fetch(
      `${host}/api/projects/${encodeURIComponent(projectId)}/persons/?distinct_id=${encodeURIComponent(userId)}`,
      { headers, signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS) },
    );
    if (!find.ok) {
      console.log(`delete: posthog_find status=${find.status}`);
      return false;
    }
    const personId = parsePosthogPersonId(await find.json());
    if (personId == null) return true; // 프로필이 없다 — 지울 것 없음
    const del = await fetch(
      `${host}/api/projects/${encodeURIComponent(projectId)}/persons/${encodeURIComponent(String(personId))}/`,
      { method: 'DELETE', headers, signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS) },
    );
    if (del.ok || del.status === 404) return true;
    console.log(`delete: posthog_delete status=${del.status}`);
    return false;
  } catch (e) {
    console.log(`delete: posthog_error ${errorKind(e)}`);
    return false;
  }
}

const ports: DeletionPorts = {
  appleRevoke,
  kakaoUnlink,
  removeAllPhotos,
  deletePosthogPerson,
  async getUnlinkDone(userId) {
    const { data, error } = await db()
      .rpc('get_deletion_progress', { p_user_id: userId })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) throw new Error(`progress_error:${error.code ?? 'unknown'}`);
    return data === true;
  },
  async markUnlinkDone(userId) {
    const { error } = await db()
      .rpc('mark_deletion_unlinked', { p_user_id: userId })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) throw new Error(`progress_error:${error.code ?? 'unknown'}`);
  },
  async finalize({ userId, reason, reasonText, posthogPending }) {
    const { data, error } = await db()
      .rpc('finalize_account_deletion', {
        p_user_id: userId,
        p_reason: reason,
        p_reason_text: reasonText,
        p_posthog_pending: posthogPending,
      })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) throw new Error(`finalize_error:${error.code ?? 'unknown'}`);
    if (data !== 'deleted' && data !== 'already_deleted') throw new Error('finalize_bad_response');
    return data;
  },
};

// ---------------------------------------------------------------------------
// 주간 정리: PostHog 재시도
// ---------------------------------------------------------------------------
async function retryPosthog(): Promise<{ retried: number; cleared: number }> {
  const { data, error } = await db().rpc('list_posthog_delete_retries', { p_limit: 50 });
  if (error) throw new Error('retry_list');
  const rows = (data ?? []) as { distinct_id: string }[];
  let cleared = 0;
  for (const row of rows) {
    const ok = await deletePosthogPerson(row.distinct_id);
    const { error: resolveError } = await db().rpc('resolve_posthog_delete_retry', {
      p_distinct_id: row.distinct_id,
      p_done: ok,
    });
    if (resolveError) console.log(`delete: retry_resolve ${errorKind(resolveError)}`);
    if (ok) cleared++;
  }
  return { retried: rows.length, cleared };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!admin) {
    console.log('delete: no_service_key');
    return json({ error: 'server_error' }, 500);
  }

  // 스케줄러 전용 경로
  const cronHeader = req.headers.get('x-cron-secret');
  if (cronHeader != null) {
    const secret = Deno.env.get('CRON_SECRET');
    if (!secret) return json({ error: 'server_error' }, 500);
    if (cronHeader !== secret) return json({ error: 'unauthorized' }, 401);
    try {
      const out = await retryPosthog();
      console.log(`delete: posthog_retry retried=${out.retried} cleared=${out.cleared}`);
      return json(out);
    } catch (e) {
      console.log(`delete: posthog_retry_failed ${errorKind(e)}`);
      return json({ error: 'server_error' }, 500);
    }
  }

  let body: unknown = {};
  const text = await req.text();
  if (text.trim() !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: 'invalid_input' }, 400);
    }
  }

  const res = await handleDelete(req.headers.get('authorization'), body, {
    ports,
    allowedAppleClientIds: parseIdList(Deno.env.get('APPLE_CLIENT_IDS')),
    async getUserByToken(jwt): Promise<UserLike | null> {
      const { data, error } = await admin.auth.getUser(jwt);
      if (error) {
        if (error.name !== 'AuthRetryableFetchError' && typeof error.status === 'number' && error.status >= 400 && error.status < 500) {
          return null;
        }
        throw new Error('auth_unavailable');
      }
      return data.user ? (data.user as unknown as UserLike) : null;
    },
    async userExists(id) {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error) {
        if (error.status === 404) return false;
        throw new Error('auth_unavailable');
      }
      return !!data.user;
    },
  });
  console.log(`delete: ${'error' in res.body ? `error=${res.body.error}` : `result=${res.body.result}`}`);
  return json(res.body, res.status);
});
