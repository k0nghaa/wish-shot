# CLAUDE.md

이 파일은 이 저장소에서 작업하는 Claude Code에게 제공하는 가이드입니다. 규칙·구조·원칙을 담고, 절차·명령·수치는 [`docs/development.md`](docs/development.md)(개발 가이드)가 정본입니다.

> 상태: **1.1.0 출시(2026-11-11, App Store)** — 구매처 링크 찾기·탭 순서·알림·몰 검색 링크까지 반영. 운영 runtimeVersion은 1.1.0 빌드 값이라 이후 OTA(JS만 바꾼 배포)는 1.1.0 사용자에게만 간다. 로그인·계정 연결은 보류. 이 문서는 `dev`의 현재 상태를 반영한다.

## 프로젝트 개요

WishShot(위시샷)은 스크린샷으로 저장한 관심 제품을 카테고리별 개인 위시리스트로 관리하는 **iOS 앱**입니다. 홈 화면 아이콘으로 여는 일반 앱이 본체이며, iOS 공유 시트(Share Extension)에서 스크린샷을 바로 받아 등록하는 진입 경로를 갖습니다. 웹 버전은 목표에서 제외되었습니다.

## 문서

- 제품 요구사항: 노션 「WishShot — 스크린샷으로 시작되는 개인 위시리스트」(v1 PRD, v2 PRD 작성 중)
- 기술 결정: 노션 「WishShot v2 — 플랫폼·아키텍처 결정 문서 (Expo + Supabase)」
- 문서 안내(읽는 순서·작업 기록 목록·용어 — 요구사항 번호 FR·NFR·E의 뜻 포함): `docs/README.md`
- 개발 가이드(로컬 실행·DB·Edge Function·빌드·출시·환경 변수): `docs/development.md` — **절차·명령·수치의 정본**
- 작업 기록: `docs/phases/` — Phase 번호순, 각 문서 끝에 결과 기록. 코드·문서가 "Phase N"으로 가리키는 근거는 여기 있다.
- 트래킹 플랜(이벤트 택소노미 **정본**): `docs/testing/tracking-plan.md`
- 디자인 정본: `docs/design/color_tokens.md`(색), `docs/design/phase-5-visual-spec.md`(토큰 매핑·화면 명세)
- 개인정보처리방침 원문: `docs/legal/privacy.html` — App Store 방침 URL로 게시하는 원본(`main` 머지로 GitHub Pages에 게시). 고칠 땐 게시 절차와 노션 동기화를 거친다.

## 기술 스택과 원칙

