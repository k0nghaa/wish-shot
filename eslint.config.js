// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  // 계측·오류 수집 SDK 는 캡슐화 모듈만 import 한다(콘텐츠 미수집 필터를 우회하지 않게).
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/analytics.ts', 'src/lib/monitoring.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@sentry/react-native', message: 'src/lib/monitoring.ts 를 거쳐 사용한다.' },
            { name: 'posthog-react-native', message: 'src/lib/analytics.ts 를 거쳐 사용한다.' },
          ],
        },
      ],
    },
  },
]);
