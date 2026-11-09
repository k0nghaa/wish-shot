// find-purchase-links 의 순수 로직(네트워크·환경 변수 없음).
// index.ts(배포 함수)와 supabase/tests/find_purchase_links_test.ts(단위 검증)가 쓴다.
//
// 불변식 1(실제 URL만): 화면에 나가는 URL 은 harvestCandidates 가 웹 검색 결과 블록에서
//   꺼낸 것뿐이다. 모델이 고르는 것은 후보 "번호"이고, URL 은 pickToLink 가 후보에서 꺼낸다.

import { MALLS, type Mall, type MallId, NON_SELLER_DOMAINS, isMallId } from './malls.ts';

export const MAX_PRODUCT_NAME_LEN = 200;
export const MAX_BRAND_LEN = 100;
// 검색 1회 결과는 보통 10개 안팎 — 검색 3회분을 담을 수 있게.
export const MAX_CANDIDATES = 30;
const MAX_URL_LEN = 2048;

// 입구 채널: 그 사이트(들) 안에서 찾는다 / 채널을 모른다(공식 홈페이지를 찾는다)
// mall: 그 사이트가 사전의 몰이면 몰 id(상품 페이지를 못 찾았을 때 그 몰 검색 링크를 만들 때 쓴다)
export type Channel =
  | { via: 'domain' | 'mall'; domains: readonly string[]; mall?: MallId }
  | { via: 'none' };

// 웹 검색 도구의 도메인 필터(allowed_domains·blocked_domains 는 둘 중 하나만)
export type SearchScope =
  | { mode: 'allowed'; domains: readonly string[] }
  | { mode: 'blocked'; domains: readonly string[] };

export type Candidate = { url: string; title: string; domain: string };

// kind: official(브랜드 공식몰 상품 페이지) / site(그 사이트·몰 상품 페이지) / search(상품 페이지를 못 찾아 넣은 그 몰 검색 결과)
export type Link = { url: string; domain: string; kind: 'official' | 'site' | 'search'; mall?: MallId };

// 호스트명 형식(ASCII 만 — 유니코드 도메인은 겉보기가 같은 다른 도메인일 수 있어 받지 않는다).
// 라벨 1~63자, 영문 소문자·숫자·하이픈(양 끝 하이픈 불가), 점 하나 이상, 최상위 라벨은 영문으로 시작하는 2자 이상.
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

// 등록 기관 접미사만 남은 이름(주소창이 잘려 '…co.kr'만 읽힌 경우 등) — 검색 범위가 나라 전체가 된다.
const PUBLIC_SUFFIX_ONLY = new Set([
  'co.kr', 'or.kr', 'go.kr', 'ac.kr', 'ne.kr', 're.kr', 'pe.kr', 'kg.kr', 'es.kr', 'ms.kr', 'hs.kr', 'sc.kr', 'mil.kr',
  'co.uk', 'org.uk', 'ac.uk', 'com.cn', 'net.cn', 'org.cn', 'co.jp', 'ne.jp', 'or.jp',
  'com.au', 'net.au', 'com.tw', 'com.hk', 'com.sg', 'co.nz', 'com.br',
]);
// 공개 인터넷에 없는 예약 최상위 이름
const RESERVED_TLDS = new Set([
  'local', 'localhost', 'internal', 'localdomain', 'invalid', 'test', 'example', 'onion', 'lan', 'home', 'corp', 'arpa',
]);

// 캡처에서 읽은 도메인을 검색 범위로 쓸 수 있게 정리한다. 형식이 틀리면 null.
// 앱이 이미 정리해 보내지만, 서버도 같은 규칙으로 한 번 더 정리한다.
export function normalizeDomain(raw: string): string | null {
  // 스킴·경로·포트가 붙어 와도 호스트명만 남긴다(예: https://m.musinsa.com/products/1 → m.musinsa.com)
  let d = raw.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#:]/)[0].replace(/\.$/, '');
  // 모바일·www 접두어는 떼어 사이트 전체를 범위로(하위 도메인은 자동 포함된다)
  const stripped = d.replace(/^(?:www\d?|m|mobile)\./, '');
  if (stripped.includes('.')) d = stripped;
  if (!HOST_RE.test(d)) return null;
  if (PUBLIC_SUFFIX_ONLY.has(d)) return null;
  if (RESERVED_TLDS.has(d.slice(d.lastIndexOf('.') + 1))) return null;
  return d;
}