- **앱**: Expo SDK 57 (React Native 0.86, React 19) + Expo Router + TypeScript. iOS 전용.
- **백엔드**: 별도 서버 없음. `@supabase/supabase-js`로 Supabase(Postgres + Storage + Auth)를 직접 호출하고, 행 단위 권한은 RLS로 강제. API 키가 필요한 일만 **Supabase Edge Function(Deno)** 으로 처리 — `parse-screenshot-text`(AI 정제)·`find-purchase-links`(구매처 링크 찾기)·`cleanup-orphan-images`(고아 이미지 스윕).
- **인증**: **익명 로그인**. 세션이 없으면 `signInAnonymouslyIfNeeded()`가 기기별 익명 세션을 만든다 → 로그인 벽 없이 바로 쓴다. 세션은 AsyncStorage에 저장돼 재시작 뒤에도 유지되고, RLS가 익명 세션의 `auth.uid()`로 행을 격리한다(익명도 `authenticated` 롤이라 GRANT·정책이 그대로 적용). 대시보드 **Authentication → Anonymous sign-ins ON**이 필요하다. 이메일 로그인 라우트(`login.tsx`)는 보존하지만 정상 흐름에선 도달하지 않는다(`__DEV__` 왕복용). 계정 연결(Apple 등)은 보류.
- **공유 시트**: `expo-share-intent`(이미지 1개 또는 URL). 받은 공유는 **루트의 공유 처리기**(`ShareIntentHandler`, 앱 전체 1개)가 어느 화면에서든 처리한다 — 이미지는 등록 폼, URL은 전체 탭 링크붙이기 모드. 등록·편집 폼이 떠 있으면 앱 자체 확인창으로 [지금 열기](작성 중인 내용 버림)·[저장 후 열기](폼을 닫으면 이어서 엶)를 묻는다. `+native-intent.ts`는 앱이 켜져 있을 때 온 공유 딥링크로 화면을 옮기지 않는다(이동은 처리기만).
- **이미지**: `expo-image-picker`(앱 내 선택), `expo-file-system`(uri → 바이트), `expo-image-manipulator`(크롭·리사이즈), `expo-media-library`(최근 사진·앨범 원본 삭제). 모두 네이티브.
- **OCR**: 온디바이스 **Apple Vision** — 자작 로컬 모듈 `modules/expo-vision-ocr/`(ko-KR + en-US). `src/lib/ocr`의 `OcrEngine` 뒤에 캡슐화하고, Expo Go·시뮬레이터처럼 모듈이 없으면 `MockOcrEngine`. Google ML Kit 대신 Apple Vision을 쓴 이유: iOS 전용이라 ML Kit의 iOS CocoaPods/arm64 문제를 피하고, Expo SDK 57·New Architecture와 호환되는 RN용 ML Kit 래퍼를 확인하지 못했다.
- **AI로 보내는 데이터 (개인정보 원칙 — 방침과 맞물림)**: 정제엔 **OCR 텍스트와 사용자 카테고리 이름만** 보낸다. 이미지는 텍스트가 부족하거나 사용자가 "제품 영역으로 분석"을 누를 때, **사용자가 고른 제품 영역 크롭만 '분석'을 누를 때** 보낸다(통이미지·자동 전송 없음, 서버 미저장·미로깅). 구매처 찾기엔 **제품명·브랜드·입구 채널만** 보낸다(OCR 원문·이미지 없음). 보내는 범위를 넓히려면 방침부터 고친다.
- **AI 정제 `parse-screenshot-text`**: Claude Haiku(`claude-haiku-4-5`) + 구조화 출력 → `{productName, price, brand, confidence, suggestedCategory}`. 카테고리 이름 목록을 받으면 그중 하나만 추천하고, 목록 밖 값은 서버·앱 모두 무시한다. 모델·스키마·프롬프트는 `prompt.ts` 한 곳. 입력 상한을 넘으면 LLM을 부르지 않고 `400`, 요청 한도(사용자·전체)를 넘으면 `429` — 앱은 다른 실패와 같은 수동 입력 경로. 한도 카운터 오류는 호출을 허용하되(fail-open) 카운터 응답이 3초를 넘기면 거절한다(요청을 몰아쳐 한도를 우회하는 것 방지). 실패 원인은 `ops.parse_failures`에 내용 없이 남긴다. 가격 원칙: 원화 금액만, 애매하면 null(틀린 값보다 빈칸), 정가 우선 — 중고거래 매물은 판매자 등록가.
- **구매처 링크 찾기 `find-purchase-links`**: 등록 폼에서 제품명이 채워지고 링크 칸이 비면 부른다. 입구 채널(캡처에 보인 판매처 도메인 또는 몰)은 기기에서 판별한다(`src/lib/purchaseChannel.ts`). 서버는 카페24 사이트 안 검색 → Claude Haiku 5.5(`claude-haiku-5-5`) 웹 검색 순으로 찾고, **주소는 서버가 모은 후보에서만 꺼낸다**(모델은 번호만 고름). **Google Web Risk 대조와 접속 확인을 통과한 링크만** 넣는다(키 없음·조회 실패면 비움). 전용 한도 카운터 오류는 **거절**한다(fail-closed — 웹 검색 비용이 커서 정제 함수와 다르다). 저장 뒤 도착한 링크는 **링크가 비어 있을 때만** 붙이고(`setSourceLinkIfEmpty`) 기기 안 알림으로 알린다(서버 미전송). 네이버 검색 API는 약관(AI 입력·처리 금지) 때문에 쓰지 않는다.
- **계측(PostHog)**: 모든 수집은 `src/lib/analytics.ts` 경유(이벤트명·속성을 타입으로 강제, 화면에서 직접 import는 eslint `no-restricted-imports`로 금지). 속성은 enum·boolean·수치만 — **사용자 콘텐츠(사진·OCR 원문·상품명·URL 등) 절대 미수집**(`app_error`도 에러 클래스명만). IP로 추정한 위치는 끈다(SDK `disableGeoip` + 프로젝트 GeoIP 변환 끔 — IP 버리기만으론 안 꺼진다). 키가 없으면 전부 no-op, `__DEV__`는 기본 옵트아웃. 이벤트 정본은 tracking-plan.
- **오류·크래시(Sentry)**: `@sentry/react-native` 7.11(sentry-cocoa 8.58). 모든 호출은 `src/lib/monitoring.ts` 경유(eslint 강제). **오류·크래시만** 수집한다 — `tracesSampleRate`·리플레이 비율 키는 0이어도 통합을 켜므로 아예 넣지 않는다. **사용자 내용 제외**: 콘솔·네트워크 요청 기록은 버린다(방침 §5가 요청 주소를 수집 항목으로 두지 않음 — 켜려면 방침 먼저), 그 밖 URL·메시지의 값·UUID는 가리고 `extra`는 지우며, 네이티브 자동 기록(네트워크 URL·화면 제목)은 끈다(`enableNetworkBreadcrumbs`·`enableAutoBreadcrumbTracking: false` — 네이티브 크래시엔 JS 필터가 안 걸림). 거르기에 실패하면 버린다. `setUser` 금지(설치별 무작위 ID만), IP 미저장. DSN이 없으면 no-op, `__DEV__`는 기본 비활성. `_layout.tsx` 최상단에서 초기화해 전역 핸들러 순서가 PostHog `app_error` → Sentry → RN 기본이 된다. RN 0.86은 렌더 오류를 전역 핸들러에 보내지 않으므로 `wrapRoot`의 루트 경계가 받는다.
- **빌드·출시**: Windows PC에서 EAS 클라우드 빌드. 개발용 앱(`WishShot Dev`, `APP_VARIANT=development`)으로 확인 → production 빌드 → `eas submit`으로 App Store Connect 업로드 → 심사 제출(TestFlight 테스트 단계 없음). JS만 바뀐 수정은 `eas update`(OTA)로 낸다. 명령·순서는 개발 가이드.

## 디렉터리 구조

