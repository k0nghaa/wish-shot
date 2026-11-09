// find-purchase-links 순수 로직 단위 검증(네트워크·키 없음).
// 실행: deno test supabase/tests/find_purchase_links_test.ts
import {
  type Channel,
  type Harvest,
  checkRedirect,
  harvestCandidates,
  hasRealToolError,
  inScope,
  isTrustedMallHost,
  kstDate,
  normalizeDomain,
  pickToLink,
  resolveChannel,
  safeHttpsUrl,
  searchScope,
  siteBase,
  statusVerdict,
  googleErrorKind,
  webRiskVerdict,
} from '../functions/find-purchase-links/logic.ts';
import { buildSearchTool } from '../functions/find-purchase-links/prompt.ts';
import { checkWebRisk } from '../functions/find-purchase-links/safety.ts';
import { verifyLink } from '../functions/find-purchase-links/verify.ts';

function eq(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}

Deno.test('normalizeDomain: 접두어·스킴·경로 정리와 형식 검사', () => {
  eq(normalizeDomain('www.musinsa.com'), 'musinsa.com');
  eq(normalizeDomain('m.smartstore.naver.com'), 'smartstore.naver.com');
  eq(normalizeDomain(' NIKE.com. '), 'nike.com');
  eq(normalizeDomain('https://m.musinsa.com/products/123?x=1'), 'musinsa.com');
  eq(normalizeDomain('brand.co.kr:443'), 'brand.co.kr');
  eq(normalizeDomain('m.com'), 'm.com', '떼면 점이 없어지는 경우는 그대로');
  eq(normalizeDomain('ohou.se'), 'ohou.se');
  eq(normalizeDomain('localhost'), null, '점 없는 이름');
  eq(normalizeDomain('аmazon.com'), null, '유니코드(키릴 а) 거부');
  eq(normalizeDomain('exa mple.com'), null);
  eq(normalizeDomain('-bad.com'), null);
  eq(normalizeDomain('1.2.3.4'), null, 'IP 거부(최상위 라벨은 영문 시작)');
  eq(normalizeDomain(''), null);
});

Deno.test('normalizeDomain: 공용 접미사만 남는 이름·예약 이름 거부', () => {
  eq(normalizeDomain('co.kr'), null, '주소창이 잘려 접미사만 읽힌 경우');
  eq(normalizeDomain('www.co.kr'), null);
  eq(normalizeDomain('m.co.kr'), null);
  eq(normalizeDomain('go.kr'), null);
  eq(normalizeDomain('co.uk'), null);
  eq(normalizeDomain('foo.local'), null);
  eq(normalizeDomain('foo.internal'), null);
  eq(normalizeDomain('foo.localhost'), null);
  eq(normalizeDomain('shop.co.kr'), 'shop.co.kr', '접미사 아래 이름은 통과');
});

Deno.test('resolveChannel: 도메인·몰·없음', () => {
  eq(resolveChannel('www.nike.com', undefined), { ok: true, channel: { via: 'domain', domains: ['nike.com'] } });
  eq(
    resolveChannel('brand.naver.com', null),
    { ok: true, channel: { via: 'domain', domains: ['smartstore.naver.com', 'brand.naver.com'] } },
    '사전의 몰 도메인이면 그 몰의 검색 도메인 전체',
  );
  eq(
    resolveChannel('m.smartstore.naver.com', null),
    { ok: true, channel: { via: 'domain', domains: ['smartstore.naver.com', 'brand.naver.com'] } },
    '몰 판별이 비판매 플랫폼(naver.com)보다 먼저',
  );
  eq(resolveChannel(undefined, 'coupang'), { ok: true, channel: { via: 'mall', domains: ['coupang.com'] } });
  eq(resolveChannel(undefined, 'zigzag'), { ok: true, channel: { via: 'mall', domains: ['zigzag.kr'] } });
  eq(resolveChannel('m.a-bly.com', undefined), { ok: true, channel: { via: 'domain', domains: ['a-bly.com'] } });
  eq(resolveChannel(undefined, undefined), { ok: true, channel: { via: 'none' } });
  eq(resolveChannel('', ''), { ok: true, channel: { via: 'none' } }, '빈 문자열은 없음');
  eq(resolveChannel('nike.com', 'coupang'), { ok: false, error: 'invalid_input' }, '둘 다 오면 거절');
  eq(resolveChannel('not a domain', undefined), { ok: false, error: 'invalid_domain' });
  eq(resolveChannel('co.kr', undefined), { ok: false, error: 'invalid_domain' });
  eq(resolveChannel(123, undefined), { ok: false, error: 'invalid_domain' });
  eq(resolveChannel(undefined, 'amazon'), { ok: false, error: 'invalid_mall' });
  eq(resolveChannel(undefined, 'toString'), { ok: false, error: 'invalid_mall' }, '프로토타입 이름 거부');
});

