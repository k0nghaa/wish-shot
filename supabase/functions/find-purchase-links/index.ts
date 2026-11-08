// find-purchase-links — 등록 폼에서 분석된 제품명·브랜드와 캡처의 입구 채널로
// 그 상품의 판매 페이지 링크를 찾아 돌려주는 Edge Function (Deno).
// 지시서: docs/phases/phase-21-purchase-finder.md
//
// 계약:
//   입력:  { "productName": string, "brand"?: string | null, "domain"?: string, "mall"?: string }
//     - productName: 정제 결과의 제품명(필수, 최대 200자)
//     - brand:       정제 결과의 브랜드(선택, 최대 100자)
//     - domain:      캡처에 보인 사이트 도메인(기기에서 OCR 원문으로 찾음). mall 과 둘 중 하나만.
//                    스킴·경로·www.·m. 은 떼고 호스트명만 쓴다. 공용 접미사만 남는 이름(co.kr 등)·
//                    예약 이름은 400. 포털·블로그·SNS 주소(malls.ts NON_SELLER_DOMAINS)는 채널 없음으로 본다.
//     - mall:        몰 앱 캡처로 판별한 몰 id(malls.ts). domain 과 둘 중 하나만
//     - domain·mall 이 없으면 입구 채널을 모르는 것 → 브랜드 공식 홈페이지만 찾는다.
//   출력:  { "link": { "url": string, "domain": string, "kind": "official" | "site" } | null }
//     - 후보가 없음·같은 상품이 확실하지 않음·거절(refusal) → { link: null } (200)
//     - 검색 도구 오류·pause_turn 이어 보내기 상한이 있어도 모은 후보가 있으면 고르기로 진행한다.
//   오류:  400 입력(invalid_json·invalid_input·input_too_long·invalid_domain·invalid_mall),
//          401 미로그인, 429 요청 한도(+Retry-After), 503 카운터 사용 불가,
//          502·504 Anthropic 호출 실패. 앱은 어떤 실패든 링크를 비워 둔다.
//
// 흐름: JWT 확인 → 입력 검증 → 요청 한도(0007) → 1차 호출(웹 검색 — 서버가 결과 블록에서 후보 URL 수집)
//       → 2차 호출(구조화 출력, 도구 없음 — 후보 "번호"만 고른다) → 서버가 후보에서 URL 을 꺼내 반환.
//   웹 검색 인용은 항상 켜져 있고 인용과 구조화 출력은 한 요청에 쓸 수 없어(400) 두 번 부른다.
//
// 규칙:
//   - 불변식 1: 돌려주는 URL 은 검색 결과 블록에서 꺼낸 것뿐(모델이 쓴 URL·OCR 로 읽은 주소는 쓰지 않음).
//   - 불변식 2: 제품명·브랜드·입구 채널만 받는다. 이미지·OCR 원문은 받지 않는다.
//   - 로그엔 채널 종류·후보 수·채웠는지·검색 횟수·토큰만. 제품명·브랜드·도메인·URL 은 남기지 않는다.
//   - Claude API 키(ANTHROPIC_API_KEY)는 이 함수의 시크릿에만.
//   - 요청 한도: 입력 검증을 통과한 요청만, Anthropic 을 부르기 전에 센다. 카운터는 DB 함수
//     public.consume_purchase_link_quota(0007, service_role 전용). 카운터 오류·시간 초과는
//     거절(503, fail-closed) — 웹 검색은 비용이 커서 한도 없이 돌지 않게 한다(정제 함수와 다름).
//   - 한도 값(Edge Function 환경 변수 — 요청마다 읽어 재배포 없이 반영. 미설정·잘못된 값이면 기본값):
//       PURCHASE_LIMIT_USER_HOURLY=10  PURCHASE_LIMIT_USER_DAILY=30  PURCHASE_LIMIT_GLOBAL_DAILY=100
//   - 실패 기록: 로그인 확인 뒤의 실패는 원인을 public.record_purchase_link_failure 로 남긴다
//     (사용자·한국 날짜·사유·횟수 — 내용 없음). 기록에 실패해도 응답은 바뀌지 않는다.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  type Channel,
  type Harvest,
  type Link,
  MAX_BRAND_LEN,
  MAX_PRODUCT_NAME_LEN,
  harvestCandidates,
  hasRealToolError,
  kstDate,
  pickToLink,
  resolveChannel,
  searchScope,
} from './logic.ts';
import {
  ANTHROPIC_VERSION,
  MAX_USES_OPEN,
  MAX_USES_SCOPED,
  MODEL,
  PICK_EFFORT,
  PICK_MAX_TOKENS,
  PICK_SCHEMA,
  SEARCH_EFFORT,
  SEARCH_MAX_TOKENS,
  buildPickSystem,
  buildPickUserMessage,
  buildSearchSystem,
  buildSearchTool,
  buildSearchUserMessage,
} from './prompt.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
// 요청 한도 카운터·실패 기록 DB 함수 호출용(둘 다 service_role 전용). 런타임이 자동 주입한다.
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// 1차(검색) 전체 시간 예산(ms) — pause_turn 이어 보내기까지 포함. 넘기면 모은 후보로 진행한다.
const SEARCH_BUDGET_MS = 45_000;
// 2차(고르기) 시간 제한(ms).
const PICK_TIMEOUT_MS = 15_000;
// pause_turn 이어 보내기 최대 횟수.
const MAX_CONTINUATIONS = 2;
// 남은 시간이 이보다 적으면 이어 보내지 않는다(중간에 끊겨 과금만 되고 결과를 버리는 것 방지).
const MIN_CONTINUE_MS = 10_000;
// 카운터·기록 DB 호출 시간 제한(ms).
const DB_TIMEOUT_MS = 3_000;