```
src/
  app/                        # Expo Router 라우트(파일 = 화면)
    _layout.tsx               # 루트: 익명 세션 부트스트랩(AuthGate) · 첫 실행 온보딩 판단 · 공유 처리기 · 스낵바. 등록·편집 = 모달, 상세 = 풀스크린 모달, 정보 = formSheet
    (tabs)/                   # 하단 플로팅 탭바(CustomTabBar): 카테고리·전체·알림·검색. 앱을 열면 전체(index)
      _layout.tsx
      index.tsx               # 전체: 3열 그리드(최신순)·업로드 버튼·다중 선택·설정 진입. 링크붙이기 모드(URL 공유로 열림 — 위시를 골라 편집에 링크를 채우거나 새로 담기)
      categories.tsx          # 카테고리: 2×2 모자이크 카드(빈 카테고리 포함)·미분류. + = 새 카테고리, ··· = 삭제 모드, 카드 길게 누르기 = 이름 변경·삭제
      notifications.tsx       # 알림: 저장 뒤 링크를 붙인 기록(기기 안, 최근 20개·14일). 탭 배지 = 안 읽은 수
      search.tsx              # 검색: 제품명·브랜드·태그·메모 클라이언트 필터
    register.tsx              # 등록: 사진 → OCR·AI 자동채움 → 확인·수정 → 저장. 카테고리 추천·중복 덮어쓰기·개인정보 고지(첫 1회)·구매처 링크 자동 채움과 저장 뒤 이어 찾기·앨범 원본 삭제 제안
    item/[id]/index.tsx       # 상세: 풀스크린 갤러리(좌우 넘김·핀치 줌) + 정보·링크·편집·삭제·카테고리 이동. 본 위시의 새 링크 알림을 읽음 처리, 삭제하면 그 위시의 알림 기록도 지움
    item/[id]/info.tsx        # 정보 반시트(formSheet): 제품 정보·메모·태그·담은 시각 + 편집 진입
    item/[id]/edit.tsx        # 편집: 필드·태그·카테고리·이미지 교체(OCR 없음). 다른 위시와 이름이 겹치면 막음. 링크붙이기로 들어오면 링크를 미리 채움
    category/[id].tsx         # 카테고리별 목록('uncategorized' = 미분류)
    tag/[name].tsx            # 태그별 목록
    settings.tsx              # 설정: 개인정보 안내·의견 보내기. __DEV__ 도구(세션 초기화·이메일 로그인·온보딩 다시 보기·썸네일 백필·계측 토글·오류·크래시 시험)
    login.tsx                 # 이메일 로그인 — 정상 흐름 미도달, __DEV__ 왕복용으로 보존
    +native-intent.ts         # 공유 딥링크: 첫 실행이면 '/', 앱이 켜져 있으면 이동 없음(공유 처리기가 처리)
  components/
    ShareIntentHandler.tsx    # 공유 시트 처리(앱 전체 1개) — 같은 공유 중복 수신 무시, 폼 작성 중이면 확인창
    SnackbarHost.tsx          # 앱 전체 스낵바 1개(FullWindowOverlay — 모달 위에도), 3초(VoiceOver 6초)
    CustomTabBar.tsx          # 플로팅 탭바(카테고리 버튼은 온보딩 안내 대상)
    tabBarVisibility.tsx      # 다중 선택 중 탭바 숨김 컨텍스트
    PhotoTile.tsx             # 그리드 타일 — 링크 찾는 중 흐림, 새 링크 점
    Thumbnail.tsx             # 썸네일(실패 시 원본으로 폴백)
    CategoryCard.tsx          # 카테고리 모자이크 카드
    CategoryPicker.tsx        # 카테고리 칩 목록(상세의 이동·카테고리 선택 시트 공용)
    FolderPickerSheet.tsx     # 카테고리 선택 반시트(새 카테고리 입력 포함)
    ItemSelectionControls.tsx # 다중 선택 하단 바·이동 시트(전체·카테고리 화면 공용) — SelectionBar.tsx 사용
    FormField.tsx             # 등록·편집 폼 부품(한 줄 입력은 넘치면 페이드·옆으로 밀어 보기)
    TagInput.tsx
    RegionSelectSheet.tsx     # 제품 영역 지정 시트(크롭)
    ImageZoomModal.tsx        # 등록·편집 사진 원본 미리보기
    OverwriteDialog.tsx, EmptyState.tsx, TabHeaderLogo.tsx
    Onboarding/               # 첫 실행 온보딩: 카드 3장(CardMock 모션) → 탭바 코치마크 → 등록 폼 코치마크. 플래그 wishshot.onboardingShown
  hooks/
    useAnalysis.ts            # 분석 상태 머신: idle → imageReceived → ocrRunning → (parsing | regionSelect → imageParsing) → filled → submitted, 실패는 error
    usePurchaseLinkSearch.ts  # 구매처 링크 찾기 호출·결과 보관, 저장 뒤 3분 안에 도착하면 빈 링크에만 붙임
    useItemSelection.ts       # 다중 선택·일괄 이동·삭제
    useNotifications.ts       # 기기 안 알림 저장소 구독(탭 배지·타일 상태·알림 목록)
  lib/
    queries/                  # 데이터 레이어(아래 절). 화면·훅은 @/lib/queries 만 import
    ocr/                      # OcrEngine 인터페이스 + VisionOcrEngine·MockOcrEngine. 화면은 @/lib/ocr 만 import
    supabase.ts               # 타입 클라이언트
    analytics.ts              # PostHog 캡슐화(키 없으면 no-op)
    monitoring.ts             # Sentry 캡슐화(DSN 없으면 no-op)
    normalize.ts              # 중복 판정 정규화(단일 소스)
    imageBytes.ts             # uri → 바이트, ensureFileReady(iCloud 미다운로드 폴링)·ImageNotReadyError·logImageDiag(__DEV__ 진단)
    imageResize.ts            # 저장용 압축(긴 변 1600px q0.8)·썸네일(400px q0.6)
    photoLibrary.ts           # 최근 사진 가져오기·앨범 원본 삭제(expo-media-library/legacy)
    purchaseChannel.ts        # 입구 채널 판별(순수 함수 — Deno 테스트가 import)
    shareIntent.ts            # 공유 값 판정(순수 함수)
    notifications.ts          # 기기 안 알림 저장소(AsyncStorage, 서버 미전송) + 링크 찾는 중인 위시(메모리)
    snackbar.ts               # 스낵바 대기열(화면 밖에서도 호출)
    emptyCategory.ts          # 카테고리가 비면 삭제/유지 묻기
    formatDate.ts, formatPrice.ts
  constants/
    theme.ts                  # 디자인 토큰(라이트) + colorsDark(상세 뷰어·스낵바의 어두운 면에만)
    privacy.ts                # 개인정보 안내 문구 단일 소스(바꿔서 다시 보이려면 register 의 PRIVACY_NOTICE_KEY 도 바꾼다)
  types/database.ts           # supabase gen types 자동 생성(직접 수정 금지)
modules/expo-vision-ocr/      # 자작 OCR 네이티브 모듈. ios/ 아래는 fingerprint 에 들어간다
supabase/
  config.toml                 # init 템플릿 + [functions.cleanup-orphan-images] verify_jwt=false(스케줄러 전용)
  migrations/                 # 0001(기준선) ~ 0007. 적용한 파일은 고치지 않는다(아래 절)
  rollback/                   # 0005부터 마이그레이션마다 되돌리기 SQL
  functions/
    parse-screenshot-text/    # AI 정제. prompt.ts + samples/(회귀 케이스·eval.ts, 정답셋 측정 goldset-eval.ts·goldset-holdout.ts·goldset/LABELING.md·REPORT.md, 비교용 고정 사본 prompt-2026-10-04.ts). 정답셋 원문·결과(goldset/data·out)는 git 제외
    find-purchase-links/      # 구매처 링크: index(흐름·한도) · logic(순수 판정) · malls(몰 사전) · prompt · site(카페24 검색) · safety(Web Risk) · verify(접속 확인)
    cleanup-orphan-images/    # 고아 이미지 주간 스윕(service_role, x-cron-secret)
  tests/                      # SQL Editor 용 검증 SQL(rls·audit·quota·purchase_link_quota·metrics·parse_failures) + Deno 시험(find_purchase_links_test·purchase_channel_test·parse_quota_live)
docs/
  README.md                   # 문서 안내 — 읽는 순서·작업 기록 목록·용어
  development.md              # 개발 가이드 — 절차·명령·수치 정본
  phases/                     # Phase별 작업 지시·결과 기록
  design/                     # 디자인 정본(색 토큰·화면 명세·목업 이미지)
  testing/tracking-plan.md    # 계측 이벤트 정본
  legal/                      # 개인정보처리방침·지원 페이지 원본
  readme/                     # README 이미지
  archive/                    # 폐기·참고 자산(지시 아님)
assets/                       # 아이콘·스플래시·헤더 로고(옛 v1 로고는 docs/archive/assets-v1)
app.json                      # Expo 설정 = 운영(스토어) 정본(플러그인·공유 확장·privacy manifest·CFBundleDevelopmentRegion ko)
app.config.js                 # APP_VARIANT=development 일 때만 개발용 앱(이름·번들 ID·scheme·공유 확장)으로 덮어씀
eas.json                      # EAS 빌드 프로필(development / preview / production)
metro.config.js               # Sentry 메트로 설정(Babel 변환기는 Expo 기본 그대로)
eslint.config.js              # PostHog·Sentry 직접 import 금지 규칙
tsconfig.json, .npmrc, .gitattributes, .env.example, .github/
```

