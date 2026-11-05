# Phase 14 — Sentry · 스토어 메타데이터 · 개발용 앱 분리 (네이티브 빌드 1)

> **이 문서 사용법**: Claude Code에 이 파일 전체를 컨텍스트로 넘기고 "**Step N을 진행해달라**"고 한 Step씩 요청한다. **사람** Step(가입·키 등록·빌드·실기기 확인·App Store Connect 입력·제출)은 에이전트가 대신하지 않는다. 에이전트는 Step마다 변경 요약을 보고하고 **승인을 받은 뒤 커밋**한다. PR은 모든 에이전트 Step이 끝난 뒤 승인받고 올린다. 커밋 메시지에 Phase·Step 번호를 넣지 않는다(`feat:`/`docs:`/`chore:` + 한국어 작업 내용).
>
> **브랜치**: 최신 `dev`에서 분기한 `feat/phase-14-sentry-aso`. 세션 시작 시 `git status --short --branch`로 확인한다. 빌드·제출은 PR 머지 뒤 `release/v1.0.2`에서 한다(Phase 8 릴리스 플로우).
>
> **재빌드 있음(중요)**: 네이티브 모듈 `@sentry/react-native`·`expo-application`·`expo-localization`을 추가하므로 EAS 재빌드와 App Store 심사가 필요하다. `runtimeVersion(fingerprint)`이 바뀌어 이 빌드 이후의 OTA는 1.0.1 사용자에게 가지 않는다(1.0.1 사용자에게 보낼 JS 수정이 생기면 1.0.1 코드 기준으로 따로 publish해야 한다 — 이후 Phase에서 판단).
>
> **레인 경계**: 이 Phase는 `supabase/functions/**`·`supabase/migrations/**`를 건드리지 않는다(다른 브랜치가 동시에 작업). `parse-screenshot-text/index.ts`의 주석 정정도 Phase 15에서 한다.
>
> **근거 원칙**: SDK 옵션명·설정 필드는 **설치된 버전(`@sentry/react-native` 7.11.x)의 공식 문서·CHANGELOG로 확인한 뒤** 쓴다. 아래 "근거·출처"는 최신(8.x) 문서 기준이라 7.x와 다를 수 있다. 확인되지 않으면 멈추고 보고한다(CLAUDE.md 규칙 6).
>
> 관련 문서: `CLAUDE.md`, `docs/phases/phase-8-app-store-release.md`(릴리스 플로우), `docs/phases/phase-10-testflight-analytics.md`(계측·고지 선행 패턴), `docs/testing/tracking-plan.md`(Sentry 보류 기록), `docs/legal/privacy.html`.

---

## 목표 (Goal)

1. **크래시·오류 수집**: Sentry로 네이티브 크래시와 JS 오류를 수집한다. 지금은 JS 오류만 PostHog `app_error`(이름만)로 보이고 네이티브 크래시는 보이지 않는다.
2. **스토어 메타데이터**: 한국어 검색 키워드를 조사해 App Store 이름·부제·키워드를 바꾼다. 이 값들은 새 버전을 제출할 때 함께 바꾼다.
3. **iOS 언어 표기**: 스토어에 '언어: 영어'로 나오는 것을 한국어로 바로잡는다.
4. **방침 정합**: 개인정보처리방침·앱 안 고지·App Store Connect '앱 개인정보'에 Sentry를 반영하고, 실제 동작과 어긋난 '제품 영역 전송' 문구를 바로잡는다.
5. **개발용 앱 분리**: 개발 빌드를 스토어 앱과 다른 번들 ID로 만들어 한 기기에 나란히 설치한다. 개발과 시험이 실사용 계정의 데이터에 닿지 않게 한다.

## 확정된 결정 (임의 변경 금지)

- **개발 환경**: 앱 변형만 분리한다(번들 ID·이름·scheme). Supabase는 운영 프로젝트 하나를 함께 쓴다. 개발용 앱은 별도 익명 계정이라 RLS로 격리되고, 그 uid는 `ops.internal_users`에 넣어 지표에서 뺀다.
- **영역 전송 문구**: 동작은 바꾸지 않고 문구를 실제 동작에 맞춘다. 실제 동작은 "OCR 텍스트가 부족하면 시트가 자동으로 뜨고, 사진이 있으면 '제품 영역으로 분석' 버튼으로 언제든 열 수 있다. 어느 경우든 사용자가 직접 고른 영역만 '분석'을 눌렀을 때 전송된다"이다(`src/hooks/useAnalysis.ts:151`, `src/app/register.tsx:568`, 커밋 `4af69c4`).
- **Sentry 범위**: 오류·크래시만 수집한다. 성능 추적(tracing)·세션 리플레이·스크린샷은 쓰지 않는다(아래 불변식 1).
- **Sentry 데이터 저장 위치**: US. 방침의 이전 국가는 미국이다(PostHog와 같다).
- **IP로 추정한 위치는 남기지 않는다(2026-11-05)**: Sentry·PostHog 모두 IP로 추정한 위치(국가·도시)를 끈다. Sentry는 IP 저장을 막아도 위치를 따로 남겨서 서버 규칙으로 지운다(Step 0). PostHog는 SDK 기본값이 위치 추정 켜짐이라 `disableGeoip: true`로 끈다(Step 4). 다시 켜려면 방침·앱 안 고지·ASC 앱 개인정보('대략적 위치')를 먼저 고친다. 켠 시점부터만 수집되고 과거 데이터에는 생기지 않는다. 국가별 사용량은 App Store Connect 앱 분석(국가별)에서 본다.
- **PostHog 기기 정보 보강을 이 빌드에 넣는다**: 선택 peer 의존성 `expo-application`·`expo-localization`을 추가한다. `expo-device`는 이미 설치돼 있다(Step 4).
- **마케팅 버전 1.0.2**: 사용자에게 보이는 새 기능이 없어 패치로 올린다. 다음 1.1.0은 영역 후보·얼굴 가리기(Phase 20) 빌드다.

