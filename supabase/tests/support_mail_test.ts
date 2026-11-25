// 지원 메일 주소 만들기(src/lib/supportMail.ts — import 없는 순수 TS) 단위 검증. 네트워크·키 없음.
// 실행: deno test --no-lock supabase/tests/support_mail_test.ts
import {
  connectionMailUrl,
  feedbackMailUrl,
  inquiryNumber,
  lostAccountMailUrl,
  SUPPORT_EMAIL,
} from '../../src/lib/supportMail.ts';

function eq(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}

const USER_ID = '8c1f2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b';

function parseMailto(url: string) {
  const [address, query = ''] = url.replace(/^mailto:/, '').split('?');
  return { address, params: Object.fromEntries(new URLSearchParams(query)) };
}

Deno.test('문의 번호: 계정 ID 앞 8자 대문자, UUID 가 아니면 없음', () => {
  eq(inquiryNumber(USER_ID), '8C1F2A3B');
  eq(inquiryNumber('8C1F2A3B-0000-0000-0000-000000000000'), '8C1F2A3B');
  eq(inquiryNumber(null), null);
  eq(inquiryNumber(''), null);
  eq(inquiryNumber('OLD'), null);
});

Deno.test('끊긴 세션 문의 메일: 제목 + 빈 줄 둘과 문의 번호만, 전체 ID 는 넣지 않는다', () => {
  const url = lostAccountMailUrl(USER_ID);
  eq(parseMailto(url), {
    address: SUPPORT_EMAIL,
    params: { subject: 'WishShot 기존 위시 찾기', body: '\n\n문의 번호: 8C1F2A3B' },
  });
  const leaksId = url.includes(USER_ID) || url.toLowerCase().includes(USER_ID.slice(9));
  eq(leaksId, false, '전체 ID 가 들어가면 안 된다');
  eq(/^[\x21-\x7e]+$/.test(url), true, '한글·줄바꿈은 인코딩');
});

Deno.test('끊긴 세션 문의 메일: 계정 ID 를 모르면 본문 없음', () => {
  eq(parseMailto(lostAccountMailUrl(null)), {
    address: SUPPORT_EMAIL,
    params: { subject: 'WishShot 기존 위시 찾기' },
  });
});

Deno.test('연결 실패 문의 메일: 제목만 다르고 본문 규칙은 같다', () => {
  eq(parseMailto(connectionMailUrl(USER_ID)), {
    address: SUPPORT_EMAIL,
    params: { subject: 'WishShot 연결 문의', body: '\n\n문의 번호: 8C1F2A3B' },
  });
  eq(parseMailto(connectionMailUrl(null)), {
    address: SUPPORT_EMAIL,
    params: { subject: 'WishShot 연결 문의' },
  });
});

Deno.test('의견 보내기 메일: 제목만(이전과 같음)', () => {
  const subject = encodeURIComponent('WishShot 의견');
  eq(feedbackMailUrl(), `mailto:wishshot2026@gmail.com?subject=${subject}`);
});
