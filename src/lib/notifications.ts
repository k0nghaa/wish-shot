import AsyncStorage from '@react-native-async-storage/async-storage';
import { uuid } from 'expo-modules-core';

/**
 * 기기 안 알림 저장소(서버에 보내지 않음 — 익명 계정, 링크 붙이기 자체가 앱 안에서 일어남).
 * 화면 밖(저장 뒤 링크 붙이기)에서도 쓰므로 React 밖의 작은 모듈로 두고, 화면은 useNotifications 로 구독한다.
 *
 * - 알림: 저장 뒤 링크를 붙인 기록. 최근 20개·14일까지(읽거나 쓸 때 정리). 탭 배지 = 안 읽은 수,
 *   타일 와인색 점 = 안 읽은 알림이 있는 위시. 상세에서 그 위시를 보면 읽음.
 * - 찾는 중: 저장 뒤 링크를 이어 찾는 위시(타일을 흐리게). 앱이 켜져 있는 동안만 찾으므로 메모리에만 둔다.
 * - 못 찾은 위시: 자동 찾기가 링크를 못 찾은 위시(편집 화면 링크 칸 자리표시). 14일·최대 100개.
 * 저장 실패는 삼킨다(다음 실행에 비어 보일 뿐 흐름을 막지 않는다).
 */

export type NotificationType = 'link_attached';

export type AppNotification = {
  id: string;
  type: NotificationType;
  itemId: string;
  /** 알림을 만든 때의 제품명(목록은 지금 위시 이름을 우선 쓰고, 위시를 못 찾으면 이 값). */
  productName: string;
  createdAt: number;
  read: boolean;
};

/** 알림 종류별 문구(한 곳에서 정한다 — 새 종류는 type 과 여기 문구만 더한다). */
export const NOTIFICATION_TITLE: Record<NotificationType, string> = {
  link_attached: '링크를 붙였습니다',
};

const NOTIFICATIONS_KEY = 'wishshot.notifications';
const LINK_NOT_FOUND_KEY = 'wishshot.linkNotFound';
const KEEP_MS = 14 * 24 * 60 * 60_000;
const MAX_NOTIFICATIONS = 20;
const MAX_NOT_FOUND = 100;

export type NotificationsSnapshot = {
  notifications: AppNotification[]; // 최신순
  unreadCount: number;
  /** 안 읽은 알림이 있는 위시(타일 와인색 점). */
  unseenItemIds: ReadonlySet<string>;
  /** 저장 뒤 링크를 찾는 중인 위시(타일 흐림). */
  pendingItemIds: ReadonlySet<string>;
  /** 자동 찾기가 링크를 못 찾은 위시(편집 화면 자리표시). */
  notFoundItemIds: ReadonlySet<string>;
};

let notifications: AppNotification[] = [];
let notFound: Record<string, number> = {}; // itemId → 기록 시각
const pending = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: NotificationsSnapshot = buildSnapshot();
let hydrating: Promise<void> | null = null;

function buildSnapshot(): NotificationsSnapshot {
  return {
    notifications,
    unreadCount: notifications.filter((n) => !n.read).length,
    unseenItemIds: new Set(notifications.filter((n) => !n.read).map((n) => n.itemId)),
    pendingItemIds: new Set(pending),
    notFoundItemIds: new Set(Object.keys(notFound)),
  };
}

function emit() {
  snapshot = buildSnapshot();
  for (const l of listeners) l();
}

function prune(now = Date.now()) {
  notifications = notifications
    .filter((n) => now - n.createdAt < KEEP_MS)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_NOTIFICATIONS);
  const kept = Object.entries(notFound)
    .filter(([, at]) => now - at < KEEP_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_NOT_FOUND);
  notFound = Object.fromEntries(kept);
}

function persist() {
  void AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications)).catch(() => undefined);
  void AsyncStorage.setItem(LINK_NOT_FOUND_KEY, JSON.stringify(notFound)).catch(() => undefined);
}

function parseNotifications(raw: string | null): AppNotification[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (n): n is AppNotification =>
        !!n &&
        typeof n.id === 'string' &&
        n.type === 'link_attached' &&
        typeof n.itemId === 'string' &&
        typeof n.productName === 'string' &&
        typeof n.createdAt === 'number' &&
        typeof n.read === 'boolean',
    );
  } catch {
    return [];
  }
}

function parseNotFound(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== 'object') return {};
    return Object.fromEntries(Object.entries(obj).filter(([, at]) => typeof at === 'number')) as Record<string, number>;
  } catch {
    return {};
  }
}

