// 입구 채널 사전(서버 쪽) — 몰 id → 그 몰 안에서 검색할 도메인 + 몰 이름.
// 앱(src/lib)은 같은 몰 id 와 OCR 식별 문구를 갖고, 판별 결과로 몰 id 만 보낸다.
// 지시서 '입구 채널 사전'(초안 — 사람이 확정)과 같은 목록이어야 한다.
//
// ownBrands: 브랜드가 그 몰 자체(자체 브랜드 포함)일 때 채널이 없는 검색에서도 그 몰을
//   검색 범위에 남기기 위한 브랜드 표기. 정규화(소문자·문자/숫자만)한 브랜드와 "정확히" 같을 때만
//   해당한다 — 앞부분만 같은 다른 브랜드(예: 컬리수·SSGOOD)는 몰을 그대로 뺀다.

// search: 상품 페이지를 못 찾았을 때 넣는 '그 몰 검색 결과' 주소 형식(사람 결정 2026-11-09).
//   base 에 param=검색어 를 붙인다. **실제 몰에서 확인된 형식만** 넣는다(지어내지 않는다) — 없는 몰은 빈칸.
//   쿠팡: 2026-11-09 웹 검색 결과에 나온 쿠팡 검색 주소(/np/search?q=…)로 확인.
//   무신사: 2026-11-10 함수와 같은 사용자 에이전트로 접속해 확인 — /search/goods?keyword=… → 307(같은 주소 + &gf=A) → 200.
//     옛 주소 /search/musinsa/goods?q=… 도 이 주소로 308 리다이렉트된다.
//   29CM: 2026-11-10 접속 확인 — 옛 검색 주소 search.29cm.co.kr/?keyword=… 가 shop.29cm.co.kr/search 를 거쳐
//     www.29cm.co.kr/store/search?keyword=… 로 리다이렉트되고, 이 주소는 307(+ &sort=RECOMMENDED) → 200.
//   오늘의집: 2026-11-10 웹 검색 결과에 나온 오늘의집 상품(스토어) 검색 주소(/productions/feed?query=…, 제목 '…의 검색결과 N개')로
//     확인. 봇 접속에 403 을 줄 때가 있으나(2026-11-10 curl) 사전의 몰이라 접속 확인에서 허용된다(statusVerdict).
//     같은 날 함수의 verifyLink 로는 200.
// notBrands: 정제가 브랜드로 잘못 뽑는 그 몰의 행사 이름 — 몰 검색어 앞에 붙이지 않는다(정규화해 정확히 같을 때).
//   29CM: 1회차 개발용 앱 시험에서 정제가 '이구패션위크'를 브랜드로 뽑음(지시서 결과 기록).
export type Mall = {
  domains: readonly string[];
  ownBrands: readonly string[];
  search?: { base: string; param: string };
  notBrands?: readonly string[];
};

export const MALLS = {
  naver: { domains: ['smartstore.naver.com', 'brand.naver.com'], ownBrands: ['네이버', 'naver'] },
  coupang: {
    domains: ['coupang.com'],
    ownBrands: ['쿠팡', 'coupang'],
    search: { base: 'https://www.coupang.com/np/search', param: 'q' },
  },
  musinsa: {
    domains: ['musinsa.com'],
    ownBrands: ['무신사', 'musinsa', '무신사스탠다드', 'musinsastandard'],
    search: { base: 'https://www.musinsa.com/search/goods', param: 'keyword' },
  },
  '29cm': {
    domains: ['29cm.co.kr'],
    ownBrands: ['29cm'],
    search: { base: 'https://www.29cm.co.kr/store/search', param: 'keyword' },
    notBrands: ['이구위크', '이구패션위크'],
  },
  wconcept: { domains: ['wconcept.co.kr'], ownBrands: ['w컨셉', 'wconcept', '더블유컨셉'] },
  oliveyoung: { domains: ['oliveyoung.co.kr'], ownBrands: ['올리브영', 'oliveyoung'] },
  ssg: { domains: ['ssg.com'], ownBrands: ['ssg', 'ssg닷컴', 'ssgcom'] },
  lotteon: { domains: ['lotteon.com'], ownBrands: ['롯데온', '롯데on', 'lotteon'] },
  ohou: {
    domains: ['ohou.se'],
    ownBrands: ['오늘의집', 'ohouse'],
    search: { base: 'https://ohou.se/productions/feed', param: 'query' },
  },
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
