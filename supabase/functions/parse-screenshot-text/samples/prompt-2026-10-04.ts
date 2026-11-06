// ⚠️ 측정용 고정 사본 — 수정 금지.
// 출처: 커밋 2a484b6 (2026-10-04, "AI 정제 규칙 개정 — 정가 우선·브랜드 한국어 표기·제품명 브랜드 중복 제거")
//       supabase/functions/parse-screenshot-text/index.ts 의 OUTPUT_SCHEMA·SYSTEM_PROMPT·IMAGE_PROMPT·buildSystemPrompt
//       를 글자 그대로 옮겼다(export 만 추가). 10/20 오추출 방지 규칙(79b816a)·온도 0(6046a2a) 이전 상태다.
// 용도: samples/goldset-eval.ts 의 v0 변형(10/04 프롬프트 + 당시 온도)과 비교 기준선. 운영 함수는 이 파일을 쓰지 않는다.
//
// 당시 온도: 요청 바디에 temperature 필드가 없었다(같은 커밋 index.ts 의 fetch 바디: model·max_tokens·system·
//   output_config·messages 만). 필드를 생략하면 API 기본값 temperature 1.0 으로 샘플링된다 — 공식 문서
//   "Migrating to API version 2026-10-21"(platform.claude.com/docs/en/api/migration-2026-10-21):
//   "Without these parameters, a request samples with their defaults, including a `temperature` of 1.0,
//    the same as a `2023-06-01` request that leaves them out." (2026-11-03 확인)
//   그래서 TEMPERATURE 는 undefined 로 두고, 실행기는 이 값이면 요청에서 temperature 를 뺀다(당시 바디 재현).

/** 당시 요청엔 temperature 가 없었다 → undefined = 요청에서 생략(API 기본값 1.0). */
export const TEMPERATURE: number | undefined = undefined;

// 구조화 출력 스키마. structured outputs 제약(additionalProperties:false + required, 숫자/문자 제약 미지원)에 맞춤.
export const OUTPUT_SCHEMA = {
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

export const SYSTEM_PROMPT = [
  'You extract product info from the raw OCR text of a shopping screenshot (Korean or English).',
  'Return only these fields via the structured format:',
  '- productName: the product name. If the name appears in both Korean and English, PREFER the Korean name.',
  '  Give the core product name only — strip quantity/bundle/option/size noise (e.g. "1EA", "+클린솝", "세트", "2개", "470g", "UP TO 33%").',
  '  Do NOT repeat the brand inside productName — the brand belongs in the brand field only',
  '  (e.g. brand "나이키" + productName "에어맥스 97", NOT productName "나이키 에어맥스 97").',
  '  If you cannot identify one, use null.',
  '- brand: the brand or store name if identifiable, else null.',
  '  Prefer the brand\'s official Korean spelling when one is in common use (e.g. "나이키", "이솝");',
  '  otherwise use the official English spelling with its official casing (e.g. "Aesop", not "AESOP"/"aesop").',
  '- price: the ORIGINAL (pre-discount) list price as an integer in Korean won (KRW), digits only (no "원", no commas, no symbols).',
  '  If both an original and a discounted price are shown, choose the ORIGINAL one (usually the higher or struck-through price),',
  '  NOT the discounted price. If only one price is shown, use it. Coupon amounts and shipping fees are never the price.',
  '  If no price is present, use null.',
  '- confidence: 0..1, your overall confidence in productName+price. Lower it when the text is ambiguous or noisy.',
  'Ignore UI noise: clock/time, carrier/battery, buttons (구매하기, 후기, 팔로우, Follow, Add comment), banners, view/like counts, URLs.',
].join('\n');

// 이미지 분기(Phase 6): 사용자가 잘라낸 제품 영역이 함께 온다. 피사체·패키지·로고로 추정하되 가격은 추측 금지.
export const IMAGE_PROMPT = [
  'An image is ALSO provided: a rectangular product region the user cropped (the OCR text may be empty or sparse — rely on the image).',
  'Identify productName and brand from the image itself — the subject, packaging, label, or logo.',
  'price: ONLY if a price is clearly legible in the image; otherwise null. Do NOT guess or infer a price.',
  'Lower confidence when the product is ambiguous or you are unsure.',
].join('\n');

/**
 * 이미지 유무·categories 유무에 따라 시스템 프롬프트를 조립한다.
 * hasImage=false·categories=[] 이면 Phase 5 와 동일한 프롬프트(바이트 동일). FR-8: 목록 밖 값·새 이름 금지.
 */
export function buildSystemPrompt(categories: string[], hasImage: boolean): string {
  const parts = [SYSTEM_PROMPT];
  if (hasImage) parts.push(IMAGE_PROMPT);
  if (categories.length === 0) {
    parts.push('- suggestedCategory: always null (no categories were provided).');
  } else {
    parts.push(
      '- suggestedCategory: pick the ONE category from the user\'s existing list below that best fits this product.',
      '  You MUST copy one of these strings VERBATIM, or use null if none clearly fits. Never invent a new category name.',
      `  Existing categories: ${JSON.stringify(categories)}`,
    );
  }
  return parts.join('\n');
}