// 환경 변수 정수 읽기. 미설정이면 기본값, 잘못된 값이면 기본값 + 로그(값은 남기지 않음).
function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Deno.env.get(name);
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= min && n <= max) return n;
  console.log(`purchase: invalid env ${name}, using default`);
  return fallback;
}

// 요청 한도. 시크릿을 바꾸면 재배포 없이 반영되도록 요청마다 읽는다.
function quotaConfig() {
  return {
    userHourly: intEnv('PURCHASE_LIMIT_USER_HOURLY', 10, 1, 1_000_000),
    userDaily: intEnv('PURCHASE_LIMIT_USER_DAILY', 30, 1, 1_000_000),
    globalDaily: intEnv('PURCHASE_LIMIT_GLOBAL_DAILY', 100, 1, 1_000_000),
  };
}

// service_role 클라이언트(요청 한도·실패 기록 전용). 세션 저장·자동 갱신 없음.
const admin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// 실패 기록 사유. DB check(0007)와 같은 목록.
type FailureReason =
  | 'invalid_json'
  | 'invalid_input'
  | 'input_too_long'
  | 'invalid_domain'
  | 'invalid_mall'
  | 'rate_limited_user'
  | 'rate_limited_global'
  | 'quota_unavailable'
  | 'llm_timeout'
  | 'llm_unreachable'
  | 'llm_error'
  | 'llm_read_error'
  | 'llm_refusal'
  | 'llm_empty'
  | 'llm_bad_json'
  | 'llm_max_tokens'
  | 'search_error'
  | 'search_paused';

// 오류 객체에서 종류만 뽑는다(메시지엔 사용자 id 등이 섞일 수 있어 로그에 남기지 않음).
function errorKind(e: unknown): string {
  if (e && typeof e === 'object') {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
    const name = (e as { name?: unknown }).name;
    if (typeof name === 'string' && name) return name;
  }
  return 'unknown';
}

// 실패 1건 기록. 실패해도 던지지 않는다(응답을 바꾸지 않음).
async function recordFailure(
  userId: string,
  reason: FailureReason,
  detail: { llmStatus?: number; len?: number } = {},
): Promise<void> {
  console.log(`purchase: fail reason=${reason}`);
  if (!admin) {
    console.log('purchase_failure_record_error: no_service_key');
    return;
  }
  try {
    const { error } = await admin
      .rpc('record_purchase_link_failure', {
        p_user_id: userId,
        p_reason: reason,
        p_llm_status: detail.llmStatus ?? 0,
        p_len: detail.len ?? null,
      })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) console.log(`purchase_failure_record_error: ${errorKind(error)}`);
  } catch (e) {
    console.log(`purchase_failure_record_error: ${errorKind(e)}`);
  }
}