export function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

// 도메인이 사전의 몰이면 그 몰 id
export function mallForDomain(domain: string): MallId | null {
  for (const [id, mall] of Object.entries(MALLS) as [MallId, (typeof MALLS)[MallId]][]) {
    if (mall.domains.some((md) => hostMatches(domain, md))) return id;
  }
  return null;
}

export type ChannelResult = { ok: true; channel: Channel } | { ok: false; error: 'invalid_input' | 'invalid_domain' | 'invalid_mall' };

// 입력의 domain·mall(둘 중 하나만)로 입구 채널을 정한다.
export function resolveChannel(domain: unknown, mall: unknown): ChannelResult {
  const hasDomain = domain != null && domain !== '';
  const hasMall = mall != null && mall !== '';
  if (hasDomain && hasMall) return { ok: false, error: 'invalid_input' };
  if (hasDomain) {
    if (typeof domain !== 'string') return { ok: false, error: 'invalid_domain' };
    const d = normalizeDomain(domain);
    if (!d) return { ok: false, error: 'invalid_domain' };
    // 사전의 몰 도메인이면 그 몰의 검색 도메인 전체를 쓴다(예: brand.naver.com → 스마트스토어 포함)
    const id = mallForDomain(d);
    if (id) return { ok: true, channel: { via: 'domain', domains: [...MALLS[id].domains], mall: id } };
    // 포털·블로그·SNS 같은 판매처가 아닌 곳이면 채널이 없는 것으로 본다(공식 홈페이지 찾기)
    if (NON_SELLER_DOMAINS.some((n) => hostMatches(d, n))) return { ok: true, channel: { via: 'none' } };
    return { ok: true, channel: { via: 'domain', domains: [d] } };
  }
  if (hasMall) {
    if (!isMallId(mall)) return { ok: false, error: 'invalid_mall' };
    return { ok: true, channel: { via: 'mall', domains: [...MALLS[mall].domains], mall } };
  }
  return { ok: true, channel: { via: 'none' } };
}

// 브랜드 비교용 정규화(앱 normalizeName 과 같은 방향: NFC·소문자·문자/숫자만)
export function normalizeBrand(brand: string): string {
  return brand.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

// 검색 범위. 채널이 있으면 그 사이트 안에서만, 없으면 사전의 몰을 빼고(공식 홈페이지 찾기).
// 브랜드가 그 몰 자체이면(이케아·무신사 스탠다드 등 — ownBrands 와 정확히 같을 때) 그 몰은 빼지 않는다.
export function searchScope(channel: Channel, brand: string | null): SearchScope {
  if (channel.via !== 'none') return { mode: 'allowed', domains: [...channel.domains] };
  const nb = brand ? normalizeBrand(brand) : '';
  const blocked: string[] = [];
  for (const mall of Object.values(MALLS)) {
    const isBrandsOwn = nb !== '' && mall.ownBrands.some((n) => normalizeBrand(n) === nb);
    if (!isBrandsOwn) blocked.push(...mall.domains);
  }
  return { mode: 'blocked', domains: blocked };
}

// 안전한 링크 형태인지: https 만, 기본 포트만, 호스트는 IP 가 아닌 도메인 이름, 아이디·비밀번호 없음.
// 맞으면 파서가 정리한 href 와 호스트, 아니면 null.
export function safeHttpsUrl(url: string): { href: string; host: string } | null {
  if (url.length > MAX_URL_LEN) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.port !== '' || u.username !== '' || u.password !== '') return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!HOST_RE.test(host)) return null; // IP 주소·유니코드 호스트 거부
  if (u.href.length > MAX_URL_LEN) return null;
  return { href: u.href, host };
}

