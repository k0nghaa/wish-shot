import { supabase } from '@/lib/supabase';

/**
 * parse-screenshot-text Edge Function 의 정제 결과.
 * OCR 원문을 서버(Claude Haiku)로 보내 뽑은 값. 못 뽑은 필드는 null.
 */
export interface ParseResult {
  productName: string | null;
  price: number | null;
  brand: string | null;
  confidence: number; // 0~1
}

/**
 * OCR 원문을 Edge Function 으로 보내 제품명·가격·브랜드를 정제한다.
 * 이미지가 아니라 텍스트만 전송한다(NFR-3). 함수 호출엔 로그인 세션 토큰이 자동으로 실린다.
 *
 * 실패(네트워크/타임아웃/LLM 오류/거부)는 throw → 상위(useAnalysis)가 E-2 로 폴백한다.
 */
export async function parseScreenshotText(text: string): Promise<ParseResult> {
  const { data, error } = await supabase.functions.invoke<ParseResult>('parse-screenshot-text', {
    body: { text },
  });
  if (error) throw new Error(`정제에 실패했어요: ${error.message}`);
  if (!data || typeof data.confidence !== 'number') {
    throw new Error('정제 결과가 올바르지 않아요.');
  }
  return data;
}