- 경로 별칭: `@/*` → `src/*` (예: `import { colors } from '@/constants/theme'`).

## 명령어

전체 명령과 순서는 [개발 가이드](docs/development.md). 여기엔 에이전트가 직접 쓰는 것과 지킬 점만 둔다.

- 검증: `npx tsc --noEmit` · `npx expo lint` · `npx expo-doctor` · `deno test --no-lock supabase/tests/find_purchase_links_test.ts supabase/tests/purchase_channel_test.ts` · `deno check --no-lock supabase/functions/find-purchase-links/index.ts`
- runtimeVersion 확인: `npx expo-updates runtimeversion:resolve --platform ios`(`APP_VARIANT`가 없는 셸에서). 원인 찾기는 `npx expo-updates fingerprint:generate --platform ios --debug`.
- 개발 서버: `npx expo start --tunnel`(이 환경은 LAN 접속이 안 된다). 개발용 앱으로 접속: `$env:APP_VARIANT='development'; npx expo start --dev-client --tunnel --scheme wishshot-dev` (PowerShell) — `APP_VARIANT`가 없으면 공유 시트로 받은 사진을 인식하지 못하고, `--scheme`이 없으면 QR이 스토어 앱도 가진 기본 scheme을 쓴다.
- **사람이 실행하는 것**(Apple 인증·비밀 값·운영 DB): EAS 빌드·제출, `eas update`(OTA), Edge Function 배포·시크릿 등록, 마이그레이션 적용, 소스맵 업로드, 정답셋 측정. 에이전트는 명령을 안내만 하고 키를 다루지 않는다.
- 지킬 점:
  - production 빌드 전 같은 창에 남은 `APP_VARIANT`를 지운다(`Remove-Item Env:APP_VARIANT -ErrorAction SilentlyContinue`) — 남아 있으면 개발용 앱 설정으로 빌드돼 실패한다.
  - Edge Function 배포는 **함수 이름을 꼭 붙인다**(이름 없이 하면 폴더의 함수가 전부 올라간다). `find-purchase-links`는 `0007`을 적용한 뒤 배포한다.
  - Supabase CLI는 `npx supabase@2.121.0`으로 쓴다(3.x는 검증하지 않음).
  - 정답셋 측정 결과(`goldset/out`)는 덮어쓰지 않는다(`--force` 금지). 원문 데이터는 git에 넣지 않는다(OCR 원문에 타인 계정명이 섞일 수 있음).
  - 마이그레이션을 바꾸면 타입을 재생성한다(`src/types/database.ts`).

