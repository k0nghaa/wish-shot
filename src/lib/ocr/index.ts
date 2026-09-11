import { MockOcrEngine } from './MockOcrEngine';
import { VisionOcrEngine, isVisionAvailable } from './VisionOcrEngine';

import type { OcrEngine } from './OcrEngine';

/**
 * 개발 중 Mock 강제 플래그.
 * 실기기에서도 Mock으로 화면 로직만 확인하고 싶을 때 true 로 바꾼다.
 */
const FORCE_MOCK = false;

/**
 * 환경에 맞는 OCR 엔진 인스턴스.
 * - 네이티브 모듈이 있고 OS가 지원하면 VisionOcrEngine(실기기).
 * - 그렇지 않으면(Expo Go·시뮬레이터·미지원) MockOcrEngine.
 *
 * 화면·훅은 이 `ocrEngine` 하나만 `@/lib/ocr`에서 가져다 쓴다.
 */
export const ocrEngine: OcrEngine =
  !FORCE_MOCK && isVisionAvailable() ? new VisionOcrEngine() : new MockOcrEngine();

export type { OcrEngine, OcrResult } from './OcrEngine';
export { VisionOcrEngine, isVisionAvailable } from './VisionOcrEngine';
export { MockOcrEngine } from './MockOcrEngine';
