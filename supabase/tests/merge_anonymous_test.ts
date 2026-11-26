// merge-anonymous 순수 로직 단위 검증(네트워크·DB·Storage 없음 — 메모리 가짜 저장소에 포트를 연결해 시험한다).
// 실행: deno test --no-lock supabase/tests/merge_anonymous_test.ts
import {
  type AuthUser,
  type CategoryRow,
  type ItemRow,
  type MergePorts,
  type StorageMoveResult,
  handleMerge,
  mergeTags,
  movedKey,
  planDuplicate,
  runMergeBatch,
  thumbKey,
} from '../functions/merge-anonymous/logic.ts';

function eq(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}

const ANON = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

// ---------------------------------------------------------------------------
// 메모리 가짜 저장소 — 포트의 의미(멱등·where 조건)를 DB·Storage 처럼 흉내 낸다.
// failAt: n 번째 "변경" 동작(Storage·DB 쓰기·사용자 삭제)에서 한 번 던진다(그 뒤 호출은 정상).
// ---------------------------------------------------------------------------
class FakeWorld {
  items: ItemRow[] = [];
  categories: CategoryRow[] = [];
  logs: { id: string; user_id: string; item_id: string | null }[] = [];
  storage = new Set<string>();
  users = new Map<string, boolean>(); // id → is_anonymous
  mutations = 0;
  failAt: number | null = null;
  seq = 0;
  /** deleteAnonUser 가 불린 순간 익명 쪽에 위시가 남아 있었는지(있으면 불변식 4 위반) */
  deletedWithItemsLeft = false;

  nextId(prefix: string): string {
    this.seq++;
    return `${prefix}-${this.seq}`;
  }

  private mutate(): void {
    this.mutations++;
    if (this.failAt === this.mutations) {
      this.failAt = null;
      throw new Error('injected_failure');
    }
  }

  ports: MergePorts = {
    listItems: (userId, limit) =>
      Promise.resolve(this.items.filter((i) => i.user_id === userId).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit).map((i) => ({ ...i }))),
    countItems: (userId) => Promise.resolve(this.items.filter((i) => i.user_id === userId).length),
    findItemsByNormalized: (userId, names) =>
      Promise.resolve(this.items.filter((i) => i.user_id === userId && names.includes(i.normalized_name)).map((i) => ({ ...i }))),
    listCategories: (userId) => Promise.resolve(this.categories.filter((c) => c.user_id === userId).map((c) => ({ ...c }))),
    createCategory: (userId, name) => {
      this.mutate();
      const found = this.categories.find((c) => c.user_id === userId && c.name === name);
      if (found) return Promise.resolve({ ...found });
      const c = { id: this.nextId('cat'), user_id: userId, name };
      this.categories.push(c);
      return Promise.resolve({ ...c });
    },
    updateItem: (itemId, patch) => {
      this.mutate();
      Object.assign(this.items.find((i) => i.id === itemId)!, patch);
      return Promise.resolve();
    },
    moveItem: (itemId, fromId, toId, patch) => {
      this.mutate();
      const it = this.items.find((i) => i.id === itemId && i.user_id === fromId);
      if (it) {
        // UNIQUE(user_id, normalized_name) 흉내
        if (this.items.some((o) => o.user_id === toId && o.normalized_name === it.normalized_name)) {
          throw new Error('23505');
        }
        it.user_id = toId;
        it.image_key = patch.image_key;
        it.category_id = patch.category_id;
      }
      return Promise.resolve();
    },
    deleteItem: (itemId, userId) => {
      this.mutate();
      this.items = this.items.filter((i) => !(i.id === itemId && i.user_id === userId));
      for (const l of this.logs) if (l.item_id === itemId) l.item_id = null; // FK on delete set null
      return Promise.resolve();
    },
    moveAllLogs: (fromId, toId) => {
      this.mutate();
      for (const l of this.logs) if (l.user_id === fromId) l.user_id = toId;
      return Promise.resolve();
    },
    storageMove: (src, dst): Promise<StorageMoveResult> => {
      this.mutate();
      if (this.storage.has(src)) {
        if (this.storage.has(dst)) return Promise.resolve('already_moved');
        this.storage.delete(src);
        this.storage.add(dst);
        return Promise.resolve('moved');
      }
      return Promise.resolve(this.storage.has(dst) ? 'already_moved' : 'source_missing');
    },
    storageRemove: (keys) => {
      this.mutate();
      for (const k of keys) this.storage.delete(k);
      return Promise.resolve();
    },
    deleteAnonUser: (userId) => {
      this.mutate();
      if (this.items.some((i) => i.user_id === userId)) this.deletedWithItemsLeft = true;
      this.users.delete(userId);
      // 사용자 cascade: 남은 카테고리·기록
      this.categories = this.categories.filter((c) => c.user_id !== userId);
      this.logs = this.logs.filter((l) => l.user_id !== userId);
      return Promise.resolve();
    },
  };

  addItem(userId: string, id: string, over: Partial<ItemRow> = {}): ItemRow {
    const it: ItemRow = {
      id,
      user_id: userId,
      category_id: null,
      image_key: `${userId}/${id}.jpg`,
      product_name: id,
      brand: null,
      normalized_name: id,
      price: null,
      source_link: null,
      memo: null,
      tags: null,
      ...over,
    };
    this.items.push(it);
    this.storage.add(it.image_key);
    this.storage.add(thumbKey(it.image_key));
    return it;
  }

  addCategory(userId: string, name: string): CategoryRow {
    const c = { id: this.nextId('cat'), user_id: userId, name };
    this.categories.push(c);
    return c;
  }

  snapshot(): string {
    return JSON.stringify({
      items: [...this.items].sort((a, b) => a.id.localeCompare(b.id)).map((i) => ({
        ...i,
        category_id: this.categories.find((c) => c.id === i.category_id)?.name ?? null, // 카테고리는 id 대신 이름으로 비교
      })),
      cats: this.categories.map((c) => [c.user_id, c.name]).sort(),
      logs: this.logs.map((l) => [l.id, l.user_id, l.item_id]).sort(),
      storage: [...this.storage].sort(),
      users: [...this.users.keys()].sort(),
    });
  }
}

