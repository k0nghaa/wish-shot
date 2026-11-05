// Expo 기본 Metro 설정 + Sentry(번들·소스맵 Debug ID, LogBox 프레임 접기).
// annotateReactComponents 는 쓰지 않는다(기본 false) — Babel 변환기를 바꾸지 않아 React Compiler·reanimated 설정이 그대로다.
// https://docs.sentry.io/platforms/react-native/manual-setup/expo/
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
