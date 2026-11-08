// parse-screenshot-text — 온디바이스 OCR 원문을 Claude Haiku로 정제해
// { productName, price, brand, confidence } 를 돌려주는 Edge Function (Deno).
//
// 계약(Phase 3 + Phase 4 FR-8 + Phase 6 이미지 분기 + 요청 한도):
//   입력:  { "text": string, "categories"?: string[],
//           "image"?: { "base64": string, "mediaType": "image/jpeg" | "image/png" } }
//     - text:       OCR 원문. 이미지가 있으면 비어 있어도 된다(텍스트 부족 폴백). 최대 2,000자.
//     - categories: 사용자의 기존 카테고리 이름들(FR-8 추천용). 프롬프트에 들어가는 형태
//                   (정리 후 JSON.stringify)로 최대 2,000자.
//     - image:      사용자가 직접 고른 "제품 영역 크롭"만(Phase 6). OCR 텍스트가 부족하면 앱이
//                   영역 지정 시트를 자동으로 열고(또는 사용자가 '제품 영역으로 분석'을 누르면),
//                   사용자가 고른 영역만 '분석'을 누를 때 온다(통이미지·자동 전송 아님).
//                   로그·저장하지 않고 Anthropic 요청에만 쓴다.
//   출력:  { productName, price, brand, confidence, suggestedCategory }  (스키마 불변)
//     - productName: string | null       못 뽑으면 null (앱에서 E-3 수동 입력). 브랜드명 미포함(brand 필드로 분리)
//     - price:       number | null       원 단위 정수(KRW). 정가 우선(할인 전 가격, 2026-10 변경) — 하나만 보이면 그 가격, 없으면 null.
//                                        원화 금액만 인정(리뷰·관심 수 등 숫자·외화 배제), 애매하면 null(2026-10-19)
//     - brand:       string | null       없으면 null. 통용되는 한국어 공식 표기 우선(나이키), 없으면 영문 공식 표기(Aesop)
//     - confidence:  number              0~1. 낮으면 앱에서 "확인이 필요해요"
//     - suggestedCategory: string | null 입력 categories 중 하나거나 null(FR-8 경량 추천)
//                                        categories 가 비면 항상 null(하위호환)
//
// 규칙:
//   - Claude API 키(ANTHROPIC_API_KEY)는 이 함수의 시크릿에만 존재. 앱엔 없음.
//   - 로그인 사용자만 호출(anon 거부).
//   - NFR-3(개정): AI 정제엔 인식된 "텍스트"를 보내고, 이미지는 사용자가 직접 고른
//     "제품 영역 크롭"만 보낸다(통이미지 아님). 미저장·미로깅.
//   - image 없는 요청은 Phase 5와 바이트 단위로 동일 동작(하위호환).
//   - LLM 오류/타임아웃은 명확한 실패 응답으로 → 앱이 E-2(원문+재시도+수동 폴백) 처리.
//   - 입력 크기 상한: 넘으면 LLM 을 부르지 않고 400(text_too_long / categories_too_long).
//     자르지 않는다 — 상한 안의 요청은 Anthropic 요청 바디가 이전과 같다.
//   - 요청 한도: 입력 검증을 통과한 뒤, Anthropic 을 부르기 전에 센다(검증 실패는 세지 않음).
//     사용자 시간당·하루(한국 시간 0시 기준) + 전체 하루(차단기). 넘으면
//     429 { error: "rate_limited", scope: "user" | "global" } + Retry-After(초).
//     카운터는 DB 함수 public.consume_parse_quota(0005, service_role 전용).
//     카운터 응답이 3초를 넘기면 503 { error: "quota_unavailable" }(몰아치기로 한도 우회 방지),
//     그 밖의 카운터 오류(DB 장애 등)면 호출을 허용한다(fail-open, 오류 종류만 로그).
//   - 실패 기록: 로그인 확인 뒤의 실패 응답은 원인을 DB 에 남긴다(public.record_parse_failure —
//     사용자·한국 날짜·사유·횟수, llm_error 는 Anthropic 상태 코드, 상한 초과는 넘은 길이 —
//     계정이 정리돼도 남는다).
//     함수 로그는 Free 플랜에서 1일만 보관되고 앱·PostHog 는 원인을 구분하지 못하기 때문.
//     기록에 실패해도 응답은 바뀌지 않는다.
//   - 한도 값(Edge Function 환경 변수 — 요청마다 읽어 시크릿 변경이 재배포 없이 반영. 미설정·잘못된 값이면 기본값):
//       PARSE_LIMIT_USER_HOURLY=30  PARSE_LIMIT_USER_DAILY=100
//       PARSE_LIMIT_GLOBAL_DAILY=300  PARSE_IMAGE_WEIGHT=1(이미지 요청 1건을 몇 건으로 셀지, 1~3)

