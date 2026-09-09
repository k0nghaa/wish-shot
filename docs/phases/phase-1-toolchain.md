# Phase 1 — 툴체인 확정 (Expo + Supabase + EAS)

> **이 문서 사용법**: Claude Code에 이 파일 전체를 컨텍스트로 넘기고 "Step N을 진행해달라"고 요청한다. Step은 순서대로 진행한다. 각 Step의 **DoD(Definition of Done)** 를 사람이 확인한 뒤 다음 Step으로 넘어간다. 아이폰 설치·동작 확인은 에이전트가 검증할 수 없으므로 사람이 직접 한다.
>
> 관련 문서: 노션 「WishShot v2 — 플랫폼·아키텍처 결정 문서 (Expo + Supabase)」 → 이 Phase는 그 문서 6장의 Phase 1이다.

---

## 목표 (Goal)

WishShot 레포를 웹(Vite + Express + SQLite) 상태에서 **iOS 네이티브 앱(Expo) + Supabase** 구조로 전환하기 위한 툴체인을 확정한다. 이 Phase가 끝나면 "윈도우 PC에서 코드 수정 → 아이폰에 설치된 개발 빌드에 즉시 반영"되는 개발 루프와, Supabase 로그인이 동작하는 빈 앱이 존재한다.

**이 Phase에서 만들지 않는 것**: 실제 화면(카테고리/목록/상세/업로드), OCR, LLM 정제, 데이터 이관. 이건 Phase 2~4.

---

## 사전 조건 (사람이 준비)

- [x] Apple Developer Program 계정 (보유)
- [x] Expo 계정 (expo.dev, 무료) — EAS 빌드에 필요
- [x] Supabase 계정 (supabase.com, 무료)
- [x] 윈도우 PC: Node.js LTS, git
- [x] iPhone: 실기기. Apple ID로 로그인된 상태
- [x] 아이폰과 PC가 같은 Wi-Fi (개발 서버 접속용)

---

## 제약 (Constraints) — 에이전트가 반드시 지킬 것

1. **웹 코드를 "수정"하지 않는다. 삭제한다.** `src/`, `backend/`, `index.html`, `vite.config.ts`, `tsconfig.app.json`, `tsconfig.node.json`, `src/App.css` 등 Vite/Express 관련 파일은 Step 1에서 태그로 보존한 뒤 제거한다. 살릴 파일 목록은 Step 1에 명시.
2. **Next.js 관련 작업을 하지 않는다.** `refactor/architecture` 브랜치는 병합하지 않고 그대로 둔다. `docs/seeds/*.yaml`은 폐기된 Next.js 마이그레이션 계획이며 참고용 아카이브다.
3. **네이티브 의존성은 Step 4에서 한 번에 추가한다.** 네이티브 모듈(`expo-share-intent` 등)은 추가·변경마다 EAS 재빌드가 필요하므로, Step 5의 첫 빌드 전에 모두 넣는다. Step 5 이후 이 Phase 안에서는 네이티브 의존성을 추가하지 않는다.
4. **Supabase는 `supabase-js`로 직접 호출한다.** 별도 API 서버, Next.js, Express를 만들지 않는다. 서비스 롤 키(service_role)는 앱에 절대 넣지 않는다 — 앱에는 `anon` 키만.
5. **모든 사용자 노출 문자열(에러, 라벨)은 한국어.** 기존 컨벤션 유지.
6. **디자인 토큰 승계.** 기존 `src/index.css`의 `@theme` 팔레트(세이지 그린 primary, 테라코타 accent, 실버 그레이 뉴트럴, `text-main`/`text-sub`/`text-disabled`/`bg-card`/`silver`/`primary`/`accent`/`error`)를 삭제 전에 값을 추출해 `constants/theme.ts`(또는 동등한 위치)에 옮긴다. 원시 색상값을 컴포넌트에 직접 쓰지 않는다.
7. **비밀 값은 커밋하지 않는다.** `.env*`는 `.gitignore`에, `.env.example`만 커밋.
8. **모르면 만들어내지 않는다.** 패키지 버전, Expo SDK 호환성, EAS 설정 필드가 불확실하면 공식 문서를 확인하거나 사람에게 묻는다. 특히 `expo-share-intent`의 현재 Expo SDK 호환 버전은 착수 시 확인 필수.

