import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { toFileUri } from './imageBytes';

/**
 * 이미지 egress·저장 최적화(Phase 9 B·D). 저장 시점에만 축소·압축한다 —
 * OCR·AI 분석·원본 확대 보기는 사용자가 고른 원본 uri 를 그대로 쓴다(품질 저하 금지).
 *
 * 리사이즈 관용구는 RegionSelectSheet(제품 영역 크롭)와 동일하다: 긴 변 기준 축소, 업스케일 금지.
 * manipulateAsync 는 로컬 file:// 뿐 아니라 원격 https URL 도 입력으로 받는다(D 백필에서 활용).
 */
async function downscaleToJpeg(uri: string, maxEdge: number, compress: number): Promise<string> {
  const file = toFileUri(uri);
  // 빈 액션으로 한 번 통과시켜 원본 크기를 잰다(리사이즈 필요 여부·기준 변 판정용).
  const probe = await manipulateAsync(file, [], { format: SaveFormat.JPEG });
  const longest = Math.max(probe.width, probe.height);
  const actions =
    longest > maxEdge
      ? [probe.width >= probe.height ? { resize: { width: maxEdge } } : { resize: { height: maxEdge } }]
      : []; // 이미 작으면 업스케일하지 않는다(품질·용량 낭비 방지)
  const out = await manipulateAsync(file, actions, { compress, format: SaveFormat.JPEG });
  return out.uri;
}

/** 원본 업로드용: 긴 변 ≤1600px · JPEG q0.8. 항상 JPEG 로 저장한다. */
export async function compressForUpload(uri: string): Promise<{ uri: string; contentType: string }> {
  return { uri: await downscaleToJpeg(uri, 1600, 0.8), contentType: 'image/jpeg' };
}

/** 그리드 썸네일용: 긴 변 ≤400px · JPEG q0.6. 이미 축소된 원본에서 만들면 디코드가 싸다. */
export async function makeThumbnail(uri: string): Promise<string> {
  return downscaleToJpeg(uri, 400, 0.6);
}
