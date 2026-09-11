/**
 * 온디바이스 OCR 엔진 인터페이스 (FR-8a).
 *
 * 화면·상태머신은 이 인터페이스만 알고, 실제 구현(Apple Vision / ML Kit / Mock)은
 * 뒤에 숨긴다. 나중에 엔진을 갈아끼워도 로직 레이어는 무변경.
 */
export interface OcrResult {
  /** 인식된 원문 텍스트(여러 줄은 \n 으로 이어붙임). 서버(LLM 정제)로는 이 텍스트만 보낸다. */
  text: string;
  /** 0~1 신뢰도. 엔진이 제공할 때만 채워진다(Apple Vision은 제공하지 않아 undefined). */
  confidence?: number;
}

export interface OcrEngine {
  /**
   * 로컬 이미지 uri에서 텍스트를 인식한다. 이미지는 기기를 떠나지 않는다(NFR-3).
   * @param uri file:// 또는 스킴 없는 절대경로. 정규화는 imageBytes.toFileUri 참고.
   */
  recognize(uri: string): Promise<OcrResult>;
}