## 환경 변수

목록과 등록 방법은 개발 가이드. 원칙:

- 앱 번들엔 **`EXPO_PUBLIC_*` 공개 값만** 넣는다(Supabase anon 키·URL, PostHog 키, Sentry DSN). `.env`는 커밋 금지, `.env.example`만 커밋한다.
- 비밀 값(Claude·Web Risk 키, `CRON_SECRET`, `SENTRY_AUTH_TOKEN`)은 Edge Function 시크릿 또는 EAS Secret에만 둔다. 앱·`.env`·커밋·채팅 금지.
- EAS 클라우드 빌드는 로컬 `.env`를 읽지 않는다 → `EXPO_PUBLIC_*`를 EAS 환경에 등록한다. 프로필에 `environment`가 없으면 개발 클라이언트 = development, internal 배포 = preview, 그 밖 = production 환경 변수를 쓴다(eas-cli 코드 확인).
- `APP_VARIANT`는 셸과 `eas.json`에서만 넣고, 커밋하는 파일에는 두지 않는다. `.env`를 바꾸면 `npx expo start --clear`로 재시작한다.

## 작업 규칙

1. **Next.js·Express·Vite를 도입하지 않는다.** 서버가 필요해 보이면 Supabase Edge Function 또는 DB 함수로 해결하고, 그것도 애매하면 사람에게 묻는다.
2. **비밀 값은 앱에 넣지 않는다.** 앱에는 Supabase `anon` 키만. `service_role` 키, Claude API 키는 Edge Function 환경 변수에만 존재한다. `.env*`는 커밋 금지, `.env.example`만 커밋.
3. **네이티브 패키지도 구현 선택지에 넣되, 비교해 보고하고 승인받아 추가한다.** 네이티브 모듈(config plugin이 있는 패키지, 예: `expo-share-intent`, `expo-dev-client`, `@react-native-async-storage/async-storage`)을 추가·제거·업그레이드하면 EAS 재빌드가 필요하다. 구현 방법을 고를 때 ① 이미 설치된 패키지·JS ② 로컬 모듈(`modules/`) 직접 구현 ③ 새 네이티브 패키지를 비교해 보고하고, 사람이 고른다. 비교 항목: 재빌드 여부와 배포 경로 변화(JS만 바꾸는 작업은 OTA로 나가지만, 네이티브를 넣으면 스토어 빌드·심사로 바뀌고 앱 지문(fingerprint)이 달라져 이후 OTA는 새 빌드 사용자만 받는다), Expo SDK 57·RN 0.86·New Architecture 호환 근거, 개인정보 매니페스트·방침 영향, 유지보수 상태(최근 릴리스·열린 이슈), 구현·검증 비용. 승인 없이 추가하지 않고, 추가는 한 빌드에 모은다(버전은 규칙 10). JS 전용 패키지는 자유.
4. **모든 사용자 노출 문자열은 한국어 — 간결한 단답형(iOS 기본 앱 톤).** 에러·라벨·플레이스홀더·접근성 라벨 포함. 대화체("~예요/~해요")를 쓰지 않는다.
   - 라벨·버튼·탭·플레이스홀더: **명사 또는 동사 원형의 단답**. 예: "저장", "삭제", "취소", "편집", "카테고리 이동", "다른 사진 선택".
   - 안내·에러: 짧은 서술("~습니다") 또는 명사구. 예: "불러오지 못했어요" → "불러오지 못했습니다"(또는 더 짧게 "불러오기 실패"). 감탄·수다·군더더기 배제.
   - 확인 다이얼로그: 제목은 짧은 질문 가능("삭제할까요?"), 본문은 담백하게("복구할 수 없습니다").
