import * as MediaLibrary from 'expo-media-library';

/**
 * 사진 앨범 접근 유틸(기능 1·2 공용). 네이티브 준비는 Batch A(expo-media-library)에서 끝났고,
 * 이 파일은 순수 JS 다(재빌드 없음).
 *
 * - `getRecentPhotoAsset`(Batch B): "방금 캡처한 사진" 제안용 최근 1장 읽기.
 * - `deletePhotoAsset`(Batch C): 앨범 원본 삭제 — 이 파일에 별도 추가 예정. 여기서는 만들지 않는다.
 */

/**
 * 최근 사진 1장의 읽을 수 있는 로컬 uri 와 자산 id 를 돌려준다("방금 캡처한 사진" 제안, 기능 1).
 *
 * iOS 자산 uri 는 `ph://…` 라 `expo-file-system` 으로 바로 못 읽는다 → `getAssetInfoAsync` 의
 * `localUri`(file://)를 확보해 반환한다. 이 uri 로 기존 OCR·업로드 파이프라인이 그대로 돈다.
 *
 * 권한은 이 기능을 실제로 쓸 때만 요청한다(HIG 적시 요청). 이미 허용돼 있으면 프롬프트 없이 진행하고,
 * 거부·제한이거나 사진이 없으면 `null` 을 돌려 호출부가 제안을 감춘다.
 *
 * 근거: Expo Media Library — https://docs.expo.dev/versions/latest/sdk/media-library/
 */
export async function getRecentPhotoAsset(): Promise<{ uri: string; assetId: string } | null> {
  // 이미 허용됐으면 프롬프트 없이 통과, 아니면 이 시점에만 요청한다.
  let perm = await MediaLibrary.getPermissionsAsync();
  if (!perm.granted) perm = await MediaLibrary.requestPermissionsAsync();
  if (!perm.granted) return null;

  try {
    // AssetsOptions 를 함수 시그니처에서 뽑아 문맥 타입으로 쓴다(legacy SortBy/MediaType 상수가
    // top-level 에서 Next 버전에 가려져 안 보이므로, 문자열 리터럴을 그대로 넘긴다).
    const options: NonNullable<Parameters<typeof MediaLibrary.getAssetsAsync>[0]> = {
      first: 1,
      mediaType: 'photo',
      // 생성 시각 내림차순(ascending=false) = 가장 최근에 담긴 사진 먼저.
      sortBy: [['creationTime', false]],
    };
    const page = await MediaLibrary.getAssetsAsync(options);
    const asset = page.assets[0];
    if (!asset) return null;
    // ph:// → 읽을 수 있는 localUri(file://). 실패하면 원 uri 로 폴백(방어적).
    const info = await MediaLibrary.getAssetInfoAsync(asset).catch(() => null);
    return { uri: info?.localUri ?? asset.uri, assetId: asset.id };
  } catch {
    // 자산 조회 실패는 제안을 감출 뿐 저장 흐름과 무관하다.
    return null;
  }
}
