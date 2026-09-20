// SDK 57 부터 top-level 의 getAssetsAsync/getAssetInfoAsync 는 deprecated 라 런타임 에러를 던진다.
// 자산 조회는 legacy 서브패스에서 가져온다(권한·상수·타입 모두 여기 포함). 근거: 배포 경고 메시지 + docs.
import * as MediaLibrary from 'expo-media-library/legacy';

/**
 * 사진 앨범 접근 유틸(기능 1·2 공용). 네이티브 준비는 Batch A(expo-media-library)에서 끝났고,
 * 이 파일은 순수 JS 다(재빌드 없음).
 *
 * - `getRecentPhotoAsset`(Batch B): "방금 캡처한 사진" 제안용 최근 1장 읽기.
 * - `deletePhotoAsset`(Batch C): 앱 내에서 고른 원본 스크린샷을 앨범에서 삭제.
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
  if (__DEV__) {
    console.log('[WishShot/photo] permission', {
      granted: perm.granted,
      status: perm.status,
      accessPrivileges: perm.accessPrivileges,
      canAskAgain: perm.canAskAgain,
    });
  }
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
    if (__DEV__) {
      console.log('[WishShot/photo] getAssetsAsync', {
        totalCount: page.totalCount,
        returned: page.assets.length,
        firstUri: asset?.uri,
        firstMediaType: asset?.mediaType,
      });
    }
    if (!asset) return null;
    // ph:// → 읽을 수 있는 localUri(file://). 실패하면 원 uri 로 폴백(방어적).
    const info = await MediaLibrary.getAssetInfoAsync(asset).catch((e) => {
      if (__DEV__) console.warn('[WishShot/photo] getAssetInfoAsync 실패', e);
      return null;
    });
    if (__DEV__) console.log('[WishShot/photo] localUri', { localUri: info?.localUri, fallback: !info?.localUri });
    return { uri: info?.localUri ?? asset.uri, assetId: asset.id };
  } catch (e) {
    // 자산 조회 실패는 제안을 감출 뿐 저장 흐름과 무관하다.
    if (__DEV__) console.warn('[WishShot/photo] getAssetsAsync 실패', e);
    return null;
  }
}

/**
 * 앱 내에서 고른 원본 스크린샷을 아이폰 앨범에서 삭제한다(기능 2, 앱 내 picker 경로 한정).
 *
 * - **전체 접근이 필수**다. 제한 접근(`limited`)이면 특정 자산을 삭제할 수 없고, 앨범 단위 권한은
 *   iOS 에 없다 → 전체 접근이 아니면 `'denied'` 로 돌려 호출부가 안내하게 한다.
 *   권한은 `requestPermissionsAsync()`(writeOnly 기본 false = read-write)로 요청한다
 *   (writeOnly=true 는 "추가"만 허용해 삭제 불가라 넘기지 않는다).
 * - iOS 는 실제 삭제 시 **시스템 "사진 삭제?" 확인창을 강제로 띄운다**(억제 불가). 사용자가
 *   확인해야 실제로 지워진다. 우리 앱은 별도 "정말 삭제?" 창을 또 띄우지 않는다(HIG).
 * - 사용자가 시스템 확인창에서 취소하면 `deleteAssetsAsync` 가 `false` 를 돌려주며(또는 throw),
 *   여기서는 `'error'` 로 매핑한다 — 위시는 이미 저장돼 있어 호출부가 조용히 넘기도록 한다.
 *
 * 근거: Expo Media Library https://docs.expo.dev/versions/latest/sdk/media-library/ ,
 * Apple `PHAssetChangeRequest.deleteAssets` https://developer.apple.com/documentation/photos/phassetchangerequest
 *
 * @returns `'deleted'` 삭제 성공 · `'denied'` 전체 접근 아님(권한) · `'error'` 취소/실패
 */
export async function deletePhotoAsset(assetId: string): Promise<'deleted' | 'denied' | 'error'> {
  // 이미 전체 접근이면 프롬프트 없이 통과, 아니면 이 시점에만 전체(read-write) 접근을 요청한다.
  let perm = await MediaLibrary.getPermissionsAsync();
  if (perm.accessPrivileges !== 'all') perm = await MediaLibrary.requestPermissionsAsync();
  if (__DEV__) {
    console.log('[WishShot/photo] delete permission', {
      granted: perm.granted,
      status: perm.status,
      accessPrivileges: perm.accessPrivileges,
      canAskAgain: perm.canAskAgain,
    });
  }
  // 전체 접근이 아니면 특정 자산 삭제 불가 → 호출부가 "전체 접근 필요"를 안내한다.
  if (perm.accessPrivileges !== 'all') return 'denied';

  try {
    // 여기서 iOS 시스템 "사진 삭제?" 확인창이 뜬다. 사용자가 확인해야 true, 취소하면 false.
    const ok = await MediaLibrary.deleteAssetsAsync([assetId]);
    if (__DEV__) console.log('[WishShot/photo] deleteAssetsAsync', { ok });
    return ok ? 'deleted' : 'error';
  } catch (e) {
    // 취소·실패 모두 여기로 올 수 있다. 위시는 이미 저장됐으므로 조용히 넘긴다.
    if (__DEV__) console.warn('[WishShot/photo] deleteAssetsAsync 실패', e);
    return 'error';
  }
}