---

## Step 1 — 레포 정리

**작업**
1. `dev` 브랜치 최신 커밋에 태그 `web-v0` 생성 및 push. (옛 웹 코드의 영구 보존점)
2. `dev`에서 새 브랜치 `v2/expo` 생성.
3. 다음 파일/디렉터리를 **보존**한다 (나머지 웹 코드는 삭제):
   - `docs/architecture-plan.md` → `docs/archive/architecture-plan-nextjs.md`로 이동 (상단에 "폐기됨, 노션 v2 결정 문서로 대체" 1줄 추가)
   - `docs/seeds/` → `docs/archive/nextjs-migration-seeds/`로 이동
   - `docs/e2e-checklist.md` → `docs/archive/`로 이동 (refactor/architecture 브랜치에만 있으면 생략)
   - `.github/` (이슈·PR 템플릿) 그대로
   - `.prettierrc`, `.gitignore`(내용은 Step 2에서 Expo 기준으로 갱신)
   - `src/assets/` (로고·파비콘 SVG) → 임시로 `docs/archive/assets-v1/`에 보관 (Step 2에서 Expo `assets/`로 필요한 것만 이동)
   - `src/index.css`의 `@theme` 색상값 → 삭제 전 값을 기록해 Step 2에서 `constants/theme.ts`로 옮긴다
   - `scripts/migrate.ts`는 `refactor/architecture` 브랜치에만 있음. `git show origin/refactor/architecture:scripts/migrate.ts > docs/archive/migrate-sqlite-to-supabase.ts`로 보관 (Phase 4에서 개조)
4. 나머지 전부 삭제: `src/`, `backend/`, `index.html`, `vite.config.ts`, `tsconfig*.json`, `eslint.config.js`, `package.json`, `package-lock.json`, `README.md`(Step 6에서 재작성).
5. `CLAUDE.md`를 전환기 버전으로 교체 (별도 파일 `CLAUDE.md` 제공됨).
6. 커밋: `chore: v2 전환 — 웹 코드 제거 (web-v0 태그로 보존), 문서 아카이브`

**DoD**
- [x] `git tag` 에 `web-v0` 존재, 원격에 push됨
- [x] `v2/expo` 브랜치에 웹 소스 없음, `docs/archive/` 에 위 파일들 존재
- [x] `CLAUDE.md`가 전환기 버전 (Step 6에서 실제 구조 반영 버전으로 갱신됨)

---

## Step 2 — Expo 프로젝트 생성

**작업**
1. 레포 루트에서 Expo 프로젝트 생성 (TypeScript, **Expo Router** 템플릿). 현재 디렉터리에 생성해야 하므로 빈 디렉터리에 생성 후 파일을 루트로 옮기는 방식도 허용.
2. `app.json`(또는 `app.config.ts`) 기본값 설정:
   - `name`: `WishShot`, `slug`: `wish-shot`
   - `ios.bundleIdentifier`: 사람이 정한 값 (예: `com.<본인식별자>.wishshot`) — **사람에게 확인**
   - `scheme`: `wishshot` (딥링크·share-intent용)
   - `ios.supportsTablet`: false
3. 디렉터리 골격 (빈 파일/플레이스홀더 허용):
   ```
   app/               # Expo Router 라우트
     _layout.tsx
     index.tsx         # 임시 홈: "WishShot v2" 텍스트 + 로그아웃 버튼 (Step 3에서 연결)
     login.tsx         # Step 3
   constants/theme.ts  # Step 1에서 추출한 색상 토큰
   lib/supabase.ts     # Step 3
   assets/             # 아이콘·스플래시 (Step 1 보관분에서 로고 가져와 앱 아이콘 초안으로)
   ```