## 하지 않는 것

- 로그인·계정 연결(Phase 22 — 보류), 요청 제한(Phase 15), RLS 점검(Phase 16)
- dev용 Supabase 프로젝트 분리
- 앱 화면에 보이는 이름(홈 화면 아이콘 아래 `WishShot`) 변경 — 스토어 이름만 바꾼다

---

## 불변식 (Invariants)

1. **콘텐츠 미수집**: Sentry 이벤트에 사진·OCR 원문·상품명·브랜드·가격·URL·메모를 싣지 않는다.
   - 세션 리플레이 끔, 스크린샷 첨부 끔, 뷰 계층 첨부 끔(화면에 사용자 사진·텍스트가 있다).
   - `sendDefaultPii: false`. `setUser`로 uid를 붙이지 않는다. IP는 저장하지 않는다(SDK에서 `ip_address`를 비우는 방법 + Sentry 프로젝트 설정 둘 다 — 정확한 방법은 설치 버전 문서로 확인). IP로 추정한 위치(`user.geo`)도 남기지 않는다(Step 0 서버 규칙).
   - **Sentry로 보내는 기록(브레드크럼·이벤트)에서만** URL의 쿼리 문자열을 지운다. Storage signed URL의 `token`은 하루 동안 사진을 여는 열쇠라서 Sentry에 남기지 않는다. 앱이 실제로 쓰는 URL·signed URL 영속 캐시(`wishshot.signedurl.*`)·`expo-image` 디스크 캐시는 바꾸지 않는다(CLAUDE.md의 Storage·Egress 규칙 그대로). 그 밖의 브레드크럼·이벤트에도 사용자 콘텐츠가 들어가지 않게 `beforeBreadcrumb`/`beforeSend`에서 거른다.
   - `captureException`에 사용자 콘텐츠가 든 extra/context를 붙이지 않는다.
2. **DSN이 없으면 no-op**: `EXPO_PUBLIC_SENTRY_DSN`이 비어 있으면 초기화하지 않는다. 키 없이 빌드해도 동작이 같아야 한다(PostHog와 같은 패턴).
3. **`__DEV__`에서는 기본 비활성**: 개발 중 이벤트로 프로젝트를 오염시키지 않는다. 검증용으로만 켜는 수단 1개를 둔다(예: `EXPO_PUBLIC_SENTRY_DEV=1`).
4. **운영 변형 불변**: `APP_VARIANT`가 없을 때의 설정은 의도한 추가(Sentry 플러그인·privacy manifest·언어) 외에는 지금과 같아야 한다. 특히 번들 ID·scheme·App Group·공유 확장 번들 ID가 바뀌면 기존 사용자의 공유 확장과 데이터가 깨진다.
5. **캡슐화**: Sentry 호출은 새 모듈 `src/lib/monitoring.ts`를 거친다. 화면에서 `@sentry/react-native`를 직접 import하지 않는다(`analytics.ts`와 같은 사상).
6. **버전 고정**: `npx expo install`로 SDK 57 호환 버전만 설치한다 — `@sentry/react-native ~7.11.0`, `expo-application ~57.0.2`, `expo-localization ~57.0.1`. Sentry를 8.x로 올리지 않는다(CLAUDE.md 규칙 10). 네이티브 의존성 추가는 이 셋뿐이다.
7. **비밀 값**: `SENTRY_AUTH_TOKEN`은 EAS 환경 변수(secret)에만 둔다. 앱·커밋·채팅에 넣지 않고, 에이전트는 이 값을 다루지 않는다. DSN과 org/project 슬러그는 공개 값이라 커밋해도 된다.
8. **고지 선행**: Sentry가 수집을 시작하는 빌드가 사용자에게 닿기 전에 방침(GitHub Pages)·앱 안 고지·ASC 앱 개인정보가 먼저 사실과 맞아야 한다(아래 "배포 순서").
9. **기존 오류 처리 보존**: `analytics.ts`의 `installJsErrorCapture`(기존 핸들러를 이어서 호출)가 계속 동작해야 한다. 개발 redbox와 기본 크래시 동작도 그대로 둔다.
10. **문서 정합(규칙 8)**: `CLAUDE.md`·`README.md`·`tracking-plan.md`·`.env.example`을 같은 PR에서 갱신한다.