Deno.test('resolveChannel: 포털·블로그·SNS 주소는 채널 없음', () => {
  for (const d of ['m.naver.com', 'm.blog.naver.com', 'shopping.naver.com', 'www.instagram.com', 'youtube.com', 'x.com']) {
    eq(resolveChannel(d, undefined), { ok: true, channel: { via: 'none' } }, d);
  }
});

Deno.test('searchScope: 채널 있으면 그 사이트만, 없으면 몰 제외(브랜드 자체 몰만 남김)', () => {
  eq(searchScope({ via: 'mall', domains: ['musinsa.com'] }, '나이키'), { mode: 'allowed', domains: ['musinsa.com'] });

  const open = searchScope({ via: 'none' }, '나이키');
  if (open.mode !== 'blocked') throw new Error('blocked 여야 한다');
  for (const d of ['coupang.com', 'musinsa.com', 'ikea.com', 'smartstore.naver.com', 'kurly.com', 'zigzag.kr', 'a-bly.com']) {
    if (!open.domains.includes(d)) throw new Error(`${d} 는 막혀야 한다`);
  }

  const keep = (brand: string, domain: string) => {
    if (searchScope({ via: 'none' }, brand).domains.includes(domain)) throw new Error(`${brand}: ${domain} 는 남겨야 한다`);
  };
  const block = (brand: string, domain: string) => {
    if (!searchScope({ via: 'none' }, brand).domains.includes(domain)) throw new Error(`${brand}: ${domain} 는 막아야 한다`);
  };
  keep('IKEA', 'ikea.com');
  keep('이케아', 'ikea.com');
  keep('무신사 스탠다드', 'musinsa.com');
  block('IKEA', 'coupang.com');
  block('컬리수', 'kurly.com'); // 앞부분만 같은 다른 브랜드
  block('SSGOOD', 'ssg.com');
  block('Glossgen', 'ssg.com');
  block('네이버후드', 'smartstore.naver.com');
  if (!searchScope({ via: 'none' }, null).domains.includes('ikea.com')) throw new Error('브랜드가 없으면 전부 막는다');
});

Deno.test('buildSearchTool: allowed/blocked 중 하나만', () => {
  const a = buildSearchTool({ mode: 'allowed', domains: ['musinsa.com'] }, 2) as Record<string, unknown>;
  eq(a.allowed_domains, ['musinsa.com']);
  eq('blocked_domains' in a, false);
  eq(a.type, 'web_search_20250305');
  eq(a.max_uses, 2);
  const b = buildSearchTool({ mode: 'blocked', domains: ['coupang.com'] }, 3) as Record<string, unknown>;
  eq(b.blocked_domains, ['coupang.com']);
  eq('allowed_domains' in b, false);
});

Deno.test('inScope: 범위·스킴 검사, 정리된 href 반환', () => {
  const allowed = { mode: 'allowed', domains: ['musinsa.com'] } as const;
  eq(inScope('https://www.musinsa.com/products/1', allowed), { href: 'https://www.musinsa.com/products/1', host: 'www.musinsa.com' });
  eq(inScope('https://musinsa.com.evil.com/x', allowed), null, '접미어 위장 거부');
  eq(inScope('https://notmusinsa.com/x', allowed), null);
  eq(inScope('javascript:alert(1)', allowed), null);
  eq(inScope('not a url', allowed), null);
  eq(
    inScope('https://www.musinsa.com/products/1\n', allowed),
    { href: 'https://www.musinsa.com/products/1', host: 'www.musinsa.com' },
    '줄바꿈 등은 파서가 정리한 형태로',
  );
  eq(inScope('http://www.musinsa.com/products/1', allowed), null, 'http 는 받지 않는다');
  const blocked = { mode: 'blocked', domains: ['coupang.com'] } as const;
  eq(inScope('https://www.coupang.com/vp/products/1', blocked), null);
  eq(inScope('https://www.coupang.com./vp/1', blocked), null, '끝에 점이 붙어도 막는다');
  eq(inScope('https://www.nike.com/kr/t/1', blocked), { href: 'https://www.nike.com/kr/t/1', host: 'www.nike.com' });
});

