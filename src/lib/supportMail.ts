// 지원 메일 주소와 메일 작성 주소(mailto). import 없는 순수 TS — Deno 시험(supabase/tests/support_mail_test.ts)이 import 한다.

/** 지원 이메일 — docs/legal/support.html·개인정보 방침과 통일된 주소(새 주소 금지). */
export const SUPPORT_EMAIL = 'wishshot2026@gmail.com';

/**
 * 문의 번호: 계정 ID(UUID) 앞 8자를 대문자로. 사람이 DB 에서 계정을 찾는 단서일 뿐 본인 증거가 아니다.
 * UUID 가 아니면 null.
 */
export function inquiryNumber(userId: string | null): string | null {
  const head = userId ? /^[0-9a-f]{8}/i.exec(userId) : null;
  return head ? head[0].toUpperCase() : null;
}

// 문의 메일. 본문은 빈 줄 둘과 문의 번호뿐이다 — 전체 ID·토큰·원인 코드는 넣지 않는다.
// 문의 번호를 모르면 본문을 비운다. 사용자는 보내기 전에 지울 수 있다.
function inquiryMailUrl(subject: string, userId: string | null): string {
  const number = inquiryNumber(userId);
  const query = [`subject=${encodeURIComponent(subject)}`];
  if (number) query.push(`body=${encodeURIComponent(`\n\n문의 번호: ${number}`)}`);
  return `mailto:${SUPPORT_EMAIL}?${query.join('&')}`;
}

/** 설정 "의견 보내기" 메일. 본문 맨 아래에 문의 번호(익명·로그인 모두 — 지금 계정 ID 앞 8자). */
export function feedbackMailUrl(userId: string | null = null): string {
  return inquiryMailUrl('WishShot 의견', userId);
}

/** 끊긴 세션 화면(알림창 C)·합치지 못한 위시 "문의하기"의 메일. */
export function lostAccountMailUrl(userId: string | null): string {
  return inquiryMailUrl('WishShot 기존 위시 찾기', userId);
}
