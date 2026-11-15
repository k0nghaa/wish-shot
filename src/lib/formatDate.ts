/** ISO 문자열(created_at)을 저장일 표기 `YYYY.MM.DD` 로 바꾼다. */
export function formatSavedDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

/** 알림 시각을 지금 기준 상대 표기로(방금 / N분 전 / N시간 전 / 어제 / N일 전). 알림은 14일까지만 보관한다. */
export function formatRelativeTime(at: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - at);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '어제' : `${days}일 전`;
}