4. Prettier 설정 유지, ESLint는 Expo 기본(`npx expo lint`)으로.
5. `.gitignore`를 Expo 기준으로 갱신 (`.expo/`, `ios/`, `android/`, `.env*` 포함, `!.env.example`).
6. 윈도우에서 `npx expo start` 실행 → 아이폰 **Expo Go**로 QR 접속해 임시 홈 화면 확인. (Expo Go는 Step 4 이후엔 못 쓰지만, 이 단계에서 JS 번들·네트워크 경로가 정상인지 확인하는 용도)
7. 커밋: `chore: Expo 프로젝트 초기 세팅 (Expo Router, 디자인 토큰 이식)`

**DoD**
- [x] `npx expo start` → Expo Go에서 홈 화면 렌더링 (이 환경은 `--tunnel` 필요)
- [x] `constants/theme.ts`에 v1 색상 토큰이 이름 그대로 존재 (`src/constants/theme.ts`)
- [x] `npx tsc --noEmit` 통과

> 참고: SDK 57 기본 템플릿이 `src/` 구조라 라우트를 `src/app/`에 두기로 결정. bundleIdentifier `com.k0nghaa.wishshot`.

---

## Step 3 — Supabase 프로젝트 + Auth

**사람이 하는 것**
- Supabase 대시보드에서 프로젝트 생성 (리전: Northeast Asia/Seoul 권장). Project URL, `anon` key를 확보해 에이전트에게 `.env` 값으로 전달 (채팅에 붙이지 말고 `.env` 파일에 직접 입력 권장).
- Authentication → Providers: **Email** 활성화. "Confirm email"은 이 Phase에선 꺼도 됨 (본인 1명).
- Authentication → Users에서 **본인 계정 1개를 수동 생성** (이메일 + 비번). 가입 화면은 만들지 않는다.

**에이전트가 하는 것**
1. `@supabase/supabase-js` 설치. 세션 저장용으로 Expo 환경에 맞는 스토리지 어댑터 설정 (Supabase 공식 Expo 가이드의 방식을 따른다 — `expo-secure-store` 또는 `@react-native-async-storage/async-storage`; 공식 문서 확인 후 선택. 이것도 네이티브 의존성이므로 Step 4 빌드 전에 확정).
2. `lib/supabase.ts`: 클라이언트 생성. URL/키는 `process.env.EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`에서 읽음. `.env.example` 커밋.
3. `app/login.tsx`: 이메일 + 비밀번호 입력 → `signInWithPassword`. 에러 메시지 한국어. 가입 링크 없음.
4. `app/_layout.tsx`: 세션 유무로 `/login` ↔ `/` 라우팅 가드 (`onAuthStateChange` 구독).
5. `app/index.tsx`: 로그인된 이메일 표시 + 로그아웃 버튼.
6. DB 스키마는 **이 Phase에서 만들지 않는다.** (Phase 2 시작 시 "계약" 확정 후 마이그레이션 SQL로 생성.) 단, Supabase CLI 초기화(`supabase init`)로 `supabase/` 디렉터리만 만들어 두는 것은 허용.
7. 커밋: `feat: Supabase Auth 이메일 로그인 + 라우팅 가드`

**DoD**
- [x] Expo Go에서 로그인 → 홈(이메일 표시) → 로그아웃 → 로그인 화면 왕복 동작
- [x] 앱 재시작 후 세션 유지됨 (AsyncStorage)
- [x] `.env`는 커밋되지 않았고 `.env.example`은 있음

> 세션 스토리지 어댑터: `@react-native-async-storage/async-storage` (Supabase 공식 퀵스타트 방식).

---

## Step 4 — 네이티브 의존성 일괄 추가

