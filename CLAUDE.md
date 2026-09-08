# CLAUDE.md

이 파일은 이 저장소에서 작업하는 Claude Code에게 제공하는 가이드입니다.

> **⚠️ 전환기 문서**: 이 저장소는 웹(Vite + Express + SQLite)에서 **iOS 네이티브 앱(Expo + Supabase)** 으로 전환 중입니다. 아래 내용은 전환 작업 기간 동안의 기준이며, Phase 1이 끝나면 실제 구조를 반영해 다시 씁니다. 아직 존재하지 않는 파일·명령어를 이 문서가 있다고 말하지 않도록 유지하세요.

## 프로젝트 개요

WishShot(위시샷)은 스크린샷으로 저장한 관심 제품을 카테고리별 개인 위시리스트로 관리하는 **iOS 앱**입니다. 홈 화면 아이콘으로 여는 일반 앱이 본체이며, iOS 공유 시트(Share Extension)에서 스크린샷을 바로 받아 등록하는 진입 경로를 갖습니다. 웹 버전은 목표에서 제외되었습니다.

- 제품 요구사항: 노션 「WishShot — 스크린샷으로 시작되는 개인 위시리스트」(v1 PRD, v2 PRD 작성 중)
- 기술 결정: 노션 「WishShot v2 — 플랫폼·아키텍처 결정 문서 (Expo + Supabase)」
- 현재 작업 지시서: `docs/phases/phase-1-toolchain.md`

## 현재 상태

- `web-v0` 태그: 옛 웹 코드(Vite SPA + Express + SQLite)의 보존점. 참고가 필요하면 `git show web-v0:<path>`로 읽는다. 이 코드를 되살리거나 수정하지 않는다.
- `refactor/architecture` 브랜치: 폐기된 Next.js 마이그레이션 시도. 병합하지 않는다.
- `docs/archive/`: 폐기된 계획(Next.js 아키텍처 문서, seed YAML)과 재사용 예정 자산(`migrate-sqlite-to-supabase.ts`, v1 로고). **참고용이며 지시가 아니다.** 특히 `nextjs-migration-seeds/`의 Round 2·3은 수행 대상이 아니다.
- 루트: Phase 1 진행에 따라 Expo 프로젝트가 생성된다. 생성 전에는 앱 코드가 없는 것이 정상이다.

## 목표 아키텍처 (Phase 1~4에 걸쳐 도달)

- **앱**: Expo(React Native) + Expo Router + TypeScript. iOS 우선.
- **백엔드**: 별도 서버 없음. `@supabase/supabase-js`로 Supabase(Postgres + Storage + Auth)를 직접 호출하고, 행 단위 권한은 RLS로 강제. API 키가 필요한 LLM 정제만 Supabase Edge Function 1개.
- **OCR**: 온디바이스(Google ML Kit). `OcrEngine` 인터페이스 뒤에 캡슐화 (Phase 3).
- **빌드**: 윈도우 PC에서 EAS 클라우드 빌드 → 아이폰 개발 빌드 → TestFlight. 로컬에 Xcode/Mac 없음.

## 작업 규칙

1. **Next.js·Express·Vite를 도입하지 않는다.** 서버가 필요해 보이면 Supabase Edge Function 또는 DB 함수로 해결하고, 그것도 애매하면 사람에게 묻는다.
2. **비밀 값은 앱에 넣지 않는다.** 앱에는 Supabase `anon` 키만. `service_role` 키, Claude API 키는 Edge Function 환경 변수에만 존재한다. `.env*`는 커밋 금지, `.env.example`만 커밋.
3. **네이티브 의존성 변경은 재빌드를 의미한다.** 네이티브 모듈(config plugin이 있는 패키지)을 추가·제거·업그레이드하면 EAS 재빌드가 필요하다. 지시서에 정해진 시점에 모아서 추가하고, 임의로 추가하지 않는다. JS 전용 패키지는 자유.
4. **모든 사용자 노출 문자열은 한국어.** 에러 메시지, 라벨, 플레이스홀더, 접근성 라벨 포함. 기존 톤("~예요/~해요" 체, 예: "제품명은 필수예요.") 유지.
5. **디자인 토큰을 쓴다.** 색상은 `constants/theme.ts`의 시맨틱 토큰(`primary`, `accent`, `error`, `textMain`, `textSub`, `textDisabled`, `bgCard`, `silver` 등 — v1 팔레트 승계: 세이지 그린 / 테라코타 / 실버 그레이)만 사용. 컴포넌트에 원시 hex를 직접 쓰지 않는다.
6. **모르면 만들어내지 않는다.** 패키지 버전·Expo SDK 호환·EAS 설정 필드가 불확실하면 공식 문서를 확인하거나 사람에게 묻는다. 아이폰 설치·공유 시트 동작은 에이전트가 검증할 수 없으므로 "확인해달라"고 명시적으로 요청한다.
7. **커밋 메시지는 기존 컨벤션**: `feat:`, `fix:`, `chore:`, `docs:`, `style:`, `refactor:`, `test:` + 한국어 요약.
8. **문서를 현실에 맞춘다.** 구조나 명령어가 바뀌면 이 파일과 `README.md`를 같은 커밋에서 갱신한다.

## 명령어

Phase 1 Step 2 이후 사용 가능. 그 전에는 실행할 것이 없다.

- `npx expo start` — 개발 서버 (Step 4 전까지는 Expo Go로 접속 가능)
- `npx expo start --dev-client` — 개발 빌드가 설치된 아이폰으로 접속 (Step 5 이후)
- `npx tsc --noEmit` — 타입 체크
- `npx expo lint` — ESLint
- `npx prettier --write .` — 포맷
- `npx eas build --platform ios --profile development` — 개발 빌드 (Apple 인증 프롬프트가 있으므로 사람이 실행)

## 데이터 흐름 (목표)

```
[iOS 공유 시트 / 앱 내 사진 선택]
  → Expo 앱 → OcrEngine(ML Kit, 온디바이스) → Edge Function(LLM 정제) → 폼 자동채움
  → supabase-js → Supabase Postgres (RLS) / Storage (private, signed URL)
```

Phase 1에서는 이 중 **Auth 로그인과 공유 시트 수신 확인**까지만 구현한다.