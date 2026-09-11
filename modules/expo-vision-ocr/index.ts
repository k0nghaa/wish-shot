import { requireOptionalNativeModule } from 'expo-modules-core';

// 네이티브 모듈이 없으면(Expo Go·미빌드) null. import 시점에 throw하지 않도록 optional 사용.
const ExpoVisionOcr = requireOptionalNativeModule<{
  isSupported: boolean;
  recognizeText: (uri: string) => Promise<string[]>;
}>('ExpoVisionOcr');

/** 현재 기기에서 온디바이스 OCR을 실행할 수 있는지(네이티브 모듈 존재 여부). */
export const isAvailable: boolean = ExpoVisionOcr != null;

/**
 * 로컬 이미지 uri에서 Apple Vision으로 텍스트를 인식한다(iOS, 온디바이스).
 * 한국어·영어를 함께 인식한다(recognitionLanguages = ["ko-KR", "en-US"]).
 * @returns 인식된 텍스트 줄 배열. 네이티브 모듈이 없으면 throw.
 */
export async function recognizeText(uri: string): Promise<string[]> {
  if (!ExpoVisionOcr) {
    throw new Error('ExpoVisionOcr 네이티브 모듈을 사용할 수 없어요(개발 빌드 필요).');
  }
  return ExpoVisionOcr.recognizeText(uri);
}