**작업**
1. `expo-share-intent` 설치 + config plugin을 `app.json`에 등록. iOS 활성화 규칙은 **이미지 1개 수신**(`NSExtensionActivationSupportsImageWithMaxCount: 1`)을 최소로. 텍스트/URL은 이 Phase에선 비활성.
   - 라이브러리 README의 Expo Router 통합 절(`+native-intent.ts` 또는 Layout 처리)을 따른다.
   - 현재 Expo SDK와 호환되는 버전을 **먼저 확인**. 불일치면 사람에게 보고.
2. `app/_layout.tsx`에 share intent 수신 훅 연결. 수신 시 임시로 `app/share.tsx` 화면으로 이동해 받은 파일의 `path`, `mimeType`을 텍스트로 표시. (실제 등록 화면은 Phase 2)
3. Step 3에서 선택한 세션 스토리지 어댑터가 네이티브 모듈이면 여기서 함께 확정.
4. `npx expo prebuild --platform ios --no-install`로 config plugin이 iOS 프로젝트 설정을 생성하는지 확인(윈도우에서도 파일 생성까지는 가능). 생성된 `ios/`는 커밋하지 않음 (EAS가 클라우드에서 다시 생성).
5. 커밋: `feat: expo-share-intent 설정 및 수신 화면 스텁`

**DoD**
- [x] `app.json` plugins에 `expo-share-intent` 등록, 이미지 수신 규칙 설정 (`NSExtensionActivationSupportsImageWithMaxCount: 1`)
- [~] `npx expo prebuild --platform ios --no-install` → **Windows에선 불가**(iOS 생성은 macOS/Linux 전용). 대신 `npx expo config --type introspect`로 config plugin 검증 (ShareExtension·이미지 규칙 주입 확인). 실제 네이티브 생성은 Step 5 EAS 클라우드에서.
- [x] 이 시점에서 Expo Go는 더 이상 동작하지 않아도 정상 (Step 5로) — `expo-share-intent`는 네이티브 모듈

> 채택 버전: `expo-share-intent` 8.0.1 (SDK 57 호환). ShareExtension bundleId `com.k0nghaa.wishshot.share-extension`, App Group `group.com.k0nghaa.wishshot`.

---

## Step 5 — EAS 개발 빌드 → 아이폰 설치

**사람이 하는 것**
- `npx eas login` (Expo 계정)
- Apple 계정 연동 프롬프트에서 Apple ID 입력 — EAS가 인증서·프로비저닝 프로파일을 대신 생성한다. 2FA 코드 입력 필요.
- 아이폰 UDID 등록: EAS가 안내하는 URL을 아이폰 Safari에서 열어 프로파일 설치.

**에이전트가 하는 것**
1. `npx eas build:configure` → `eas.json` 생성. 프로파일:
   - `development`: `developmentClient: true`, `distribution: internal`, `ios.simulator: false`
   - `preview`: `distribution: internal` (TestFlight 전 내부 배포용, Phase 4)
   - `production`: 기본
2. `expo-dev-client` 설치.
3. 빌드 명령 실행: `npx eas build --platform ios --profile development` (사람이 터미널에서 직접 실행하는 것을 권장 — Apple 인증 프롬프트가 인터랙티브).
4. 빌드 완료 후 아이폰에서 EAS 링크로 설치. `npx expo start --dev-client`로 개발 서버 실행 → 설치된 앱에서 접속.
5. 커밋: `chore: EAS 빌드 설정 (development/preview/production)`

**DoD**
- [x] 아이폰에 WishShot 개발 빌드 설치됨 (홈 화면 아이콘)
- [x] 개발 서버 접속 후 코드 수정 → 아이폰에 핫 리로드 반영
- [x] 로그인/로그아웃 동작 (Step 3와 동일)
- [x] **아이폰 사진 앱에서 스크린샷 → 공유 → WishShot 선택 → `share.tsx`에 파일 경로 표시** ← 이 Phase의 핵심 검증 ✅
- [x] EAS 빌드 소요 시간·남은 무료 크레딧을 기록 (아래 결과 기록)

---

## Step 6 — 문서 정리

