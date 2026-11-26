// merge-anonymous(합치기) — 익명 계정의 위시를 로그인 계정으로 옮기는 Edge Function (Deno, service_role).
// 근거: docs/phases/phase-22-account-login.md '확정된 결정 — 합치기', 설계 1, 불변식 4.
//
// 계약:
//   앱 경로:    Authorization: Bearer <로그인 계정 access token>, 본문 { "anonAccessToken": string }
//               — 두 토큰을 모두 서버가 검증하고, 익명 쪽은 is_anonymous 여야 한다.
//   운영자 경로: Authorization: Bearer <service_role 키>, 본문 { "fromUserId": uuid, "toUserId": uuid }
//               — from 은 익명만, to 는 익명·로그인 모두. (끊긴 세션 문의 복구용 — 운영자가 실행한다)
//   출력:  200 { "status": "done" | "partial", "merged": number, "remaining": number }
//            merged = 이번 호출에서 처리한 위시 수, remaining = 익명 쪽에 남은 위시 수. partial 이면 앱이 이어 부른다.
//            done 이면 익명 사용자를 지운 것이다(마지막에, 모두 옮겼는지 다시 세어 확인한 뒤에만).
//          400 { "error": "invalid_input" | "same_user" | "not_anonymous" }
//          401 { "error": "unauthorized" | "invalid_target_token" | "invalid_anon_token" }
//          404 { "error": "user_not_found" }(운영자 경로), 500 { "error": "server_error" }, 405 method_not_allowed
//
// 규칙(logic.ts):
//   - 위시는 id 를 유지한 채 옮긴다(user_id·image_key 만 바뀜). 사진은 {익명 id}/ → {로그인 id}/ 로 Storage move(원본·썸네일).
//   - 같은 위시(normalized_name 이 같음)는 로그인 계정 것을 남기고 빈 가격·링크·메모·카테고리만 채우고 태그를 합친다. 익명 쪽 사진은 지운다.
//   - 같은 이름 카테고리는 하나로(없으면 로그인 계정에 만든다. 빈 카테고리도 옮긴다).
//   - 위시마다 멱등: 사진을 먼저 옮기고 행을 바꾸며, 이미 옮겨진 것은 건너뛴다. 중간에 실패하면 500 — 다시 부르면 이어서 한다.
//   - 분석 기록은 마지막에 로그인 계정으로 옮긴다.
//
// 인증: verify_jwt = false(supabase/config.toml) — 토큰은 함수 안에서 Auth 서버로 직접 검증한다(운영자 경로의 service_role 키가
//   JWT 형식이 아니어도 통과하도록). 키·토큰은 로그에 남기지 않는다. 소셜 토큰은 다루지 않는다.
// 로그: 결과 종류·개수만. 사용자 id·위시 내용은 남기지 않는다.
// 배포(사람): npx supabase@2.121.0 functions deploy merge-anonymous  (0009 적용 뒤 — items 등 service_role grant 포함)

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  type AuthUser,
  type CategoryRow,
  type ItemRow,
  type MergePorts,
  type StorageMoveResult,
  handleMerge,
} from './logic.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BUCKET = 'item-images';
const ITEM_COLUMNS =
  'id,user_id,category_id,image_key,product_name,brand,normalized_name,price,source_link,memo,tags';

const admin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// 오류에서 종류만 뽑는다(메시지엔 값이 섞일 수 있어 로그에 남기지 않는다).
function errorKind(e: unknown): string {
  if (e && typeof e === 'object') {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
    const name = (e as { name?: unknown }).name;
    if (typeof name === 'string' && name) return name;
  }
  return 'unknown';
}

function db() {
  if (!admin) throw new Error('no_service_key');
  return admin;
}

function check(error: { code?: string; message?: string } | null, what: string): void {
  if (error) throw new Error(`${what}:${error.code ?? 'error'}`);
}

async function objectExists(path: string): Promise<boolean> {
  const slash = path.lastIndexOf('/');
  const folder = slash >= 0 ? path.slice(0, slash) : '';
  const name = path.slice(slash + 1);
  const { data, error } = await db().storage.from(BUCKET).list(folder, { limit: 5, search: name });
  check(error, 'storage_list');
  return (data ?? []).some((o: { name: string }) => o.name === name);
}