---

## Step 0 — 선행 준비 (사람)

1. Sentry 가입 → 조직 생성. 데이터 저장 위치는 **US**를 고른다(확정된 결정). 조직을 만들 때만 고를 수 있고 나중에 못 바꾼다.
2. React Native 프로젝트 생성 → DSN, org 슬러그, project 슬러그를 에이전트에게 전달한다(공개 값).
3. Sentry 프로젝트 설정
   - IP 주소 저장 끄기(Security & Privacy 메뉴의 'Prevent Storing of IP Addresses'. 조직 단위로 켜면 프로젝트 설정은 잠긴 채 켜진다)
   - IP로 추정한 위치 지우기: Project Settings → Security & Privacy → Advanced Data Scrubbing → Add Rule. 방식 `Remove`, 대상 `Anything`, 출처 `$user.geo.**`. IP 저장을 막아도 Sentry는 IP로 추정한 위치를 따로 남긴다(Sentry 서버 측 스크러빙 문서).
   - 무료 한도를 넘었을 때 과금되지 않게 지출 한도 확인
   - 오류 보존 기간 확인(방침 '보유 기간'에 쓴다)
4. Sentry 조직 설정에서 auth token 발급 → EAS 환경 변수 `SENTRY_AUTH_TOKEN`으로 등록(production·preview·development, secret 공개 범위). 값은 채팅에 붙이지 않는다.
5. `EXPO_PUBLIC_SENTRY_DSN`을 로컬 `.env`와 EAS 환경(production)에 등록.

**DoD**: 에이전트가 DSN·슬러그를 받음. 토큰은 등록 여부만 확인(값 노출 없이 `npx eas-cli env:list production`에 이름이 보이는지).

## Step 1 — ASO 키워드 조사 (에이전트, 문서만)

1. App Store 메타데이터 규칙을 공식 문서로 다시 확인한다.
   - 이름 2~30자, 부제 30자, **키워드 100바이트**(글자 수가 아니다. 한글은 UTF-8로 한 글자에 3바이트라 약 33자). 키워드는 쉼표로 구분, 앱 이름·회사명과 중복 금지.
   - 이름·부제·키워드를 새 버전 제출 때만 바꿀 수 있는지(홍보 문구는 언제든 가능).
2. 한국 App Store에서 비슷한 앱(위시리스트, 스크린샷 정리, 쇼핑 메모)이 이름·부제에 쓰는 표현을 조사한다. 사용자가 검색할 만한 한국어 단어를 모은다.
3. 이름·부제·키워드 **2~3안**을 만든다. 각 안의 글자 수·바이트 수를 계산해 표로 보고한다. 이름에는 `WishShot`(또는 `위시샷`)을 남긴다.
4. 사람이 1안을 고른다. 고른 안은 이 문서 "결과 기록"에 적는다.

**DoD**: 후보 표(글자 수·바이트 수 검증 포함) 보고 → 사람이 선택 → 결과 기록에 기입 → `docs:` 커밋.

## Step 2 — 개발용 앱 변형 (에이전트)

**대상**: 새 `app.config.js`, `eas.json`, (필요하면) `app.json`.

1. Expo 공식 "multiple app variants" 방식을 따른다. `app.json`은 정적 값으로 두고, `app.config.js`가 `process.env.APP_VARIANT === 'development'`일 때만 아래 값을 덮어쓴다.

   | 항목 | 운영(변형 없음) | 개발(`development`) |
   |---|---|---|
   | `name` | `WishShot` | `WishShot Dev` |
   | `ios.bundleIdentifier` | `com.k0nghaa.wishshot` | `com.k0nghaa.wishshot.dev` |
   | `scheme` | `wishshot` | `wishshot-dev` |
   | 공유 확장 번들 ID (`extra.eas.build.experimental.ios.appExtensions[0].bundleIdentifier`) | `com.k0nghaa.wishshot.share-extension` | `com.k0nghaa.wishshot.dev.share-extension` |
   | App Group (같은 블록의 `entitlements`) | `group.com.k0nghaa.wishshot` | `group.com.k0nghaa.wishshot.dev` |

   - **scheme도 바꾸는 이유**: `expo-share-intent`(8.0.1)의 공유 확장은 `config.scheme`으로 본 앱을 연다. scheme이 같으면 개발용 앱의 공유 확장이 스토어 앱을 열 수 있다.
   - 플러그인은 App Group(`group.<번들ID>`)과 확장 번들 ID(`<번들ID>.share-extension`)를 번들 ID에서 자동으로 만든다(`node_modules/expo-share-intent/plugin/build/ios/constants.js`). 그래서 직접 적어 둔 `appExtensions` 블록만 변형별로 맞추면 된다. 이 블록은 정확히 1개여야 한다(2개면 플러그인이 빌드를 멈춘다).
