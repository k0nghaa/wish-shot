// 고른 링크가 알려진 악성 사이트(악성코드·피싱/사칭·원치 않는 소프트웨어)인지 Google Web Risk 로 대조한다.
//   - Lookup API: GET https://webrisk.googleapis.com/v1/uris:search?threatTypes=…&uri=…
//     빈 응답 {} = 어느 목록에도 없음, { threat: { threatTypes: [...] } } = 목록에 오름.
//   - 키는 함수 시크릿 WEB_RISK_API_KEY 에만 두고, 주소(URL)가 아니라 x-goog-api-key 헤더로 보낸다
//     (Google 권장 — 주소에 키를 넣으면 노출될 수 있다).
//   - fail-closed: 키가 없거나 조회에 실패하면 'unavailable' → 호출부가 링크를 비운다.
//   - 한계: 이미 신고된 사이트만 잡는다. 막 생긴 사칭 사이트는 목록에 없을 수 있다.
//   - 접속 확인(verify.ts)보다 먼저 한다 — 악성일 수 있는 사이트에 먼저 접속하지 않기 위해.

import { webRiskVerdict } from './logic.ts';

const ENDPOINT = 'https://webrisk.googleapis.com/v1/uris:search';
const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'] as const;

export type SafetyResult = 'safe' | 'unsafe' | 'no_key' | 'unavailable';

export async function checkWebRisk(url: string, apiKey: string | undefined, timeoutMs: number): Promise<SafetyResult> {
  if (!apiKey) return 'no_key';
  const qs = new URLSearchParams();
  for (const t of THREAT_TYPES) qs.append('threatTypes', t);
  qs.append('uri', url);
  try {
    const res = await fetch(`${ENDPOINT}?${qs.toString()}`, {
      method: 'GET',
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      console.log(`purchase: web_risk_error status=${res.status}`);
      return 'unavailable';
    }
    const verdict = webRiskVerdict(await res.json());
    return verdict === 'unknown' ? 'unavailable' : verdict;
  } catch (e) {
    console.log(`purchase: web_risk_error ${e instanceof DOMException ? e.name : 'fetch'}`);
    return 'unavailable';
  }
}
