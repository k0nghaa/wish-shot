// merge-anonymous 순수 로직 — 합치기 규칙·진행 순서·요청 판정. 네트워크·DB·Storage 는 index.ts 가 포트로 주입한다.
// 근거: docs/phases/phase-22-account-login.md '확정된 결정 — 합치기', 설계 1 '합치기', 불변식 4(멱등·익명 삭제는 마지막).

/** 한 번 부를 때 처리하는 위시 수(합치기 한 번의 처리 개수 — 미결 사항 2: 서버 제안값). 앱이 partial 이면 이어 부른다. */
export const MERGE_BATCH = 20;

export type ItemRow = {
  id: string;
  user_id: string;
  category_id: string | null;
  image_key: string;
  product_name: string;
  brand: string | null;
  normalized_name: string;
  price: number | null;
  source_link: string | null;
  memo: string | null;
  tags: string[] | null;
};

export type CategoryRow = { id: string; user_id: string; name: string };

/** 같은 위시일 때 로그인 계정 위시에 채우는 값(빈 값만). */
export type FillPatch = Partial<Pick<ItemRow, 'price' | 'source_link' | 'memo' | 'tags' | 'category_id'>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

function isEmptyText(v: string | null | undefined): boolean {
  return v == null || v.trim() === '';
}

/** 태그 합치기: 로그인 쪽 순서를 앞에 두고 익명 쪽에만 있는 태그를 뒤에 붙인다(정확히 같은 글자만 같은 태그). */
export function mergeTags(target: string[] | null, anon: string[] | null): string[] | null {
  if ((target == null || target.length === 0) && (anon == null || anon.length === 0)) return target;
  const out = [...(target ?? [])];
  for (const t of anon ?? []) if (!out.includes(t)) out.push(t);
  return out;
}

/**
 * 같은 위시(브랜드+제품명 정규화가 같음): 로그인 계정 것을 남기고 비어 있는 가격·링크·메모·카테고리만 익명 값으로 채운다.
 * 태그는 합친다. 바뀌는 값만 담아 돌려준다(빈 객체면 바꿀 것 없음). 브랜드·제품명은 판정 기준이라 건드리지 않는다.
 * mappedCategoryId: 익명 위시의 카테고리를 로그인 계정에서 같은 이름으로 찾은(없으면 만든) 카테고리 id.
 */
export function planDuplicate(anon: ItemRow, target: ItemRow, mappedCategoryId: string | null): FillPatch {
  const patch: FillPatch = {};
  if (target.price == null && anon.price != null) patch.price = anon.price;
  if (isEmptyText(target.source_link) && !isEmptyText(anon.source_link)) patch.source_link = anon.source_link;
  if (isEmptyText(target.memo) && !isEmptyText(anon.memo)) patch.memo = anon.memo;
  if (target.category_id == null && mappedCategoryId != null) patch.category_id = mappedCategoryId;
  const tags = mergeTags(target.tags, anon.tags);
  if (tags != null && tags.length > (target.tags?.length ?? 0)) patch.tags = tags;
  return patch;
}

/** `{익명 id}/{파일}` → `{로그인 id}/{파일}`. 익명 폴더 밖의 키는 건드리지 않는다(null). */
export function movedKey(key: string, fromId: string, toId: string): string | null {
  const prefix = `${fromId}/`;
  return key.startsWith(prefix) ? `${toId}/${key.slice(prefix.length)}` : null;
}

/** src/lib/queries/storage.ts thumbKeyFromImageKey 와 같은 규칙. */
export function thumbKey(key: string): string {
  return key.replace(/\.jpg$/i, '_thumb.jpg');
}

export type StorageMoveResult = 'moved' | 'already_moved' | 'source_missing';

