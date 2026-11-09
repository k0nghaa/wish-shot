// 캡처에 보인 쇼핑몰의 사이트 안 검색 페이지를 읽는다(카페24). 본문을 읽는 유일한 접속이라 제한을 둔다.
//   - 접속 전에 Google Web Risk 대조(호출부) — 악성일 수 있는 사이트에 먼저 접속하지 않는다.
//   - https·기본 포트·도메인 이름만(safeHttpsUrl — IP 주소·점 없는 이름 거절). 인증서 검증(Deno fetch 기본)이 실패하면
//     요청을 보내지 않는다 — 도메인이 내부망 주소를 가리켜도 TCP 연결까지는 될 수 있으나, 그 도메인의 공인 인증서가
//     없는 내부 서버와는 TLS 가 성립하지 않아 HTTP 요청이 전달되지 않는다(내부망 접근(SSRF) 완화).
//   - 리다이렉트는 같은 사이트 안에서만, 최대 MAX_HOPS 단계.
//   - 2xx·HTML 만, 본문은 maxBytes 까지만 읽는다. 문자 인코딩은 응답 헤더 → <meta> 순으로 읽고, 모르면 UTF-8.

import { checkRedirect, safeHttpsUrl, siteBase } from './logic.ts';

const MAX_HOPS = 3;
const USER_AGENT = 'Mozilla/5.0 (compatible; WishShot-LinkCheck/1.0)';

export type SitePage = { ok: true; html: string; finalUrl: string } | { ok: false; reason: string };

export async function fetchSitePage(url: string, timeoutMs: number, maxBytes: number): Promise<SitePage> {
  const first = safeHttpsUrl(url);
  if (!first) return { ok: false, reason: 'not_https' };
  const base = siteBase(first.host);
  const signal = AbortSignal.timeout(timeoutMs);
  let current = first.href;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let res: Response;
    try {
      res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      });
    } catch (e) {
      const timedOut = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
      return { ok: false, reason: timedOut ? 'timeout' : 'tls_or_network' };
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      await res.body?.cancel().catch(() => {});
      if (hop === MAX_HOPS) return { ok: false, reason: 'too_many_redirects' };
      const location = res.headers.get('location');
      const next = location ? checkRedirect(location, current, base) : null;
      if (!next) return { ok: false, reason: 'bad_redirect' };
      current = next;
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: `status_${res.status}` };
    }
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(type)) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: 'not_html' };
    }
    try {
      return { ok: true, html: await readLimited(res, maxBytes, type), finalUrl: current };
    } catch (e) {
      const timedOut = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
      return { ok: false, reason: timedOut ? 'timeout' : 'read_error' };
    }
  }
  return { ok: false, reason: 'too_many_redirects' };
}

// 본문을 maxBytes 까지만 읽고 나머지는 버린다(큰 페이지로 함수 메모리를 쓰지 않게).
async function readLimited(res: Response, maxBytes: number, contentType: string): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const take = value.byteLength > maxBytes - total ? value.subarray(0, maxBytes - total) : value;
    chunks.push(take);
    total += take.byteLength;
  }
  await reader.cancel().catch(() => {});
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return decoderFor(contentType, buf).decode(buf);
}

// 문자 인코딩: Content-Type 의 charset → 앞부분 <meta charset> → UTF-8. 모르는 이름이면 UTF-8.
function decoderFor(contentType: string, buf: Uint8Array): TextDecoder {
  const head = new TextDecoder('windows-1252').decode(buf.subarray(0, 4096));
  const label =
    contentType.match(/charset\s*=\s*"?([\w-]{1,40})/i)?.[1] ??
    head.match(/<meta\b[^<>]{0,300}?charset\s*=\s*["']?([\w-]{1,40})/i)?.[1];
  if (label) {
    try {
      return new TextDecoder(label.toLowerCase(), { fatal: false });
    } catch {
      // 모르는 인코딩 이름
    }
  }
  return new TextDecoder('utf-8', { fatal: false });
}
