import { supabase } from '@/lib/supabase';

import { listCategories } from './categories';

/**
 * parse-screenshot-text Edge Function 의 정제 결과.
 * OCR 원문을 서버(Claude Haiku)로 보내 뽑은 값. 못 뽑은 필드는 null.
 */
export interface ParseResult {
  productName: string | null;
  price: number | null;
  brand: string | null;
  confidence: number; // 0~1
  /** FR-8: 기존 카테고리 이름 중 추천 하나거나 null. 목록 밖 값은 앱에서 무시(항상 null). */
  suggestedCategory: string | null;
}

/**
 * OCR 원문을 Edge Function 으로 보내 제품명·가격·브랜드를 정제하고, 기존 카테고리 중 하나를
 * 추천받는다(FR-8, 추가 LLM 왕복 없이 같은 호출에 얹음). 이미지가 아니라 텍스트만 전송한다(NFR-3).
 * 카테고리 이름 목록도 함께 보낸다(사용자가 만든 라벨 — OCR 텍스트와 같은 수준의 민감도).
 * 함수 호출엔 로그인 세션 토큰이 자동으로 실린다.
 *
 * 실패(네트워크/타임아웃/LLM 오류/거부)는 throw → 상위(useAnalysis)가 E-2 로 폴백한다.
 */
export async function parseScreenshotText(text: string): Promise<ParseResult> {
  // 기존 카테고리 이름을 함께 보내 추천을 받는다. 조회 실패 시 추천만 생략(정제는 계속).
  let categoryNames: string[] = [];
  try {
    categoryNames = (await listCategories()).map((c) => c.name);
  } catch {
    /* 카테고리 조회 실패는 추천만 건너뛴다 */
  }

  const { data, error } = await supabase.functions.invoke<ParseResult>('parse-screenshot-text', {
    body: { text, categories: categoryNames },
  });
  if (error) throw new Error(`정제에 실패했어요: ${error.message}`);
  if (!data || typeof data.confidence !== 'number') {
    throw new Error('정제 결과가 올바르지 않아요.');
  }

  // 제약 5: 목록에 없는 추천값은 무시(임의 카테고리 생성 방지). 하위호환: 필드 없으면 null.
  const suggestedCategory =
    typeof data.suggestedCategory === 'string' && categoryNames.includes(data.suggestedCategory)
      ? data.suggestedCategory
      : null;

  return { ...data, suggestedCategory };
}