/** 합치기가 쓰는 DB·Storage 동작. 실패하면 throw(호출 쪽은 500 으로 돌려주고 앱이 다시 부른다). */
export interface MergePorts {
  /** 오래된 순으로 최대 limit 개. */
  listItems(userId: string, limit: number): Promise<ItemRow[]>;
  countItems(userId: string): Promise<number>;
  findItemsByNormalized(userId: string, names: string[]): Promise<ItemRow[]>;
  listCategories(userId: string): Promise<CategoryRow[]>;
  /** 이미 같은 이름이 있으면(동시 생성) 그 행을 돌려준다. */
  createCategory(userId: string, name: string): Promise<CategoryRow>;
  /** 로그인 계정 위시의 빈 값 채우기. */
  updateItem(itemId: string, patch: FillPatch): Promise<void>;
  /** 위시를 id 그대로 로그인 계정으로 옮긴다(where id = itemId and user_id = fromId). */
  moveItem(itemId: string, fromId: string, toId: string, patch: { image_key: string; category_id: string | null }): Promise<void>;
  /** 익명 쪽 위시 삭제. 분석 기록의 item_id 는 FK 가 비운다. */
  deleteItem(itemId: string, userId: string): Promise<void>;
  /** 분석 기록을 모두 로그인 계정으로 옮긴다. */
  moveAllLogs(fromId: string, toId: string): Promise<void>;
  storageMove(src: string, dst: string): Promise<StorageMoveResult>;
  /** 없는 키는 무시한다. */
  storageRemove(keys: string[]): Promise<void>;
  deleteAnonUser(userId: string): Promise<void>;
}

export type MergeOutcome = { status: 'done' | 'partial'; merged: number; remaining: number };

/**
 * 합치기 한 번(위시 batchSize 개까지). 위시마다 멱등이다: 중간에 실패해도 다시 부르면 남은 것부터 이어서 한다.
 * 익명 사용자는 모든 위시를 옮긴 것을 다시 세어 확인한 뒤에만 지운다(불변식 4).
 */
export async function runMergeBatch(
  ports: MergePorts,
  fromId: string,
  toId: string,
  batchSize: number = MERGE_BATCH,
): Promise<MergeOutcome> {
  const items = await ports.listItems(fromId, batchSize);
  let merged = 0;

  if (items.length > 0) {
    const anonCats = await ports.listCategories(fromId);
    const targetCats = await ports.listCategories(toId);
    const anonNameById = new Map(anonCats.map((c) => [c.id, c.name]));
    const targetIdByName = new Map(targetCats.map((c) => [c.name, c.id]));

    // 같은 이름 카테고리는 하나로: 로그인 계정에 있으면 그것을, 없으면 만든다(이름이 같은 것끼리만).
    const mapCategory = async (anonCategoryId: string | null): Promise<string | null> => {
      if (anonCategoryId == null) return null;
      const name = anonNameById.get(anonCategoryId);
      if (name === undefined) return null;
      let id = targetIdByName.get(name);
      if (id === undefined) {
        id = (await ports.createCategory(toId, name)).id;
        targetIdByName.set(name, id);
      }
      return id;
    };

    const dups = await ports.findItemsByNormalized(toId, items.map((i) => i.normalized_name));
    const dupByName = new Map(dups.map((d) => [d.normalized_name, d]));

    for (const item of items) {
      const dup = dupByName.get(item.normalized_name);
      if (dup) {
        // 같은 위시: 로그인 계정 것을 남기고 빈 값만 채운 뒤 익명 쪽을 지운다. 익명 쪽 사진도 지운다.
        const patch = planDuplicate(item, dup, await mapCategory(item.category_id));
        const own = [item.image_key, thumbKey(item.image_key)].filter((k) => k.startsWith(`${fromId}/`));
        if (own.length > 0) await ports.storageRemove(own);
        if (Object.keys(patch).length > 0) await ports.updateItem(dup.id, patch);
        await ports.deleteItem(item.id, fromId);
      } else {
        // 새 위시: id 를 유지한 채 옮긴다. 사진은 먼저 옮기고(이미 옮겨졌으면 건너뜀) 그 뒤에 행을 바꾼다 — 다시 불러도 안전하다.
        const categoryId = await mapCategory(item.category_id);
        const newKey = movedKey(item.image_key, fromId, toId);
        if (newKey != null) {
          await ports.storageMove(item.image_key, newKey);
          await ports.storageMove(thumbKey(item.image_key), thumbKey(newKey));
        }
        await ports.moveItem(item.id, fromId, toId, { image_key: newKey ?? item.image_key, category_id: categoryId });
      }
      merged++;
    }
  }

  const remaining = await ports.countItems(fromId);
  if (remaining > 0) return { status: 'partial', merged, remaining };

  // 마무리: 빈 카테고리도 옮기고(같은 이름은 하나로), 분석 기록을 옮기고, 다시 세어 확인한 뒤에만 익명 사용자를 지운다.
  const anonCats = await ports.listCategories(fromId);
  if (anonCats.length > 0) {
    const have = new Set((await ports.listCategories(toId)).map((c) => c.name));
    for (const c of anonCats) {
      if (!have.has(c.name)) {
        await ports.createCategory(toId, c.name);
        have.add(c.name);
      }
    }
  }
  await ports.moveAllLogs(fromId, toId);
  const left = await ports.countItems(fromId);
  if (left > 0) return { status: 'partial', merged, remaining: left };
  await ports.deleteAnonUser(fromId);
  return { status: 'done', merged, remaining: 0 };
}

