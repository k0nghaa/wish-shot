// 세션 저장 어댑터와 거절 판정. import 없는 순수 TS — 앱(supabase.ts·queries/auth.ts)과
// Deno 시험(supabase/tests/session_vault_test.ts)이 함께 쓴다.
//
// 익명 사용자는 기기에 저장된 세션이 계정의 유일한 열쇠다. 그래서:
// - 세션 키(sb-<프로젝트>-auth-token)의 값은 사용자가 고른 로그아웃에서만 지운다. auth-js 는 재발급이
//   실패하면(403·429·402 등) 세션을 스스로 지우는데, 이를 무시하면 다음 자동 갱신(30초 간격)이 같은
//   세션으로 다시 시도한다.
// - 사용자 id 와 refreshToken 만 담은 사본을 따로 둔다(1024자 이하라 iOS AsyncStorage 목록 안에 저장돼
//   세션 파일과 따로 남는다). 원래 값이 확실히 없거나 깨졌을 때만 사본으로 되살린다. 읽기에 실패했을
//   때는 쓰지 않는다 — 낡은 refreshToken 을 쓰면 서버가 세션 전체를 끝낸다.
// - 다른 사용자의 세션이 저장되면 옛 사본을 보관 목록으로 옮긴다. 지금은 보관 목록을 읽어 되살리는 코드가 없다 —
//   어떤 경로로든 덮어쓰인 계정의 refreshToken 을 기기에 남겨 두는 마지막 방어선이고(나중에 계정 연결·지원 도구가
//   쓸 수 있게), 세션과 같은 저장소에만 두며 기기 밖으로 보내지 않는다.
// - 사본·보관 처리의 실패는 원래 읽기·쓰기를 막지 않는다.

export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
};

export const SESSION_COPY_KEY = 'wishshot.sessionCopy';
export const SESSION_ARCHIVE_KEY = 'wishshot.sessionArchive';
const ARCHIVE_LIMIT = 5;

// 세션을 얻은 뒤에만 쓰이는 키 = 이 기기에서 앱을 쓴 흔적. 사본이 없을 때 새 설치인지 가린다.
// 출처: Onboarding/onboardingStorage.ts, queries/storage.ts(PERSIST_PREFIX), notifications.ts, register.tsx
const USAGE_KEY_PREFIXES = [
  SESSION_COPY_KEY,
  SESSION_ARCHIVE_KEY,
  'wishshot.onboardingShown',
  'wishshot.signedurl.',
  'wishshot.notifications',
  'wishshot.privacyNoticeShown',
  'wishshot.regionNoticeShown',
];

// 위시를 저장해 봤을 수 있다는 흔적(등록 화면을 연 기록 포함). 없으면 끊긴 세션이어도 잃을 위시가 없다 —
// 위시 없는 익명 계정은 서버가 30일 뒤 지우므로(0002), 이때는 화면 없이 새로 시작한다.
const WISH_KEY_PREFIXES = [
  'wishshot.privacyNoticeShown', // 등록 화면을 처음 열 때
  'wishshot.regionNoticeShown', // 등록의 제품 영역 지정
  'wishshot.signedurl.', // 위시 이미지 주소 캐시
  'wishshot.notifications', // 저장 뒤 링크 알림
];

const isSessionKey = (key: string) => /^sb-.+-auth-token$/.test(key);

type SessionCopy = { v: 1; userId: string; refreshToken: string };
type StoredSession = { refresh_token: string; user?: { id?: unknown } };

/** 이번 실행에서 세션 키를 읽은 결과. */
export type StoredSessionState = 'unknown' | 'present' | 'none' | 'corrupt' | 'unreadable';

// auth-js 가 받아들이는 세션인지(access_token·expires_at 이 있고 refreshToken 이 비어 있지 않음).
function parseSession(raw: string): StoredSession | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const s = value as Record<string, unknown>;
    if (!('access_token' in s) || !('expires_at' in s)) return null;
    if (typeof s.refresh_token !== 'string' || !s.refresh_token) return null;
    return s as StoredSession;
  } catch {
    return null;
  }
}