// URL 이 안전한 https 주소이고 검색 범위 안이면 파서가 정리한 href 와 호스트를, 아니면 null.
// 앱에는 검사한 그 형태(href)를 넘긴다 — 원본 문자열의 탭·줄바꿈·역슬래시를 다른 파서가
// 다르게 읽어 검사한 호스트와 열리는 호스트가 달라지는 것을 막는다.
export function inScope(url: string, scope: SearchScope): { href: string; host: string } | null {
  const ok = safeHttpsUrl(url);
  if (!ok) return null;
  const matched = scope.domains.some((d) => hostMatches(ok.host, d));
  if (scope.mode === 'allowed' ? !matched : matched) return null;
  return ok;
}

// ---------------------------------------------------------------------------
// 링크 접속 확인(verify.ts)이 쓰는 판정 — 네트워크 없이 검증할 수 있게 여기 둔다.
// ---------------------------------------------------------------------------

// 사이트 기준 이름: www.·m. 같은 앞부분을 뗀 호스트. 리다이렉트는 이 이름(과 하위 도메인) 안에서만 허용.
export function siteBase(host: string): string {
  const stripped = host.replace(/^(?:www\d?|m|mobile)\./, '');
  return stripped.includes('.') ? stripped : host;
}

// 사전의 몰(대형 쇼핑몰) 호스트인지 — 봇 접속을 막아 403 을 주는 경우가 많아 판정을 달리한다.
export function isTrustedMallHost(host: string): boolean {
  return mallForDomain(host) !== null;
}

// 리다이렉트 한 단계: 다음 주소가 안전한 https 이고 같은 사이트 안이면 정리한 href, 아니면 null.
export function checkRedirect(location: string, current: string, base: string): string | null {
  let next: string;
  try {
    next = new URL(location, current).href; // 상대 경로 허용
  } catch {
    return null;
  }
  const ok = safeHttpsUrl(next);
  if (!ok || !hostMatches(ok.host, base)) return null;
  return ok.href;
}

// 최종 응답 코드 판정. 2xx 는 정상. 대형 몰은 봇 차단(401·403·429)도 사이트가 살아 있는 것으로 본다
// (인증서는 접속 단계에서 이미 확인됨). 그 밖(404·410·5xx 등)은 버린다.
export function statusVerdict(status: number, trustedMall: boolean): 'ok' | 'redirect' | 'reject' {
  if (status >= 200 && status < 300) return 'ok';
  if ([301, 302, 303, 307, 308].includes(status)) return 'redirect';
  if (trustedMall && (status === 401 || status === 403 || status === 429)) return 'ok';
  return 'reject';
}

type Block = { type?: unknown; content?: unknown };

export type Harvest = { candidates: Candidate[]; errorCodes: string[] };

// 응답 content 의 web_search_tool_result 블록에서 후보를 모은다(범위 밖·중복은 버림).
// 오류 결과(content 가 목록이 아니라 객체)는 error_code 만 모은다.
export function harvestCandidates(content: unknown, scope: SearchScope, into: Harvest): Harvest {
  if (!Array.isArray(content)) return into;
  for (const block of content as Block[]) {
    if (block?.type !== 'web_search_tool_result') continue;
    const c = block.content;
    if (Array.isArray(c)) {
      for (const r of c as { type?: unknown; url?: unknown; title?: unknown }[]) {
        if (into.candidates.length >= MAX_CANDIDATES) break;
        if (r?.type !== 'web_search_result' || typeof r.url !== 'string') continue;
        const ok = inScope(r.url, scope);
        if (!ok) continue;
        if (into.candidates.some((x) => x.url === ok.href)) continue;
        into.candidates.push({ url: ok.href, title: typeof r.title === 'string' ? r.title : '', domain: ok.host });
      }
    } else if (c && typeof c === 'object') {
      const code = (c as { error_code?: unknown }).error_code;
      into.errorCodes.push(typeof code === 'string' ? code : 'unknown');
    }
  }
  return into;
}

// 실패로 기록할 도구 오류(max_uses_exceeded 는 허용 횟수를 다 쓴 것이라 "결과 없음"으로 본다)
export function hasRealToolError(errorCodes: readonly string[]): boolean {
  return errorCodes.some((c) => c !== 'max_uses_exceeded');
}

