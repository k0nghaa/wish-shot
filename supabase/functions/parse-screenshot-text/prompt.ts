// parse-screenshot-text 의 모델·출력 스키마·시스템 프롬프트.
// index.ts(배포 함수)와 samples/eval.ts(로컬 회귀 검증)가 같은 정의를 쓰도록 분리했다.

// 정제 모델: 텍스트만 보내는 저비용 정제(지시서 §Edge Function 계약).
export const MODEL = 'claude-haiku-4-5';

// 샘플링 온도 0: 추출은 "같은 입력 → 같은 출력"이어야 한다. 기본값(1.0)에선 같은 스크린샷이어도
// confidence 가 0.4~0.6 으로 흔들려 "확인이 필요해요"(<0.5) 안내가 떴다 안 떴다 했다(2026-10-20 eval).
// 정확도가 아니라 일관성을 위한 값 — 틀린 추출은 프롬프트 규칙으로 막는다.
export const TEMPERATURE = 0;

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
  '  A number counts as a price ONLY when the context shows it is the product\'s KRW amount: followed by "원" or "₩",',
  '  labeled as a price (가격, 판매가, 정가, 할인가), or shown as the product price next to a discount rate (e.g. "30% 26,900").',
  '  These are NEVER prices, even when they look like one: review/like/view/comment/follower/sold/interest counts',
  '  (e.g. "리뷰 1,204", "3,512명이 관심", "구매 12,000+"), ratings, percentages, quantities, sizes/weights/volumes,',
  '  model numbers, product/order codes, dates, times, phone numbers.',
  '  If the price is shown only in a foreign currency ($, US$, €, ¥, etc.), use null — do NOT convert it and do NOT drop the decimal point.',
  '  If the screen shows several products (a list, feed, or "recommended / similar items" section), use only the main product\'s price;',
  '  if you cannot tell which price belongs to the main product, use null.',
  '  When unsure, use null: a wrong price is worse than no price (the user can type it in).',
  '- confidence: 0..1, your overall confidence in productName+price. Lower it when the text is ambiguous or noisy,',
  '  and when choosing the price required guessing.',
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
 * FR-8: 목록 밖 값·새 이름 금지.
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