function seedWorld(): FakeWorld {
  const w = new FakeWorld();
  w.users.set(ANON, true);
  w.users.set(USER, false);
  const anonShoes = w.addCategory(ANON, '신발');
  const anonBags = w.addCategory(ANON, '가방');
  w.addCategory(ANON, '빈 카테고리');
  const userShoes = w.addCategory(USER, '신발');
  void userShoes;
  // 익명: 새 위시 2개 + 로그인 계정과 같은 위시 2개
  w.addItem(ANON, 'a-new1', { category_id: anonShoes.id, price: 50000, tags: ['운동'] });
  w.addItem(ANON, 'a-new2', { category_id: anonBags.id });
  w.addItem(ANON, 'a-dup1', {
    normalized_name: 'same1',
    category_id: anonShoes.id,
    price: 70000,
    source_link: 'https://anon.example/1',
    memo: '익명 메모',
    tags: ['세일', '운동'],
  });
  w.addItem(ANON, 'a-dup2', { normalized_name: 'same2', price: 1, memo: '익명 메모2' });
  // 로그인 계정: 같은 위시 2개(dup1 은 빈 값 많음, dup2 는 값이 채워져 있음) + 자기 위시 1개
  w.addItem(USER, 'u-dup1', { normalized_name: 'same1', tags: ['운동', '내태그'] });
  w.addItem(USER, 'u-dup2', {
    normalized_name: 'same2',
    price: 999,
    source_link: 'https://user.example/2',
    memo: '내 메모',
    category_id: userShoes.id,
  });
  w.addItem(USER, 'u-own', {});
  w.logs.push({ id: 'log-new', user_id: ANON, item_id: 'a-new1' });
  w.logs.push({ id: 'log-dup', user_id: ANON, item_id: 'a-dup1' });
  w.logs.push({ id: 'log-free', user_id: ANON, item_id: null });
  return w;
}

// ---------------------------------------------------------------------------
// 규칙(순수 함수)
// ---------------------------------------------------------------------------
Deno.test('planDuplicate: 로그인 계정 값을 남기고 빈 가격·링크·메모·카테고리만 채운다', () => {
  const w = seedWorld();
  const anon = w.items.find((i) => i.id === 'a-dup1')!;
  const target = w.items.find((i) => i.id === 'u-dup1')!;
  eq(planDuplicate(anon, target, 'cat-x'), {
    price: 70000,
    source_link: 'https://anon.example/1',
    memo: '익명 메모',
    category_id: 'cat-x',
    tags: ['운동', '내태그', '세일'],
  });
  // 채워진 값은 건드리지 않는다
  const full = w.items.find((i) => i.id === 'u-dup2')!;
  eq(planDuplicate(w.items.find((i) => i.id === 'a-dup2')!, full, 'cat-y'), {});
  // 공백뿐인 메모·링크는 빈 값으로 본다
  eq(planDuplicate(anon, { ...target, memo: '  ', source_link: '' }, null).memo, '익명 메모');
});