// 2차 호출(고르기)의 구조화 출력 → 링크. 번호는 1부터. 범위 밖·형식 오류는 null.
// 채널이 없을 때는 공식 판매처일 때만 채운다(불변식 4).
export function pickToLink(parsed: unknown, candidates: Candidate[], channel: Channel): Link | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const { index, isOfficial } = parsed as { index?: unknown; isOfficial?: unknown };
  if (typeof index !== 'number' || !Number.isInteger(index)) return null;
  if (index < 1 || index > candidates.length) return null;
  const official = isOfficial === true;
  if (channel.via === 'none' && !official) return null;
  const c = candidates[index - 1];
  return { url: c.url, domain: c.domain, kind: official ? 'official' : 'site' };
}

// Google Web Risk Lookup API(uris.search) 응답 판정. 빈 응답 {} = 어느 목록에도 없음.
// threat.threatTypes 가 하나라도 있으면 악성(목록에 오른 주소). 형식을 모르면 판정 불가.
export function webRiskVerdict(body: unknown): 'safe' | 'unsafe' | 'unknown' {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'unknown';
  const threat = (body as { threat?: unknown }).threat;
  if (threat == null) return 'safe';
  if (typeof threat !== 'object') return 'unknown';
  const types = (threat as { threatTypes?: unknown }).threatTypes;
  if (Array.isArray(types) && types.length > 0) return 'unsafe';
  return 'safe';
}

// 상품 페이지를 못 찾았을 때 넣는 그 몰 검색 결과 링크(사람 결정 2026-11-09 — "링크가 들어가는 게 더 중요").
// 채널이 사전의 몰이고 그 몰의 검색 주소 형식이 확인돼 있을 때만. 도메인은 사전에 고정하고 검색어만
// URL 인코딩해 넣는다(사용자 입력이 호스트·경로를 바꿀 수 없다). 검색어 = 브랜드 + 상품명(상품명이 이미
// 브랜드로 시작하면 브랜드를 다시 붙이지 않는다).
export function mallSearchLink(channel: Channel, productName: string, brand: string | null): Link | null {
  if (channel.via === 'none' || !channel.mall) return null;
  const mall = MALLS[channel.mall] as Mall;
  if (!mall.search) return null;
  const name = productName.trim();
  if (!name) return null;
  const b = brand?.trim() ?? '';
  const query = b && !normalizeBrand(name).startsWith(normalizeBrand(b)) ? `${b} ${name}` : name;
  let u: URL;
  try {
    u = new URL(mall.search.base);
  } catch {
    return null;
  }
  u.searchParams.set(mall.search.param, query);
  const ok = safeHttpsUrl(u.href);
  if (!ok) return null;
  return { url: ok.href, domain: ok.host, kind: 'search', mall: channel.mall };
}

// ---------------------------------------------------------------------------
// 카페24 사이트 안 검색(사람 결정 2026-11-09) — 캡처에 주소가 보이는 쇼핑몰(몰 사전에 없는 곳)은
// 웹 검색 색인에 상품 페이지가 없는 경우가 많아, 그 사이트의 카페24 공통 검색 페이지를 읽어 상품 링크를 모은다.
// 링크 주소는 그 사이트가 검색 결과로 직접 준 실제 상품 주소다(모델이 쓰지 않음).
// ---------------------------------------------------------------------------

// 카페24 공통 사이트 검색 페이지(검색어 없음). 접속 전 Web Risk 대조에 쓴다(검색어를 Google 로 보내지 않음).
export function cafe24SearchPage(domain: string): string | null {
  return safeHttpsUrl(`https://${domain}/product/search.html`)?.href ?? null;
}

// 카페24 공통 사이트 검색 주소. 도메인은 정리된 호스트명, 검색어만 인코딩한다.
export function cafe24SearchUrl(domain: string, query: string): string | null {
  const q = query.trim();
  const page = q ? cafe24SearchPage(domain) : null;
  if (!page) return null;
  const u = new URL(page);
  u.searchParams.set('keyword', q);
  return safeHttpsUrl(u.href)?.href ?? null;
}

// 사이트 검색어: 상품명 그대로, 그다음 앞 두 단어(수량·용량·옵션 표기가 붙어 검색이 안 될 때 — 예: '제로 룸데오도란트 2EA').
export function siteQueries(productName: string): string[] {
  const name = productName.trim().replace(/\s+/g, ' ');
  if (!name) return [];
  const words = name.split(' ');
  return words.length >= 3 ? [name, words.slice(0, 2).join(' ')] : [name];
}