import { createClient } from 'npm:@supabase/supabase-js@2';
// 모델·출력 스키마·시스템 프롬프트(samples/eval.ts 와 공유)
import { MODEL, OUTPUT_SCHEMA, TEMPERATURE, buildSystemPrompt } from './prompt.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
// 요청 한도 카운터·실패 기록 DB 함수 호출용(둘 다 service_role 전용). Edge Function 런타임이
// 자동 주입한다(수동 등록 불필요). 앱·커밋엔 절대 없음.
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// LLM 호출 타임아웃(ms). 초과 시 앱이 E-2로 폴백할 수 있게 실패 응답을 준다.
const LLM_TIMEOUT_MS = 20_000;
// 이미지 분기(Phase 6): 이미지 입력은 처리 지연이 커 타임아웃을 상향한다.
const IMAGE_LLM_TIMEOUT_MS = 25_000;
// 허용 이미지 타입(화이트리스트). 크롭본은 JPEG.
const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png'] as const;
// base64 문자열 길이 상한(≈1.5MB 이미지). 크롭·리사이즈된 영역만 오므로 넉넉. 초과 시 400.
const MAX_IMAGE_BASE64_LEN = 2_000_000;
// 입력 크기 상한(요청 한 번의 최대 비용을 묶는다). 초과 시 400 — 자르지 않는다.
const MAX_TEXT_LEN = 2_000;
// 카테고리는 프롬프트에 실제로 들어가는 형태(JSON.stringify — 따옴표·쉼표 포함)로 잰다.
const MAX_CATEGORIES_JSON_LEN = 2_000;

// 환경 변수 정수 읽기. 미설정이면 기본값, 잘못된 값이면 기본값 + 로그(값은 남기지 않음).
function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Deno.env.get(name);
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= min && n <= max) return n;
  console.log(`parse: invalid env ${name}, using default`);
  return fallback;
}

// 요청 한도(환경 변수로 마이그레이션 없이 조정). 시크릿을 바꾸면 재배포 없이 반영되도록
// 요청마다 읽는다(모듈 로드 때 한 번만 읽으면 떠 있는 워커에는 옛 값이 남는다).
function quotaConfig() {
  return {
    userHourly: intEnv('PARSE_LIMIT_USER_HOURLY', 30, 1, 1_000_000),
    userDaily: intEnv('PARSE_LIMIT_USER_DAILY', 100, 1, 1_000_000),
    globalDaily: intEnv('PARSE_LIMIT_GLOBAL_DAILY', 300, 1, 1_000_000),
    // 이미지 요청 1건을 몇 건으로 셀지. DB 함수도 1~3만 받는다.
    imageWeight: intEnv('PARSE_IMAGE_WEIGHT', 1, 1, 3),
  };
}
// 카운터·기록 DB 호출 시간 제한(ms). 넘으면 카운터는 503 으로 거절, 기록은 건너뛴다.
const DB_TIMEOUT_MS = 3_000;

// service_role 클라이언트(요청 한도·실패 기록 전용). 세션 저장·자동 갱신 없음.
const admin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// 실패 기록 사유 = 응답의 error 코드(한도 초과는 scope 까지). DB check 와 같은 목록.
type FailureReason =
  | 'invalid_json'
  | 'invalid_text'
  | 'invalid_image'
  | 'invalid_media_type'
  | 'image_too_large'
  | 'text_too_long'
  | 'categories_too_long'
  | 'rate_limited_user'
  | 'rate_limited_global'
  | 'quota_unavailable'
  | 'llm_timeout'
  | 'llm_unreachable'
  | 'llm_error'
  | 'llm_refusal'
  | 'llm_empty'
  | 'llm_bad_json'
  | 'llm_read_error';

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
  if (!admin) {
    console.log('parse_failure_record_error: no_service_key');
    return;
  }
  try {
    const { error } = await admin
      .rpc('record_parse_failure', {
        p_user_id: userId,
        p_reason: reason,
        p_llm_status: detail.llmStatus ?? 0,
        p_len: detail.len ?? null,
      })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) console.log(`parse_failure_record_error: ${errorKind(error)}`);
  } catch (e) {
    console.log(`parse_failure_record_error: ${errorKind(e)}`);
  }
}

// 요청 한도 판정 결과.
//   allowed  허용
//   denied   한도 초과 → 429
//   timeout  카운터 응답이 DB_TIMEOUT_MS 를 넘김 → 503 으로 거절(fail-closed).
//            같은 계정 요청을 동시에 쏟아내 카운터 행에 줄을 세우면 시간 초과가 나는데,
//            이때 허용하면 몰아치기만으로 한도를 우회할 수 있기 때문.
//   error    그 밖의 카운터 오류(서비스 키 없음·함수 없음·연결 실패 등) → 허용(fail-open, 오류 종류만 로그)
type QuotaResult =
  | { status: 'allowed' }
  | { status: 'denied'; scope: 'user' | 'global'; retryAfterSec: number }
  | { status: 'timeout' }
  | { status: 'error' };

