/**
 * 링크 찾기의 입구 채널(어디서 캡처했나)을 OCR 원문에서 판별한다 — 기기 안에서만.
 * 결과로 도메인 또는 몰 id 하나만 함수(find-purchase-links)에 보내고, OCR 원문은 보내지 않는다(불변식 2).
 *
 * 판별 순서(지시서 '입구 채널 확인'):
 *   1. 캡처에 판매처 주소가 보임(사파리 주소창·앱 안 브라우저 상단·찍힌 주소) → { domain }
 *      서로 다른 사이트 주소가 여럿이면 판별하지 않는다(null).
 *      포털·블로그·SNS 주소만 보이면 판매처가 아니므로 바로 null(공식 홈페이지 찾기).
 *   2. 판매처 주소는 없지만 몰 이름·고유 문구가 보임(몰 앱 캡처, 또는 SNS 캡션의 "에이블리에서 샀어요") → { mall }.
 *      포털·SNS 주소가 함께 보여도 몰 이름을 따른다. 여러 몰이 함께 보이면 null.
 *      상품명·브랜드 글자는 빼고 찾는다('지그재그 패턴 니트' 같은 상품명이 몰로 읽히지 않게).
 *   3. 둘 다 아니면 null → 함수가 브랜드 공식 홈페이지를 찾는다.
 *
 * 틀리게 판별하면 검색 범위가 엉뚱한 사이트 하나로 좁혀지므로, 애매하면 판별하지 않는 쪽(null)을 택한다.
 * 몰 id·판매처가 아닌 도메인·접미사 목록은 서버 supabase/functions/find-purchase-links/{malls,logic}.ts 와 같아야 한다.
 * 식별 문구는 초안 — 실제 캡처 OCR 로 확인해 고친다.
 */

export type MallId =
  | 'naver'
  | 'coupang'
  | 'musinsa'
  | '29cm'
  | 'wconcept'
  | 'oliveyoung'
  | 'ssg'
  | 'lotteon'
  | 'ohou'
  | 'ikea'
  | 'kurly'
  | 'zigzag'
  | 'ably';

export type PurchaseChannel = { domain: string } | { mall: MallId } | null;

// 몰 고유 문구. 다른 맥락에도 흔한 글자는 넣지 않는다(지시서 '입구 채널 사전'):
//   결제 수단 '네이버페이'·일반 표현 '브랜드스토어'·치수와 겹치는 '29cm'·'IKEA 호환' 같은 'IKEA'·'컬리수' 같은 '컬리'.
//   29CM·이케아는 주소(29cm.co.kr·ikea.com)로만 판별한다.
// 비교: 원문을 소문자로 바꾸고 연속 공백을 한 칸으로 줄인 뒤, 문구가 그대로 들어 있는지 본다(공백을 지우지 않는다 —
//   '오늘의 집밥'이 '오늘의집'으로 읽히지 않게).
const MALL_PHRASES: Partial<Record<MallId, readonly string[]>> = {
  naver: ['스마트스토어'],
  // 쿠팡 앱 상품 화면엔 '쿠팡' 글자 없이 배송 표기만 보이는 경우가 많다(예: '판매자로켓')
  coupang: ['쿠팡', 'coupang', '로켓배송', '로켓와우', '판매자로켓', '로켓프레시', '로켓직구', '로켓설치', '로켓그로스'],
  musinsa: ['무신사', 'musinsa'],
  wconcept: ['w컨셉', 'wconcept', 'w concept'],
  oliveyoung: ['올리브영', 'oliveyoung', 'olive young', '오늘드림'],
  ssg: ['ssg.com', '쓱배송'],
  lotteon: ['롯데on', '롯데온', 'lotteon', 'lotte on'],
  ohou: ['오늘의집'],
  kurly: ['마켓컬리', 'kurly', '샛별배송'],
  // '직진배송'은 지그재그 배송 표기. 영문 'zigzag'·'ably'는 일반 단어(지그재그 무늬, probably)와 겹쳐 넣지 않는다.
  zigzag: ['지그재그', '직진배송', 'zigzag.kr'],
  ably: ['에이블리', 'a-bly'],
};