5. **디자인 토큰을 쓴다.** 색상은 `src/constants/theme.ts`의 시맨틱 토큰(`primary`(검정), `accent`(와인 — 제한 사용), `error`, `textMain`, `textSub`, `textDisabled`, `bgCard`, `silver`(iOS 시스템 그레이) 등)만 사용. 컴포넌트에 원시 hex를 직접 쓰지 않는다.
6. **모르면 만들어내지 않는다.** 패키지 버전·Expo SDK 호환·EAS 설정 필드가 불확실하면 공식 문서를 확인하거나 사람에게 묻는다. 아이폰 설치·공유 시트 동작은 에이전트가 검증할 수 없으므로 "확인해달라"고 명시적으로 요청한다.
7. **커밋 메시지는 기존 컨벤션**: `feat:`, `fix:`, `chore:`, `docs:`, `style:`, `refactor:`, `test:` + 한국어 요약.
8. **문서를 현실에 맞춘다.** 구조나 명령어가 바뀌면 이 파일과 `docs/development.md`(개발 가이드)를 같은 커밋에서 갱신한다. 절차·명령·수치는 개발 가이드가 정본이고, 이 파일엔 규칙·구조·원칙과 링크만 둔다. `README.md`는 서비스 소개라 기능·구조가 크게 바뀔 때만 함께 고친다.
9. **새 테이블엔 GRANT를 명시한다.** 이 Supabase 프로젝트는 `public` 테이블 권한을 자동 부여하지 않는다. 마이그레이션에 `grant select, insert, update, delete on public.<table> to authenticated;`를 직접 쓴다(RLS는 행 필터일 뿐, 테이블 접근은 GRANT가 먼저 통과해야 함). 로그인 전용 데이터는 `anon`에 부여하지 않는다. **함수도 같다** — `0006`부터 postgres가 만드는 새 함수는 기본으로 아무도 실행할 수 없으니, 앱·Edge Function이 부를 함수는 `grant execute on function ... to authenticated`(또는 `service_role`)를 직접 쓴다(트리거 함수는 권한 없이도 발화). `security definer` 함수는 `set search_path = ''`로 고정한다.
10. **패키지 버전은 임의로 올리지 않는다.** 검증된 현재 버전을 유지한다. `expo`/`expo-router`/`@expo/ui`/`expo-glass-effect`는 정확히 고정하고 `package.json`의 `expo.install.exclude`로 자동 변경을 막았다. `expo-doctor`가 패치 미스매치를 지적해도 임의로 `expo install --fix` 하지 말고, 필요하면 사람에게 묻는다. 새 패키지는 `npx expo install`로 SDK 호환 버전만 추가한다.
11. **데이터는 데이터 레이어(`src/lib/queries`)로만 접근한다.** 화면에서 `supabase.from(...)`을 직접 부르지 않는다. `user_id`는 앱에서 신뢰하지 말고 RLS가 강제하게 한다(INSERT의 `user_id`는 편의로 채울 뿐).

## 데이터 레이어 · Supabase 접근

- **쿼리는 `src/lib/queries/`에 모아둔다.** `categories`(목록/생성/이름 변경/삭제), `items`(전체·카테고리별·태그별 목록, 전체 태그, 단건, 생성, 수정 `updateItem`, 카테고리 이동 `moveItemCategory`, 일괄 이동·삭제 `moveItems`·`deleteItems`, 삭제, 중복 조회, 빈 링크에만 붙이기 `setSourceLinkIfEmpty`), `storage`(업로드/signed URL/삭제), `auth`(`getCurrentUserId`·`signInAnonymouslyIfNeeded`, `signOut`은 `__DEV__`만), `errors`(`DuplicateItemError`·`DuplicateCategoryError`), `analysisLogs`(분석 로그 기록 — 실패는 삼켜 저장을 막지 않음), `parse`(`parseScreenshotText(text, image?)` — 정제 함수 호출), `purchaseLinks`(`findPurchaseLink` — 실패·한도·시간 초과는 던지지 않고 null, https 링크만 받음). 화면·훅은 `@/lib/queries`에서 가져다 쓴다.
- **편집·이동의 중복 판정.** `updateItem`은 `normalizeName`을 재계산하고, 편집으로 **다른 아이템**과 정규화명이 겹치면 23505 → `DuplicateItemError`로 변환해 화면이 **차단·안내**한다(덮어쓰기 없음). `moveItemCategory`는 `category_id`만 바꿔(정규화명 불변) 중복 위험이 없다. 카테고리 생성/이름 변경 중복은 `DuplicateCategoryError`('같은 이름의 카테고리가 있습니다.')로 변환한다(원본 메시지는 콘솔).
- **빈 카테고리 표시.** 카테고리 탭은 개수 0인 카테고리도 노출한다(삭제 여부를 사용자가 알아차리도록). 대신 이동·편집·삭제로 카테고리가 비면 `promptDeleteIfCategoryEmpty`로 삭제/유지를 묻는다.
- **OCR/정제는 데이터 레이어·훅 경유.** 화면은 OCR 엔진을 `@/lib/ocr`로, 상태 흐름을 `useAnalysis`로만 다룬다. `analysis_logs`는 **쓰기만** 한다. `status`는 `ocr_empty`/`parsed`/`parse_failed`/`low_confidence` 4종. `parsed`에는 **AI 원본 정제값**을 남긴다(실제 저장값은 `items` — AI 정확도 평가용 로그이기 때문). **위시를 지우면** 외래 키가 `item_id`를 비울 때 트리거(`0006`, `ops.clear_analysis_log_content`)가 그 로그의 `raw_text`·`parsed`를 비우고 상태·시각과 분석 경로 표시(`parsed.source`)만 남긴다. 개발자 계정(`ops.internal_users`)은 건너뛴다(정답셋·재현 사례용) — 측정 기록이 필요하면 개발자 uid가 목록에 있는지 먼저 확인한다.
- **RLS가 최종 방어선.** 세 테이블 모두 `user_id = (select auth.uid())`로 SELECT/INSERT/UPDATE/DELETE 강제. `anon`은 권한 없음. API 롤(anon·authenticated·service_role)엔 CRUD 외 테이블 권한(TRUNCATE·REFERENCES·TRIGGER·MAINTAIN)이 없다(`0006` — 새 public 테이블에도 자동으로 붙지 않음). 검증 쿼리는 `supabase/tests/rls.sql`, 권한·정책 전체 점검은 `supabase/tests/audit.sql`.
- **`normalized_name`은 서버 전용 중복 판정 컬럼.** 값 = `normalizeName(brand, product_name)`(NFC·소문자·문자/숫자만). `UNIQUE(user_id, normalized_name)`로 재저장을 하드 차단. 저장·사전조회·수정이 **모두 `src/lib/normalize.ts` 한 곳**을 써야 판정이 일치한다. 화면엔 `product_name`·`brand`만 노출.
- **Storage 규칙.** private 버킷 `item-images`, 키 `{user_id}/{item_id}.jpg`. 렌더는 signed URL로만. DB엔 객체 키만 저장. 중복 덮어쓰기는 같은 키에 `upsert`. 버킷은 **파일 3MB·`image/jpeg`만** 받는다(`0006`, 업로드할 때만 검사) — 다른 형식이나 더 큰 파일을 올리려면 마이그레이션으로 버킷 설정부터 바꾼다.
- **Storage · Egress 규칙(Free 플랜 월 5GB 유지).** 이미지 전송량을 코드로 줄여 Free 플랜을 유지한다(플랜 업그레이드로 해결하지 않는다). 모두 `src/lib/queries/storage.ts` 경유(화면에서 `supabase.storage` 직접 호출 금지).
  - **업로드 전 리사이즈 필수.** 저장 시점에만 원본을 긴 변 1600px JPEG로 최적화한다(`compressForUpload`). **OCR·AI 분석·원본 확대 보기는 사용자가 고른 원본 uri 그대로** 쓴다(품질 저하 금지). 압축 전 `ensureFileReady`로 iCloud 미다운로드를 흡수한다.
  - **목록은 썸네일 객체만.** 아이템 1개 = 원본 `{uid}/{id}.jpg` + 파생 썸네일 `{uid}/{id}_thumb.jpg`(DB에 저장하지 않는 파생 키 — `thumbKeyFromImageKey`). 그리드는 `getItemThumbSignedUrls`로 썸네일을, **상세 뷰어만 원본**을 쓴다. Supabase Image Transformation은 Pro 전용이라 별도 썸네일 객체로 대체한다.
  - **썸네일이 없으면 원본 폴백.** 썸네일이 없는 옛 아이템은 그리드에서 원본으로 폴백한다(`Thumbnail`의 `fallbackUrl` + `onError`). 신규·재저장은 자동으로 썸네일이 생긴다.
  - **signed URL 영속 캐시 재사용.** 발급한 signed URL을 AsyncStorage에 영속해 콜드스타트 뒤에도 같은 URL을 재사용한다 → `expo-image` 디스크 캐시가 살아남아 재방문 다운로드 ≈ 0. 앱 시작 시 `hydrateSignedUrlCache()` 1회.
  - **삭제·덮어쓰기·교체는 원본+썸네일을 항상 함께.** `deleteItemImage(s)`가 두 키를 함께 지우고 둘 다 캐시를 무효화한다(고아 객체 없음). 담기·덮어쓰기·이미지 교체는 둘 다 다시 올린다.
