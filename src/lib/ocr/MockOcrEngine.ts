import type { OcrEngine, OcrResult } from './OcrEngine';

/**
 * 개발/테스트용 OCR 엔진.
 *
 * 네이티브 모듈 없이(Expo Go·시뮬레이터·개발 서버) 등록 화면과 분석 상태머신 로직을
 * 검증할 수 있도록, 고정된 샘플 텍스트를 반환한다. 실제 인식은 하지 않는다.
 *
 * 테스트 토글(Expo Go 전용): RETURN_EMPTY=true 로 두면 빈 텍스트를 반환해 Phase 6
 * "제품 영역 지정" 폴백 흐름(OCR 부족 → 시트)을 실기기 없이 재현할 수 있다. 검증 후 false 로 되돌린다.
 */
const RETURN_EMPTY = false;

export class MockOcrEngine implements OcrEngine {
  async recognize(_uri: string): Promise<OcrResult> {
    if (RETURN_EMPTY) return { text: '' };
    return {
      text: ['소니 무선 노이즈 캔슬링 이어폰', 'WF-1000XM5', '189,000원'].join('\n'),
      confidence: 0.9,
    };
  }
}