// 판매처가 아닌 플랫폼(서버 NON_SELLER_DOMAINS 와 같음). 하위 도메인 포함.
const NON_SELLER_DOMAINS: readonly string[] = [
  'naver.com', 'naver.me', 'daum.net', 'kakao.com', 'tistory.com', 'brunch.co.kr',
  'google.com', 'instagram.com', 'facebook.com', 'threads.net', 'x.com', 'twitter.com',
  'youtube.com', 'youtu.be', 'tiktok.com', 'pinterest.com',
];
// 사전의 몰 도메인 중 판매처가 아닌 플랫폼의 하위 도메인인 것(먼저 몰로 본다)
const MALL_SUBDOMAINS_OF_PLATFORMS: readonly string[] = ['smartstore.naver.com', 'brand.naver.com'];

// 등록 기관 접미사만 남은 이름·예약 최상위 이름(서버 logic.ts 와 같음) — 서버가 400 으로 거절한다.
const PUBLIC_SUFFIX_ONLY = new Set([
  'co.kr', 'or.kr', 'go.kr', 'ac.kr', 'ne.kr', 're.kr', 'pe.kr', 'kg.kr', 'es.kr', 'ms.kr', 'hs.kr', 'sc.kr', 'mil.kr',
  'co.uk', 'org.uk', 'ac.uk', 'com.cn', 'net.cn', 'org.cn', 'co.jp', 'ne.jp', 'or.jp',
  'com.au', 'net.au', 'com.tw', 'com.hk', 'com.sg', 'co.nz', 'com.br',
]);
const RESERVED_TLDS = new Set([
  'local', 'localhost', 'internal', 'localdomain', 'invalid', 'test', 'example', 'onion', 'lan', 'home', 'corp', 'arpa',
]);

// 캡처에 보이는 주소로 흔한 최상위 이름만 인정한다(1.5kg·v2.0·image.jpg 같은 글자를 주소로 오인하지 않게).
const TLDS = [
  'com', 'net', 'org', 'kr', 'co', 'shop', 'store', 'io', 'me', 'app', 'se', 'jp', 'cn', 'us', 'uk',
  'de', 'fr', 'it', 'tw', 'hk', 'sg', 'au', 'ca', 'site', 'online', 'xyz', 'biz', 'info',
];
// 그룹 1: 스킴, 그룹 2: 호스트, 그룹 3: 바로 뒤 경로('/' 로 시작)
const HOST_IN_TEXT = new RegExp(
  `(https?:\\/\\/)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS.join('|')}))(?![a-z0-9@_-])(\\/)?`,
  'gi',
);
// SNS 캡처 표시 — 이런 글자가 있으면 계정명(nike.kr 등)을 주소로 오인하기 쉬워, 확실한 주소만 인정한다.
const SNS_MARKERS = /팔로우|팔로워|팔로잉|follow|좋아요|댓글|릴스|reels|리포스트|게시물/i;
// 사파리 주소창 줄에 함께 읽히는 글자(텍스트 크기 버튼 'AA'·'가가')
// (\b 는 한글에서 동작하지 않으므로 공백·줄 끝으로 경계를 잡는다)
const ADDRESS_BAR_EXTRAS = /(?:^|\s)(?:aa|가가)(?=\s|$)/gi;

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

// 호스트명을 서버와 같은 규칙으로 정리: 소문자, www.·m. 떼기(뗀 뒤에도 점이 남을 때만).
function siteName(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '');
  const stripped = h.replace(/^(?:www\d?|m|mobile)\./, '');
  return stripped.includes('.') ? stripped : h;
}

function isNonSeller(name: string): boolean {
  if (MALL_SUBDOMAINS_OF_PLATFORMS.some((d) => hostMatches(name, d))) return false;
  return NON_SELLER_DOMAINS.some((d) => hostMatches(name, d));
}

export interface DomainScan {
  /** 판매처로 볼 수 있는 사이트 이름들(중복 없음) */
  sellers: string[];
  /** 판매처가 아닌 플랫폼 주소(포털·블로그·SNS)를 봤는지 */
  sawNonSeller: boolean;
}