/** 기기에 둔 알림을 읽어 메모리에 둔다(앱 시작 1회 — 쓰기 전에도 자동으로 기다린다). 실패는 빈 목록. */
export function hydrateNotifications(): Promise<void> {
  if (!hydrating) {
    hydrating = (async () => {
      try {
        const [rawN, rawF] = await Promise.all([
          AsyncStorage.getItem(NOTIFICATIONS_KEY),
          AsyncStorage.getItem(LINK_NOT_FOUND_KEY),
        ]);
        // 읽는 사이 쓴 값(앱 시작 직후 붙임 등)은 살린다.
        const loaded = parseNotifications(rawN);
        const ids = new Set(notifications.map((n) => n.id));
        notifications = [...notifications, ...loaded.filter((n) => !ids.has(n.id))];
        notFound = { ...parseNotFound(rawF), ...notFound };
      } catch {
        /* 읽기 실패는 빈 목록으로 */
      }
      prune();
      emit();
    })();
  }
  return hydrating;
}

async function mutate(change: () => boolean) {
  await hydrateNotifications();
  if (!change()) return;
  prune();
  persist();
  emit();
}

/** 저장 뒤 링크를 붙였다는 알림(안 읽음). 그 위시의 '못 찾음' 기록은 지운다. */
export function addLinkAttachedNotification(input: { itemId: string; productName: string }): Promise<void> {
  return mutate(() => {
    notifications = [
      { id: uuid.v4(), type: 'link_attached', itemId: input.itemId, productName: input.productName, createdAt: Date.now(), read: false },
      ...notifications,
    ];
    delete notFound[input.itemId];
    return true;
  });
}

/** 그 위시의 알림을 모두 읽음으로(상세에서 그 위시를 봤을 때). */
export function markItemSeen(itemId: string): Promise<void> {
  return mutate(() => {
    let changed = false;
    notifications = notifications.map((n) => {
      if (n.itemId !== itemId || n.read) return n;
      changed = true;
      return { ...n, read: true };
    });
    return changed;
  });
}

/** 저장 뒤 링크 찾기 시작(타일 흐림). 메모리에만. */
export function markLinkPending(itemId: string) {
  if (pending.has(itemId)) return;
  pending.add(itemId);
  emit();
}

/** 저장 뒤 링크 찾기 끝(붙임·못 찾음 무관). */
export function clearLinkPending(itemId: string) {
  if (!pending.delete(itemId)) return;
  emit();
}

/** 자동 찾기가 링크를 못 찾은 위시로 기록(편집 화면 자리표시). */
export function markLinkNotFound(itemId: string): Promise<void> {
  return mutate(() => {
    notFound = { ...notFound, [itemId]: Date.now() };
    return true;
  });
}

/** 그 위시에 링크가 저장됐으면 '못 찾음' 기록을 지운다. */
export function clearLinkNotFound(itemId: string): Promise<void> {
  return mutate(() => {
    if (!(itemId in notFound)) return false;
    const next = { ...notFound };
    delete next[itemId];
    notFound = next;
    return true;
  });
}

/** 위시를 지웠을 때 그 위시의 알림·기록을 함께 지운다. */
export function removeNotificationItems(itemIds: string[]): Promise<void> {
  const ids = new Set(itemIds);
  let pendingChanged = false;
  for (const id of ids) pendingChanged = pending.delete(id) || pendingChanged;
  if (pendingChanged) emit();
  return mutate(() => {
    const before = notifications.length + Object.keys(notFound).length;
    notifications = notifications.filter((n) => !ids.has(n.itemId));
    notFound = Object.fromEntries(Object.entries(notFound).filter(([id]) => !ids.has(id)));
    return before !== notifications.length + Object.keys(notFound).length;
  });
}

/** 이미 없는 위시(다른 경로로 지워짐 등)의 알림·기록을 정리한다 — 알림 목록이 위시 목록을 읽은 뒤 부른다. */
export function pruneMissingItems(existingItemIds: ReadonlySet<string>): Promise<void> {
  return mutate(() => {
    const before = notifications.length + Object.keys(notFound).length;
    notifications = notifications.filter((n) => existingItemIds.has(n.itemId));
    notFound = Object.fromEntries(Object.entries(notFound).filter(([id]) => existingItemIds.has(id)));
    return before !== notifications.length + Object.keys(notFound).length;
  });
}

export function subscribeNotifications(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getNotificationsSnapshot(): NotificationsSnapshot {
  return snapshot;
}
