// 세션 저장 어댑터·앱 시작 판정(src/lib/sessionVault.ts — import 없는 순수 TS) 시험.
// 설치된 @supabase/supabase-js 를 가짜 서버·가짜 AsyncStorage 에 연결한다(외부 접속·키 없음, node_modules 필요).
// - 가짜 서버: Supabase Auth 의 refreshToken 교체·재사용 규칙. 한 단계 전 토큰과 교체 뒤 10초 안은 받아 주고,
//   그보다 낡은 토큰이 오면 세션을 끝낸다.
// - 가짜 저장소: iOS AsyncStorage 2.2 의 규칙. 1024자 이하는 목록(manifest) 안, 넘으면 파일. 파일 읽기에 실패하면
//   그 키를 메모리 목록에서 빼서 다음 읽기가 오류 없이 "없음"이 되고, 다른 값을 저장하면 디스크에도 그렇게 남는다.
// - 시간은 20배속: auth-js 의 재발급 재시도(약 27초)·실패 뒤 60초 제한·30초 자동 갱신을 그대로 거친다.
// 실행: deno test --no-lock supabase/tests/session_vault_test.ts  (약 30초)
// 고치기 전 동작(1.1.0 의 시작 코드 + AsyncStorage 그대로)으로 같은 사례를 돌린다 — 실패하는 것이 정상:
//   deno test --no-lock supabase/tests/session_vault_test.ts -- --baseline
import { createClient } from '@supabase/supabase-js';

import {
  createSessionVault,
  isSessionRejected,
  runStartOver,
  SESSION_ARCHIVE_KEY,
  SESSION_COPY_KEY,
  type SessionAuth,
  type SessionVault,
} from '../../src/lib/sessionVault.ts';

// ── 시험용 세션 확인 ──────────────────────────────────────────
// 세션 저장 어댑터가 auth-js 의 세션 지우기·읽기 실패·재발급 재시도와 맞물려 동작하는지 보려고, getSession(재발급을 기다림)으로
// 세션을 확인하는 코드다. 앱의 첫 화면 판정은 통신 없이 기기 값만 읽으므로(src/lib/accountLogic.ts, 시험은 account_logic_test.ts)
// 이 코드를 쓰지 않는다. 다만 결과는 지금 앱의 규칙을 따른다 — 새 익명 계정은 사용자가 "로그인 없이 시작"을 고를 때만
// 만든다(불변식 1). 세션이 없으면(새 설치·위시 흔적 없는 거절) 계정을 만들지 않고 로그인 화면(signin)이다.
// userId: 이 기기에 저장된 계정의 사용자 id(문의 번호용). 모르면 null.
type BootResult =
  | { status: 'ready' } // 저장된 세션으로 쓸 수 있음
  | { status: 'signin' } // 세션 없음 + 잃을 위시 없음(새 설치·위시 흔적 없는 거절) — 로그인 화면, 새 계정을 만들지 않음
  | { status: 'offline'; userId: string | null } // 확인하지 못함(통신·서버·저장소 오류). auth-js 의 자동 갱신으로 다시 확인한다
  | { status: 'lost'; userId: string | null }; // 서버가 세션을 거절했거나 저장값이 사라짐(위시 흔적 있음) — 알림창 C


/**
 * 시험 실행마다 1회. 새 계정은 만들지 않는다.
 * 같은 실행 안에서 다시 부르지 않는다 — 재발급 실패 뒤 60초 동안 auth-js 가 저장해 둔 실패를 돌려준다.
 */
async function runSessionBootstrap(auth: SessionAuth, vault: SessionVault): Promise<BootResult> {
  const offline = async (): Promise<BootResult> => ({
    status: 'offline',
    userId: await vault.inquiryUserId(),
  });
  let result: Awaited<ReturnType<SessionAuth['getSession']>>;
  try {
    result = await auth.getSession();
  } catch {
    return offline();
  }
  if (result.data.session) return { status: 'ready' };
  if (result.error) return isSessionRejected(result.error) ? lostOrSignIn(vault) : offline();
  const state = vault.state();
  if (state === 'corrupt') return lostOrSignIn(vault);
  if (state !== 'none') return offline();
  let used: boolean;
  try {
    used = await vault.hasUsageTrace();
  } catch {
    return offline();
  }
  return used ? lostOrSignIn(vault) : { status: 'signin' };
}

// 끊긴 세션: 위시를 저장한 흔적이 있으면(모르면) 끊긴 세션(알림창 C), 없으면 새 설치와 같은 로그인 화면. 어느 쪽도 계정을 만들지 않는다.
async function lostOrSignIn(vault: SessionVault): Promise<BootResult> {
  const userId = await vault.inquiryUserId();
  let hadWishes: boolean;
  try {
    hadWishes = await vault.hasWishTrace();
  } catch {
    hadWishes = true;
  }
  return hadWishes ? { status: 'lost', userId } : { status: 'signin' };
}



const BASELINE = Deno.args.includes('--baseline');
// 고치기 전 코드는 저장소 읽기 오류가 auth-js 안에서 처리되지 않은 오류가 되어 시험 실행기를 멈춘다 — 비교 실행에서만 삼킨다.
if (BASELINE) globalThis.addEventListener('unhandledrejection', (e) => e.preventDefault());
const SUPABASE_URL = 'https://abcd.supabase.co';
const KEY = 'sb-abcd-auth-token'; // supabase-js 기본 저장 키

function eq(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}