- **익명 계정 수명주기(전부 서버 측, 앱 코드 무관).** 앱 재설치마다 접근할 수 없는 옛 계정·파일이 쌓이므로 "잃을 게 없는 것만" 자동 정리한다. (1) **빈 익명 계정**(아이템 0건·생성 30일+)은 pg_cron 주간 잡 `delete-empty-anon-users`(`0002`)가 삭제한다 → FK cascade로 정리. **아이템이 있는 계정은 절대 삭제하지 않는다**(`not exists items` 조건 필수). (2) **고아 Storage 객체**(살아 있는 키 = `items.image_key` ∪ 파생 썸네일 키 — 이 union 밖)는 `list_orphan_item_images`(`0003`)가 열거하고 `cleanup-orphan-images`가 주 1회 **Storage API(`.remove()`)로만** 지운다(`storage.objects` 직접 DELETE 금지). 썸네일 키는 DB에 없는 파생 키라 union을 빼면 썸네일이 전부 오삭제된다. (3) **재설치 시 데이터 미보존은 의도된 동작** — 복원은 계정 연결 작업 소관.
- **마이그레이션.** 기준선은 `0001_init.sql`이고, 그 뒤 `0002`~`0007`을 번호순으로 적용한다(방법은 개발 가이드). **스키마를 바꾸면 새 `000N_*.sql`을 추가**하고(적용한 파일은 고치지 않음), 타입을 재생성한다. 운영 DB 하나로 시험하므로 되돌리는 SQL을 `supabase/rollback/000N_*_down.sql`로 함께 둔다(`0005`부터). `ops` 테이블은 API 비노출이라 타입에 없고, `public`의 한도·실패 기록 함수(`0005`·`0007`)는 service_role 전용이라 앱에서 쓰지 않는다.
- **타입은 자동 생성.** `src/types/database.ts`는 `supabase gen types`로 만든다. 손으로 고치지 않는다.

## 개발 환경 주의 (Windows 개발 머신)

