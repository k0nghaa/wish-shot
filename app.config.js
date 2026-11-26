// 앱 변형(Expo "multiple app variants").
// app.json이 운영(스토어) 설정의 정본이다. APP_VARIANT가 없으면 운영 설정에 카카오 로그인 설정만 더한다.
// APP_VARIANT=development일 때만 개발용 앱 식별자를 덮어써서 스토어 앱과 한 기기에 나란히 설치한다.
// - scheme도 바꾼다: expo-share-intent의 공유 확장은 config.scheme으로 본 앱을 연다.
// - App Group(group.<번들ID>)과 확장 번들 ID(<번들ID>.share-extension)는 플러그인이 번들 ID에서 만든다.
//   직접 적어 둔 appExtensions 블록(정확히 1개)만 같은 규칙으로 맞춘다.
//
// 카카오 로그인: 네이티브 앱 키(공개 값)를 변형마다 다른 환경 변수로 받는다 — 운영 EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY,
// 개발 EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY_DEV. 카카오톡에서 kakao<앱 키>:// 로 돌아오므로 운영·개발 앱이 같은 키를
// 쓰면 같은 scheme 이 돼 어느 앱이 열릴지 알 수 없다(그래서 개발용 카카오 앱을 따로 둔다). 키는 extra.kakaoNativeAppKey 로도
// 내려 앱이 카카오 SDK 를 초기화할 때 쓴다. 키는 runtimeVersion(fingerprint)에 들어가므로, OTA(eas update)를 낼 때도
// 같은 환경 변수가 있는 환경에서 낸다.
const IS_DEV = process.env.APP_VARIANT === 'development';

const DEV_BUNDLE_ID = 'com.k0nghaa.wishshot.dev';

function withKakao(config) {
  const nativeAppKey = (
    IS_DEV ? process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY_DEV : process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY
  )?.trim();
  if (!nativeAppKey) {
    // EAS 빌드는 키 없이 만들지 않는다(카카오 로그인이 빠진 앱이 나가는 것을 막는다). 로컬 명령(lint·tsc 등)은 통과시킨다.
    if (process.env.EAS_BUILD) {
      throw new Error(
        `app.config.js: ${IS_DEV ? 'EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY_DEV' : 'EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY'}가 없습니다(EAS 환경 변수에 등록).`,
      );
    }
    return config;
  }
  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      ['@react-native-kakao/core', { nativeAppKey, ios: { handleKakaoOpenUrl: true } }],
    ],
    extra: { ...config.extra, kakaoNativeAppKey: nativeAppKey },
  };
}

module.exports = ({ config }) => {
  if (!IS_DEV) return withKakao(config);

  const appExtensions = config.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [];
  if (appExtensions.length !== 1) {
    throw new Error(
      `app.config.js: appExtensions는 정확히 1개여야 합니다(현재 ${appExtensions.length}개).`,
    );
  }

  return withKakao({
    ...config,
    name: 'WishShot Dev',
    scheme: 'wishshot-dev',
    ios: { ...config.ios, bundleIdentifier: DEV_BUNDLE_ID },
    extra: {
      ...config.extra,
      eas: {
        ...config.extra.eas,
        build: {
          ...config.extra.eas.build,
          experimental: {
            ...config.extra.eas.build.experimental,
            ios: {
              ...config.extra.eas.build.experimental.ios,
              appExtensions: [
                {
                  ...appExtensions[0],
                  bundleIdentifier: `${DEV_BUNDLE_ID}.share-extension`,
                  entitlements: {
                    ...appExtensions[0].entitlements,
                    'com.apple.security.application-groups': [`group.${DEV_BUNDLE_ID}`],
                  },
                },
              ],
            },
          },
        },
      },
    },
  });
};