2. `eas.json`의 `development` 프로필에 `"env": { "APP_VARIANT": "development" }`를 추가한다. `production`·`preview`는 그대로 둔다.
3. 로컬 개발 서버 명령을 정한다(PowerShell): `$env:APP_VARIANT='development'; npx expo start --dev-client --tunnel --scheme wishshot-dev`.
   - `APP_VARIANT`가 없으면 개발 서버가 운영 scheme(`wishshot`)을 앱에 넘긴다. 그러면 `expo-share-intent`가 공유 링크(`<scheme>://dataUrl=`)와 저장 키(`<scheme>ShareKey`)를 운영 scheme으로 찾아서, 개발용 앱에서 공유 시트로 받은 사진을 인식하지 못한다.
   - `--scheme`이 필요한 이유: 개발 서버 QR 링크의 scheme은 `scheme` 값이 아니라 slug로 만든 `exp+wish-shot`이다(Expo CLI는 네이티브 폴더가 없으면 slug로 정한다). 이 scheme은 expo-dev-client 플러그인이 운영 빌드에도 넣으므로 스토어 앱과 개발용 앱이 같이 갖는다. slug는 EAS 프로젝트와 묶여 바꿀 수 없다. `--scheme`을 주면 Expo CLI가 그 값을 먼저 쓴다.
   - `$env:` 값은 그 PowerShell 창에서만 유지된다.

**DoD**
- `npx expo config --type introspect`를 변형 없이 한 번, `APP_VARIANT=development`로 한 번 실행한다. 위 표의 값이 양쪽 다 맞는지 확인한다(Info.plist의 URL scheme·App Group·확장 번들 ID 포함).
- 변형 없는 출력은 이 Step 전과 비교해 차이가 없어야 한다(불변식 4).
- `npx tsc --noEmit`·`npx expo lint` 통과.

## Step 3 — Sentry 설치와 `monitoring.ts` (에이전트)

**대상**: `package.json`, 새 `metro.config.js`, `app.config.js`(또는 `app.json`) 플러그인, 새 `src/lib/monitoring.ts`, `src/app/_layout.tsx`, `src/app/settings.tsx`(`__DEV__` 영역), `.env.example`.

1. `npx expo install @sentry/react-native` → `package.json`에 `~7.11.x`로 들어갔는지 확인한다.
2. 설치 버전 문서로 아래를 확인하고 적용한다.
   - 설정 플러그인: `@sentry/react-native/expo`에 `url`·`organization`·`project`.
   - Metro: `getSentryExpoConfig(__dirname)`(`@sentry/react-native/metro`)로 `metro.config.js`를 만든다. 지금은 `metro.config.js`가 없어 기본 설정을 쓰고 있다. React Compiler·reanimated 동작이 바뀌지 않는지 확인한다.
   - EAS Build 때 소스맵이 자동 업로드되는 조건(`SENTRY_AUTH_TOKEN`).
3. `src/lib/monitoring.ts`
   - `initMonitoring()`: DSN이 없거나 `__DEV__`(검증 플래그 제외)면 아무것도 하지 않는다. `Sentry.init`에 불변식 1의 옵션을 넣는다(`sendDefaultPii: false`, tracing 0, 리플레이·스크린샷·뷰 계층 끔, `beforeBreadcrumb`/`beforeSend` 필터). `environment`는 `__DEV__`면 `development`, 아니면 `production`.
   - `wrapRoot(component)`: DSN이 없으면 컴포넌트를 그대로 돌려준다.
4. `_layout.tsx`: 모듈 최상단(컴포넌트 밖)에서 `initMonitoring()`을 호출하고, 기본 export를 `wrapRoot(RootLayout)`로 감싼다. Sentry가 먼저 초기화돼야 `installJsErrorCapture`가 Sentry 핸들러를 이어서 호출한다(불변식 9). 실제 호출 순서를 코드로 확인해 보고한다.
5. `settings.tsx`(`__DEV__` 영역): "네이티브 크래시 테스트(개발용)" 버튼을 하나 추가한다(SDK의 네이티브 크래시 함수). JS 오류는 기존 "테스트 에러 발생" 버튼을 쓴다.
6. **Apple privacy manifest**: React Native는 기본 정적 링크라 Sentry가 쓰는 API 사유를 앱이 직접 선언해야 한다는 Sentry 문서를 따른다. `ios.privacyManifests.NSPrivacyAccessedAPITypes`에 Sentry 문서의 항목(UserDefaults `CA92.1`, SystemBootTime `35F9.1`, FileTimestamp `C617.1`)을 넣는다. 수집 데이터 유형(CollectedDataTypes)까지 넣을지는 Expo 설정 지원 여부를 확인해 보고한다.
7. `.env.example`에 `EXPO_PUBLIC_SENTRY_DSN=`, `EXPO_PUBLIC_SENTRY_DEV=` 추가(값 비움). `SENTRY_AUTH_TOKEN`은 주석으로 "EAS secret에만"이라고만 적는다.

