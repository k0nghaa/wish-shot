/** ISO 문자열(created_at)을 저장일 표기 `YYYY.MM.DD` 로 바꾼다. */
export function formatSavedDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}