/**
 * OCR 원문에서 사이트 주소를 찾는다. 주소로 인정하는 것:
 *   - 스킴(https://)·www.·경로('/...')가 붙은 주소, 또는
 *   - 그 줄이 거의 주소뿐인 경우(사파리 주소창 줄 — 'AA'·'가가' 정도만 함께 있음). 단 SNS 캡처에선 인정하지 않는다.
 * 버리는 것: 이메일·계정명(앞 글자가 문자·숫자·밑줄·점·@), 잘린 주소('brand.co. kr'), 접미사만 남은 이름·예약 이름.
 */
export function scanDomains(ocrText: string): DomainScan {
  const sellers = new Set<string>();
  let sawNonSeller = false;
  const sns = SNS_MARKERS.test(ocrText);

  for (const line of ocrText.split(/\r?\n/)) {
    for (const m of line.matchAll(HOST_IN_TEXT)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      const prev = start > 0 ? line[start - 1] : '';
      if (/[A-Za-z0-9_.@-]/.test(prev)) continue; // 이메일·계정명의 일부
      if (/^\.\s*[a-z]/i.test(line.slice(end))) continue; // 'brand.co. kr' — OCR 이 끊어 읽은 주소

      const host = m[2];
      const strong = Boolean(m[1]) || /^www\d?\./i.test(host) || Boolean(m[3]);
      if (!strong) {
        if (sns) continue;
        // 그 줄에서 주소와 주소창 버튼 글자를 뺀 나머지 문자·숫자가 거의 없을 때만(주소창 줄)
        const rest = (line.slice(0, start) + line.slice(end)).replace(ADDRESS_BAR_EXTRAS, '').replace(/[^\p{L}\p{N}]/gu, '');
        if (rest.length > 2) continue;
      }

      const name = siteName(host);
      if (PUBLIC_SUFFIX_ONLY.has(name)) continue;
      if (RESERVED_TLDS.has(name.slice(name.lastIndexOf('.') + 1))) continue;
      if (isNonSeller(name)) {
        sawNonSeller = true;
        continue;
      }
      sellers.add(name);
    }
  }
  return { sellers: [...sellers], sawNonSeller };
}

// 몰 문구 비교용: 소문자 + 연속 공백을 한 칸으로
function foldText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * OCR 원문에 고유 문구가 보이는 몰 id 들.
 * exclude(상품명·브랜드)의 글자는 빼고 찾는다 — 상품명에 든 '지그재그'·'올리브영 콜라보' 같은 글자가 몰로 읽히지 않게.
 */
export function findMalls(ocrText: string, exclude: readonly (string | null | undefined)[] = []): MallId[] {
  let text = foldText(ocrText);
  for (const term of exclude) {
    const t = term ? foldText(term).trim() : '';
    if (t.length >= 2) text = text.split(t).join(' ');
  }
  return (Object.keys(MALL_PHRASES) as MallId[]).filter((id) =>
    (MALL_PHRASES[id] ?? []).some((p) => text.includes(p)),
  );
}

/**
 * 입구 채널 판별. 확실하지 않으면 null(공식 홈페이지 찾기).
 * exclude: 정제 결과의 상품명·브랜드(몰 문구를 찾을 때 그 글자는 뺀다).
 */
export function detectPurchaseChannel(
  ocrText: string | null | undefined,
  exclude: readonly (string | null | undefined)[] = [],
): PurchaseChannel {
  if (!ocrText) return null;
  const { sellers } = scanDomains(ocrText);
  if (sellers.length === 1) return { domain: sellers[0] };
  if (sellers.length > 1) {
    // 같은 사이트의 다른 하위 도메인이면(shop.brand.com·brand.com) 가장 짧은 이름으로 본다
    const shortest = [...sellers].sort((a, b) => a.length - b.length)[0];
    if (sellers.every((d) => hostMatches(d, shortest))) return { domain: shortest };
    return null; // 서로 다른 사이트 — 판별하지 않음
  }
  // 판매처 주소가 없으면 몰 이름·고유 문구로(포털·SNS 주소가 함께 보여도 몰 이름을 따른다)
  const malls = findMalls(ocrText, exclude);
  return malls.length === 1 ? { mall: malls[0] } : null;
}
