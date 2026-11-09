// 고른 링크가 실제로 열리는 안전한 https 페이지인지 함수가 직접 접속해 확인한다.
//   - 인증서: Deno fetch 는 인증서를 검증한다 — 만료·자체 서명·이름 불일치면 접속 자체가 실패한다.
//   - 리다이렉트: 자동으로 따라가지 않고 한 단계씩 본다. 모두 https·기본 포트·같은 사이트 안이어야 한다
//     (다른 사이트로 넘기는 링크는 버린다). 최대 MAX_HOPS 단계.
//   - 응답 코드: 2xx 만 정상. 대형 몰(사전)은 봇 차단 응답(401·403·429)도 사이트가 살아 있는 것으로 본다.
//   - 본문은 읽지 않는다(바로 닫는다).
// 반환하는 링크는 검사한 원래 주소(검색 결과에 나온 그대로)다 — 리다이렉트 목적지로 바꾸지 않는다.

import { checkRedirect, isTrustedMallHost, safeHttpsUrl, siteBase, statusVerdict } from './logic.ts';

const MAX_HOPS = 3;
// 봇 관례 형식의 사용자 에이전트(브라우저로 위장하지 않는다)
const USER_AGENT = 'Mozilla/5.0 (compatible; WishShot-LinkCheck/1.0)';

// 로그·실패 기록용 판정 결과(enum — 주소는 남기지 않는다)
export type VerifyResult =
  | { ok: true; status: number; hops: number }
  | { ok: false; reason: 'not_https' | 'bad_redirect' | 'too_many_redirects' | `status_${number}` | 'timeout' | 'tls_or_network' };

export async function verifyLink(url: string, timeoutMs: number): Promise<VerifyResult> {
  const first = safeHttpsUrl(url);
  if (!first) return { ok: false, reason: 'not_https' };
  const base = siteBase(first.host);
  const trustedMall = isTrustedMallHost(first.host);
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
    await res.body?.cancel().catch(() => {});
    const verdict = statusVerdict(res.status, trustedMall);
    if (verdict === 'ok') return { ok: true, status: res.status, hops: hop };
    if (verdict === 'reject') return { ok: false, reason: `status_${res.status}` };
    // 리다이렉트: 다음 주소가 안전하고 같은 사이트 안일 때만 따라간다
    if (hop === MAX_HOPS) return { ok: false, reason: 'too_many_redirects' };
    const location = res.headers.get('location');
    const next = location ? checkRedirect(location, current, base) : null;
    if (!next) return { ok: false, reason: 'bad_redirect' };
    current = next;
  }
  return { ok: false, reason: 'too_many_redirects' };
}