// 요청 한도 판정 결과. 카운터를 쓸 수 없으면(서비스 키 없음·함수 없음·연결 실패·시간 초과)
// unavailable → 거절(fail-closed).
type QuotaResult =
  | { status: 'allowed' }
  | { status: 'denied'; scope: 'user' | 'global'; retryAfterSec: number }
  | { status: 'unavailable' };

async function consumeQuota(userId: string): Promise<QuotaResult> {
  if (!admin) {
    console.log('purchase_quota_error: no_service_key');
    return { status: 'unavailable' };
  }
  const cfg = quotaConfig();
  try {
    const { data, error } = await admin
      .rpc('consume_purchase_link_quota', {
        p_user_id: userId,
        p_limit_user_hourly: cfg.userHourly,
        p_limit_user_daily: cfg.userDaily,
        p_limit_global_daily: cfg.globalDaily,
      })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) {
      console.log(`purchase_quota_error: ${errorKind(error)}`);
      return { status: 'unavailable' };
    }
    const d = data as { allowed?: unknown; scope?: unknown; retry_after_sec?: unknown } | null;
    if (typeof d?.allowed !== 'boolean') {
      console.log('purchase_quota_error: bad_response');
      return { status: 'unavailable' };
    }
    if (d.allowed) return { status: 'allowed' };
    const retry = typeof d.retry_after_sec === 'number' && d.retry_after_sec > 0
      ? Math.ceil(d.retry_after_sec)
      : 60;
    return { status: 'denied', scope: d.scope === 'global' ? 'global' : 'user', retryAfterSec: retry };
  } catch (e) {
    console.log(`purchase_quota_error: ${errorKind(e)}`);
    return { status: 'unavailable' };
  }
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

// 로그인 확인 뒤의 실패 응답: 원인을 기록하고(실패해도 무시) 응답을 돌려준다.
async function fail(
  userId: string,
  reason: FailureReason,
  status: number,
  detail: { llmStatus?: number; len?: number } = {},
  extraBody: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  await recordFailure(userId, reason, detail);
  return json({ error: reason, ...extraBody }, status, extraHeaders);
}

// ---------------------------------------------------------------------------
// Anthropic 호출
// ---------------------------------------------------------------------------
type AnthropicMessage = {
  content?: unknown[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; server_tool_use?: { web_search_requests?: number } };
};

type LlmFailure = 'llm_timeout' | 'llm_unreachable' | 'llm_error' | 'llm_read_error';
type AnthropicCall = { ok: true; data: AnthropicMessage } | { ok: false; reason: LlmFailure; status?: number };