// 카페24 페이지인지(카페24 호스팅 자원 주소가 들어 있음)
export function looksLikeCafe24(html: string): boolean {
  return /echosting\.cafe24\.com/i.test(html);
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s: string): string {
  return s.replace(
    /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(amp|lt|gt|quot|apos|nbsp));/gi,
    (all, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? all;
      const cp = dec ? Number(dec) : parseInt(hex ?? '', 16);
      // 유효한 유니코드 문자만(NUL·서로게이트·범위 밖은 그대로 둔다)
      return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : all;
    },
  );
}

// 아래 정규식은 모두 반복 길이에 상한을 둔다 — 상대 사이트의 HTML 은 믿을 수 없는 입력이라,
// 닫는 태그가 없는 큰 페이지 등으로 정규식이 오래 도는 것(CPU 고갈)을 막는다.
const MAX_TEXT_SCAN = 3_000;
function stripTags(s: string): string {
  return decodeEntities(s.slice(0, MAX_TEXT_SCAN).replace(/<[^<>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// 검색 결과 영역(카페24 공통 모듈 xans-search-result ~ 페이지 번호 xans-search-paging). 머리말·추천 상품 등
// 검색 결과가 아닌 상품 링크는 읽지 않는다. 영역이 없으면 null(검색 결과 없음으로 본다).
const MAX_AREA_CHARS = 300_000;
export function cafe24ResultArea(html: string): string | null {
  // class 속성 안에서만 찾는다(머리말 CSS·JS 에 같은 이름이 있어도 영역이 앞당겨지지 않게)
  const start = html.search(/class\s*=\s*"[^"<>]{0,200}\bxans-search-result(?![\w-])/);
  if (start < 0) return null;
  const rest = html.slice(start, start + MAX_AREA_CHARS);
  const end = rest.search(/xans-search-paging(?![\w-])/);
  return end < 0 ? rest : rest.slice(0, end);
}

// <a href="…">내용</a> — 태그 안 1,000자·주소 2,048자·내용 3,000자까지, 내용에 다른 <a> 가 끼면 그 앞에서 끊는다.
const ANCHOR_RE = /<a\b[^<>]{0,1000}?\shref\s*=\s*"([^"<>]{1,2048})"[^<>]{0,1000}>((?:[^<]|<(?!\/?a\b)){0,3000}?)<\/a>/gi;
// 링크 바로 앞이 상품 이름 칸(class 에 name 이 든 요소)인지 — 카페24 스킨은 이름 링크를 <div|strong class="name"> 안에 둔다.
const NAME_AREA_RE = /class\s*=\s*"[^"<>]{0,100}\bname\b[^"<>]{0,100}"[^<>]{0,300}>\s*$/i;
const NAME_AREA_LOOKBACK = 400;
// 사진 링크의 대체 글자(이름 링크가 없을 때 이름으로)
const IMG_ALT_RE = /<img\b[^<>]{0,2000}?\salt\s*=\s*"([^"<>]{1,300})"/i;
const MAX_TITLE = 120;

// 카페24 상품 상세 주소: /product/detail.html?product_no=N 또는 /product/{이름}/{N}/… (검색 노출용 주소)
function cafe24ProductNo(u: URL): string | null {
  if (u.pathname === '/product/detail.html') {
    const no = u.searchParams.get('product_no') ?? '';
    return /^\d+$/.test(no) ? no : null;
  }
  const m = u.pathname.match(/^\/product\/[^/]+\/(\d+)(?:\/|$)/);
  return m ? m[1] : null;
}