const ports: MergePorts = {
  async listItems(userId, limit) {
    const { data, error } = await db()
      .from('items')
      .select(ITEM_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit);
    check(error, 'list_items');
    return (data ?? []) as ItemRow[];
  },
  async countItems(userId) {
    const { count, error } = await db().from('items').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    check(error, 'count_items');
    return count ?? 0;
  },
  async findItemsByNormalized(userId, names) {
    if (names.length === 0) return [];
    const { data, error } = await db()
      .from('items')
      .select(ITEM_COLUMNS)
      .eq('user_id', userId)
      .in('normalized_name', names);
    check(error, 'find_items');
    return (data ?? []) as ItemRow[];
  },
  async listCategories(userId) {
    const { data, error } = await db().from('categories').select('id,user_id,name').eq('user_id', userId);
    check(error, 'list_categories');
    return (data ?? []) as CategoryRow[];
  },
  async createCategory(userId, name) {
    const ins = await db().from('categories').insert({ user_id: userId, name }).select('id,user_id,name').single();
    if (!ins.error) return ins.data as CategoryRow;
    if (ins.error.code !== '23505') check(ins.error, 'create_category');
    // 동시에 같은 이름이 만들어졌다 — 그 행을 쓴다
    const sel = await db().from('categories').select('id,user_id,name').eq('user_id', userId).eq('name', name).single();
    check(sel.error, 'create_category_reselect');
    return sel.data as CategoryRow;
  },
  async updateItem(itemId, patch) {
    const { error } = await db().from('items').update(patch).eq('id', itemId);
    check(error, 'update_item');
  },
  async moveItem(itemId, fromId, toId, patch) {
    const { error } = await db()
      .from('items')
      .update({ user_id: toId, image_key: patch.image_key, category_id: patch.category_id })
      .eq('id', itemId)
      .eq('user_id', fromId);
    check(error, 'move_item');
  },
  async deleteItem(itemId, userId) {
    const { error } = await db().from('items').delete().eq('id', itemId).eq('user_id', userId);
    check(error, 'delete_item');
  },
  async moveAllLogs(fromId, toId) {
    const { error } = await db().from('analysis_logs').update({ user_id: toId }).eq('user_id', fromId);
    check(error, 'move_logs');
  },
  async storageMove(src, dst): Promise<StorageMoveResult> {
    const { error } = await db().storage.from(BUCKET).move(src, dst);
    if (!error) return 'moved';
    // 실패 원인을 존재 여부로 가른다: 이미 옮겨졌거나(대상이 있음) 원본이 없거나(옛 위시의 없는 썸네일 등)
    if (await objectExists(dst)) return 'already_moved';
    if (!(await objectExists(src))) return 'source_missing';
    throw new Error('storage_move');
  },
  async storageRemove(keys) {
    const { error } = await db().storage.from(BUCKET).remove(keys);
    check(error, 'storage_remove');
  },
  async deleteAnonUser(userId) {
    const { error } = await db().auth.admin.deleteUser(userId);
    check(error, 'delete_user');
  },
};

function toAuthUser(u: { id: string; is_anonymous?: boolean }): AuthUser {
  return { id: u.id, is_anonymous: u.is_anonymous === true };
}

// Auth 서버 오류 중 "토큰이 틀림"만 null, 서버·통신 오류는 던진다.
function isTokenRejection(error: { status?: number; name?: string }): boolean {
  if (error.name === 'AuthRetryableFetchError') return false;
  return typeof error.status === 'number' && error.status >= 400 && error.status < 500;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!admin) {
    console.log('merge: no_service_key');
    return json({ error: 'server_error' }, 500);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_input' }, 400);
  }

  const res = await handleMerge(req.headers.get('authorization'), body, {
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY ?? null,
    async getUserByToken(jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      if (error) {
        if (isTokenRejection(error)) return null;
        throw new Error('auth_unavailable');
      }
      return data.user ? toAuthUser(data.user) : null;
    },
    async getUserById(id) {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error) {
        if (error.status === 404) return null;
        throw new Error('auth_unavailable');
      }
      return data.user ? toAuthUser(data.user) : null;
    },
    ports,
    onError: (stage, e) => console.log(`merge: ${stage}_failed ${e instanceof Error ? e.message.split(':')[0] : errorKind(e)}`),
  }).catch((e) => {
    console.log(`merge: unexpected ${errorKind(e)}`);
    return { status: 500 as const, body: { error: 'server_error' as const } };
  });

  console.log(
    'error' in res.body
      ? `merge: error=${res.body.error}`
      : `merge: status=${res.body.status} merged=${res.body.merged} remaining=${res.body.remaining}`,
  );
  return json(res.body, res.status);
});