Deno.test('harvestCandidates: 결과 블록에서만, 범위 밖·중복 제외, 오류 코드 수집', () => {
  const scope = { mode: 'allowed', domains: ['musinsa.com'] } as const;
  const content = [
    { type: 'text', text: '검색합니다 https://www.musinsa.com/products/999' }, // 모델이 쓴 URL — 무시
    { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 's1',
      content: [
        { type: 'web_search_result', url: 'https://www.musinsa.com/products/1', title: 'A 상품', page_age: null },
        { type: 'web_search_result', url: 'https://www.musinsa.com/products/1', title: 'A 중복' },
        { type: 'web_search_result', url: 'https://blog.example.com/a', title: '블로그' },
        { type: 'web_search_result', url: 'https://www.musinsa.com/products/2' },
      ],
    },
    { type: 'web_search_tool_result', tool_use_id: 's2', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
  ];
  const h: Harvest = { candidates: [], errorCodes: [] };
  harvestCandidates(content, scope, h);
  eq(h.candidates, [
    { url: 'https://www.musinsa.com/products/1', title: 'A 상품', domain: 'www.musinsa.com' },
    { url: 'https://www.musinsa.com/products/2', title: '', domain: 'www.musinsa.com' },
  ]);
  eq(h.errorCodes, ['max_uses_exceeded']);

  // 이어 보내기 응답에서 같은 URL 이 다시 와도 중복 없이 누적
  harvestCandidates(
    [{ type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://www.musinsa.com/products/2', title: 'B' }] }],
    scope,
    h,
  );
  eq(h.candidates.length, 2);
  eq(harvestCandidates(undefined, scope, { candidates: [], errorCodes: [] }), { candidates: [], errorCodes: [] });
});

Deno.test('hasRealToolError: 허용 횟수 소진은 실패로 보지 않음', () => {
  eq(hasRealToolError([]), false);
  eq(hasRealToolError(['max_uses_exceeded']), false);
  eq(hasRealToolError(['max_uses_exceeded', 'unavailable']), true);
  eq(hasRealToolError(['too_many_requests']), true);
});

Deno.test('pickToLink: 번호 범위·형식·채널 조건', () => {
  const cands = [
    { url: 'https://www.nike.com/kr/t/1', title: '에어맥스', domain: 'www.nike.com' },
    { url: 'https://www.abc-mart.co.kr/p/2', title: '에어맥스', domain: 'www.abc-mart.co.kr' },
  ];
  const none: Channel = { via: 'none' };
  const site: Channel = { via: 'domain', domains: ['abc-mart.co.kr'] };
  eq(pickToLink({ index: 1, isOfficial: true }, cands, none), { url: cands[0].url, domain: 'www.nike.com', kind: 'official' });
  eq(pickToLink({ index: 2, isOfficial: false }, cands, none), null, '채널 없으면 공식만');
  eq(pickToLink({ index: 2, isOfficial: false }, cands, site), { url: cands[1].url, domain: 'www.abc-mart.co.kr', kind: 'site' });
  eq(pickToLink({ index: null, isOfficial: false }, cands, site), null);
  eq(pickToLink({ index: 0, isOfficial: true }, cands, none), null, '번호는 1부터');
  eq(pickToLink({ index: 3, isOfficial: true }, cands, none), null, '범위 밖');
  eq(pickToLink({ index: 1.5, isOfficial: true }, cands, none), null);
  eq(pickToLink({ index: '1', isOfficial: true }, cands, none), null);
  eq(pickToLink(null, cands, none), null);
  eq(pickToLink({ index: 1, isOfficial: 'true' }, cands, none), null, 'isOfficial 은 true 만 공식');
});

Deno.test('safeHttpsUrl: https·기본 포트·도메인 이름만', () => {
  eq(safeHttpsUrl('https://www.nike.com/kr/t/1'), { href: 'https://www.nike.com/kr/t/1', host: 'www.nike.com' });
  eq(safeHttpsUrl('http://www.nike.com/kr/t/1'), null, 'http');
  eq(safeHttpsUrl('https://www.nike.com:8443/x'), null, '기본 포트가 아님');
  eq(safeHttpsUrl('https://www.nike.com:443/x'), { href: 'https://www.nike.com/x', host: 'www.nike.com' }, '443 은 기본 포트');
  eq(safeHttpsUrl('https://1.2.3.4/x'), null, 'IP 주소');
  eq(safeHttpsUrl('https://[::1]/x'), null, 'IPv6 주소');
  eq(safeHttpsUrl('https://user:pw@www.nike.com/x'), null, '아이디·비밀번호 포함');
  eq(safeHttpsUrl('https://xn--80ak6aa92e.com/'), { href: 'https://xn--80ak6aa92e.com/', host: 'xn--80ak6aa92e.com' }, '퓨니코드 도메인은 형식상 통과');
});

Deno.test('링크 접속 확인 판정: 리다이렉트·응답 코드', () => {
  eq(siteBase('www.nike.com'), 'nike.com');
  eq(siteBase('m.smartstore.naver.com'), 'smartstore.naver.com');
  eq(siteBase('nike.com'), 'nike.com');

  const cur = 'https://www.nike.com/kr/t/1';
  eq(checkRedirect('/kr/t/1-new', cur, 'nike.com'), 'https://www.nike.com/kr/t/1-new', '상대 경로');
  eq(checkRedirect('https://nike.com/kr/x', cur, 'nike.com'), 'https://nike.com/kr/x', '같은 사이트');
  eq(checkRedirect('https://evil.com/phish', cur, 'nike.com'), null, '다른 사이트로 넘김');
  eq(checkRedirect('https://nike.com.evil.com/x', cur, 'nike.com'), null, '접미어 위장');
  eq(checkRedirect('http://www.nike.com/kr/x', cur, 'nike.com'), null, 'http 로 내림');
  eq(checkRedirect('javascript:alert(1)', cur, 'nike.com'), null);

  eq(statusVerdict(200, false), 'ok');
  eq(statusVerdict(301, false), 'redirect');
  eq(statusVerdict(404, false), 'reject');
  eq(statusVerdict(410, true), 'reject');
  eq(statusVerdict(500, true), 'reject');
  eq(statusVerdict(403, false), 'reject', '일반 사이트의 403 은 확인 실패');
  eq(statusVerdict(403, true), 'ok', '대형 몰의 봇 차단 403 은 사이트가 살아 있는 것으로');

  eq(isTrustedMallHost('www.coupang.com'), true);
  eq(isTrustedMallHost('smartstore.naver.com'), true);
  eq(isTrustedMallHost('blog.naver.com'), false);
  eq(isTrustedMallHost('www.nike.com'), false);
});

Deno.test('verifyLink: https 가 아니면 접속하지 않고 거절', async () => {
  eq(await verifyLink('http://www.nike.com/', 1000), { ok: false, reason: 'not_https' });
  eq(await verifyLink('https://1.2.3.4/', 1000), { ok: false, reason: 'not_https' });
});

Deno.test('webRiskVerdict: 빈 응답은 안전, 목록에 오르면 악성, 모르는 형식은 판정 불가', () => {
  eq(webRiskVerdict({}), 'safe');
  eq(webRiskVerdict({ threat: { threatTypes: ['SOCIAL_ENGINEERING'], expireTime: '2026-11-10T00:00:00Z' } }), 'unsafe');
  eq(webRiskVerdict({ threat: { threatTypes: [] } }), 'safe');
  eq(webRiskVerdict(null), 'unknown');
  eq(webRiskVerdict([]), 'unknown');
  eq(webRiskVerdict({ threat: 'x' }), 'unknown');
});

Deno.test('googleErrorKind: 원인 종류만 뽑음(메시지 본문 제외)', () => {
  eq(
    googleErrorKind({
      error: {
        code: 403,
        message: 'This API method requires billing to be enabled. project 123',
        status: 'PERMISSION_DENIED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'BILLING_DISABLED', domain: 'googleapis.com' }],
      },
    }),
    'PERMISSION_DENIED/BILLING_DISABLED',
  );
  eq(googleErrorKind({ error: { status: 'PERMISSION_DENIED' } }), 'PERMISSION_DENIED');
  eq(googleErrorKind({ error: { status: 'bad value; drop table' } }), 'unknown', '형식 밖 값은 남기지 않음');
  eq(googleErrorKind(null), 'unknown');
  eq(googleErrorKind({}), 'unknown');
});

Deno.test('checkWebRisk: 키가 없으면 조회하지 않고 no_key(호출부가 링크를 비움)', async () => {
  eq(await checkWebRisk('https://www.nike.com/', undefined, 1000), 'no_key');
  eq(await checkWebRisk('https://www.nike.com/', '', 1000), 'no_key');
});

Deno.test('kstDate: 한국 날짜', () => {
  eq(kstDate(new Date('2026-11-09T14:59:59Z')), '2026-11-09');
  eq(kstDate(new Date('2026-11-09T15:00:00Z')), '2026-11-10', 'UTC 15시 = 한국 0시');
});