// 카페24 검색 결과 HTML 의 검색 결과 영역에서 상품 후보(주소·이름)를 모은다.
//   - 주소는 그 사이트(base 와 하위 도메인) 안의 안전한 https 링크에서 상품 번호만 읽어
//     정규 상세 주소(/product/detail.html?product_no=N)로 다시 만든다(링크에 붙은 다른 경로·쿼리는 버림).
//   - 같은 상품(번호)의 사진 링크·이름 링크는 하나로 묶고, 이름은 이름 칸 링크 글자 > 사진 대체 글자 > 그 밖 링크 글자 순.
export function extractCafe24Products(html: string, pageUrl: string, base: string): Candidate[] {
  const area = cafe24ResultArea(html);
  if (!area) return [];
  const byNo = new Map<string, Candidate & { rank: number }>();
  for (const m of area.matchAll(ANCHOR_RE)) {
    let abs: URL;
    try {
      abs = new URL(decodeEntities(m[1]), pageUrl);
    } catch {
      continue;
    }
    const no = cafe24ProductNo(abs);
    if (!no) continue;
    const linked = safeHttpsUrl(abs.href);
    if (!linked || !hostMatches(linked.host, base)) continue;
    const ok = safeHttpsUrl(`https://${linked.host}/product/detail.html?product_no=${no}`);
    if (!ok) continue;
    const at = m.index ?? 0;
    const inName = NAME_AREA_RE.test(area.slice(Math.max(0, at - NAME_AREA_LOOKBACK), at));
    // 스킨에 따라 이름 앞에 붙는 '상품명 :' 표기는 뗀다
    const text = stripTags(m[2]).replace(/^(?:상품명|product\s*name)\s*:\s*/i, '');
    const alt = text ? '' : stripTags(m[2].match(IMG_ALT_RE)?.[1] ?? '');
    const title = (text || alt).slice(0, MAX_TITLE);
    const rank = text ? (inName ? 3 : 1) : alt ? 2 : 0;
    const prev = byNo.get(no);
    if (!prev) {
      if (byNo.size >= MAX_CANDIDATES) continue;
      byNo.set(no, { url: ok.href, title, domain: ok.host, rank });
    } else if (rank > prev.rank || (rank === prev.rank && title.length > prev.title.length)) {
      byNo.set(no, { ...prev, title, rank });
    }
  }
  return [...byNo.values()].map(({ url, title, domain }) => ({ url, title, domain }));
}

// 고르기 결과 요약(로그용 — 번호와 공식 여부만): "3/official" · "3/site" · "null" · "invalid"
export function pickSummary(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') return 'invalid';
  const { index, isOfficial } = parsed as { index?: unknown; isOfficial?: unknown };
  if (index === null) return 'null';
  if (typeof index !== 'number' || !Number.isInteger(index)) return 'invalid';
  return `${index}/${isOfficial === true ? 'official' : 'site'}`;
}

// 시험용 상세 로그(PURCHASE_DEBUG_LOG=1 일 때만): 후보의 번호·도메인·주소 경로·제목 앞부분.
// 제목에 상품명이 들어가므로 평소엔 남기지 않는다.
export function debugCandidates(candidates: Candidate[]): { i: number; d: string; p: string; t: string }[] {
  return candidates.map((c, idx) => {
    let p = '';
    try {
      const u = new URL(c.url);
      p = (u.pathname + u.search).slice(0, 100);
    } catch {
      /* 형식 오류는 경로 없이 */
    }
    return { i: idx + 1, d: c.domain, p, t: c.title.slice(0, 80) };
  });
}

// Google API 오류 응답에서 원인 종류만 뽑는다(로그용 — 메시지 본문은 남기지 않는다).
// 형식: { error: { status: "PERMISSION_DENIED", details: [{ reason: "BILLING_DISABLED", ... }] } }
// 반환 예: "PERMISSION_DENIED/BILLING_DISABLED". 형식을 모르면 "unknown".
export function googleErrorKind(body: unknown): string {
  const err = (body as { error?: unknown } | null)?.error;
  if (!err || typeof err !== 'object') return 'unknown';
  const status = (err as { status?: unknown }).status;
  const details = (err as { details?: unknown }).details;
  const reasons = Array.isArray(details)
    ? details
        .map((d) => (d && typeof d === 'object' ? (d as { reason?: unknown }).reason : undefined))
        .filter((r): r is string => typeof r === 'string' && /^[A-Z0-9_]{1,64}$/.test(r))
    : [];
  const s = typeof status === 'string' && /^[A-Z_]{1,64}$/.test(status) ? status : 'unknown';
  return reasons.length ? `${s}/${reasons.join(',')}` : s;
}

// 한국 날짜(YYYY-MM-DD) — 검색 프롬프트에 넣는다.
export function kstDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now);
}