function userIdOf(session: StoredSession): string | null {
  const id = session.user?.id;
  return typeof id === 'string' && id ? id : null;
}

function toCopy(value: unknown): SessionCopy | null {
  if (typeof value !== 'object' || value === null) return null;
  const c = value as Record<string, unknown>;
  if (typeof c.userId !== 'string' || !c.userId) return null;
  if (typeof c.refreshToken !== 'string' || !c.refreshToken) return null;
  return { v: 1, userId: c.userId, refreshToken: c.refreshToken };
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// 사본으로 만든 세션: 만료된 것으로 보여 auth-js 가 바로 재발급한다. expires_at 이 0 이면 만료로 보지
// 않으므로 1 을 쓴다.
function sessionFromCopy(copy: SessionCopy): string {
  return JSON.stringify({
    access_token: '',
    refresh_token: copy.refreshToken,
    expires_at: 1,
    expires_in: 0,
    token_type: 'bearer',
    user: { id: copy.userId },
  });
}

export type SessionVault = ReturnType<typeof createSessionVault>;

export function createSessionVault(kv: KeyValueStore) {
  // 이번 실행이 시작할 때의 키 목록. 앱이 시작하며 지우는 키(만료된 이미지 주소 캐시 등)에 쓴 흔적 판단이
  // 흔들리지 않게 먼저 찍어 둔다. 실패는 쓸 때 던진다.
  const keysAtStart = kv.getAllKeys();
  keysAtStart.catch(() => {});
  let copyMemo: SessionCopy | null | undefined; // undefined = 아직 읽지 않음
  let lastGood: { raw: string; copy: SessionCopy | null } | null = null; // 이번 실행에서 마지막으로 읽거나 쓴 세션
  let readFailed = false; // 세션 읽기가 실패한 뒤 성공한 읽기·쓰기가 아직 없음
  let writes = 0;
  let removalAllowed = 0;
  let state: StoredSessionState = 'unknown';

  async function readCopy(): Promise<SessionCopy | null> {
    if (copyMemo !== undefined) return copyMemo;
    const copy = toCopy(parseJson(await kv.getItem(SESSION_COPY_KEY)));
    copyMemo = copy;
    return copy;
  }

  async function addToArchive(copy: SessionCopy): Promise<void> {
    const raw = parseJson(await kv.getItem(SESSION_ARCHIVE_KEY));
    const list = (Array.isArray(raw) ? raw : []).map(toCopy).filter((c): c is SessionCopy => c !== null);
    if (list.some((c) => c.userId === copy.userId && c.refreshToken === copy.refreshToken)) return;
    const next = [copy, ...list.filter((c) => c.userId !== copy.userId)].slice(0, ARCHIVE_LIMIT);
    await kv.setItem(SESSION_ARCHIVE_KEY, JSON.stringify(next));
  }

  // 사본을 세션에 맞춘다. 다른 사용자면 옛 사본을 먼저 보관한다 — 보관에 실패하면 옛 사본을 덮지 않는다.
  async function syncCopy(next: SessionCopy): Promise<void> {
    const current = await readCopy();
    if (current && current.userId === next.userId && current.refreshToken === next.refreshToken) return;
    if (current && current.userId !== next.userId) await addToArchive(current);
    await kv.setItem(SESSION_COPY_KEY, JSON.stringify(next));
    copyMemo = next;
  }

  function remember(raw: string, session: StoredSession): SessionCopy | null {
    const userId = userIdOf(session);
    const copy = userId ? ({ v: 1, userId, refreshToken: session.refresh_token } as const) : null;
    lastGood = { raw, copy };
    readFailed = false;
    state = 'present';
    return copy;
  }

  function knownUserId(): string | null {
    return lastGood?.copy?.userId ?? copyMemo?.userId ?? null;
  }

  // 세션 키를 읽지 못함: auth-js 에는 "없음"을 돌려주되(던지면 auth-js 내부의 첫 세션 알림에서 처리되지 않은
  // 오류가 된다) 상태를 unreadable 로 남긴다. 시작 판정은 이 상태를 보고 새 계정을 만들지 않는다.
  function unreadable(): null {
    state = 'unreadable';
    return null;
  }

  const storage = {
    async getItem(key: string): Promise<string | null> {
      if (!isSessionKey(key)) return kv.getItem(key);
      const writesBefore = writes;
      let raw: string | null;
      try {
        raw = await kv.getItem(key);
      } catch {
        if (lastGood) return lastGood.raw;
        readFailed = true;
        return unreadable();
      }
      const session = raw === null ? null : parseSession(raw);
      if (raw !== null && session) {
        // 읽는 사이에 새 세션이 저장됐으면 옛 값을 기억하거나 사본에 쓰지 않는다.
        if (writesBefore === writes) {
          const copy = remember(raw, session);
          if (copy) await syncCopy(copy).catch(() => {});
        }
        return raw;
      }
      if (lastGood) return lastGood.raw;
      // iOS AsyncStorage 는 파일 읽기에 한 번 실패하면 그 키를 목록에서 빼서, 다음 읽기가 오류 없이 "없음"이 된다.
      if (raw === null && readFailed) return unreadable();
      let copy: SessionCopy | null;
      try {
        copy = await readCopy();
      } catch {
        return unreadable();
      }
      if (copy) {
        state = 'present';
        return sessionFromCopy(copy);
      }
      state = raw === null ? 'none' : 'corrupt';
      return null;
    },

    async setItem(key: string, value: string): Promise<void> {
      if (!isSessionKey(key)) return kv.setItem(key, value);
      writes++;
      await kv.setItem(key, value);
      const session = parseSession(value);
      if (!session) return;
      const copy = remember(value, session);
      if (copy) await syncCopy(copy).catch(() => {});
    },

    async removeItem(key: string): Promise<void> {
      if (!isSessionKey(key)) return kv.removeItem(key);
      if (removalAllowed === 0) return; // auth-js 가 스스로 지우는 것(재발급 실패 등)은 무시한다
      writes++;
      await kv.removeItem(SESSION_COPY_KEY);
      copyMemo = null;
      await kv.removeItem(key);
      lastGood = null;
      readFailed = false;
      state = 'none';
    },
  };

  return {
    /** supabase-js `auth.storage` 에 넣는다. */
    storage,

    /** 이번 실행에서 세션 키를 읽은 결과. */
    state: (): StoredSessionState => state,

    /** 이 기기에 저장된 계정의 사용자 id(이번 실행에서 읽은 세션 또는 사본). 모르면 null. */
    knownUserId,

    /**
     * 문의 번호용 사용자 id. 세션을 읽지 못했어도 사본의 사용자 id 는 쓴다 — 사본의 refreshToken 은 쓰지 않으므로
     * 읽기 실패 뒤에도 안전하다. 모르면 null.
     */
    async inquiryUserId(): Promise<string | null> {
      const known = knownUserId();
      if (known) return known;
      try {
        return (await readCopy())?.userId ?? null;
      } catch {
        return null;
      }
    },

    /** 이번 실행이 시작할 때 이 기기에 앱을 쓴 흔적이 있었는지. 저장소 목록을 읽지 못하면 throw. */
    async hasUsageTrace(): Promise<boolean> {
      const keys = await keysAtStart;
      return keys.some((k) => USAGE_KEY_PREFIXES.some((p) => k.startsWith(p)));
    },

    /** 이번 실행이 시작할 때 이 기기에 위시를 저장해 봤을 수 있다는 흔적이 있었는지. 읽지 못하면 throw. */
    async hasWishTrace(): Promise<boolean> {
      const keys = await keysAtStart;
      return keys.some((k) => WISH_KEY_PREFIXES.some((p) => k.startsWith(p)));
    },

    /** 보관 목록에서 가장 최근에 보관된 계정의 사용자 id(이전 계정 번호용). 없거나 읽지 못하면 null. */
    async archivedUserId(): Promise<string | null> {
      try {
        const raw = parseJson(await kv.getItem(SESSION_ARCHIVE_KEY));
        return (Array.isArray(raw) ? raw : []).map(toCopy).find((c): c is SessionCopy => c !== null)?.userId ?? null;
      } catch {
        return null;
      }
    },

    /** 지금 계정을 보관 목록에 넣는다(새로 시작 전). */
    async archiveCurrent(): Promise<void> {
      const copy = lastGood?.copy ?? (await readCopy());
      if (copy) await addToArchive(copy);
    },

    /** 개발용: 저장된 세션의 만료 시각을 지나게 해 다음 확인 때 재발급하게 한다. 세션이 없으면 false. */
    async expireStoredSessionForDev(): Promise<boolean> {
      const key = (await kv.getAllKeys()).find(isSessionKey);
      const raw = key ? await kv.getItem(key) : null;
      const session = raw ? parseSession(raw) : null;
      if (!key || !session) return false;
      await storage.setItem(key, JSON.stringify({ ...session, expires_at: 1 }));
      return true;
    },

    /** 사용자가 고른 로그아웃: fn 이 도는 동안만 세션과 사본을 지울 수 있다. */
    async allowRemoval<T>(fn: () => Promise<T>): Promise<T> {
      removalAllowed++;
      try {
        return await fn();
      } finally {
        removalAllowed--;
      }
    },
  };
}

// ── 거절 판정·새 익명 계정 ───────────────────────────────────
// 앱의 첫 화면 판정은 통신 없이 기기 값만 읽는다(src/lib/accountLogic.ts). 여기엔 서버 거절 분류와 "로그인 없이 시작"의
// 새 익명 계정 만들기만 둔다.

/** supabase-js `auth` 중 여기서 쓰는 부분. */
export type SessionAuth = {
  getSession(): Promise<{ data: { session: { user: { id: string } } | null }; error: unknown }>;
  signInAnonymously(credentials?: {
    options?: { data?: object };
  }): Promise<{ data: { session: { user: { id: string } } | null }; error: unknown }>;
};

// 다시 시도해도 같은 답이 오는 거절. 그 밖의 오류(403·429·402·409·5xx·통신 실패 등)는 일시적일 수 있어 offline 으로 본다.
// session_not_found 는 auth-js 가 코드 없는 AuthSessionMissingError 로 바꿔 돌려준다.
const REJECTED_CODES = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_expired',
  'validation_failed',
]);

export function isSessionRejected(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: unknown; name?: unknown };
  return (typeof e.code === 'string' && REJECTED_CODES.has(e.code)) || e.name === 'AuthSessionMissingError';
}

/**
 * 사용자가 고른 "로그인 없이 시작": 지금 계정을 보관하고 새 익명 계정을 만든다.
 * 새 계정의 user_metadata.previous_user_id 에 옛 계정 id 를 남겨, 문의 때 사람이 두 계정을 잇게 한다.
 * previousUserId: 남길 값. 생략하면 기기에 저장된 계정, null 이면 남기지 않는다.
 * 가입에 실패하면 false — 저장된 세션은 그대로다.
 */
export async function runStartOver(
  auth: SessionAuth,
  vault: SessionVault,
  previousUserId: string | null = vault.knownUserId(),
): Promise<boolean> {
  await vault.archiveCurrent().catch(() => {});
  try {
    const { data, error } = await auth.signInAnonymously(
      previousUserId ? { options: { data: { previous_user_id: previousUserId } } } : undefined,
    );
    return !error && !!data.session;
  } catch {
    return false;
  }
}
