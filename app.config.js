// 앱 변형(Expo "multiple app variants").
// app.json이 운영(스토어) 설정의 정본이다. APP_VARIANT가 없으면 그대로 돌려준다.
// APP_VARIANT=development일 때만 개발용 앱 식별자를 덮어써서 스토어 앱과 한 기기에 나란히 설치한다.
// - scheme도 바꾼다: expo-share-intent의 공유 확장은 config.scheme으로 본 앱을 연다.
// - App Group(group.<번들ID>)과 확장 번들 ID(<번들ID>.share-extension)는 플러그인이 번들 ID에서 만든다.
//   직접 적어 둔 appExtensions 블록(정확히 1개)만 같은 규칙으로 맞춘다.
const IS_DEV = process.env.APP_VARIANT === 'development';

const DEV_BUNDLE_ID = 'com.k0nghaa.wishshot.dev';

module.exports = ({ config }) => {
  if (!IS_DEV) return config;

  const appExtensions = config.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [];
  if (appExtensions.length !== 1) {
    throw new Error(
      `app.config.js: appExtensions는 정확히 1개여야 합니다(현재 ${appExtensions.length}개).`,
    );
  }

  return {
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
  };
};