// ── 가짜 AsyncStorage ───────────────────────────────────────
class FakeAsyncStorage {
  disk = new Map<string, string | null>(); // 디스크의 목록(manifest). null = 값은 파일에
  files = new Map<string, string>();
  mem = new Map<string, string | null>(); // 실행 중 메모리의 목록
  failFileReads = 0; // 남은 파일 읽기 실패 횟수
  failKeys = new Set<string>(); // 이 키는 읽기·쓰기 모두 실패
  relaunch() {
    this.mem = new Map(this.disk);
  }
  getItem = (k: string): Promise<string | null> => {
    if (this.failKeys.has(k)) return Promise.reject(new Error(`read failed ${k}`));
    const v = this.mem.get(k);
    if (v === undefined) return Promise.resolve(null);
    if (v !== null) return Promise.resolve(v);
    if (this.failFileReads > 0) {
      this.failFileReads--;
      this.mem.delete(k);
      return Promise.reject(new Error('Failed to read storage file.'));
    }
    const f = this.files.get(k);
    if (f === undefined) {
      this.mem.delete(k);
      return Promise.resolve(null);
    }
    return Promise.resolve(f);
  };
  setItem = (k: string, v: string): Promise<void> => {
    if (this.failKeys.has(k)) return Promise.reject(new Error(`write failed ${k}`));
    if (v.length <= 1024) {
      this.files.delete(k);
      this.mem.set(k, v);
      this.disk = new Map(this.mem);
    } else {
      this.files.set(k, v);
      if (this.mem.get(k) !== null) {
        this.mem.set(k, null);
        this.disk = new Map(this.mem);
      }
    }
    return Promise.resolve();
  };
  removeItem = (k: string): Promise<void> => {
    this.files.delete(k);
    if (this.mem.delete(k)) this.disk = new Map(this.mem);
    return Promise.resolve();
  };
  getAllKeys = (): Promise<readonly string[]> => Promise.resolve([...this.mem.keys()]);
  peek(k: string): string | null {
    const v = this.mem.has(k) ? this.mem.get(k) : this.disk.get(k);
    if (v === undefined) return null;
    return v ?? this.files.get(k) ?? null;
  }
}

// ── 가짜 서버 ───────────────────────────────────────────────
const jres = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
  });
const html = (status: number) => new Response('<html>blocked</html>', { status, headers: { 'content-type': 'text/html' } });
const authError = (status: number, code: string) => jres(status, { code, error_code: code, msg: code });

