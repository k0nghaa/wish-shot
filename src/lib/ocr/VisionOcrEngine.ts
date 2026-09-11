import { extractTextFromImage, isSupported } from 'expo-text-extractor';

import { toFileUri } from '@/lib/imageBytes';

import type { OcrEngine, OcrResult } from './OcrEngine';

/**
 * expo-text-extractor 기반 온디바이스 OCR 엔진.
 *
 * - iOS: Apple Vision(OS 내장, 온디바이스) — 현재 앱은 iOS 전용이라 이 경로만 탄다.
 * - Android: Google ML Kit (이후 Android 지원 시).
 *
 * 네이티브 모듈이므로 Expo Go에서는 동작하지 않는다. 개발/시뮬레이터에서 화면 로직을
 * 검증할 때는 MockOcrEngine을 쓴다(엔진 선택은 ./index 참고).
 */
export class VisionOcrEngine implements OcrEngine {
  async recognize(uri: string): Promise<OcrResult> {
    const lines = await extractTextFromImage(toFileUri(uri));
    // Apple Vision(이 래퍼)은 신뢰도를 제공하지 않으므로 confidence는 생략(undefined).
    return { text: lines.join('\n') };
  }
}

/**
 * 현재 기기에서 온디바이스 OCR을 실행할 수 있는지 여부.
 * 네이티브 모듈 부재(Expo Go)·미지원 OS에서는 false를 돌려 Mock으로 폴백하게 한다.
 */
export function isVisionAvailable(): boolean {
  try {
    return isSupported === true;
  } catch {
    return false;
  }
}