**작업**
1. `CLAUDE.md`를 전환기 버전에서 **실제 구조 반영 버전**으로 갱신: 디렉터리 구조, 명령어(`npx expo start --dev-client`, `npx eas build ...`, `npx tsc --noEmit`, `npx expo lint`), Supabase 접근 패턴, 환경 변수, "네이티브 의존성 변경 시 재빌드 필요" 규칙.
2. `README.md` 재작성: 프로젝트 한 줄 소개, v2 전환 안내(`web-v0` 태그 언급), 로컬 실행 방법, 노션 문서 링크.
3. 이 문서(`docs/phases/phase-1-toolchain.md`)의 DoD 체크박스를 실제 결과로 채우고, 발견한 이슈·결정(선택한 스토리지 어댑터, expo-share-intent 버전, bundleIdentifier, EAS 크레딧)을 하단 "결과 기록" 절에 남긴다.
4. 커밋: `docs: Phase 1 완료 — CLAUDE.md/README 갱신, 결과 기록`

**DoD**
- [x] `CLAUDE.md`가 현재 레포 상태를 정확히 설명 (아직 없는 것을 있다고 쓰지 않음)
- [~] `dev`로 PR: Step 1~2는 PR #8로 이미 머지됨. Step 3~6은 `feat/supabase-auth` 브랜치 → `dev` PR 예정 (사람이 머지)

---

## 이 Phase의 미결 사항 (진행 중 결정, 결과 기록에 남길 것)

- `ios.bundleIdentifier` 값
- 세션 스토리지 어댑터 (`expo-secure-store` vs async-storage)
- `expo-share-intent` 채택 버전과 Expo SDK 버전
- Apple Sign-In 도입 여부 — 이 Phase는 이메일 로그인만. 앱스토어 심사 시 소셜 로그인이 있으면 Apple 로그인 필수라는 규정이 있으므로, 소셜 로그인을 추가할 계획이면 그때 함께 검토
- EAS 무료 크레딧 실측치

---

## 결과 기록 (Phase 완료 시 작성)

- **완료일**: 2026-09-09
- **bundleIdentifier**: `com.k0nghaa.wishshot` (ShareExtension: `com.k0nghaa.wishshot.share-extension`, App Group: `group.com.k0nghaa.wishshot`)
- **Expo SDK / expo-share-intent 버전**: Expo SDK 57 (expo ~57.0.20, React Native 0.86.3, React 19.2.3) / expo-share-intent 8.0.1
- **세션 스토리지**: `@react-native-async-storage/async-storage` (Supabase 공식 퀵스타트 방식). 참고: 더 민감한 저장이 필요하면 향후 `expo-secure-store` 어댑터로 교체 검토 가능
- **EAS 빌드 시간 / 남은 크레딧**: iOS development 빌드 약 **5분 12초** (10:05:06→10:10:18, build number 1). 무료 플랜 — 크레딧 소진이 아니라 **월 빌드 횟수 제한** 방식. 이번 달 누적 7회(iOS 6 / Android 1, 타 프로젝트 포함). 남은 횟수는 expo.dev Usage 페이지에서 확인
- **발생한 이슈와 해결**:
  - Windows에서 iOS prebuild 불가 → `expo config --type introspect`로 config plugin 검증, 실제 빌드는 EAS 클라우드
  - 개발 서버 LAN 접속 실패("Could not connect to the server") → `npx expo start --tunnel` 필수 (`@expo/ngrok` 로컬 설치로 해결)
  - SDK 57 기본 템플릿이 `src/` 디렉터리 구조 → 라우트를 `src/app/`에 두기로 결정
  - `.env` 변경은 `--clear` 재시작 필요
- **Phase 2로 넘길 것**: DB 스키마("계약") 확정 + 마이그레이션 SQL(RLS 정책·grant 포함), 실제 화면(카테고리/목록/상세/업로드), 공유로 받은 이미지의 실제 등록 플로우(현재는 경로 표시 스텁), OCR(Phase 3)·LLM 정제 Edge Function(Phase 3), 앱 아이콘을 v1 로고 기반으로 교체(현재 Expo 기본)