Deno.test('mergeTags: 로그인 쪽 순서 뒤에 익명 쪽만 붙이고 중복은 하나로', () => {
  eq(mergeTags(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
  eq(mergeTags(null, ['x']), ['x']);
  eq(mergeTags(['a'], null), ['a']);
  eq(mergeTags(null, null), null);
});

Deno.test('movedKey·thumbKey: 익명 폴더만 로그인 폴더로 바꾼다', () => {
  eq(movedKey(`${ANON}/i1.jpg`, ANON, USER), `${USER}/i1.jpg`);
  eq(movedKey(`${OTHER}/i1.jpg`, ANON, USER), null);
  eq(thumbKey(`${USER}/i1.jpg`), `${USER}/i1_thumb.jpg`);
});

// ---------------------------------------------------------------------------
// 합치기 한 번(전부)
// ---------------------------------------------------------------------------
Deno.test('합치기: 새 위시는 id 를 유지하고 image_key 경로만 바뀌며 사진(원본·썸네일)이 옮겨진다', async () => {
  const w = seedWorld();
  const r = await runMergeBatch(w.ports, ANON, USER);
  eq(r, { status: 'done', merged: 4, remaining: 0 });
  for (const id of ['a-new1', 'a-new2']) {
    const it = w.items.find((i) => i.id === id)!;
    eq(it.user_id, USER, `${id} 주인`);
    eq(it.image_key, `${USER}/${id}.jpg`, `${id} 키`);
    eq(w.storage.has(`${USER}/${id}.jpg`) && w.storage.has(`${USER}/${id}_thumb.jpg`), true, `${id} 사진 이동`);
    eq(w.storage.has(`${ANON}/${id}.jpg`) || w.storage.has(`${ANON}/${id}_thumb.jpg`), false, `${id} 옛 사진 없음`);
  }
  eq(w.items.find((i) => i.id === 'a-new1')!.price, 50000);
  eq(w.items.find((i) => i.id === 'a-new1')!.tags, ['운동']);
});

Deno.test('합치기: 같은 위시는 로그인 계정 것을 남기고 빈 값만 채우며 태그를 합치고 익명 사진을 지운다', async () => {
  const w = seedWorld();
  await runMergeBatch(w.ports, ANON, USER);
  eq(w.items.some((i) => i.id === 'a-dup1' || i.id === 'a-dup2'), false, '익명 쪽 위시 삭제');
  const d1 = w.items.find((i) => i.id === 'u-dup1')!;
  eq(d1.price, 70000);
  eq(d1.source_link, 'https://anon.example/1');
  eq(d1.memo, '익명 메모');
  eq(d1.tags, ['운동', '내태그', '세일']);
  eq(w.categories.find((c) => c.id === d1.category_id)?.name, '신발', '카테고리도 같은 이름으로 채움');
  const d2 = w.items.find((i) => i.id === 'u-dup2')!;
  eq([d2.price, d2.source_link, d2.memo], [999, 'https://user.example/2', '내 메모'], '채워진 값은 그대로');
  // 사진: 익명 쪽은 지워지고 로그인 쪽 사진은 건드리지 않는다
  eq(w.storage.has(`${ANON}/a-dup1.jpg`) || w.storage.has(`${ANON}/a-dup1_thumb.jpg`), false);
  eq(w.storage.has(`${USER}/u-dup1.jpg`) && w.storage.has(`${USER}/u-dup1_thumb.jpg`), true);
  eq(w.storage.has(`${USER}/a-dup1.jpg`), false, '같은 위시의 익명 사진을 로그인 폴더로 옮기지 않는다');
});

Deno.test('합치기: 같은 이름 카테고리는 하나로, 빈 카테고리도 옮긴다, 분석 기록도 옮긴다', async () => {
  const w = seedWorld();
  await runMergeBatch(w.ports, ANON, USER);
  const userCats = w.categories.filter((c) => c.user_id === USER).map((c) => c.name).sort();
  eq(userCats, ['가방', '빈 카테고리', '신발'], '신발은 하나');
  eq(w.categories.filter((c) => c.name === '신발').length, 1);
  const bag = w.items.find((i) => i.id === 'a-new2')!;
  eq(w.categories.find((c) => c.id === bag.category_id), { id: bag.category_id, user_id: USER, name: '가방' });
  eq(w.logs.map((l) => [l.id, l.user_id]).sort(), [['log-dup', USER], ['log-free', USER], ['log-new', USER]]);
  eq(w.logs.find((l) => l.id === 'log-new')!.item_id, 'a-new1', '옮겨진 위시의 기록은 위시를 가리킨다');
  eq(w.logs.find((l) => l.id === 'log-dup')!.item_id, null, '같은 위시로 합쳐진 쪽 기록은 위시 연결이 끊긴다');
});

Deno.test('합치기: 익명 사용자는 모두 옮긴 뒤에만 지워진다', async () => {
  const w = seedWorld();
  const r = await runMergeBatch(w.ports, ANON, USER);
  eq(r.status, 'done');
  eq(w.deletedWithItemsLeft, false);
  eq(w.users.has(ANON), false);
  eq(w.items.filter((i) => i.user_id === ANON).length, 0);
  eq(w.users.has(USER), true);
});

Deno.test('합치기 partial → done: 정한 개수씩 처리하고 앱이 이어 부른다(익명 삭제는 마지막 호출에서만)', async () => {
  const w = seedWorld();
  const first = await runMergeBatch(w.ports, ANON, USER, 3);
  eq(first, { status: 'partial', merged: 3, remaining: 1 });
  eq(w.users.has(ANON), true, 'partial 에선 익명 사용자가 남아 있다');
  const second = await runMergeBatch(w.ports, ANON, USER, 3);
  eq(second, { status: 'done', merged: 1, remaining: 0 });
  eq(w.users.has(ANON), false);
  // 이미 끝난 뒤에 다시 불러도 안전하다(익명 사용자가 없어도 위시가 0 이면 done)
  const third = await runMergeBatch(w.ports, ANON, USER, 3);
  eq(third.merged, 0);
});

Deno.test('합치기 멱등: 어느 동작에서 실패해도 다시 부르면 이어서 해 결과가 한 번에 한 것과 같고 중복이 없다', async () => {
  const baseline = seedWorld();
  await runMergeBatch(baseline.ports, ANON, USER);
  const expected = baseline.snapshot();
  const total = baseline.mutations;
  eq(total > 10, true, '변경 동작 수 확인');

  for (let k = 1; k <= total; k++) {
    const w = seedWorld();
    w.failAt = k;
    let failures = 0;
    let done = false;
    for (let attempt = 0; attempt < 20 && !done; attempt++) {
      try {
        const r = await runMergeBatch(w.ports, ANON, USER);
        if (r.status === 'done') done = true;
      } catch {
        failures++;
        // 실패한 시점에 익명 사용자는 아직 있어야 한다(마지막에만 지움)
        eq(w.users.has(ANON), true, `실패 ${k}: 익명 사용자가 일찍 지워짐`);
      }
    }
    eq(done, true, `실패 ${k}: 끝나지 않음`);
    eq(failures, 1, `실패 ${k}: 한 번만 실패`);
    eq(w.snapshot(), expected, `실패 ${k}: 결과가 다름`);
    eq(w.deletedWithItemsLeft, false, `실패 ${k}`);
  }
});

Deno.test('합치기 멱등: partial 뒤에 중간 실패가 끼어도 이어서 끝난다', async () => {
  const baseline = seedWorld();
  await runMergeBatch(baseline.ports, ANON, USER);
  const w = seedWorld();
  eq((await runMergeBatch(w.ports, ANON, USER, 2)).status, 'partial');
  w.failAt = w.mutations + 3;
  let threw = false;
  try {
    await runMergeBatch(w.ports, ANON, USER, 2);
  } catch {
    threw = true;
  }
  eq(threw, true);
  eq((await runMergeBatch(w.ports, ANON, USER, 2)).status, 'done');
  eq(w.snapshot(), baseline.snapshot());
});

Deno.test('합치기: 사진이 이미 옮겨졌거나(재시도) 썸네일이 없는 옛 위시도 계속 진행한다', async () => {
  const w = new FakeWorld();
  w.users.set(ANON, true);
  w.users.set(USER, false);
  w.addItem(ANON, 'old1');
  w.storage.delete(`${ANON}/old1_thumb.jpg`); // 썸네일 없음
  w.addItem(ANON, 'half1');
  // half1: 원본·썸네일을 이전 시도에서 이미 옮겼는데 행은 그대로
  w.storage.delete(`${ANON}/half1.jpg`);
  w.storage.delete(`${ANON}/half1_thumb.jpg`);
  w.storage.add(`${USER}/half1.jpg`);
  w.storage.add(`${USER}/half1_thumb.jpg`);
  const r = await runMergeBatch(w.ports, ANON, USER);
  eq(r.status, 'done');
  eq(w.items.map((i) => [i.id, i.user_id, i.image_key]).sort(), [['half1', USER, `${USER}/half1.jpg`], ['old1', USER, `${USER}/old1.jpg`]]);
});

Deno.test('합치기: 익명 폴더 밖의 사진 키는 건드리지 않고 지우지도 않는다', async () => {
  const w = new FakeWorld();
  w.users.set(ANON, true);
  w.users.set(USER, false);
  const odd = w.addItem(ANON, 'odd1', { image_key: `${OTHER}/odd1.jpg` });
  w.addItem(USER, 'u-odd', { normalized_name: 'odd1x' });
  w.addItem(ANON, 'odd2', { image_key: `${OTHER}/odd2.jpg`, normalized_name: 'odd1x' }); // 같은 위시
  await runMergeBatch(w.ports, ANON, USER);
  eq(odd.image_key, `${OTHER}/odd1.jpg`);
  eq(odd.user_id, USER);
  eq(w.storage.has(`${OTHER}/odd1.jpg`) && w.storage.has(`${OTHER}/odd2.jpg`), true, '남의 폴더 파일은 그대로');
});

Deno.test('합치기: 익명 위시가 0개여도(카테고리만) 끝까지 가서 익명 사용자를 지운다', async () => {
  const w = new FakeWorld();
  w.users.set(ANON, true);
  w.users.set(USER, false);
  w.addCategory(ANON, '비어 있음');
  eq(await runMergeBatch(w.ports, ANON, USER), { status: 'done', merged: 0, remaining: 0 });
  eq(w.categories.map((c) => [c.user_id, c.name]), [[USER, '비어 있음']]);
});

Deno.test('합치기: 동시에 같은 위시가 로그인 계정에 생겨 UNIQUE 에 걸리면 실패 뒤 다시 불러 같은 위시로 합친다', async () => {
  const w = new FakeWorld();
  w.users.set(ANON, true);
  w.users.set(USER, false);
  w.addItem(ANON, 'race1', { normalized_name: 'racey', price: 10 });
  // 목록을 읽은 뒤(같은 위시가 없다고 본 뒤) 로그인 쪽에 생긴 것을 흉내: listItems 후 첫 findItems 가 빈 결과를 돌려주게 한다
  const real = w.ports.findItemsByNormalized;
  w.ports.findItemsByNormalized = () => Promise.resolve([]);
  w.addItem(USER, 'u-race', { normalized_name: 'racey' });
  let threw = false;
  try {
    await runMergeBatch(w.ports, ANON, USER);
  } catch {
    threw = true;
  }
  eq(threw, true, 'UNIQUE 위반은 실패로 올라온다');
  eq(w.users.has(ANON), true);
  w.ports.findItemsByNormalized = real;
  eq((await runMergeBatch(w.ports, ANON, USER)).status, 'done');
  eq(w.items.find((i) => i.id === 'u-race')!.price, 10, '빈 가격을 채움');
});

// ---------------------------------------------------------------------------
// 요청 판정(앱 경로·운영자 경로)
// ---------------------------------------------------------------------------
const SERVICE_KEY = 'service-role-key-for-tests';

function deps(w: FakeWorld, users: Record<string, AuthUser | null> = {}) {
  return {
    serviceRoleKey: SERVICE_KEY,
    getUserByToken: (jwt: string) => Promise.resolve(users[jwt] ?? null),
    getUserById: (id: string) => Promise.resolve(Object.values(users).find((u) => u?.id === id) ?? null),
    ports: w.ports,
  };
}

const anonUser: AuthUser = { id: ANON, is_anonymous: true };
const loginUser: AuthUser = { id: USER, is_anonymous: false };
const otherLogin: AuthUser = { id: OTHER, is_anonymous: false };

Deno.test('요청(앱 경로): 두 토큰이 모두 유효하고 익명 쪽이 익명이면 합친다', async () => {
  const w = seedWorld();
  const res = await handleMerge('Bearer login-token', { anonAccessToken: 'anon-token' }, deps(w, { 'login-token': loginUser, 'anon-token': anonUser }));
  eq([res.status, res.body], [200, { status: 'done', merged: 4, remaining: 0 }]);
});

Deno.test('요청(앱 경로): 토큰 무효·헤더 없음·본문 오류', async () => {
  const w = seedWorld();
  const d = deps(w, { 'login-token': loginUser, 'anon-token': anonUser });
  eq((await handleMerge(null, { anonAccessToken: 'anon-token' }, d)).body, { error: 'unauthorized' });
  eq((await handleMerge('Bearer bad', { anonAccessToken: 'anon-token' }, d)).body, { error: 'invalid_target_token' });
  eq((await handleMerge('Bearer login-token', { anonAccessToken: 'bad' }, d)).body, { error: 'invalid_anon_token' });
  eq((await handleMerge('Bearer login-token', {}, d)).body, { error: 'invalid_input' });
  eq((await handleMerge('Bearer login-token', null, d)).status, 400);
  eq(w.users.has(ANON), true, '거절된 요청은 아무것도 바꾸지 않는다');
  eq(w.mutations, 0);
});

Deno.test('요청(앱 경로): 익명 쪽이 익명이 아니면 not_anonymous, 같은 사용자면 same_user', async () => {
  const w = seedWorld();
  const d = deps(w, { 'login-token': loginUser, 'other-login': otherLogin, 'anon-token': anonUser });
  const notAnon = await handleMerge('Bearer login-token', { anonAccessToken: 'other-login' }, d);
  eq([notAnon.status, notAnon.body], [400, { error: 'not_anonymous' }]);
  const same = await handleMerge('Bearer anon-token', { anonAccessToken: 'anon-token' }, d);
  eq([same.status, same.body], [400, { error: 'same_user' }]);
  eq(w.mutations, 0);
});

Deno.test('요청(운영자 경로): service_role 키 + from/to — from 은 익명만, to 는 익명·로그인 모두', async () => {
  const w = seedWorld();
  const d = deps(w, { a: anonUser, b: loginUser, c: otherLogin });
  const bearer = `Bearer ${SERVICE_KEY}`;
  eq((await handleMerge(bearer, { fromUserId: USER, toUserId: OTHER }, d)).body, { error: 'not_anonymous' }, 'from 이 로그인 계정');
  eq((await handleMerge(bearer, { fromUserId: ANON, toUserId: ANON }, d)).body, { error: 'same_user' });
  eq((await handleMerge(bearer, { fromUserId: ANON.toUpperCase(), toUserId: ANON }, d)).body, { error: 'same_user' }, '대소문자 달라도 같은 사용자');
  eq((await handleMerge(bearer, { fromUserId: ANON, toUserId: '44444444-4444-4444-8444-444444444444' }, d)).body, { error: 'user_not_found' });
  eq((await handleMerge(bearer, { fromUserId: 'not-a-uuid', toUserId: USER }, d)).body, { error: 'invalid_input' });
  eq(w.mutations, 0);
  const ok = await handleMerge(bearer, { fromUserId: ANON, toUserId: USER }, d);
  eq([ok.status, ok.body], [200, { status: 'done', merged: 4, remaining: 0 }]);

  // to 가 익명 계정이어도 허용
  const w2 = new FakeWorld();
  const anon2: AuthUser = { id: OTHER, is_anonymous: true };
  w2.users.set(ANON, true);
  w2.users.set(OTHER, true);
  w2.addItem(ANON, 'x1');
  const ok2 = await handleMerge(bearer, { fromUserId: ANON, toUserId: OTHER }, deps(w2, { a: anonUser, b: anon2 }));
  eq(ok2.status, 200);
});

Deno.test('요청: 합치는 중 실패하면 500 server_error 이고 익명 사용자는 남아 있다(다시 부르면 이어서)', async () => {
  const w = seedWorld();
  w.failAt = 4;
  const logged: string[] = [];
  const d = { ...deps(w, { l: loginUser, a: anonUser }), onError: (stage: string) => { logged.push(stage); } };
  const res = await handleMerge('Bearer l', { anonAccessToken: 'a' }, d);
  eq([res.status, res.body], [500, { error: 'server_error' }]);
  eq(logged, ['merge']);
  eq(w.users.has(ANON), true);
  const again = await handleMerge('Bearer l', { anonAccessToken: 'a' }, d);
  eq(again.status, 200);
  eq(w.users.has(ANON), false);
});