- **개발 서버는 `--tunnel` 필수.** 이 PC/네트워크에서 기본 LAN 모드는 아이폰이 접속하지 못한다("Could not connect to the server"). `@expo/ngrok`은 devDependency로 설치돼 있다.
- **React Compiler가 켜져 있다(`app.json` `experiments.reactCompiler`).** 컴포넌트·훅 안에서 모듈 수준 `let` 변수를 직접 읽거나 쓰지 않는다 — 컴파일러가 모듈 변수를 바뀌지 않는 값으로 보고 `const next = queued; queued = null; open(next)`를 `queued = null; open(queued)`로 바꿔 `null`을 넘긴 실제 사례가 있다(공유 처리기, 2026-11-10). 모듈 상태는 컴포넌트 밖 함수(예: `takeQueued()`)로만 다룬다. 변환 결과는 `@babel/core`로 `babel-preset-expo`를 caller `{ name: 'metro', platform: 'ios', supportsReactCompiler: true }`로 돌려 확인할 수 있다.
- **runtimeVersion(fingerprint)에 들어가는 파일.** `.gitignore`·`eas.json`(파일 전체), `modules/expo-vision-ocr/ios/`, `app.json`·`app.config.js`의 **값**(주석은 아님), 의존성, `package.json` scripts의 `start`·`web`·`lint`, 아이콘·스플래시 이미지가 바뀌면 값이 달라져 이후 OTA가 기존 스토어 빌드 사용자에게 가지 않는다. JS만 바꾸는 작업에 이 파일들이 섞이면 멈추고 알린다. 확인 명령은 위 "명령어".
- **iOS prebuild는 Windows에서 불가.** `npx expo prebuild --platform ios`는 스킵/실패한다. config plugin 검증은 `npx expo config --type introspect`로 하고, 실제 iOS 네이티브 생성·빌드는 **EAS 클라우드**에서 일어난다. Mac은 Xcode Organizer 크래시 열람 같은 보조 용도로만 쓴다.
- iOS 설치·공유 시트 동작 등 실기기 검증은 사람이 한다.
- **EAS `npm ci` peer 충돌 방지**: `react-native-awesome-gallery`(peer `reanimated@^3`) ↔ 설치된 `reanimated@4` 충돌로 EAS 설치(Install dependencies)가 즉시 실패한다. 루트 **`.npmrc`(`legacy-peer-deps=true`)를 커밋**해 로컬·EAS 동일하게 통과시킨다(삭제 금지).
- **iOS 빌드 크레덴셜**: 앱 본체 + `share-extension` 두 타깃 + App Group(`group.com.k0nghaa.wishshot`)의 프로비저닝이 필요하다 — EAS가 Apple 로그인 시 자동 생성. 배포 인증서는 다른 앱과 공유(재사용 권장). 개발용 앱 변형은 별도 식별자(`com.k0nghaa.wishshot.dev`, `com.k0nghaa.wishshot.dev.share-extension`, `group.com.k0nghaa.wishshot.dev`)라 첫 development 빌드에서 따로 만든다. 운영 식별자는 절대 바꾸지 않는다(기존 사용자의 공유 확장·데이터가 깨진다).

## 참고 (보존된 옛 코드)

- `web-v0` 태그: 옛 웹 코드(Vite SPA + Express + SQLite)의 영구 보존점. 필요하면 `git show web-v0:<path>`로 읽는다. 되살리거나 수정하지 않는다.
- `docs/archive/`: 폐기된 Next.js 계획과 보존용 자산(v1 데이터 이관 스크립트 `migrate-sqlite-to-supabase.ts` — 이관은 하지 않기로 함, v1 로고·디자인 토큰). **참고용이며 지시가 아니다.**

## 데이터 흐름

```
[iOS 공유 시트 (이미지) / 앱 내 사진 선택]
  → Expo 앱 → OcrEngine(Apple Vision, 온디바이스)
       ├ (텍스트 충분) 텍스트만 → Edge Function(Claude Haiku 정제)
       └ (텍스트 부족 시 자동 / "제품 영역으로 분석" 버튼) 제품 영역 지정 시트 → 선택 영역 크롭만('분석' 때) → Edge Function
  (Edge Function: 입력 상한 → 요청 한도(사용자·전체, 0005 카운터) → Claude. 실패 원인은 ops.parse_failures 에 기록)
  → 폼 자동채움("AI가 채웠습니다. 확인하세요.") → supabase-js → Supabase Postgres (RLS) / Storage (private, signed URL 영속 캐시, 원본 1600px 최적화 저장 + 400px 썸네일)
  → (제품명이 채워지고 링크 칸이 비면) 입구 채널 판별(기기, OCR 원문 → 도메인 또는 몰 id)
       → 제품명·브랜드·채널만 → Edge Function find-purchase-links
         (전용 한도 0007 → 카페24 사이트 안 검색 또는 Claude 웹 검색 → 후보 번호 고르기 → Web Risk·접속 확인
          → 상품 페이지 / 몰·사이트 검색 결과 링크 / 없음)
       → 링크 칸 자동채움(저장 뒤 도착하면 3분 안·빈 링크에만 붙이고 스낵바·알림 탭·타일 점으로 알림 — 찾는 동안 타일 흐림)

[iOS 공유 시트 (URL/웹페이지)]  ※ 스크린샷 원본 URL 자동추출은 불가, 페이지 직접 공유만
  → 루트 공유 처리기가 분기(어느 탭·화면에서든, 폼 작성 중이면 지금 열기/저장 후 열기) → '전체' 탭 링크붙이기 모드
       ├ 기존 위시 탭 → 편집(링크 프리필) → 저장
       └ 새로 담기 → 등록(링크 프리필 + "방금 캡처한 사진" 제안) → 위 등록 흐름
```

OCR 결과 없음·정제 실패·저신뢰는 수동 입력으로 폴백한다(AI 실패가 저장을 막지 않는다). v1(웹) 데이터 이관은 범위 밖이다.