async function callAnthropic(body: Record<string, unknown>, timeoutMs: number): Promise<AnthropicCall> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': ANTHROPIC_API_KEY!,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // 오류 종류만 남긴다(메시지엔 입력값이 섞일 수 있음)
      const errType = await res.json().then(
        (b: { error?: { type?: unknown } }) => (typeof b?.error?.type === 'string' ? b.error.type : 'unknown'),
        () => 'unreadable',
      );
      console.log(`purchase: llm_error status=${res.status} type=${errType}`);
      return { ok: false, reason: 'llm_error', status: res.status };
    }
    try {
      return { ok: true, data: (await res.json()) as AnthropicMessage };
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      return { ok: false, reason: aborted ? 'llm_timeout' : 'llm_read_error' };
    }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    return { ok: false, reason: aborted ? 'llm_timeout' : 'llm_unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

function llmFailStatus(reason: LlmFailure): number {
  return reason === 'llm_timeout' || reason === 'llm_unreachable' ? 504 : 502;
}

type Usage = { searches: number; inTokens: number; outTokens: number };

function addUsage(u: Usage, data: AnthropicMessage): void {
  u.searches += data.usage?.server_tool_use?.web_search_requests ?? 0;
  u.inTokens += data.usage?.input_tokens ?? 0;
  u.outTokens += data.usage?.output_tokens ?? 0;
}

// stop: 검색·고르기 호출의 마지막 stop_reason(enum — 내용 노출 없음)
function logResult(
  channel: Channel,
  harvest: Harvest,
  link: Link | null,
  u: Usage,
  stop: { search: string; pick: string },
): void {
  console.log(
    `purchase: via=${channel.via} candidates=${harvest.candidates.length} filled=${!!link} kind=${link?.kind ?? '-'}` +
      ` searches=${u.searches} in=${u.inTokens} out=${u.outTokens}` +
      ` searchStop=${stop.search} pickStop=${stop.pick} toolErrors=${harvest.errorCodes.join(',') || '-'}`,
  );
}

// ---------------------------------------------------------------------------
// 요청 처리
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return json({ error: 'server_misconfigured' }, 500);
  }

  // 1) 로그인 사용자만 통과 (anon/미로그인 거부)
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: 'unauthorized' }, 401);

  // 2) 입력 검증: { productName, brand?, domain?, mall? }
  let body: { productName?: unknown; brand?: unknown; domain?: unknown; mall?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(user.id, 'invalid_json', 400);
  }
  if (!body || typeof body !== 'object') return fail(user.id, 'invalid_json', 400);

  const productName = typeof body.productName === 'string' ? body.productName.trim() : '';
  if (!productName) return fail(user.id, 'invalid_input', 400);
  if (body.brand != null && typeof body.brand !== 'string') return fail(user.id, 'invalid_input', 400);
  const brand = typeof body.brand === 'string' && body.brand.trim() ? body.brand.trim() : null;
  // 길이 상한: 넘으면 자르지 않고 거절(넘은 길이만 기록). 검증 실패라 한도에 세지 않는다.
  if (productName.length > MAX_PRODUCT_NAME_LEN) {
    return fail(user.id, 'input_too_long', 400, { len: productName.length });
  }
  if (brand && brand.length > MAX_BRAND_LEN) {
    return fail(user.id, 'input_too_long', 400, { len: brand.length });
  }
  const resolved = resolveChannel(body.domain, body.mall);
  if (!resolved.ok) return fail(user.id, resolved.error, 400);
  const channel = resolved.channel;

  console.log(`purchase: via=${channel.via} nameLen=${productName.length} hasBrand=${!!brand}`);

  // 3) 요청 한도: 검증을 통과한 요청만, Anthropic 을 부르기 전에 센다. 카운터를 못 쓰면 거절.
  const quota = await consumeQuota(user.id);
  if (quota.status === 'denied') {
    return fail(
      user.id,
      quota.scope === 'global' ? 'rate_limited_global' : 'rate_limited_user',
      429,
      {},
      { error: 'rate_limited', scope: quota.scope },
      { 'Retry-After': String(quota.retryAfterSec) },
    );
  }
  if (quota.status === 'unavailable') return fail(user.id, 'quota_unavailable', 503);

  // 4) 1차 호출 — 웹 검색. 후보 URL 은 결과 블록에서 서버가 직접 모은다.
  const scope = searchScope(channel, brand);
  const maxUses = channel.via === 'none' ? MAX_USES_OPEN : MAX_USES_SCOPED;
  const tools = [buildSearchTool(scope, maxUses)];
  const system = buildSearchSystem(channel, maxUses, kstDate(new Date()));
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [
    { role: 'user', content: buildSearchUserMessage(productName, brand) },
  ];
  const harvest: Harvest = { candidates: [], errorCodes: [] };
  const usage: Usage = { searches: 0, inTokens: 0, outTokens: 0 };
  const stop = { search: '-', pick: '-' };
  const deadline = Date.now() + SEARCH_BUDGET_MS;
  let paused = false;

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const remaining = deadline - Date.now();
    if (turn > 0 && remaining < MIN_CONTINUE_MS) {
      paused = true; // 시간이 모자라 이어 보내지 않음 — 모은 후보로 진행
      break;
    }
    const r = await callAnthropic(
      { model: MODEL, max_tokens: SEARCH_MAX_TOKENS, system, tools, messages, output_config: { effort: SEARCH_EFFORT } },
      remaining,
    );
    if (!r.ok) {
      // 첫 호출 실패는 실패 응답. 이어 보내기 실패는 기록만 하고 모은 후보로 진행한다.
      if (turn === 0) {
        logResult(channel, harvest, null, usage, { ...stop, search: r.reason });
        return fail(user.id, r.reason, llmFailStatus(r.reason), { llmStatus: r.status });
      }
      await recordFailure(user.id, r.reason, { llmStatus: r.status });
      break;
    }
    addUsage(usage, r.data);
    harvestCandidates(r.data.content, scope, harvest);
    stop.search = r.data.stop_reason ?? 'unknown';
    if (r.data.stop_reason === 'pause_turn') {
      if (turn === MAX_CONTINUATIONS) {
        paused = true;
        break;
      }
      // 멈춘 응답을 그대로 붙이고 같은 tools 로 이어 보낸다(thinking 블록 포함, 수정 금지).
      // max_uses 는 이어 보낸 요청까지 한 턴으로 합쳐 센다(공식 문서).
      messages.push({ role: 'assistant', content: r.data.content ?? [] });
      continue;
    }
    break;
  }

  // 거절은 모은 후보가 있어도 링크를 만들지 않는다.
  if (stop.search === 'refusal') {
    await recordFailure(user.id, 'llm_refusal');
    logResult(channel, harvest, null, usage, stop);
    return json({ link: null });
  }
  if (harvest.candidates.length === 0) {
    // 결과 없음은 정상 결과. 도구 오류·이어 보내기 상한·토큰 상한으로 비었으면 원인을 남긴다.
    if (hasRealToolError(harvest.errorCodes)) await recordFailure(user.id, 'search_error');
    else if (paused) await recordFailure(user.id, 'search_paused');
    else if (stop.search === 'max_tokens') await recordFailure(user.id, 'llm_max_tokens');
    logResult(channel, harvest, null, usage, stop);
    return json({ link: null });
  }

  // 5) 2차 호출 — 고르기(구조화 출력, 도구 없음). 모델은 후보 번호만 고른다.
  const pick = await callAnthropic(
    {
      model: MODEL,
      max_tokens: PICK_MAX_TOKENS,
      system: buildPickSystem(channel),
      output_config: { effort: PICK_EFFORT, format: { type: 'json_schema', schema: PICK_SCHEMA } },
      messages: [{ role: 'user', content: buildPickUserMessage(productName, brand, harvest.candidates) }],
    },
    PICK_TIMEOUT_MS,
  );
  if (!pick.ok) {
    logResult(channel, harvest, null, usage, { ...stop, pick: pick.reason });
    return fail(user.id, pick.reason, llmFailStatus(pick.reason), { llmStatus: pick.status });
  }
  addUsage(usage, pick.data);
  stop.pick = pick.data.stop_reason ?? 'unknown';

  let link: Link | null = null;
  if (pick.data.stop_reason === 'refusal') {
    await recordFailure(user.id, 'llm_refusal');
  } else if (pick.data.stop_reason === 'max_tokens') {
    // 잘린 JSON 은 믿지 않는다
    await recordFailure(user.id, 'llm_max_tokens');
  } else {
    const textBlock = Array.isArray(pick.data.content)
      ? (pick.data.content as { type?: unknown; text?: unknown }[]).find((b) => b?.type === 'text')
      : undefined;
    if (typeof textBlock?.text !== 'string' || !textBlock.text) {
      await recordFailure(user.id, 'llm_empty');
    } else {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(textBlock.text);
      } catch {
        await recordFailure(user.id, 'llm_bad_json');
      }
      // URL 은 후보 목록에서 꺼낸다(번호 범위·채널 조건은 pickToLink 가 검사)
      if (parsed !== null) link = pickToLink(parsed, harvest.candidates, channel);
    }
  }

  logResult(channel, harvest, link, usage, stop);
  return json({ link });
});
