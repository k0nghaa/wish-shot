// 입구 채널 사전(서버 쪽) — 몰 id → 그 몰 안에서 검색할 도메인 + 몰 이름.
// 앱(src/lib)은 같은 몰 id 와 OCR 식별 문구를 갖고, 판별 결과로 몰 id 만 보낸다.
// 지시서 '입구 채널 사전'(초안 — 사람이 확정)과 같은 목록이어야 한다.
//
// ownBrands: 브랜드가 그 몰 자체(자체 브랜드 포함)일 때 채널이 없는 검색에서도 그 몰을
//   검색 범위에 남기기 위한 브랜드 표기. 정규화(소문자·문자/숫자만)한 브랜드와 "정확히" 같을 때만
//   해당한다 — 앞부분만 같은 다른 브랜드(예: 컬리수·SSGOOD)는 몰을 그대로 뺀다.

export type Mall = { domains: readonly string[]; ownBrands: readonly string[] };

export const MALLS = {
  naver: { domains: ['smartstore.naver.com', 'brand.naver.com'], ownBrands: ['네이버', 'naver'] },
  coupang: { domains: ['coupang.com'], ownBrands: ['쿠팡', 'coupang'] },
  musinsa: { domains: ['musinsa.com'], ownBrands: ['무신사', 'musinsa', '무신사스탠다드', 'musinsastandard'] },
  '29cm': { domains: ['29cm.co.kr'], ownBrands: ['29cm'] },
  wconcept: { domains: ['wconcept.co.kr'], ownBrands: ['w컨셉', 'wconcept', '더블유컨셉'] },
  oliveyoung: { domains: ['oliveyoung.co.kr'], ownBrands: ['올리브영', 'oliveyoung'] },
  ssg: { domains: ['ssg.com'], ownBrands: ['ssg', 'ssg닷컴', 'ssgcom'] },
  lotteon: { domains: ['lotteon.com'], ownBrands: ['롯데온', '롯데on', 'lotteon'] },
  ohou: { domains: ['ohou.se'], ownBrands: ['오늘의집', 'ohouse'] },
  ikea: { domains: ['ikea.com'], ownBrands: ['이케아', 'ikea'] },
  kurly: { domains: ['kurly.com'], ownBrands: ['컬리', 'kurly'] },
  zigzag: { domains: ['zigzag.kr'], ownBrands: ['지그재그', 'zigzag'] },
  ably: { domains: ['a-bly.com'], ownBrands: ['에이블리', 'ably'] },
} as const satisfies Record<string, Mall>;

// 판매처가 아닌 플랫폼(포털·블로그·SNS·영상·검색). 캡처에 이 주소가 보여도 상품을 파는 곳이
// 아니므로 입구 채널이 없는 것으로 본다(→ 공식 홈페이지 찾기). 하위 도메인 포함.
// 사전의 몰 도메인(smartstore.naver.com 등)은 이 목록보다 먼저 판별된다.
export const NON_SELLER_DOMAINS: readonly string[] = [
  'naver.com', 'naver.me', 'daum.net', 'kakao.com', 'tistory.com', 'brunch.co.kr',
  'google.com', 'instagram.com', 'facebook.com', 'threads.net', 'x.com', 'twitter.com',
  'youtube.com', 'youtu.be', 'tiktok.com', 'pinterest.com',
];

export type MallId = keyof typeof MALLS;

export function isMallId(v: unknown): v is MallId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(MALLS, v);
}