**DoD**
- `npx tsc --noEmit`·`npx expo lint` 통과.
- `npx expo config --type introspect`에 Sentry 플러그인과 privacy manifest가 보인다.
- DSN 없이도 import·초기화 경로가 no-op임을 코드로 확인한다.
- 이 Step의 `package.json` diff에서 네이티브 의존성은 `@sentry/react-native` 하나뿐이다(나머지 둘은 Step 4).
- `npx expo-doctor`를 실행해 결과만 보고한다. 패치 버전 불일치가 나와도 `--fix` 하지 않는다.

## Step 4 — PostHog 기기 정보 보강 + iOS 언어 한국어 표기 (에이전트)

**대상**: `package.json`, `app.config.js`(또는 `app.json`) 플러그인, `src/lib/analytics.ts`(위치 추정 끄기), (필요하면) `docs/legal/privacy.html`·`src/constants/privacy.ts`.

1. `npx expo install expo-application expo-localization`.
2. **PostHog 보강**: 설치된 `posthog-react-native` 버전 문서로, 이 모듈들이 있으면 자동으로 쓰는지와 **어떤 속성이 새로 수집되는지**를 확인해 표로 보고한다. `analytics.ts` 변경은 아래 3 외에는 원칙적으로 없다(필요하면 보고 후 진행).
   - 지금 방침은 '기기 기본 정보(모델·OS 버전·앱 버전)'만 적는다. 새로 수집되는 속성에 언어·시간대처럼 이 범위를 벗어나는 항목이 있으면 Step 5에서 방침·앱 안 고지에 더한다(고지 선행).
3. **PostHog 위치 추정 끄기**(확정된 결정): `analytics.ts`의 PostHog 초기화 옵션에 `disableGeoip: true`를 넣는다. 설치된 `@posthog/core`(1.55.3)는 클라이언트 SDK의 기본값이 `false`라서, 그대로 두면 서버가 이벤트에 IP로 추정한 위치(`$geoip_*`)를 붙인다. JS만 바뀐다.
   - PostHog가 이벤트에 `$ip`를 저장하는지는 PostHog 프로젝트 설정(클라이언트 IP 버리기)에 달려 있다. 사람이 이벤트 속성으로 확인하고, 저장되고 있으면 그 설정을 켠다. 항목명은 화면에서 확인한다.
4. **iOS 언어**: `expo-localization` 설정 플러그인의 `supportedLocales: { ios: ['ko'] }`(Expo 공식 현지화 가이드의 방식)를 쓴다.
   - 플러그인이 Info.plist에 실제로 쓰는 키를 introspect로 확인한다. `CFBundleDevelopmentRegion`이 `en`으로 남으면 `ios.infoPlist`로 `ko`를 함께 지정할지 보고한다(Expo 문서에는 없는 방식이라 사람이 판단).
5. 스토어 '언어' 표기는 Apple이 바이너리의 현지화로 정한다. 정확한 규칙은 공식 문서에 없으므로 **출시 뒤 스토어 페이지에서 사람이 확인**한다(결과 기록에 적는다).

**DoD**
- introspect 출력에 언어 설정이 보이고, 운영 변형의 다른 값은 그대로다.
- PostHog 새 속성 표 보고(방침 범위 안/밖 표시).
- `analytics.ts`에 `disableGeoip: true`가 들어갔다(이벤트에 `$geoip_*`가 없는지는 Step 7에서 확인).
- `tsc`·`lint` 통과. `package.json`의 네이티브 의존성 추가는 Step 3과 합쳐 셋뿐이다.

## Step 5 — 방침·앱 안 고지·영역 고지 문구 (에이전트 초안 → 사람 검토)

**대상**: `docs/legal/privacy.html`, `src/constants/privacy.ts`, `src/app/register.tsx`(최초 영역 고지 문구), `src/components/RegionSelectSheet.tsx`·`src/lib/queries/parse.ts`·`src/lib/ocr/VisionOcrEngine.ts`의 주석.

1. **영역 전송 문구 정정**(확정된 결정): "텍스트를 찾지 못한 경우에 한해"를 실제 동작으로 바꾼다. 예: "텍스트가 부족하거나 사용자가 '제품 영역으로 분석'을 누른 경우, 사용자가 직접 선택한 제품 영역 이미지만 '분석'을 누를 때 전송되며 저장하지 않습니다." 원본 전체·다른 부분은 전송하지 않는다는 문장은 그대로 둔다.
   - `privacy.html` 2절·3절, `privacy.ts`, 최초 영역 고지 Alert(`register.tsx:220` — 지금은 "텍스트를 찾지 못했습니다"로 시작해 버튼으로 열었을 때 사실과 다르다), 위 파일들의 주석.