async function consumeQuota(userId: string, hasImage: boolean): Promise<QuotaResult> {
  if (!admin) {
    console.log('parse_quota_error: no_service_key');
    return { status: 'error' };
  }
  const cfg = quotaConfig();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DB_TIMEOUT_MS);
  try {
    const { data, error } = await admin
      .rpc('consume_parse_quota', {
        p_user_id: userId,
        p_weight: hasImage ? cfg.imageWeight : 1,
        p_limit_user_hourly: cfg.userHourly,
        p_limit_user_daily: cfg.userDaily,
        p_limit_global_daily: cfg.globalDaily,
      })
      .abortSignal(controller.signal);
    if (error) {
      if (timedOut) {
        console.log('parse_quota_error: timeout');
        return { status: 'timeout' };
      }
      console.log(`parse_quota_error: ${errorKind(error)}`);
      return { status: 'error' };
    }
    const d = data as { allowed?: unknown; scope?: unknown; retry_after_sec?: unknown } | null;
    if (typeof d?.allowed !== 'boolean') {
      console.log('parse_quota_error: bad_response');
      return { status: 'error' };
    }
    if (d.allowed) return { status: 'allowed' };
    const retry = typeof d.retry_after_sec === 'number' && d.retry_after_sec > 0
      ? Math.ceil(d.retry_after_sec)
      : 60;
    return { status: 'denied', scope: d.scope === 'global' ? 'global' : 'user', retryAfterSec: retry };
  } catch (e) {
    if (timedOut) {
      console.log('parse_quota_error: timeout');
      return { status: 'timeout' };
    }
    console.log(`parse_quota_error: ${errorKind(e)}`);
    return { status: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

type ParsedResult = {
  productName: string | null;
  price: number | null;
  brand: string | null;
  confidence: number;
  suggestedCategory: string | null;
};

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

// 로그인 확인 뒤의 실패 응답: 원인을 기록하고(실패해도 무시) 기존과 같은 응답을 돌려준다.
async function fail(
  userId: string,
  reason: FailureReason,
  body: Record<string, unknown>,
  status: number,
  detail: { llmStatus?: number; len?: number } = {},
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  console.log(`parse: fail reason=${reason}`);
  await recordFailure(userId, reason, detail);
  return json(body, status, extraHeaders);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // 시크릿 미설정 — 배포 설정 문제. 앱엔 E-2로 처리됨.
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

  // 2) 입력 검증: { text: string, categories?: string[], image?: { base64, mediaType } }
  let body: { text?: unknown; categories?: unknown; image?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(user.id, 'invalid_json', { error: 'invalid_json' }, 400);
  }
  const text = typeof body?.text === 'string' ? body.text : '';

  // image(Phase 6): 있으면 검증. 타입 화이트리스트 + base64 길이 상한. 크롭본이 아니어도 여기선 형식만 본다.
  let image: { base64: string; mediaType: string } | null = null;
  if (body?.image != null) {
    const raw = body.image;
    if (typeof raw !== 'object') return fail(user.id, 'invalid_image', { error: 'invalid_image' }, 400);
    const b64 = (raw as { base64?: unknown }).base64;
    const mt = (raw as { mediaType?: unknown }).mediaType;
    if (typeof b64 !== 'string' || b64.length === 0) {
      return fail(user.id, 'invalid_image', { error: 'invalid_image' }, 400);
    }
    if (typeof mt !== 'string' || !ALLOWED_MEDIA_TYPES.includes(mt as (typeof ALLOWED_MEDIA_TYPES)[number])) {
      return fail(user.id, 'invalid_media_type', { error: 'invalid_media_type' }, 400);
    }
    if (b64.length > MAX_IMAGE_BASE64_LEN) return fail(user.id, 'image_too_large', { error: 'image_too_large' }, 400);
    image = { base64: b64, mediaType: mt };
  }

  // 텍스트든 이미지든 최소 하나는 있어야 한다. 이미지 없이 텍스트가 비면 기존처럼 거부.
  if (text.trim().length === 0 && !image) {
    return fail(user.id, 'invalid_text', { error: 'invalid_text' }, 400);
  }

  // categories: 문자열만 추리고, 빈 값·중복 제거. 없으면 추천을 건너뛴다(하위호환).
  const categories = Array.isArray(body?.categories)
    ? [...new Set(body.categories.filter((c: unknown): c is string => typeof c === 'string' && c.trim().length > 0))]
    : [];

  // 입력 크기 상한: 넘으면 LLM 을 부르지 않고 거절한다(자르지 않음 — 상한 안의 요청은 바디 불변).
  // 이 거절은 검증 실패라 요청 한도에 세지 않는다. 넘은 길이(숫자)만 기록한다.
  if (text.length > MAX_TEXT_LEN) {
    return fail(user.id, 'text_too_long', { error: 'text_too_long' }, 400, { len: text.length });
  }
  const categoriesJsonLen = JSON.stringify(categories).length;
  if (categoriesJsonLen > MAX_CATEGORIES_JSON_LEN) {
    return fail(user.id, 'categories_too_long', { error: 'categories_too_long' }, 400, { len: categoriesJsonLen });
  }

  // 관측용: 이미지 "데이터"는 남기지 않고 길이만 기록한다(NFR-3).
  console.log(`parse: textLen=${text.length} hasImage=${!!image} imgB64Len=${image?.base64.length ?? 0} cats=${categories.length}`);

  // 요청 한도: 검증을 통과한 요청만, Anthropic 을 부르기 전에 센다.
  // 시간 초과는 거절(503), 그 밖의 카운터 오류는 호출 허용(fail-open).
  const quota = await consumeQuota(user.id, !!image);
  if (quota.status === 'denied') {
    return fail(
      user.id,
      quota.scope === 'global' ? 'rate_limited_global' : 'rate_limited_user',
      { error: 'rate_limited', scope: quota.scope },
      429,
      {},
      { 'Retry-After': String(quota.retryAfterSec) },
    );
  }
  if (quota.status === 'timeout') {
    return fail(user.id, 'quota_unavailable', { error: 'quota_unavailable' }, 503);
  }

  // 3) Claude Haiku 호출 (구조화 출력). Deno에 설치될 SDK 버전이 output_config를
  //    지원하는지 확신할 수 없어, 문서화된 REST 바디를 fetch로 직접 호출한다.
  // 이미지가 있으면 [image, text] 블록. 없으면 기존과 바이트 동일한 문자열 content.
  const userContent = image
    ? [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
        { type: 'text', text: `OCR text (may be empty):\n${text}` },
      ]
    : text;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), image ? IMAGE_LLM_TIMEOUT_MS : LLM_TIMEOUT_MS);
  let anthropicRes: Response;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        temperature: TEMPERATURE,
        system: buildSystemPrompt(categories, !!image),
        output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
        messages: [{ role: 'user', content: userContent }],
      }),
    });
  } catch (e) {
    // 네트워크/타임아웃 → 앱이 E-2로 폴백
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    const reason = aborted ? 'llm_timeout' : 'llm_unreachable';
    return fail(user.id, reason, { error: reason }, 504);
  } finally {
    clearTimeout(timeout);
  }

  if (!anthropicRes.ok) {
    return fail(
      user.id,
      'llm_error',
      { error: 'llm_error', status: anthropicRes.status },
      502,
      { llmStatus: anthropicRes.status },
    );
  }

  // 4) 응답 파싱
  // 본문 읽기 실패(연결 끊김 등)는 원인만 기록하고 그대로 던진다 — 응답(런타임 500)은 이전과 같다.
  const data = await anthropicRes.json().catch(async (e: unknown) => {
    console.log('parse: fail reason=llm_read_error');
    await recordFailure(user.id, 'llm_read_error');
    throw e;
  });
  if (data?.stop_reason === 'refusal') {
    return fail(user.id, 'llm_refusal', { error: 'llm_refusal' }, 502);
  }
  const textBlock = Array.isArray(data?.content)
    ? data.content.find((b: { type?: string }) => b?.type === 'text')
    : undefined;
  if (!textBlock?.text) {
    return fail(user.id, 'llm_empty', { error: 'llm_empty' }, 502);
  }

  let parsed: ParsedResult;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    return fail(user.id, 'llm_bad_json', { error: 'llm_bad_json' }, 502);
  }

  // price 방어적 정규화: 혹시 숫자 아닌 값이 오면 null 처리(저장 흐름을 막지 않는다).
  const price =
    typeof parsed.price === 'number' && Number.isFinite(parsed.price)
      ? Math.round(parsed.price)
      : null;

  // suggestedCategory 화이트리스트: 반드시 입력 categories 안의 값이어야 한다(할루시네이션·새 이름 차단).
  const suggestedCategory =
    typeof parsed.suggestedCategory === 'string' && categories.includes(parsed.suggestedCategory)
      ? parsed.suggestedCategory
      : null;

  return json({
    productName: parsed.productName ?? null,
    price,
    brand: parsed.brand ?? null,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    suggestedCategory,
  });
});
