import { isAvailable, recognizeText } from 'expo-vision-ocr';

import { toFileUri } from '@/lib/imageBytes';

import type { OcrEngine, OcrResult } from './OcrEngine';

/**
 * 로컬 Expo 네이티브 모듈(expo-vision-ocr) 기반 온디바이스 OCR 엔진.
 *
 * - iOS: Apple Vision(OS 내장, 온디바이스). 한국어+영어 인식(recognitionLanguages 지정).
 * - 이미지는 기기를 떠나지 않는다(NFR-3).
 *
 * 네이티브 모듈이므로 Expo Go에서는 동작하지 않는다. 개발/시뮬레이터에서 화면 로직을
 * 검증할 때는 MockOcrEngine을 쓴다(엔진 선택은 ./index 참고).
 */
export class VisionOcrEngine implements OcrEngine {
  async recognize(uri: string): Promise<OcrResult> {
    const lines = await recognizeText(toFileUri(uri));
    // Apple Vision은 줄 단위 신뢰도만 제공하고 전체 신뢰도 개념이 없어 confidence는 생략(undefined).
    return { text: lines.join('\n') };
  }
}

/**
 * 현재 기기에서 온디바이스 OCR을 실행할 수 있는지 여부.
 * 네이티브 모듈 부재(Expo Go)·미지원 환경에서는 false를 돌려 Mock으로 폴백하게 한다.
 */
export function isVisionAvailable(): boolean {
  return isAvailable;
}