// ---------------------------------------------------------------------------
// 요청 판정
// ---------------------------------------------------------------------------

export type AuthUser = { id: string; is_anonymous: boolean };

export type MergeDeps = {
  /** 환경의 service_role 키(운영자 경로 판별용). 없으면 운영자 경로 없음. */
  serviceRoleKey: string | null;
  /** 토큰을 서버가 검증해 사용자를 돌려준다. 무효·만료면 null. 통신 실패는 throw. */
  getUserByToken(jwt: string): Promise<AuthUser | null>;
  getUserById(id: string): Promise<AuthUser | null>;
  ports: MergePorts;
  batchSize?: number;
  /** 예기치 못한 실패를 로그로 남길 때(값은 넘기지 않고 오류만). */
  onError?: (stage: 'auth' | 'merge', error: unknown) => void;
};

export type MergeResponse =
  | { status: 200; body: MergeOutcome }
  | {
    status: 400 | 401 | 404 | 500;
    body: {
      error:
        | 'invalid_input'
        | 'unauthorized'
        | 'invalid_target_token'
        | 'invalid_anon_token'
        | 'not_anonymous'
        | 'same_user'
        | 'user_not_found'
        | 'server_error';
    };
  };

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearer(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return m ? m[1] : null;
}

/**
 * 요청 처리.
 *  - 앱 경로: Authorization = 로그인 계정 토큰, 본문 {anonAccessToken}. 둘 다 서버가 검증하고 익명 쪽은 is_anonymous 여야 한다.
 *  - 운영자 경로: Authorization = service_role 키, 본문 {fromUserId, toUserId}. from 은 익명만, to 는 익명·로그인 모두.
 */
export async function handleMerge(
  authorization: string | null,
  rawBody: unknown,
  deps: MergeDeps,
): Promise<MergeResponse> {
  const token = bearer(authorization);
  if (token == null) return { status: 401, body: { error: 'unauthorized' } };
  if (!rawBody || typeof rawBody !== 'object') return { status: 400, body: { error: 'invalid_input' } };
  const body = rawBody as Record<string, unknown>;

  let from: AuthUser | null;
  let to: AuthUser | null;
  try {
    if (deps.serviceRoleKey != null && constantTimeEqual(token, deps.serviceRoleKey)) {
      if (!isUuid(body.fromUserId) || !isUuid(body.toUserId)) return { status: 400, body: { error: 'invalid_input' } };
      if (body.fromUserId.toLowerCase() === body.toUserId.toLowerCase()) {
        return { status: 400, body: { error: 'same_user' } };
      }
      from = await deps.getUserById(body.fromUserId);
      to = await deps.getUserById(body.toUserId);
      if (!from || !to) return { status: 404, body: { error: 'user_not_found' } };
    } else {
      if (typeof body.anonAccessToken !== 'string' || body.anonAccessToken.length === 0) {
        return { status: 400, body: { error: 'invalid_input' } };
      }
      to = await deps.getUserByToken(token);
      if (!to) return { status: 401, body: { error: 'invalid_target_token' } };
      from = await deps.getUserByToken(body.anonAccessToken);
      if (!from) return { status: 401, body: { error: 'invalid_anon_token' } };
    }
  } catch (e) {
    deps.onError?.('auth', e);
    return { status: 500, body: { error: 'server_error' } };
  }

  if (from.id === to.id) return { status: 400, body: { error: 'same_user' } };
  if (!from.is_anonymous) return { status: 400, body: { error: 'not_anonymous' } };

  try {
    const outcome = await runMergeBatch(deps.ports, from.id, to.id, deps.batchSize ?? MERGE_BATCH);
    return { status: 200, body: outcome };
  } catch (e) {
    deps.onError?.('merge', e);
    return { status: 500, body: { error: 'server_error' } };
  }
}