2. **Sentry 추가**: `privacy.html`에 오류 수집과 국외 이전 항목을 PostHog 절과 같은 형식으로 넣는다.
   - 수집 항목: 오류·크래시 정보(오류 종류, 발생 위치(스택), 앱 상태), 기기 기본 정보(모델·OS 버전·앱 버전), 설치별 무작위 식별자
   - 수집하지 않는 항목: 사진·인식된 텍스트·사용자가 입력하거나 저장한 콘텐츠, IP 주소(저장하지 않음), IP로 추정한 위치
   - PostHog 절의 '수집하지 않는 항목'에도 IP로 추정한 위치를 적는다. IP는 Step 4에서 확인한 PostHog 설정에 맞춰 적는다.
   - 이전받는 자(법인명은 Sentry 방침에서 사람이 확인), 이전 국가(미국), 이전 일시·방법, 이용 목적(오류 분석·안정성 개선), 보유 기간(Step 0의 보존 기간)
   - Step 4에서 PostHog 새 속성이 방침 범위 밖으로 나왔으면 PostHog 절의 수집 항목에도 더한다.
3. `privacy.ts`에 같은 내용을 한 문장으로 더한다(단일 소스 원칙 — 인앱 고지와 방침이 같은 말을 한다).
4. 방침 시행일(개정일)을 갱신한다.
5. 카피는 CLAUDE.md 규칙 4(간결한 단답, "~습니다")를 따른다.

**DoD**: 인앱 고지와 `privacy.html`이 같은 내용을 말한다. PR 설명에 "방침 문구 사람 검토 필요"를 적는다. `tsc`·`lint` 통과.

## Step 6 — 문서 정합 (에이전트)

- `CLAUDE.md`: 기술 스택에 Sentry(수집 범위·불변식 요약), 계측 항목의 "선택 peer 의존성 설치 금지" 서술을 "이 빌드부터 설치"로 바꾼다(`expo-device`는 처음부터 설치돼 있었음도 바로잡는다), 디렉터리에 `app.config.js`·`metro.config.js`·`src/lib/monitoring.ts`, 명령어에 개발용 변형 실행 명령, OTA 뒤 소스맵 업로드 명령(아래), 환경 변수에 `EXPO_PUBLIC_SENTRY_DSN`·`SENTRY_AUTH_TOKEN`(EAS secret). 영역 전송 서술도 확정된 결정에 맞춘다.
- OTA 소스맵 업로드(7.11 기준 — 설치 버전 문서로 확인): `npx expo export --platform ios --dump-sourcemap` → `npx eas-cli update ...` → `npx --package=@sentry/react-native sentry-expo-upload-sourcemaps dist`(`SENTRY_AUTH_TOKEN`은 셸 환경 변수로 사람이 설정). 스코프 패키지 `@sentry/expo-upload-sourcemaps`는 8.9.0 이상 전용이라 쓰지 않는다.
- `README.md`: 기술 스택 줄.
- `docs/testing/tracking-plan.md`: 보류 목록의 Sentry 행과 `app_error` 한계 설명을 "Sentry 도입(1.0.2)"으로 갱신한다.

**DoD**: 보고 → 승인 → `docs:` 커밋. 이어서 PR(템플릿 구조) 승인 요청.

## Step 7 — 개발 빌드와 실기기 확인 (사람)

1. `npx eas-cli build --platform ios --profile development`. 새 번들 ID(본 앱·공유 확장)와 App Group에 대한 프로비저닝을 EAS가 만들도록 Apple 로그인으로 승인한다.
2. 스토어 앱을 지우지 않고 개발용 앱(`WishShot Dev`)을 설치한다. 두 앱이 나란히 있는지 확인한다.
3. 확인 항목
   - 사진 앱 공유 시트에 두 앱이 따로 보이고, 각각 자기 앱을 연다.
   - 개발 서버(Step 2의 명령)의 QR을 카메라로 찍으면 스토어 앱이 아니라 개발용 앱이 열린다. 안 열리면 개발용 앱을 직접 열어 개발 런처에서 서버를 고르거나 URL을 입력한다.
   - 개발용 앱에서 담기·OCR·저장이 동작한다(새 익명 계정).
   - `EXPO_PUBLIC_SENTRY_DEV=1`로 띄워 "테스트 에러 발생"·"네이티브 크래시 테스트"가 Sentry에 `development` 환경으로 들어온다. 이벤트에 사용자 콘텐츠·IP·위치(`geo`)가 없다.
   - 설정의 "계측 토글(개발용)"을 켜고 이벤트를 하나 보내, PostHog Activity에서 Step 4 표의 새 속성이 보이는지 확인한다. `$geoip_*` 속성은 없어야 한다.
   - 스토어 앱은 그대로 열리고 기존 데이터가 보인다.
4. 개발용 앱의 uid를 SQL Editor에서 `ops.internal_users`에 넣는다(uid는 git에 남기지 않는다).

**DoD**: 위 항목 체크 결과를 에이전트에게 전달 → 결과 기록에 기입.

## Step 8 — 릴리스·제출 (사람, 에이전트 보조)

