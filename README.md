# WishShot (위시샷)

스크린샷으로 저장한 관심 제품을 카테고리별 개인 위시리스트로 관리하는 **iOS 앱**입니다. iOS 공유 시트에서 스크린샷을 바로 받아 등록하는 진입 경로를 갖습니다.

> **v2 전환 안내**: 이 저장소는 웹(Vite + Express + SQLite)에서 **iOS 네이티브 앱(Expo + Supabase)** 으로 전환되었습니다. 옛 웹 코드는 `web-v0` 태그에 보존돼 있습니다 (`git show web-v0:<path>`). 현재 `main`/`dev`은 Expo 앱입니다.

## 기술 스택

- **앱**: Expo SDK 57 (React Native) + Expo Router + TypeScript, iOS 우선
- **백엔드**: Supabase (Postgres + Storage + Auth), `@supabase/supabase-js`로 직접 호출 + RLS
- **공유 시트**: `expo-share-intent` (iOS Share Extension)
- **빌드**: EAS 클라우드 빌드 (Windows PC + Mac 없이 iOS 개발)

## 로컬 실행

사전 준비: Node.js LTS, git. Supabase 프로젝트의 URL·anon 키.

```bash
# 1) 의존성 설치
npm install

# 2) 환경 변수 설정
cp .env.example .env
#   .env 에 EXPO_PUBLIC_SUPABASE_URL 과 EXPO_PUBLIC_SUPABASE_ANON_KEY 입력

# 3) 개발 서버 (이 환경은 --tunnel 필수)
npx expo start --tunnel            # Expo Go 로 접속 (네이티브 모듈 없는 화면 확인용)
npx expo start --dev-client --tunnel  # 개발 빌드가 설치된 아이폰으로 접속
```

- `expo-share-intent` 등 네이티브 모듈은 Expo Go에서 동작하지 않습니다. 공유 시트까지 확인하려면 EAS 개발 빌드가 설치된 실기기가 필요합니다.
- `.env` 변경 후에는 `npx expo start --clear`로 재시작해야 반영됩니다.

## 자주 쓰는 명령어

| 명령어 | 용도 |
|---|---|
| `npx tsc --noEmit` | 타입 체크 |
| `npx expo lint` | ESLint |
| `npx expo-doctor` | 설정·의존성 정합성 점검 |
| `npx eas-cli build --platform ios --profile development` | 개발 빌드 (Apple 인증 필요, 사람이 실행) |

## 문서

- 아키텍처·플랫폼 결정: 노션 「WishShot v2 — 플랫폼·아키텍처 결정 문서 (Expo + Supabase)」
- Phase 1 작업 기록: [`docs/phases/phase-1-toolchain.md`](docs/phases/phase-1-toolchain.md)
- 저장소 작업 규칙: [`CLAUDE.md`](CLAUDE.md)
