import type { OcrEngine, OcrResult } from './OcrEngine';

/**
 * 개발/테스트용 OCR 엔진.
 *
 * 네이티브 모듈 없이(Expo Go·시뮬레이터·개발 서버) 등록 화면과 분석 상태머신 로직을
 * 검증할 수 있도록, 고정된 샘플 텍스트를 반환한다. 실제 인식은 하지 않는다.
 */
export class MockOcrEngine implements OcrEngine {
  async recognize(_uri: string): Promise<OcrResult> {
    return {
      text: ['소니 무선 노이즈 캔슬링 이어폰', 'WF-1000XM5', '189,000원'].join('\n'),
      confidence: 0.9,
    };
  }
}