1. PR 머지 → `dev`에서 `release/v1.0.2` 분기 → `app.json` `version`을 `1.0.2`로 올린다. 빌드 번호는 `autoIncrement`.
2. `npx eas-cli build --platform ios --profile production` → 빌드 로그에서 소스맵 업로드 성공 확인 → `npx eas-cli submit --platform ios --profile production --latest`.
3. TestFlight 내부 테스터로 회귀 확인(담기·공유 시트·OCR·편집·링크·온보딩). 스토어 앱 자리에 설치되므로 기존 데이터가 그대로인지 함께 본다.
4. App Store Connect
   - 새 버전: 이름·부제·키워드(Step 1 결과), 새로운 기능 문구
   - 앱 개인정보: Sentry 수집 유형 추가(크래시 데이터·기타 진단 데이터 — 사용자와 연결 안 됨, 추적 안 함, 목적은 Sentry 문서 기준 앱 기능/분석 중 사람 판단). tracing을 껐으므로 성능 데이터는 넣지 않는다.
   - 출시 옵션은 **수동 출시**로 둔다(아래 배포 순서 3).
5. 심사 제출.

## 배포 순서 (고지 선행 — 순서 위반 금지)

1. ASC 앱 개인정보 반영(언제든 가능·재심사 없음)
2. 심사 제출(수동 출시)
3. 승인 뒤 **출시 버튼을 누르기 전에** `release/v1.0.2` → `main` 머지로 GitHub Pages 방침을 갱신하고 노션 방침 페이지를 동기화한다(사람). 방침 URL에서 개정 내용이 보이는지 확인한다.
4. 출시 → `main`에 태그 `v1.0.2` → `dev` 역머지(Phase 8 Step 0-3).

---

## 미결 사항 (사람 결정)

1. **Sentry 이벤트 목적 분류**(ASC 앱 개인정보): 앱 기능 / 분석.
2. **방침의 Sentry 보유 기간 표기**(Step 5): Developer 플랜 기준 30일 / 체험 기간·상위 플랜까지 감싸는 '최대 90일'.

## 완료 기준 (Phase DoD)

- [ ] Step 1~6 DoD 충족, `tsc`·`lint` 통과, 네이티브 의존성 추가는 의도한 것뿐
- [ ] 운영 변형 introspect 결과가 의도한 변경 외 동일
- [ ] 사람 확인: 개발용 앱 나란히 설치·공유 시트 분리·Sentry 수신(콘텐츠·IP 없음)
- [ ] 방침·앱 안 고지·ASC 앱 개인정보 반영 후 출시
- [ ] CLAUDE.md·README·tracking-plan 갱신 포함 PR(템플릿 구조)

## 근거·출처

- Sentry Expo 설정(설치·플러그인·Metro·init·wrap): https://docs.sentry.io/platforms/react-native/manual-setup/expo/
- Sentry Expo 소스맵(EAS Build 자동 업로드, EAS Update 명령, 8.9.0 이상 스코프 패키지): https://docs.sentry.io/platforms/react-native/sourcemaps/uploading/expo/
- Sentry expo-updates 태그: https://docs.sentry.io/platforms/react-native/manual-setup/expo/expo-updates/
- Sentry 수집 데이터·`sendDefaultPii`·IP: https://docs.sentry.io/platforms/react-native/data-management/data-collected/
- Sentry 모바일 개인정보 FAQ(App Store 설문): https://docs.sentry.io/security-legal-pii/security/mobile-privacy/
- Sentry Apple privacy manifest: https://docs.sentry.io/platforms/react-native/data-management/apple-privacy-manifest/
- Sentry 데이터 저장 위치: https://docs.sentry.io/organization/data-storage-location/
- Expo privacy manifest: https://docs.expo.dev/guides/apple-privacy/
- Expo 앱 변형: https://docs.expo.dev/tutorial/eas/multiple-app-variants/
- Expo 현지화: https://docs.expo.dev/guides/localization/
- App Store Connect 앱 정보(이름·부제·키워드 제한): https://developer.apple.com/help/app-store-connect/reference/app-information/app-information
- App Store Connect 버전 정보(홍보 문구는 제출 없이 수정 가능): https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information
- SDK 57 호환 버전: `node_modules/expo/bundledNativeModules.json`(`@sentry/react-native ~7.11.0`, `expo-localization ~57.0.1`)
- 공유 확장 식별자 규칙: `node_modules/expo-share-intent/plugin/build/ios/constants.js`(8.0.1)

---

## 결과 기록 (구현 세션이 채움)