function sessionFor(user: string, n: number) {
  return {
    access_token: `h.${'x'.repeat(900)}.${Math.random()}`, // 실제 세션처럼 1024자를 넘겨 파일에 저장되게 한다
    refresh_token: `${user}#${n}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: user, aud: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: '' },
  };
}

class FakeAuthServer {
  chains = new Map<string, { active: number; dead: boolean; rotatedAt: number }>();
  signups = 0;
  staleUses = 0; // 낡은 refreshToken 이 와서 세션을 끝낸 횟수
  signupBodies: { data?: Record<string, unknown> }[] = [];
  seq = 0;
  create(user: string) {
    this.chains.set(user, { active: 0, dead: false, rotatedAt: 0 });
    return sessionFor(user, 0);
  }
  signup(body: { data?: Record<string, unknown> }) {
    this.signups++;
    this.signupBodies.push(body);
    return jres(200, this.create(`NEW${++this.seq}`));
  }
  refresh(token: string) {
    const [user, ns] = token.split('#');
    const chain = this.chains.get(user);
    const n = Number(ns);
    if (!chain || chain.dead) return authError(400, 'refresh_token_not_found');
    const diff = chain.active - n;
    if (diff === 0) {
      chain.active++;
      chain.rotatedAt = Date.now();
      return jres(200, sessionFor(user, chain.active));
    }
    if (diff === 1 || Date.now() - chain.rotatedAt < 10e3) return jres(200, sessionFor(user, chain.active));
    chain.dead = true;
    this.staleUses++;
    return authError(400, 'refresh_token_already_used');
  }
}

// ── 20배속 시계 ─────────────────────────────────────────────
const SPEED = 20;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withFastClock<T>(fn: () => Promise<T>): Promise<T> {
  const realNow = Date.now;
  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;
  const realWarn = console.warn;
  const realError = console.error;
  const t0 = realNow();
  Date.now = () => t0 + (realNow() - t0) * SPEED;
  // deno-lint-ignore no-explicit-any
  globalThis.setTimeout = ((f: any, ms = 0, ...a: any[]) => realSetTimeout(f, ms / SPEED, ...a)) as typeof setTimeout;
  // deno-lint-ignore no-explicit-any
  globalThis.setInterval = ((f: any, ms = 0, ...a: any[]) => realSetInterval(f, ms / SPEED, ...a)) as typeof setInterval;
  console.warn = () => {}; // auth-js 의 경고(재시도·세션 경고)를 숨긴다
  console.error = () => {};
  try {
    return await fn();
  } finally {
    Date.now = realNow;
    globalThis.setTimeout = realSetTimeout;
    globalThis.setInterval = realSetInterval;
    console.warn = realWarn;
    console.error = realError;
  }
}

// ── 한 번의 실행(앱 프로세스) ────────────────────────────────
type Kind = 'fixed' | 'legacy';
type Net = (t: number, kind: 'token' | 'signup') => Response | 'down' | null;
const ok: Net = () => null;
const until = (ms: number, r: () => Response | 'down'): Net => (t) => (t < ms ? r() : null);
const tokenOnly = (n: Net): Net => (t, k) => (k === 'token' ? n(t, k) : null);
const signupOnly = (n: Net): Net => (t, k) => (k === 'signup' ? n(t, k) : null);

type Auth = ReturnType<typeof createClient>['auth'];

// 1.1.0 의 시작 코드(_layout.tsx + signInAnonymouslyIfNeeded)
async function legacyBoot(auth: Auth): Promise<string> {
  const { data } = await auth.getSession();
  if (data.session) return 'ready';
  const again = await auth.getSession();
  if (again.data.session) return 'ready';
  const { error } = await auth.signInAnonymously();
  return error ? 'offline' : 'created';
}

function launch(kind: Kind, kv: FakeAsyncStorage, server: FakeAuthServer, net: Net) {
  const start = Date.now();
  const vault = createSessionVault(kv);
  const fakeFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const k = url.includes('/signup') ? 'signup' : url.includes('/token') ? 'token' : null;
    if (!k) return Promise.resolve(jres(200, {}));
    const r = net(Date.now() - start, k);
    if (r === 'down') return Promise.reject(new TypeError('Network request failed'));
    if (r) return Promise.resolve(r);
    const body = JSON.parse(String(init?.body ?? '{}'));
    return Promise.resolve(k === 'signup' ? server.signup(body) : server.refresh(body.refresh_token));
  };
  const client = createClient(SUPABASE_URL, 'anon', {
    auth: {
      storage: kind === 'fixed' ? vault.storage : kv,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: { fetch: fakeFetch },
  });
  // AuthGate 처럼 onAuthStateChange 로 받은 마지막 세션의 사용자(앱 화면으로 넘어가는 근거).
  let delivered = '(없음)';
  let refreshedAt = -1; // 마지막 TOKEN_REFRESHED 시각(실행 시작부터, 가상 ms)
  client.auth.onAuthStateChange((event, session) => {
    if (session) delivered = session.user.id;
    if (event === 'TOKEN_REFRESHED') refreshedAt = Date.now() - start;
  });
  const boot = async (): Promise<string> => {
    try {
      if (kind === 'legacy') return await legacyBoot(client.auth);
      const r = await runSessionBootstrap(client.auth, vault);
      return 'userId' in r ? `${r.status}:${r.userId ?? '-'}` : r.status; // lost·offline 은 문의 번호용 id 도 본다
    } catch (e) {
      return `throw:${(e as Error).message}`;
    }
  };
  return {
    client,
    vault,
    boot,
    delivered: () => delivered,
    refreshedAt: () => refreshedAt,
    stop: () => client.auth.stopAutoRefresh(),
  };
}
type Launched = ReturnType<typeof launch>;

// 지금 쓸 수 있는 계정(그때의 통신 상태로 세션을 얻었을 때의 사용자)
async function accountNow(l: Launched): Promise<string> {
  try {
    const { data } = await l.client.auth.getSession();
    return data.session?.user.id ?? '(없음)';
  } catch {
    return '(읽기 실패)';
  }
}

const storedUser = (raw: string | null) => (raw ? (JSON.parse(raw).user?.id ?? '?') : '(없음)');
const archivedUsers = (kv: FakeAsyncStorage) =>
  (JSON.parse(kv.peek(SESSION_ARCHIVE_KEY) ?? '[]') as { userId: string }[]).map((c) => c.userId).join(',') || '없음';

// ── 사례 실행 ───────────────────────────────────────────────
type Ctx = { kv: FakeAsyncStorage; server: FakeAuthServer };
// delivered: 첫 실행 동안 onAuthStateChange 로 받은 마지막 세션의 사용자 — 시험이 getSession 을 부르기 전에 잰다
//   (getSession 이 스스로 재발급하면 자동 갱신이 망가져도 account 는 통과하므로, 저절로 돌아오는지는 이것으로 본다).
// account: 지켜본 뒤 그때의 통신 상태로 getSession 을 불러 얻은 사용자.
type Outcome = {
  boot: string;
  delivered: string;
  account: string;
  again: string;
  signups: number;
  staleUses: number;
  note: string;
};
type Case = {
  name: string;
  net?: Net;
  wait: number; // 첫 실행을 지켜보는 시간(가상 ms)
  seed?: boolean; // 기기에 OLD 계정 세션이 있음(기본 true)
  wishes?: boolean; // 위시를 저장한 흔적(등록 화면을 연 기록)이 있음(기본 = seed)
  expiredSec?: number; // 저장된 세션이 만료된 지 몇 초(기본 2시간, 음수 = 아직 유효)
  before?: (c: Ctx, kind: Kind) => Promise<void>; // 앞선 실행
  setup?: (c: Ctx) => void;
  after?: (l: Launched, c: Ctx, boot: string) => Promise<string>;
  relaunch?: boolean; // 뒤에 정상 통신으로 다시 켠다(기본 true)
  expect: Partial<Outcome>;
  baseline?: false; // 고치기 전 코드에 없는 동작(새로 시작·로그아웃)이면 false
};

async function normalRun(kind: Kind, { kv, server }: Ctx) {
  kv.relaunch();
  const l = launch(kind, kv, server, ok);
  await l.boot();
  l.stop();
}

// 기기 저장값의 만료 시각을 지나게 한다(다음 실행이 바로 재발급하게)
async function expireStored(kv: FakeAsyncStorage) {
  const s = JSON.parse(kv.peek(KEY)!);
  s.expires_at = 1;
  await kv.setItem(KEY, JSON.stringify(s));
}

async function runCase(kind: Kind, cs: Case): Promise<Outcome> {
  const kv = new FakeAsyncStorage();
  const server = new FakeAuthServer();
  if (cs.seed !== false) {
    const s = server.create('OLD');
    s.expires_at = Math.floor(Date.now() / 1000) - (cs.expiredSec ?? 7200);
    await kv.setItem(KEY, JSON.stringify(s));
  }
  if (cs.wishes ?? cs.seed !== false) await kv.setItem('wishshot.privacyNoticeShown.v2', '1');
  if (cs.before) await cs.before({ kv, server }, kind);
  cs.setup?.({ kv, server });
  kv.relaunch();
  const l = launch(kind, kv, server, cs.net ?? ok);
  let boot = '(판정 없음)';
  const booting = l.boot().then((b) => (boot = b));
  await sleep(cs.wait);
  await Promise.race([booting, sleep(1000)]);
  const delivered = l.delivered();
  const note = cs.after ? await cs.after(l, { kv, server }, boot) : '';
  const account = await accountNow(l);
  l.stop();
  let again = '';
  if (cs.relaunch !== false) {
    kv.relaunch();
    const l2 = launch(kind, kv, server, ok);
    const b2 = await l2.boot();
    again = `${b2}/${await accountNow(l2)}`;
    l2.stop();
  }
  return { boot, delivered, account, again, signups: server.signups, staleUses: server.staleUses, note };
}

// 사례를 한꺼번에 돌린다(시간이 겹치므로 전체 시간 = 가장 긴 사례). 어긋난 사례를 모두 모아 실패시킨다.
async function runCases(cases: Case[]): Promise<void> {
  const kind: Kind = BASELINE ? 'legacy' : 'fixed';
  const outcomes = await withFastClock(() =>
    Promise.all(cases.map((cs) => runCase(kind, cs).catch((e: Error) => e))),
  );
  const failures: string[] = [];
  cases.forEach((cs, i) => {
    const o = outcomes[i];
    if (o instanceof Error) return void failures.push(`${cs.name}: 오류 ${o.message}`);
    const expected = { staleUses: 0, ...cs.expect };
    const actual = Object.fromEntries(Object.keys(expected).map((k) => [k, o[k as keyof Outcome]]));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(`${cs.name}\n  기대: ${JSON.stringify(expected)}\n  결과: ${JSON.stringify(o)}`);
    }
  });
  if (failures.length) throw new Error(`\n${failures.join('\n')}`);
}

// 시험 끝에 auth-js 의 재시도 타이머가 남을 수 있어 타이머 누수 검사는 끈다.
function scenario(name: string, cases: Case[]) {
  const run = BASELINE ? cases.filter((c) => c.baseline !== false) : cases;
  Deno.test({ name, ignore: run.length === 0, sanitizeOps: false, sanitizeResources: false, fn: () => runCases(run) });
}

// ── 사례 ────────────────────────────────────────────────────
const recovered = { again: 'ready/OLD', signups: 0 };
const cameBack = { delivered: 'OLD', account: 'OLD', ...recovered }; // 저절로 돌아와 앱이 세션을 받음

scenario('통신 실패·서버 오류: 새 계정을 만들지 않고 기존 계정으로 저절로 돌아온다', [
  { name: '재발급 통신 실패 60초(가입은 됨)', net: tokenOnly(until(60e3, () => 'down')), wait: 130e3, expect: { boot: 'offline:OLD', ...cameBack } },
  { name: '재발급만 503 60초', net: tokenOnly(until(60e3, () => jres(503, {}))), wait: 130e3, expect: { boot: 'offline:OLD', ...cameBack } },
  { name: '완전 오프라인 40초', net: until(40e3, () => 'down'), wait: 130e3, expect: { boot: 'offline:OLD', ...cameBack } },
  { name: '403 HTML 40초', net: until(40e3, () => html(403)), wait: 130e3, expect: { boot: 'offline:OLD', ...cameBack } },
  { name: '429 40초', net: until(40e3, () => authError(429, 'over_request_rate_limit')), wait: 130e3, expect: { boot: 'offline:OLD', ...cameBack } },
  { name: '402 사용량 제한 40초', net: until(40e3, () => jres(402, { message: 'exceed_egress_quota' })), wait: 130e3, expect: { boot: 'offline:OLD', ...cameBack } },
  { name: '540 프로젝트 정지 40초', net: until(40e3, () => html(540)), wait: 130e3, expect: { boot: 'offline:OLD', ...cameBack } },
  { name: '409 conflict 1회', net: tokenOnly(until(5e3, () => authError(409, 'conflict'))), wait: 130e3, expect: { boot: 'offline:OLD', ...cameBack } },
  { name: '목록에 없는 400(user_banned)이 계속됨', net: tokenOnly(() => authError(400, 'user_banned')), wait: 20e3, relaunch: false, expect: { boot: 'offline:OLD', delivered: '(없음)', signups: 0 } },
  { name: '정상 세션(만료 전)', expiredSec: -1800, wait: 5e3, expect: { boot: 'ready', ...cameBack } },
]);

scenario('서버가 세션을 거절하면 lost: 새 계정을 만들지 않는다', [
  { name: 'refresh_token_not_found', setup: ({ server }) => void (server.chains.get('OLD')!.dead = true), wait: 20e3, expect: { boot: 'lost:OLD', delivered: '(없음)', account: '(없음)', again: 'lost:OLD/(없음)', signups: 0 } },
  { name: 'session_expired', net: tokenOnly(() => authError(403, 'session_expired')), wait: 20e3, relaunch: false, expect: { boot: 'lost:OLD', signups: 0 } },
  { name: 'validation_failed', net: tokenOnly(() => authError(400, 'validation_failed')), wait: 20e3, relaunch: false, expect: { boot: 'lost:OLD', signups: 0 } },
  { name: '재발급 응답에 세션이 없음(AuthSessionMissingError)', net: tokenOnly(() => jres(200, {})), wait: 20e3, relaunch: false, expect: { boot: 'lost:OLD', signups: 0 } },
  {
    name: '저장소 목록을 읽지 못하면 위시 흔적을 모르니 lost(새로 시작하지 않음)',
    setup: (c) => {
      c.server.chains.get('OLD')!.dead = true;
      c.kv.getAllKeys = () => Promise.reject(new Error('getAllKeys failed'));
    },
    wait: 20e3,
    relaunch: false,
    expect: { boot: 'lost:OLD', signups: 0 },
    baseline: false,
  },
]);

scenario('저장소 읽기 실패·깨진 값은 "없음"이 아니다', [
  { name: '세션 파일 읽기 1회 실패', setup: ({ kv }) => void (kv.failFileReads = 1), wait: 20e3, expect: { boot: 'offline:-', delivered: '(없음)', ...recovered } },
  {
    name: '읽기 실패 뒤 다른 값 저장으로 목록에서 빠진 채 다시 켬(사본 있음)',
    before: async (c, kind) => {
      await normalRun(kind, c);
      c.kv.relaunch();
      c.kv.failFileReads = 1;
      await c.kv.getItem(KEY).catch(() => {});
      await c.kv.setItem('other', '1');
    },
    wait: 20e3,
    expect: { boot: 'ready', ...cameBack },
  },
  { name: '저장값 깨짐, 사본 없음', setup: ({ kv }) => void kv.setItem(KEY, `{"access_token":"h.${'x'.repeat(1200)}`), wait: 20e3, expect: { boot: 'lost:-', delivered: '(없음)', again: 'lost:-/(없음)', signups: 0 } },
  {
    name: '저장값 깨짐, 사본 있음',
    before: async (c, kind) => {
      await normalRun(kind, c);
      await c.kv.setItem(KEY, `{"acc${'x'.repeat(1200)}`);
    },
    wait: 20e3,
    expect: { boot: 'ready', ...cameBack },
  },
  { name: '사본 저장·읽기가 계속 실패', setup: ({ kv }) => { kv.failKeys.add(SESSION_COPY_KEY); kv.failKeys.add(SESSION_ARCHIVE_KEY); }, wait: 20e3, expect: { boot: 'ready', ...cameBack } },
  {
    name: '사용 중(세션 확인 뒤) 세션 파일 읽기 실패',
    expiredSec: -1800,
    wait: 5e3,
    relaunch: false,
    after: async (l, { kv }) => {
      kv.failFileReads = 1;
      await l.client.auth.getSession().catch(() => {});
      const now = await accountNow(l);
      await kv.setItem('other', '1');
      return `실패 직후=${now}`;
    },
    expect: { account: 'OLD', note: '실패 직후=OLD' },
  },
]);

const noAccount = { delivered: '(없음)', account: '(없음)', again: 'signin/(없음)', signups: 0 };

scenario('새 설치: 새 익명 계정을 만들지 않고 로그인 화면(불변식 1)', [
  { name: '온라인', seed: false, wait: 10e3, expect: { boot: 'signin', ...noAccount }, baseline: false },
  { name: '오프라인', seed: false, net: () => 'down', wait: 10e3, expect: { boot: 'signin', ...noAccount }, baseline: false },
  { name: '저장소 읽기가 처음부터 오류', seed: false, setup: ({ kv }) => void kv.failKeys.add(KEY), wait: 5e3, relaunch: false, expect: { boot: 'offline:-', signups: 0 } },
  {
    name: '(한계) 저장소 목록 전체가 초기화되면 새 설치와 구분하지 못한다 — 로그인 화면(새 계정 없음)',
    before: async (c, kind) => {
      await normalRun(kind, c);
      c.kv.disk = new Map();
    },
    wait: 10e3,
    expect: { boot: 'signin', ...noAccount },
    baseline: false,
  },
]);

scenario('사본이 없어도 쓴 흔적이 있으면 lost: 말없이 새 계정을 만들지 않는다', [
  {
    name: '사본 없는 첫 실행에 세션 파일 읽기 실패 + 다른 값 저장 → 다시 켬',
    before: async ({ kv }) => void (await kv.setItem('wishshot.onboardingShown', '1')),
    setup: ({ kv }) => void (kv.failFileReads = 1),
    wait: 10e3,
    after: async (_l, { kv }) => {
      await kv.setItem('other', '1');
      return '';
    },
    expect: { boot: 'offline:-', again: 'lost:-/(없음)', signups: 0 },
  },
  {
    name: '세션이 이미 지워진 채 첫 실행',
    before: async ({ kv }) => {
      await kv.setItem('wishshot.onboardingShown', '1');
      await kv.removeItem(KEY);
    },
    wait: 10e3,
    expect: { boot: 'lost:-', signups: 0 },
  },
]);

const previousUserRecord = (server: FakeAuthServer) =>
  server.signupBodies.at(-1)?.data?.previous_user_id ?? '없음';

scenario('위시를 저장한 흔적이 없으면 끊겨도 새 계정을 만들지 않고 로그인 화면(불변식 1)', [
  {
    name: '위시 없는 계정이 서버 정리로 지워짐(refresh_token_not_found) — 거절된 세션은 지우지 않는다',
    wishes: false,
    setup: ({ server }) => void (server.chains.get('OLD')!.dead = true),
    wait: 20e3,
    after: (_l, { kv }) => Promise.resolve(`저장된 계정=${storedUser(kv.peek(KEY))}, 보관=${archivedUsers(kv)}`),
    expect: { boot: 'signin', ...noAccount, note: '저장된 계정=OLD, 보관=없음' },
    baseline: false,
  },
  {
    name: '흔적이 온보딩 기록뿐인데 세션이 이미 지워진 채 첫 실행',
    wishes: false,
    before: async ({ kv }) => {
      await kv.setItem('wishshot.onboardingShown', '1');
      await kv.removeItem(KEY);
    },
    wait: 10e3,
    expect: { boot: 'signin', ...noAccount },
    baseline: false,
  },
  {
    name: '사용자가 로그인 없이 시작을 고르면 그때만 새 계정(옛 계정은 보관·이전 계정 기록)',
    wishes: false,
    setup: ({ server }) => void (server.chains.get('OLD')!.dead = true),
    wait: 20e3,
    after: async (l, { kv, server }, boot) => {
      if (boot !== 'signin') return '(signin 아님)';
      const started = await runStartOver(l.client.auth, l.vault);
      return `새로 시작=${started}, 보관=${archivedUsers(kv)}, 이전 계정 기록=${previousUserRecord(server)}`;
    },
    expect: { boot: 'signin', account: 'NEW1', again: 'ready/NEW1', signups: 1, note: '새로 시작=true, 보관=OLD, 이전 계정 기록=OLD' },
    baseline: false,
  },
]);

// 고치기 전 코드가 refreshToken 을 세 번 바꿔 사본이 세 단계 낡은 상태(OTA 를 되돌렸다가 다시 받은 경우 등)
async function staleCopy(c: Ctx) {
  await normalRun('fixed', c);
  for (let i = 0; i < 3; i++) {
    c.kv.relaunch();
    await expireStored(c.kv);
    await normalRun('legacy', c);
    await sleep(12e3); // 교체 뒤 10초 허용 시간을 넘긴다
  }
  await expireStored(c.kv);
}

scenario('낡은 사본을 쓰지 않는다(쓰면 서버가 세션을 끝낸다)', [
  { name: '원래 값이 정상이면 원래 값을 쓴다', before: staleCopy, wait: 20e3, expect: { boot: 'ready', ...cameBack } },
  {
    name: '원래 값 읽기에 실패해도 사본을 쓰지 않는다',
    before: async (c) => {
      await staleCopy(c);
      c.kv.failFileReads = 1;
    },
    wait: 20e3,
    expect: { boot: 'offline:OLD', delivered: '(없음)', ...recovered }, // 문의 번호는 사본의 사용자 id 로(토큰은 안 씀)
  },
]);

scenario('사용 중 만료 + 403 이 이어져도 세션을 지우지 않는다', [
  {
    name: '403 HTML 3분 → 회복',
    expiredSec: -60,
    net: (t) => (t < 180e3 ? html(403) : null),
    wait: 290e3,
    // 시작 때는 아직 유효한 세션이 전달되므로, 403 이 끝난 뒤 실제로 재발급됐는지는 TOKEN_REFRESHED 시각으로 본다
    after: (l) => Promise.resolve(l.refreshedAt() >= 180e3 ? '403이 끝난 뒤 재발급' : `재발급 시각=${l.refreshedAt()}`),
    expect: { delivered: 'OLD', account: 'OLD', note: '403이 끝난 뒤 재발급', ...recovered },
  },
]);

scenario('다른 사용자의 세션이 저장되면 옛 계정을 보관한다', [
  {
    name: '고치기 전 코드가 새 계정을 만든 뒤 고친 코드로 실행',
    before: async (c) => {
      await normalRun('fixed', c);
      c.kv.relaunch();
      c.kv.mem.delete(KEY);
      c.kv.disk = new Map(c.kv.mem);
      await normalRun('legacy', c);
    },
    wait: 10e3,
    after: (_l, { kv }) => Promise.resolve(`보관=${archivedUsers(kv)}`),
    expect: { boot: 'ready', account: 'NEW1', note: '보관=OLD' },
  },
]);

scenario('새로 시작·로그아웃', [
  {
    name: '끊긴 세션에서 새로 시작',
    setup: ({ server }) => void (server.chains.get('OLD')!.dead = true),
    wait: 20e3,
    after: async (l, { kv, server }, boot) => {
      if (!boot.startsWith('lost')) return '(lost 아님)';
      const started = await runStartOver(l.client.auth, l.vault);
      const previous = server.signupBodies.at(-1)?.data?.previous_user_id;
      return `새로 시작=${started}, 보관=${archivedUsers(kv)}, 이전 계정 기록=${previous}`;
    },
    expect: { boot: 'lost:OLD', account: 'NEW1', again: 'ready/NEW1', signups: 1, note: '새로 시작=true, 보관=OLD, 이전 계정 기록=OLD' },
    baseline: false,
  },
  {
    name: '새로 시작의 가입이 실패하면 저장된 계정은 그대로',
    setup: ({ server }) => void (server.chains.get('OLD')!.dead = true),
    net: signupOnly(() => 'down'),
    wait: 20e3,
    relaunch: false,
    after: async (l, { kv }, boot) => {
      if (!boot.startsWith('lost')) return '(lost 아님)';
      const started = await runStartOver(l.client.auth, l.vault);
      return `새로 시작=${started}, 저장된 계정=${storedUser(kv.peek(KEY))}`;
    },
    expect: { boot: 'lost:OLD', signups: 0, note: '새로 시작=false, 저장된 계정=OLD' },
    baseline: false,
  },
  {
    name: '보관 목록 저장이 실패해도 새로 시작은 된다',
    setup: ({ kv, server }) => {
      server.chains.get('OLD')!.dead = true;
      kv.failKeys.add(SESSION_ARCHIVE_KEY);
    },
    wait: 20e3,
    relaunch: false,
    after: async (l, { kv }, boot) => {
      if (!boot.startsWith('lost')) return '(lost 아님)';
      const started = await runStartOver(l.client.auth, l.vault);
      return `새로 시작=${started}, 저장된 계정=${storedUser(kv.peek(KEY))}`;
    },
    expect: { boot: 'lost:OLD', signups: 1, note: '새로 시작=true, 저장된 계정=NEW1' },
    baseline: false,
  },
  {
    name: '사용자가 고른 로그아웃은 세션과 사본을 지운다',
    expiredSec: -1800,
    wishes: false, // 위시 흔적이 있으면 다음 실행은 끊긴 세션으로 본다(로그아웃은 지금 개발용만)
    wait: 5e3,
    after: async (l, { kv }) => {
      await l.vault.allowRemoval(() => l.client.auth.signOut());
      return `세션=${kv.peek(KEY) ? '남음' : '지워짐'}, 사본=${kv.peek(SESSION_COPY_KEY) ? '남음' : '지워짐'}`;
    },
    expect: { boot: 'ready', again: 'signin/(없음)', signups: 0, note: '세션=지워짐, 사본=지워짐' },
    baseline: false,
  },
]);

// ── 저장 어댑터 단위 시험(통신 없음) ──────────────────────────
const stored = (user: string, token: string) =>
  JSON.stringify({ ...sessionFor(user, 0), refresh_token: token, expires_at: 2000000000 });

Deno.test({
  name: '거절 판정: 다시 시도해도 같은 답이 오는 오류만 lost',
  ignore: BASELINE,
  fn() {
    for (const code of ['refresh_token_not_found', 'refresh_token_already_used', 'session_expired', 'validation_failed']) {
      eq(isSessionRejected({ name: 'AuthApiError', code }), true, code);
    }
    eq(isSessionRejected({ name: 'AuthSessionMissingError' }), true);
    for (const code of ['user_banned', 'user_not_found', 'over_request_rate_limit', 'conflict', 'unexpected_failure', undefined]) {
      eq(isSessionRejected({ name: 'AuthApiError', code }), false, String(code));
    }
    eq(isSessionRejected({ name: 'AuthRetryableFetchError' }), false);
    eq(isSessionRejected(new TypeError('Network request failed')), false);
    eq(isSessionRejected(null), false);
  },
});

Deno.test({
  name: '저장 어댑터: auth-js 가 지우는 것은 무시하고, 고른 로그아웃만 세션과 사본을 지운다',
  ignore: BASELINE,
  async fn() {
    const kv = new FakeAsyncStorage();
    const vault = createSessionVault(kv);
    await vault.storage.setItem(KEY, stored('U1', 'r1'));
    eq(JSON.parse(kv.peek(SESSION_COPY_KEY)!), { v: 1, userId: 'U1', refreshToken: 'r1' }, '사본');
    await vault.storage.removeItem(KEY);
    eq(storedUser(kv.peek(KEY)), 'U1', '자동 삭제 무시');
    await vault.allowRemoval(() => vault.storage.removeItem(KEY));
    eq([kv.peek(KEY), kv.peek(SESSION_COPY_KEY)], [null, null], '고른 로그아웃');
    // 세션 키가 아니면 그대로 지나간다
    await vault.storage.setItem('sb-abcd-auth-token-code-verifier', 'v');
    await vault.storage.removeItem('sb-abcd-auth-token-code-verifier');
    eq(kv.peek('sb-abcd-auth-token-code-verifier'), null, '다른 키');
  },
});

Deno.test({
  name: '저장 어댑터: 다른 사용자의 세션이 저장되면 옛 사본을 보관한다(사용자당 1개, 최근 5개)',
  ignore: BASELINE,
  async fn() {
    const kv = new FakeAsyncStorage();
    const vault = createSessionVault(kv);
    await vault.storage.setItem(KEY, stored('U1', 'r1'));
    await vault.storage.setItem(KEY, stored('U1', 'r2')); // 같은 사용자의 교체는 보관하지 않는다
    eq(archivedUsers(kv), '없음');
    await vault.storage.setItem(KEY, stored('U2', 's1'));
    await vault.storage.setItem(KEY, stored('U1', 'r3'));
    eq(archivedUsers(kv), 'U2,U1');
    eq(JSON.parse(kv.peek(SESSION_ARCHIVE_KEY)!)[1].refreshToken, 'r2', '보관한 사본은 그때의 refreshToken');
    for (const u of ['U3', 'U4', 'U5', 'U6', 'U7']) await vault.storage.setItem(KEY, stored(u, `${u}-r`));
    eq(archivedUsers(kv), 'U6,U5,U4,U3,U1');
  },
});

Deno.test({
  name: '저장 어댑터: 보관에 실패하면 옛 사본을 덮지 않고, 원래 저장은 막지 않는다',
  ignore: BASELINE,
  async fn() {
    const kv = new FakeAsyncStorage();
    const vault = createSessionVault(kv);
    await vault.storage.setItem(KEY, stored('U1', 'r1'));
    kv.failKeys.add(SESSION_ARCHIVE_KEY);
    await vault.storage.setItem(KEY, stored('U2', 's1'));
    eq([storedUser(kv.peek(KEY)), JSON.parse(kv.peek(SESSION_COPY_KEY)!).userId], ['U2', 'U1']);
  },
});

Deno.test({
  name: '저장 어댑터: 읽는 사이에 새 세션이 저장되면 옛 값을 기억하거나 사본에 쓰지 않는다',
  ignore: BASELINE,
  async fn() {
    const kv = new FakeAsyncStorage();
    const vault = createSessionVault(kv);
    await vault.storage.setItem(KEY, stored('U1', 'r1'));
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const realGet = kv.getItem;
    kv.getItem = async (k) => {
      const v = await realGet(k);
      if (k === KEY) await gate;
      return v;
    };
    const reading = vault.storage.getItem(KEY); // r1 을 읽는 중
    kv.getItem = realGet;
    await vault.storage.setItem(KEY, stored('U1', 'r2'));
    release();
    await reading;
    kv.failKeys.add(KEY); // 다음 읽기가 실패하면 이번 실행에서 마지막으로 저장한 값을 돌려줘야 한다
    const fallback = JSON.parse((await vault.storage.getItem(KEY))!);
    eq([JSON.parse(kv.peek(SESSION_COPY_KEY)!).refreshToken, fallback.refresh_token], ['r2', 'r2']);
  },
});

Deno.test({
  name: '저장 어댑터: 원래 값이 없을 때만 사본으로 만료된 세션을 돌려준다',
  ignore: BASELINE,
  async fn() {
    const kv = new FakeAsyncStorage();
    await kv.setItem(SESSION_COPY_KEY, JSON.stringify({ v: 1, userId: 'U1', refreshToken: 'r1' }));
    const vault = createSessionVault(kv);
    const s = JSON.parse((await vault.storage.getItem(KEY))!);
    eq([s.refresh_token, s.expires_at, s.user.id], ['r1', 1, 'U1']);
    eq([vault.state(), vault.knownUserId()], ['present', 'U1']);
  },
});

Deno.test({
  name: '저장 어댑터: 읽기에 실패한 뒤의 "없음"은 없음이 아니다(사본도 쓰지 않는다)',
  ignore: BASELINE,
  async fn() {
    const kv = new FakeAsyncStorage();
    await createSessionVault(kv).storage.setItem(KEY, stored('U1', 'r1')); // 1024자를 넘어 파일에 저장된다
    kv.relaunch();
    kv.failFileReads = 1;
    const vault = createSessionVault(kv);
    const first = await vault.storage.getItem(KEY); // 실패 → 목록에서 빠짐
    const second = await vault.storage.getItem(KEY); // 오류 없이 "없음"이 되지만 사본을 쓰지 않는다
    eq([first, second, vault.state()], [null, null, 'unreadable']);
    eq(JSON.parse(kv.peek(SESSION_COPY_KEY)!).userId, 'U1', '사본은 남아 있음');
    // 문의 번호용으로는 사본의 사용자 id 를 읽지만, 그 뒤에도 세션 대신 사본을 돌려주지 않는다
    eq([vault.knownUserId(), await vault.inquiryUserId()], [null, 'U1'], '문의 번호용 id');
    eq(await vault.storage.getItem(KEY), null, '사본을 쓰지 않음');
  },
});

Deno.test({
  name: '저장 어댑터: 개발용 만료 흉내는 만료 시각만 바꾼다',
  ignore: BASELINE,
  async fn() {
    const kv = new FakeAsyncStorage();
    const vault = createSessionVault(kv);
    eq(await vault.expireStoredSessionForDev(), false, '세션 없음');
    await vault.storage.setItem(KEY, stored('U1', 'r1'));
    eq(await vault.expireStoredSessionForDev(), true);
    const s = JSON.parse(kv.peek(KEY)!);
    eq([s.expires_at, s.refresh_token, s.user.id], [1, 'r1', 'U1']);
  },
});

Deno.test({
  name: '저장 어댑터: 쓴 흔적 판단',
  ignore: BASELINE,
  async fn() {
    const kv = new FakeAsyncStorage();
    await kv.setItem('ph_some_key', '1'); // 계측 SDK 키는 흔적이 아니다(흔적은 vault 를 만들 때의 키로 본다)
    const vault = createSessionVault(kv);
    eq(await vault.hasUsageTrace(), false, '흔적 없음');
    for (const k of ['wishshot.onboardingShown', 'wishshot.signedurl.u/1.jpg', SESSION_ARCHIVE_KEY]) {
      const one = new FakeAsyncStorage();
      await one.setItem(k, '1');
      eq(await createSessionVault(one).hasUsageTrace(), true, k);
    }
  },
});

Deno.test({
  name: '저장 어댑터: 위시를 저장한 흔적 판단(온보딩 기록·사본만으로는 아니다)',
  ignore: BASELINE,
  async fn() {
    const none = new FakeAsyncStorage();
    await none.setItem('wishshot.onboardingShown', '1');
    await none.setItem(SESSION_COPY_KEY, '{}');
    eq(await createSessionVault(none).hasWishTrace(), false, '흔적 없음');
    const keys = [
      'wishshot.privacyNoticeShown.v2',
      'wishshot.privacyNoticeShown',
      'wishshot.regionNoticeShown',
      'wishshot.signedurl.u/1.jpg',
      'wishshot.notifications',
    ];
    for (const k of keys) {
      const one = new FakeAsyncStorage();
      await one.setItem(k, '1');
      eq(await createSessionVault(one).hasWishTrace(), true, k);
    }
  },
});

Deno.test({
  name: '저장 어댑터: 쓴 흔적은 실행이 시작할 때의 키로 본다(시작하며 지운 만료 캐시도 흔적)',
  ignore: BASELINE,
  async fn() {
    const kv = new FakeAsyncStorage();
    await kv.setItem('wishshot.signedurl.u/1.jpg', '1');
    const vault = createSessionVault(kv);
    await kv.removeItem('wishshot.signedurl.u/1.jpg'); // hydrateSignedUrlCache 가 만료된 캐시를 지움
    eq(await vault.hasUsageTrace(), true);
  },
});
