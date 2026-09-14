// parse-screenshot-text — 온디바이스 OCR 원문을 Claude Haiku로 정제해
// { productName, price, brand, confidence } 를 돌려주는 Edge Function (Deno).
//
// 계약(Phase 3 + Phase 4 FR-8):
//   입력:  { "text": string, "categories"?: string[] }   OCR 원문 + 사용자의 기존 카테고리 이름들
//   출력:  { productName, price, brand, confidence, suggestedCategory }
//     - productName: string | null       못 뽑으면 null (앱에서 E-3 수동 입력)
//     - price:       number | null       원 단위 정수(KRW). 없으면 null
//     - brand:       string | null       없으면 null
//     - confidence:  number              0~1. 낮으면 앱에서 "확인이 필요해요"
//     - suggestedCategory: string | null 입력 categories 중 하나거나 null(FR-8 경량 추천)
//                                        categories 가 비면 항상 null(하위호환)
//
// 규칙:
//   - Claude API 키(ANTHROPIC_API_KEY)는 이 함수의 시크릿에만 존재. 앱엔 없음.
//   - 로그인 사용자만 호출(anon 거부). 이미지가 아니라 "텍스트만" 받는다(NFR-3).
//   - LLM 오류/타임아웃은 명확한 실패 응답으로 → 앱이 E-2(원문+재시도+수동 폴백) 처리.

import { createClient } from 'npm:@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

// 정제 모델: 텍스트만 보내는 저비용 정제(지시서 §Edge Function 계약).
const MODEL = 'claude-haiku-4-5';
// LLM 호출 타임아웃(ms). 초과 시 앱이 E-2로 폴백할 수 있게 실패 응답을 준다.
const LLM_TIMEOUT_MS = 20_000;

// 구조화 출력 스키마. structured outputs 제약(additionalProperties:false + required, 숫자/문자 제약 미지원)에 맞춤.
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    productName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    price: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    brand: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    confidence: { type: 'number' },
    suggestedCategory: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['productName', 'price', 'brand', 'confidence', 'suggestedCategory'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = [
  'You extract product info from the raw OCR text of a shopping screenshot (Korean or English).',
  'Return only these fields via the structured format:',
  '- productName: the product name. If the name appears in both Korean and English, PREFER the Korean name.',
  '  Give the core product name only — strip quantity/bundle/option/size noise (e.g. "1EA", "+클린솝", "세트", "2개", "470g", "UP TO 33%").',
  '  If you cannot identify one, use null.',
  '- brand: the brand or store name if identifiable, else null.',
  '- price: the actual selling price as an integer in Korean won (KRW), digits only (no "원", no commas, no symbols).',
  '  If both an original and a discounted price are shown, choose the price the customer actually pays (the discounted/current price).',
  '  If no price is present, use null.',
  '- confidence: 0..1, your overall confidence in productName+price. Lower it when the text is ambiguous or noisy.',
  'Ignore UI noise: clock/time, carrier/battery, buttons (구매하기, 후기, 팔로우, Follow, Add comment), banners, view/like counts, URLs.',
].join('\n');

/** categories 유무에 따라 suggestedCategory 지침을 덧붙인다(FR-8). 목록 밖 값·새 이름 금지. */
function buildSystemPrompt(categories: string[]): string {
  if (categories.length === 0) {
    return `${SYSTEM_PROMPT}\n- suggestedCategory: always null (no categories were provided).`;
  }
  return [
    SYSTEM_PROMPT,
    '- suggestedCategory: pick the ONE category from the user\'s existing list below that best fits this product.',
    '  You MUST copy one of these strings VERBATIM, or use null if none clearly fits. Never invent a new category name.',
    `  Existing categories: ${JSON.stringify(categories)}`,
  ].join('\n');
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
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

  // 2) 입력 검증: { text: string, categories?: string[] }
  let body: { text?: unknown; categories?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const text = body?.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    return json({ error: 'invalid_text' }, 400);
  }
  // categories: 문자열만 추리고, 빈 값·중복 제거. 없으면 추천을 건너뛴다(하위호환).
  const categories = Array.isArray(body?.categories)
    ? [...new Set(body.categories.filter((c: unknown): c is string => typeof c === 'string' && c.trim().length > 0))]
    : [];

  // 3) Claude Haiku 호출 (구조화 출력). Deno에 설치될 SDK 버전이 output_config를
  //    지원하는지 확신할 수 없어, 문서화된 REST 바디를 fetch로 직접 호출한다.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
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
        system: buildSystemPrompt(categories),
        output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
        messages: [{ role: 'user', content: text }],
      }),
    });
  } catch (e) {
    // 네트워크/타임아웃 → 앱이 E-2로 폴백
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    return json({ error: aborted ? 'llm_timeout' : 'llm_unreachable' }, 504);
  } finally {
    clearTimeout(timeout);
  }

  if (!anthropicRes.ok) {
    return json({ error: 'llm_error', status: anthropicRes.status }, 502);
  }

  // 4) 응답 파싱
  const data = await anthropicRes.json();
  if (data?.stop_reason === 'refusal') {
    return json({ error: 'llm_refusal' }, 502);
  }
  const textBlock = Array.isArray(data?.content)
    ? data.content.find((b: { type?: string }) => b?.type === 'text')
    : undefined;
  if (!textBlock?.text) {
    return json({ error: 'llm_empty' }, 502);
  }

  let parsed: ParsedResult;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    return json({ error: 'llm_bad_json' }, 502);
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