- **완료일**:
- **Step 0(준비)**: org 슬러그 `wishshot`, project 슬러그 `wishshot`. 저장 위치 US(DSN 호스트 `ingest.us.sentry.io`로 확인). IP 저장 방지를 조직 단위로 켬(프로젝트는 잠긴 채 상속). Business 체험 14일(2026-11-05 시작), 결제 정보·결제 수단 없음 → 끝나면 Developer 플랜(요금 페이지 기준 보존 30일). EAS 환경 변수: `SENTRY_AUTH_TOKEN`(Secret, production·preview·development), `EXPO_PUBLIC_SENTRY_DSN`(Plain text, production). 로컬 `.env`에 DSN 추가. 위치 제거 규칙(`$user.geo.**`): 사람이 추가 예정.
- **Step 1(ASO)**: 고른 이름 / 부제 / 키워드(바이트 수) /
  - 이름: `WishShot 위시샷 - 스크린샷 위시리스트` (25자)
  - 부제: `캡처 한 장으로 내 취향과 관심사 저장, 통합 장바구니` (30자)
  - 키워드: `찜목록,사고싶은,갖고싶은,관심상품,위시템,구매목록,캡쳐 정리,스샷 정리` (UTF-8 99바이트, 8개)
  - 검증(스크립트): 한도 안. 2자 이하 키워드 없음. 이름·부제·카테고리(쇼핑)와 겹치는 단어 없음(`캡쳐`는 `캡처`의 다른 표기로 일부러 넣음). 쉼표 뒤 공백 없음.
  - 공식 규칙 확인(2026-11-03): 이름 2~30자(심사 제출 전까지, 그 뒤엔 새 버전에서 변경). 부제 30자(새 버전 제출 때 변경). 키워드 100바이트이며 **키워드 하나는 2자를 넘어야 함**. 앱 이름·회사명·다른 앱/회사 이름 금지(지침 2.3.7). 이름·부제·카테고리 단어 반복은 낭비. 키워드 변경 시점은 문서에 명시가 없으나 버전 단위 항목이라 1.0.2와 함께 바꾼다. 홍보 문구만 재제출 없이 언제든 수정할 수 있고 검색 순위와 무관하다. 개발자 사이트 가이드는 "100 characters", ASC 도움말은 "100 bytes"로 적어서 더 엄격한 바이트 기준으로 계산했다. ASC 입력 칸의 남은 글자 수 표시로 다시 확인한다.
  - 변경 전 순위(iTunes 검색 API·KR, 2026-11-02, 출시 뒤 비교용): 위시리스트 56위, 스크린샷 33위, 스크린샷 정리 74위, 쇼핑 위시리스트 52위, 상품 저장 8위, 관심상품 9위. 찜목록·사고싶은·갖고싶은·캡처는 200위 밖. 스토어 언어 표기는 `EN`(Step 4 대상).
- **Step 2(변형)**: introspect 비교 결과 /
  - 변형 없음: 이 Step 전 출력과 비교해 달라진 것은 `_internal.dynamicConfigPath`(설정 파일 경로 메타데이터)뿐이다. 앱 이름·번들 ID·scheme·URL scheme·App Group·확장 번들 ID 모두 같다(불변식 4).
  - `APP_VARIANT=development`: 이름 `WishShot Dev`(`CFBundleDisplayName` 포함), 번들 ID `com.k0nghaa.wishshot.dev`, scheme `wishshot-dev`, URL scheme `wishshot-dev`·`com.k0nghaa.wishshot.dev`, App Group `group.com.k0nghaa.wishshot.dev`(본 앱 entitlements·`AppGroupIdentifier`·확장 블록), 확장 번들 ID `com.k0nghaa.wishshot.dev.share-extension`. Xcode 본 타깃 이름은 `WishShotDev`가 된다(이름에서 파생). `exp+wish-shot`은 두 변형 모두 그대로다(Step 2-3의 `--scheme`으로 우회).
  - `npx eas-cli config`: development 프로필은 `development` EAS 환경과 `env`의 `APP_VARIANT`를 읽어 위 개발 값으로, production 프로필은 운영 값으로 풀린다.
  - `npx tsc --noEmit`·`npx expo lint` 통과.
- **Step 3(Sentry)**: 설치 버전 / 초기화·핸들러 순서 확인 / privacy manifest 범위 /
- **Step 4(언어)**: 택한 방식 / 출시 뒤 스토어 표기 /
- **Step 5(방침)**: 바뀐 문장 목록 / 시행일 /
- **Step 7(실기기)**: 체크 결과 /
- **Step 8(제출)**: 빌드 번호 / 제출·승인·출시일 /
- **사람이 정한 것**: ASO 후보 3안 중 A안(이름에 '스크린샷 위시리스트')을 골랐고, 부제 문구는 직접 썼다. IP로 추정한 위치를 Sentry·PostHog 모두 끄기로 했다(필요해지면 고지한 뒤 켠다).
- **에이전트가 제안해 채택한 것**: 키워드를 모두 3자 이상으로 구성(2자 이하는 구로만 넣음). 부제에 `장바구니`가 들어가면서 키워드의 `장바구니`를 `구매목록`으로 바꿈. 개발 서버 명령에 `--scheme wishshot-dev` 추가(`exp+wish-shot` 충돌 우회).
- **에이전트가 구현한 것**: `app.config.js`(`APP_VARIANT=development`일 때만 이름·번들 ID·scheme·공유 확장 블록을 덮어씀. 확장 블록이 1개가 아니면 설정 단계에서 멈춤), `eas.json` development 프로필의 `env.APP_VARIANT`.
