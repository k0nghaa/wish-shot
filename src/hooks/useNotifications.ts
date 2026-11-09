import { useSyncExternalStore } from 'react';

import { getNotificationsSnapshot, subscribeNotifications, type NotificationsSnapshot } from '@/lib/notifications';

/** 기기 안 알림 저장소 구독(탭 배지·타일 흐림/점·알림 목록·편집 자리표시). 값이 바뀔 때만 다시 그린다. */
export function useNotifications(): NotificationsSnapshot {
  return useSyncExternalStore(subscribeNotifications, getNotificationsSnapshot);
}
