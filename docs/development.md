# 개발 가이드

WishShot(위시샷) 앱을 로컬에서 실행하고, 빌드·출시하고, DB·Edge Function을 배포·운영하는 방법을 모은 문서입니다. **절차·명령·수치는 이 문서가 정본**입니다. 서비스 소개는 [README](../README.md), 저장소 작업 규칙·구조·원칙은 [CLAUDE.md](../CLAUDE.md), 문서 읽는 순서와 용어는 [문서 안내](README.md)를 참고하세요.

## 기술 스택

- **앱**: Expo SDK 57 (React Native 0.86) + Expo Router + TypeScript, iOS 전용
- **백엔드**: Supabase (Postgres + Storage + Auth), `@supabase/supabase-js`로 직접 호출 + RLS
- **인증**: **익명 로그인**(로그인 벽 없음, 기기별 세션). 세션은 AsyncStorage에 저장, RLS가 `auth.uid()`로 행 격리. 세션을 확인하지 못해도 새 계정을 만들지 않는다 — 아래 "익명 세션 지키기". (계정 연결은 보류)
- **공유 시트**: `expo-share-intent` (iOS Share Extension). 받은 공유는 루트 레이아웃의 공유 처리기(`ShareIntentHandler`)가 어느 탭·화면에서든 처리합니다 — 사진은 등록 폼, URL은 전체 탭 링크 저장 모드. 등록·편집 폼을 작성 중이면 [지금 열기](작성 중인 내용 버림)·[저장 후 열기](폼을 닫으면 이어서 열림) 중에서 고르게 묻습니다
- **OCR**: 온디바이스 Apple Vision — 자작 로컬 Expo 네이티브 모듈 `modules/expo-vision-ocr` (한국어+영어 인식). `src/lib/ocr`의 `OcrEngine` 뒤에 캡슐화
- **LLM 정제 + 카테고리 추천(FR-8)**: Supabase Edge Function `parse-screenshot-text` (Deno) + Claude Haiku. OCR 원문을 정제하고, 기존 카테고리 이름을 함께 보내면 그중 하나를 추천(`suggestedCategory`). **텍스트가 부족하거나 사용자가 "제품 영역으로 분석"을 누르면, 사용자가 선택한 제품 영역 크롭만 '분석' 때 예외 전송해 분석(Phase 6, 하위호환·미저장)**. 요청 한도(사용자·전체)·입력 크기 상한으로 API 비용 제한
- **구매처 링크 찾기(Phase 21)**: Supabase Edge Function `find-purchase-links` (Deno) + Claude Haiku 5.5 웹 검색. 등록 폼에서 제품명이 채워지고 링크 칸이 비면 **제품명·브랜드·입구 채널(캡처에 보인 도메인 또는 몰)만** 보내 판매처 상품 페이지 링크를 채웁니다. 주소가 보인 카페24 쇼핑몰은 그 사이트의 검색 페이지를 먼저 읽고, 링크는 Google Web Risk 대조와 접속 확인을 거친 것만 넣습니다. 전용 요청 한도(`0007`)
- **빌드·출시**: Windows PC에서 EAS 클라우드 빌드. 개발용 앱으로 확인한 뒤 production 빌드를 App Store 심사에 제출합니다(TestFlight 테스트 단계 없음). JS만 바뀐 수정은 OTA(`eas update`) — 아래 "앱 빌드·출시"
- **계측(Phase 10)**: PostHog (`posthog-react-native`). 커스텀 이벤트 + 자동 라이프사이클 수집, 전부 `src/lib/analytics.ts` 경유. **키 미설정 시 no-op**, `__DEV__` 기본 옵트아웃. 속성은 enum·수치만 — 사진·텍스트 등 콘텐츠 미수집, IP로 추정한 위치 미수집. 1.0.2부터 앱 버전·언어·시간대 자동 수집(`expo-application`·`expo-localization`). 정본: [`docs/testing/tracking-plan.md`](testing/tracking-plan.md)
- **오류·크래시 수집(Phase 14, 1.0.2)**: Sentry (`@sentry/react-native` 7.11). 오류·크래시만(성능 추적·리플레이·스크린샷 끔), 전부 `src/lib/monitoring.ts` 경유, 사용자 내용·IP·위치 제외. **DSN 미설정 시 no-op**, `__DEV__` 기본 비활성. 소스맵은 EAS Build가 자동 업로드
- **개발용 앱 분리(Phase 14)**: `APP_VARIANT=development`(EAS development 프로필)면 `app.config.js`가 번들 ID·이름·scheme을 바꿔 `WishShot Dev`로 빌드 — 스토어 앱과 한 기기에 나란히 설치, 별도 익명 계정
- **디자인**: 흰 배경 + iOS 시스템 그레이 모노톤, 와인색은 새 링크 점·알림 배지에만(색 토큰 = `src/constants/theme.ts`, 정본 = `docs/design/color_tokens.md`)

주요 화면: **하단 알약 탭바(카테고리·전체·알림·검색 — 앱을 열면 전체)** · 전체(전체 아이템 3열 그리드·설정 진입) · 카테고리(2×2 모자이크 카드·설정 진입) · 알림(저장 뒤 링크를 붙인 기록) · 검색 · 등록(OCR 자동채움·카테고리 추천·메모/태그) · **상세 풀스크린 뷰어 + 정보(i) 하프시트**(편집·카테고리 이동·삭제) · 편집 · 설정(개인정보 안내). **로그인 화면 없이 익명 로그인으로 바로 사용.**

## 로컬 실행

사전 준비: Node.js LTS, git. Supabase 프로젝트의 URL·anon 키.

```bash
# 1) 의존성 설치
npm install

# 2) 환경 변수 설정
cp .env.example .env
#   .env 에 EXPO_PUBLIC_SUPABASE_URL 과 EXPO_PUBLIC_SUPABASE_ANON_KEY 입력
#   (선택) 계측: EXPO_PUBLIC_POSTHOG_KEY / EXPO_PUBLIC_POSTHOG_HOST — 미설정이면 계측만 꺼진 채 동작
#   (선택) 오류 수집: EXPO_PUBLIC_SENTRY_DSN — 미설정이면 Sentry만 꺼진 채 동작(개발 중엔 기본 비활성)

# 3) 개발 서버 (이 환경은 --tunnel 필수)
npx expo start --tunnel            # Expo Go 로 접속 (네이티브 모듈 없는 화면 확인용)
```

개발용 앱(`WishShot Dev` — 스토어 앱과 나란히 설치되는 개발 빌드)으로 접속할 때는 PowerShell에서:

```powershell
$env:APP_VARIANT='development'; npx expo start --dev-client --tunnel --scheme wishshot-dev
```

- `APP_VARIANT`가 없으면 운영 scheme이 앱에 넘어가 공유 시트로 받은 사진을 인식하지 못합니다(`expo-share-intent`가 scheme으로 앱을 찾음). `--scheme`이 없으면 QR 링크가 스토어 앱도 가진 기본 scheme(`exp+wish-shot`)을 씁니다. `$env:` 값은 그 창에서만 유지됩니다.
- Sentry까지 확인할 땐 `.env`에 `EXPO_PUBLIC_SENTRY_DEV=1`을 넣고 `--clear`로 띄웁니다.
- `expo-share-intent`·`expo-vision-ocr`(OCR) 등 네이티브 모듈은 Expo Go에서 동작하지 않습니다. 공유 시트·OCR까지 확인하려면 개발용 앱이 설치된 실기기가 필요합니다(Expo Go·시뮬레이터에선 OCR이 `MockOcrEngine`으로 폴백).
- `.env` 변경 후에는 `npx expo start --clear`로 재시작해야 반영됩니다.

## 자주 쓰는 명령어

| 명령어 | 용도 |
|---|---|
| `npx tsc --noEmit` | 타입 체크 |
| `npx expo lint` | ESLint |
| `npx expo-doctor` | 설정·의존성 정합성 점검(패치 미스매치가 나와도 `expo install --fix`는 하지 않음) |
| `deno test --no-lock supabase/tests/find_purchase_links_test.ts supabase/tests/purchase_channel_test.ts` | 구매처 함수 순수 로직 + 앱 입구 채널 판별 단위 시험(네트워크·키 없음) |
| `deno test --no-lock supabase/tests/session_vault_test.ts supabase/tests/support_mail_test.ts` | 세션 저장 어댑터·시작 판정 + 문의 메일 주소 시험(약 30초, `node_modules` 필요 — 설치된 supabase-js를 가짜 서버·가짜 저장소에 연결). 끝에 `-- --baseline`을 붙이면 고치기 전 동작으로 같은 사례를 돌려 실패를 보인다 |
| `deno check --no-lock supabase/functions/find-purchase-links/index.ts` | 구매처 함수 타입 검사 |
| `npx expo-updates runtimeversion:resolve --platform ios` | 지금 코드의 runtimeVersion(fingerprint) 확인 — `APP_VARIANT`가 없는 셸에서 |

## 앱 빌드·출시

빌드·제출·OTA는 Apple 인증이나 운영 채널이 걸려 있어 사람이 실행합니다.

**개발 빌드** — 개발용 앱(`WishShot Dev`):

```powershell
npx eas-cli build --platform ios --profile development
```

- `eas.json`의 development 프로필이 `APP_VARIANT=development`를 넣어 별도 번들 ID(`com.k0nghaa.wishshot.dev`)·별도 익명 계정으로 만듭니다. 이 계정의 uid는 지표에서 빼도록 `ops.internal_users`에 넣습니다.
- 네이티브 모듈을 추가·변경했을 때만 다시 빌드합니다. JS 변경은 개발 서버로 확인합니다.

**출시 흐름**: `dev` → `release/vX.Y.Z` 브랜치 → 개발용 앱으로 확인 → production 빌드 → 제출·심사 → 출시 → `release/vX.Y.Z` → `main` PR(머지 커밋에 태그 `vX.Y.Z`) → `main` → `dev` 역머지. 개인정보처리방침이 바뀌는 출시는 **출시 버튼을 누르기 전에** `main` 머지로 방침(GitHub Pages)을 갱신하고 노션 방침 페이지를 동기화합니다.

```powershell
Remove-Item Env:APP_VARIANT -ErrorAction SilentlyContinue   # 개발 서버를 띄운 창이면 남아 있다 — 남으면 개발용 앱 설정으로 빌드돼 실패
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production --latest   # App Store Connect 업로드
```

업로드한 빌드는 App Store Connect에서 심사에 제출합니다(TestFlight 테스트 단계는 거치지 않음).

- production 프로필은 `channel: "production"`(OTA 사용)·`autoIncrement`(빌드 번호 자동 증가)입니다.
- 앱 버전(App Store에 보이는 버전)은 `app.json`의 `expo.version` 하나가 정본입니다. 출시마다 이 값만 올립니다. `package.json`의 `version`은 쓰지 않습니다 — Expo는 앱 설정에 버전이 없을 때만 그 값을 읽습니다.
- 네이티브를 바꾸면 `runtimeVersion`(`app.json`의 `policy: "fingerprint"`)이 달라집니다. 그 빌드를 받은 사용자만 이후 OTA를 받습니다(불일치 크래시 방지).

**OTA(JS만 바뀐 수정)** — 새 빌드·재심사 없이 배포:

```powershell
npx expo-updates runtimeversion:resolve --platform ios   # 운영 빌드의 runtimeVersion과 같아야 OTA가 그 빌드에 간다
npx eas-cli update --branch production --platform ios --environment production --message "..."
```

- production 채널이 `production` branch를 구독합니다. 개발용 앱(dev client)으로 먼저 확인한 뒤 올립니다.
- `--platform ios`를 붙입니다. 기본값은 웹 번들까지 내보내다 실패할 수 있습니다(앱 설정에 web 플랫폼이 남아 있음). `--environment production`은 EAS production 환경 변수를 번들에 넣습니다.
- 깨진 번들은 마지막 정상 번들(또는 내장 번들)로 폴백합니다. 고친 업데이트를 다시 publish해 롤백합니다.
- OTA 뒤 Sentry 소스맵은 수동으로 올립니다. `eas update`가 export할 때 `dist`에 소스맵을 이미 만듭니다(eas-cli `--dump-sourcemap` 기본):

```powershell
npx --package=@sentry/react-native sentry-expo-upload-sourcemaps dist
```

  `SENTRY_AUTH_TOKEN`은 그 셸에서만 환경 변수로 넣습니다(`.env`·명령어 기록에 남기지 않습니다). org·project는 `app.json`의 Sentry 플러그인에서 읽습니다. 스코프 패키지 `@sentry/expo-upload-sourcemaps`는 8.9.0 이상 전용이라 쓰지 않습니다.

**EAS 환경 변수**: `npx eas-cli env:set` / `env:push` / `env:list production`. `env:create`는 deprecated(`env:set`이 만들기·수정을 겸함). 비밀 값은 터미널 대신 expo.dev 웹(Project settings → Environment variables)에서 넣습니다(PowerShell이 명령어를 기록 파일에 남김).

## 환경 변수

**앱 (`.env`, 로컬 개발)** — `EXPO_PUBLIC_` 값은 앱 번들에 들어가므로 공개 값만 넣습니다.

| 변수 | 필수 | 설명 |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | 예 | Supabase 접속 정보(anon 키만, `service_role` 금지) |
| `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_HOST` | 아니오 | 계측. write-only 공개 키. 없으면 계측만 no-op |
| `EXPO_PUBLIC_SENTRY_DSN` | 아니오 | 오류 수집. 공개 값. 없으면 Sentry만 no-op |
| `EXPO_PUBLIC_SENTRY_DEV` | 아니오 | `1`이면 `__DEV__`에서도 Sentry를 켬(검증용, 로컬 `.env`만) |

- **EAS 클라우드 빌드는 로컬 `.env`를 읽지 않습니다.** 같은 `EXPO_PUBLIC_*` 값을 EAS 환경(production 등)에 등록합니다. 미등록이면 빌드는 되지만 앱이 켜지자마자 Supabase 환경 변수가 없어 실패합니다.
- EAS는 프로필에 `environment`가 없으면 개발 클라이언트 = development, internal 배포 = preview, 그 밖 = production 환경 변수를 씁니다(eas-cli 코드 확인).
- `SENTRY_AUTH_TOKEN`(소스맵 업로드)은 **EAS 환경 변수 Secret(production·preview·development 모두)에만** 둡니다. 토큰이 없으면 Xcode 업로드 단계가 실패해 빌드가 멈춥니다(`SENTRY_DISABLE_AUTO_UPLOAD=true`로만 건너뜀).
- `APP_VARIANT`: `development`면 개발용 앱 변형(`app.config.js`). EAS는 `eas.json` development 프로필이, 로컬 개발 서버는 셸이 넣습니다. 커밋하는 파일에는 두지 않습니다.

**Edge Function 시크릿** (`npx supabase@2.121.0 secrets set 이름=값` — 앱 `.env`와 무관):

| 변수 | 설명 |
|---|---|
| `ANTHROPIC_API_KEY` | 필수. Claude 키(정제·구매처 찾기) |
| `WEB_RISK_API_KEY` | 구매처 찾기 필수. Google Cloud Web Risk API 키 — 없으면 링크를 항상 비움 |
| `CRON_SECRET` | 고아 이미지 스윕 호출 보호 |
| `PARSE_LIMIT_USER_HOURLY` / `PARSE_LIMIT_USER_DAILY` / `PARSE_LIMIT_GLOBAL_DAILY` | AI 정제 한도(기본 30 / 100 / 300) |
| `PARSE_IMAGE_WEIGHT` | 이미지 요청을 몇 건으로 셀지(기본 1, 1~3 — 잘못된 값이면 기본값) |
| `PURCHASE_LIMIT_USER_HOURLY` / `PURCHASE_LIMIT_USER_DAILY` / `PURCHASE_LIMIT_GLOBAL_DAILY` | 구매처 찾기 한도(기본 10 / 30 / 100) |
| `PURCHASE_DEBUG_LOG` | `1`이면 후보 주소·제목을 함수 로그에 남김(시험용 — 시험 뒤 삭제) |

한도 값은 함수가 요청마다 읽으므로 재배포 없이 반영됩니다. `SUPABASE_URL`·`SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`는 런타임이 자동으로 넣습니다. 비밀 값은 앱·커밋·채팅에 넣지 않습니다.

## 계측·오류 수집 설정

코드 밖(서비스 설정)에서 맞춰 둔 값입니다. 바꾸면 개인정보처리방침과 어긋나는지 먼저 확인합니다.

- **PostHog**: SDK `disableGeoip: true` + 프로젝트의 GeoIP 변환 Paused, "Discard client IP data" 켬(IP 버리기만으로는 GeoIP가 꺼지지 않음). 익명 부트스트랩 뒤 Supabase uid로 `identify`. 이벤트·속성 정본은 [트래킹 플랜](testing/tracking-plan.md), DB 지표 SQL은 `supabase/tests/metrics.sql`.
- **Sentry**: 조직·프로젝트 슬러그 `wishshot`, 데이터 저장 위치 US. IP 미저장(SDK `infer_ip: never` + 조직 설정), 위치는 서버 규칙(`$user.geo.**` 제거)으로 지움. 보존 최대 90일(방침 §5).

## 데이터베이스 (Supabase)

마이그레이션은 `supabase/migrations/`에 번호순으로 있습니다. 기준선은 `0001_init.sql`이고, 이후 파일이 그 위에 쌓입니다.

| 파일 | 내용 |
|---|---|
| `0001_init.sql` | 테이블(`categories`/`items`/`analysis_logs`), GRANT, RLS 정책, Storage private 버킷(`item-images`)·정책 |
| `0002_cleanup_anon_users.sql` | 빈 익명 계정 주 1회 삭제 pg_cron 잡(아래 "익명 계정·고아 파일 정리") |
| `0003_orphan_images_fn.sql` | 고아 이미지 키 열거 함수 |
| `0004_internal_users.sql` | 지표 집계에서 뺄 개발자 uid 목록(`ops.internal_users`, API 비노출). uid는 git에 두지 않고 SQL Editor에서 직접 insert |
| `0005_parse_quota.sql` | AI 정제 함수의 요청 한도 카운터와 실패 기록(`ops` 스키마, 함수 `consume_parse_quota`·`record_parse_failure`는 service_role 전용) |
| `0006_permissions_and_retention.sql` | 권한 정리(public 테이블의 CRUD 외 권한 회수, 새 함수 기본 실행 권한 끔), `item-images` 업로드 제한(3MB·JPEG), 위시 삭제 시 분석 로그의 원문·AI 결과 비우기(개발자 계정 제외) |
| `0007_purchase_link_quota.sql` | 구매처 링크 찾기 함수의 전용 요청 한도 카운터와 실패 기록(함수 `consume_purchase_link_quota`·`record_purchase_link_failure`, service_role 전용) |

운영 DB 하나로 시험하므로 `0005`부터 되돌리는 SQL을 `supabase/rollback/`에 함께 둡니다.

**마이그레이션 적용** (둘 중 하나):

```bash
# 방법 A: 대시보드 SQL Editor 에 파일을 번호순으로 하나씩 붙여넣고 Run (링크 불필요, 권장)
#        각 파일 상단의 적용 안내를 먼저 읽는다(0002 는 pg_cron 확장, 0007 은 함수 배포 전에 적용)
# 방법 B: CLI
npx supabase@2.121.0 link --project-ref vcvzuiyxcmvrkxscgvwp   # DB 비밀번호 입력
npx supabase@2.121.0 db push
```

**타입 재생성** (스키마를 바꿀 때마다):

```bash
npx supabase@2.121.0 login   # 최초 1회 (브라우저 인증)
npx supabase@2.121.0 gen types typescript --project-id vcvzuiyxcmvrkxscgvwp > src/types/database.ts
npx tsc --noEmit
```

- Supabase CLI는 2.121.0으로 고정해 씁니다(3.x는 검증하지 않음).
- 스키마 변경은 기존 파일을 고치지 말고 **새 `000N_*.sql`** 을 추가합니다.
- RLS/권한 검증은 `supabase/tests/rls.sql` 을 대시보드 SQL Editor 에서 실행합니다(테스트 4·5는 블록 단위 — 끝에 "통과"가 나오면 통과, 시험 데이터는 블록 안에서 되돌림).
- RLS·GRANT·함수 권한·Storage 정책 점검은 `supabase/tests/audit.sql`(읽기 전용 한 문장 — 결과가 표 하나로 나옴)을 같은 방식으로 실행합니다.
- 테스트 지표(링크 보유율·AI 정제 상태 분포·필드 수정률·추천 채택률)는 `supabase/tests/metrics.sql` 을 같은 방식으로 실행합니다(블록마다 코호트 시작 시각이 고정돼 있고, 개발자 uid는 `ops.internal_users`에서 읽음).
- 요청 한도 검증은 `supabase/tests/quota.sql`(권한 확인 + 트랜잭션 안 동작 시험 후 rollback), AI 정제 실패 원인 조회는 `supabase/tests/parse_failures.sql` 을 같은 방식으로 실행합니다.
- 요청 한도 실제 동작 시험은 `supabase/tests/parse_quota_live.ts`(Deno, 공개 anon 키만 사용)로 합니다. 사용자 시간당 한도를 시크릿으로 잠시 낮춘 뒤 실행하고 바로 되돌립니다(실행 방법은 파일 상단 주석).
- `src/types/database.ts` 는 자동 생성 파일이라 직접 수정하지 않습니다.

## 이미지 저장·전송 (egress 최적화, Phase 9)

Free 플랜(월 Egress 5GB)을 출시·성장까지 유지하기 위해 이미지 전송량을 코드로 줄입니다.

- **업로드 전 리사이즈·압축**: 저장 시점에만 원본을 **긴 변 1600px · JPEG q0.8**로 최적화합니다(`src/lib/imageResize.ts`). OCR·AI·원본 확대 보기는 사용자가 고른 **원본 uri** 그대로 씁니다.
- **그리드는 썸네일 객체만**: 아이템 1개당 원본(`{uid}/{id}.jpg`)과 별도 **400px 썸네일**(`{uid}/{id}_thumb.jpg`, q0.6, DB에 저장하지 않는 파생 키)을 함께 올립니다. 목록/홈 그리드는 썸네일, **상세 뷰어만 원본**을 봅니다. 썸네일이 없는 레거시 아이템은 그리드에서 원본으로 폴백합니다(화면 비지 않음). 썸네일이 없는 자기 데이터는 설정의 `__DEV__` "썸네일 백필"로 채울 수 있습니다.
- **signed URL 영속 캐시**: 발급한 signed URL을 AsyncStorage에 저장(TTL 1일, 접두사 `wishshot.signedurl.`)해 앱 콜드스타트·리로드 후에도 같은 URL을 재사용합니다 → `expo-image` 디스크 캐시가 살아남아 **재방문 다운로드 ≈ 0**. 업로드 시 `cacheControl: 604800`(7일).
- 삭제·덮어쓰기·이미지 교체는 **원본과 썸네일을 항상 함께** 처리합니다(고아 객체 없음, 양쪽 캐시 무효화). 전 구간 `src/lib/queries` 경유(화면에서 Storage 직접 호출 금지).
- Supabase **Image Transformation은 Pro 전용**이라 Free에선 못 쓰므로 썸네일을 **별도 객체**로 만듭니다.

## 익명 계정·고아 파일 정리 (Phase 11)

익명 로그인은 앱 재설치마다 새 계정을 만들므로(옛 세션은 앱 샌드박스와 함께 삭제), 접근
불가능한 옛 계정·파일이 서버에 쌓입니다. **잃을 게 없는 것만** 주 1회 자동 정리합니다.

- **빈 익명 계정 삭제**: `is_anonymous` AND 생성 30일+ AND **아이템 0건**인 계정만 pg_cron 잡
  (`delete-empty-anon-users`)이 삭제합니다. 행(`categories`/`items`/`analysis_logs`)은 FK cascade로
  함께 정리되고, **아이템이 있는 계정은 절대 삭제하지 않습니다.**
- **고아 이미지 스윕**: 살아있는 키(= `items.image_key` ∪ 파생 썸네일 키 `_thumb.jpg`) 밖의
  `item-images` 객체를 DB 함수 `list_orphan_item_images()`가 열거하고, Edge Function
  `cleanup-orphan-images`(비밀 헤더 `x-cron-secret` 보호, `?dryRun=true` 지원)가 **Storage API로만**
  삭제합니다. 썸네일 키는 DB에 저장되지 않는 파생 키라 union에서 빠지면 전부 오삭제됩니다.
- **재설치 시 데이터 미보존은 의도된 동작**입니다 — 복원은 계정 연결 작업(보류) 소관.
- 적용·활성화는 사람이 합니다: 마이그레이션 실행 → dry-run 카운트 확인 → cron 등록,
  `npx supabase@2.121.0 secrets set CRON_SECRET=<임의 난수>` → `npx supabase@2.121.0 functions deploy cleanup-orphan-images`
  (JWT 검증 해제는 `supabase/config.toml`의 `verify_jwt = false`가 배포 시 적용) → dryRun 확인 → 주간 스케줄 등록.

## 익명 세션 지키기

익명 사용자는 기기에 저장된 세션이 계정의 유일한 열쇠입니다. 그래서 앱이 스스로 새 계정을 만들거나 저장된 세션을 지우지 않습니다.

- **시작 판정**(`bootstrapSession`, 앱 시작 1회): 세션이 있으면 그대로 씁니다. 세션도 사본도 없고 이 기기에서 앱을 쓴 흔적(온보딩 기록·이미지 주소 캐시 등)도 없을 때만 새 익명 계정을 만듭니다.
  - **연결 실패 화면**: 확인하지 못함(통신 실패·5xx·403·429·402·540 등, 저장소 읽기 실패). 8초가 넘어도 보입니다. 저절로 복구되면 앱으로 들어갑니다. [다시 시도] 문의 — 계속 실패하는 오류(서버 차단·풀리지 않는 사용량 제한 등)에서도 연락할 수 있게 문의를 둡니다.
  - **끊긴 세션 화면**: 서버가 세션을 거절(`refresh_token_not_found`·`refresh_token_already_used`·`session_expired`·`validation_failed`·세션 없음 응답)했거나 저장값이 깨졌거나 사라짐. [다시 시도] [새로 시작] 문의.
  - **위시를 저장한 흔적이 없으면** 끊겨도 화면 없이 새로 시작합니다(옛 계정 기록·보관은 같음). 위시 없는 익명 계정은 서버가 30일 뒤 지우므로(`0002`), 그대로 두면 이런 사용자가 30일마다 끊긴 세션 화면을 봅니다. 흔적 = 등록 화면을 연 기록(`wishshot.privacyNoticeShown*`)·제품 영역 고지·이미지 주소 캐시·링크 알림 기록. 흔적은 실행이 시작할 때의 키로 봅니다(시작하며 지우는 만료 캐시에 흔들리지 않게).
  - 다시 시도는 앱 새로고침입니다. auth-js가 재발급 실패를 60초 동안 저장해 두어, 같은 실행에서 다시 확인하면 같은 실패를 돌려받습니다.
- **세션 저장소**(`src/lib/sessionVault.ts`): AsyncStorage를 감쌉니다. auth-js가 재발급 실패 뒤 세션을 스스로 지우는 것을 무시하고(다음 자동 갱신이 같은 세션으로 다시 시도), 사용자가 고른 로그아웃(`signOut`)만 지웁니다. 사용자 id·refreshToken 사본(`wishshot.sessionCopy`)은 원래 값이 확실히 없거나 깨졌을 때만 씁니다 — 읽기에 실패했을 때 낡은 사본을 쓰면 서버가 세션 전체를 끝냅니다. 다른 계정의 세션이 저장되면 옛 계정을 `wishshot.sessionArchive`에 보관합니다(최근 5개). **저장 키(`sb-<프로젝트>-auth-token`)는 바꾸지 않습니다** — 바꾸면 모든 사용자의 세션이 사라집니다.
- **새로 시작**: 지금 계정을 보관하고 새 익명 계정을 만듭니다. 새 계정의 `user_metadata.previous_user_id`에 옛 계정 id가 남습니다.
- **사용자가 고른 로그아웃**(`signOut`, 지금은 `__DEV__` 세션 초기화만)은 세션과 사본을 지웁니다. 바로 새 계정을 만들지 않은 채 다시 켜면, 위시 흔적이 있는 기기는 끊긴 세션으로 봅니다.
- **문의**: 메일 제목은 끊긴 세션 화면이 "WishShot 기존 위시 찾기", 연결 실패 화면이 "WishShot 연결 문의"이고, 본문에는 문의 번호(이 기기 계정 id 앞 8자, 모르면 없음)만 넣습니다. 전체 id·토큰은 넣지 않습니다. 두 계정은 새 계정의 `previous_user_id`(전체 id)로 잇고, 문의 번호(앞 8자 — 스크린샷 등에 보일 수 있음)는 후보를 좁히는 데만 씁니다. 둘 다 본인 증거가 아니므로(`user_metadata`는 사용자가 바꿀 수 있음) 위시를 옮기기 전에 메일로 본인을 확인합니다. 옮기는 절차는 사람이 DB·Storage에서 합니다.
- **대시보드 설정**: Authentication → Sessions의 세션 시간 제한·비활성 만료·사용자당 세션 1개는 꺼 둡니다. 켜면 정상 사용자도 끊긴 세션 화면을 봅니다.
- **실기기 확인**: 개발용 앱은 Metro에서 JS를 받아 비행기 모드로는 다시 켤 수 없으므로, 설정의 `__DEV__` 흉내를 씁니다. 흉내는 누른 실행(다시 시작할 때까지)과 다음 실행 1회에만 적용되고, 실제 refreshToken은 서버로 가지 않습니다.
  - **연결 실패 흉내**: 다음 실행 40초 동안 모든 요청 실패. "적용"만 누르고 앱을 끈 뒤 공유 시트로 열면 공유로 연 실행도 확인할 수 있습니다(제어 센터를 열면 앱이 비활성이 되어 받은 사진이 지워짐).
  - **서버 거절 흉내**: 다음 실행에서 토큰 재발급이 `refresh_token_not_found` → 끊긴 세션 화면. 다시 시도하면 지금 계정으로 돌아오고, 새로 시작하면 새 계정이 됩니다. **위시 흔적이 없는 기기에서는 화면 없이 바로 새 계정이 됩니다** — 끊긴 세션 화면을 보려면 먼저 등록 화면에서 사진을 한 번 고릅니다(새 설치 흉내 뒤라면 특히).
  - **새 설치 흉내**: 기기의 `wishshot.*`·세션 키를 지우고 다음 실행을 연결 실패로 시작합니다. 위시 흔적도 함께 지워집니다. 지금 계정은 이 기기에서 되찾을 수 없습니다.

## OCR 정제 Edge Function (`parse-screenshot-text`)

온디바이스 OCR(Apple Vision)로 뽑은 **텍스트만** Edge Function으로 보내 Claude Haiku(`claude-haiku-4-5`)가
제품명·가격·브랜드를 정제합니다. 이미지는 비공개 저장소까지만 가고(업로드 시 긴 변 1600px JPEG로 최적화 저장), AI 정제엔 텍스트만 전송합니다.
단, 텍스트가 부족하거나 사용자가 "제품 영역으로 분석"을 누른 경우, 사용자가 직접 선택한 **제품 영역 크롭만** '분석'을 누를 때 전송하며 저장하지 않습니다(NFR-3, Phase 6 개정 — 문구는 Phase 14에서 실제 동작에 맞게 정정).

**시크릿 등록 & 배포** (Claude 키는 함수 시크릿에만 — 앱·커밋 금지):

```bash
npx supabase@2.121.0 login                                     # 최초 1회
npx supabase@2.121.0 link --project-ref vcvzuiyxcmvrkxscgvwp
npx supabase@2.121.0 secrets set ANTHROPIC_API_KEY=sk-ant-...  # 함수 시크릿
npx supabase@2.121.0 functions deploy parse-screenshot-text    # 배포(앱 재빌드와 무관). 함수 이름을 꼭 붙인다
```

- Docker가 없어도 클라우드 번들로 배포됩니다 (`WARNING: Docker is not running`은 무시).
- 정제 프롬프트/로직·**입출력 계약**만 바꿀 땐 **재배포만** 하면 됩니다(앱 재빌드 불필요). 예: Phase 4에서 입력 `categories?`·출력 `suggestedCategory`를 하위호환으로 추가.
- 로그인 세션(익명 로그인 포함)이 있는 호출만 받습니다 — 세션 없이 anon 키만으로 부르면 `401`. 회귀 케이스: `supabase/functions/parse-screenshot-text/samples/`.
- 프롬프트·출력 스키마는 `prompt.ts` 한 곳에 있습니다. 샘플링은 `temperature 0`(정확도가 아니라 추출 일관성 때문 — 함수·eval 공통). 가격 원칙: 원화 금액만, 애매하면 null(틀린 값보다 빈칸), 정가 우선 — 단 중고거래 매물은 판매자 등록가(Phase 17).
- **배포 전 회귀 검증**은 `samples/eval.ts`(Deno)로 — 같은 프롬프트로 Anthropic API를 직접 호출해 케이스별 PASS/FAIL을 냅니다(케이스당 3회). 키는 사람이 셸 환경 변수로만 넣습니다(실행법은 `samples/samples.md` "자동 검증").

```bash
deno run --allow-net=api.anthropic.com --allow-env=ANTHROPIC_API_KEY supabase/functions/parse-screenshot-text/samples/eval.ts 3
```

- **정답셋 정확도 측정**은 `samples/goldset-eval.ts`로 합니다. 사람이 붙인 정답(`goldset/data/labels.csv`, 라벨 규칙: `samples/goldset/LABELING.md`)으로 변형 5개(v0 10/04 프롬프트 · v1 운영 · v2 운영 프롬프트+온도 1.0 · v1h/v1h-think 최신 Haiku)의 가격 정답률을 'N장 중 M장'으로 냅니다. 원문 데이터(`samples/goldset/data/`)와 결과(`samples/goldset/out/`)는 git에 올리지 않습니다(OCR 원문에 타인 계정명이 섞일 수 있음). 기준선(Phase 13)과 재측정(Phase 17 — 중고거래 가격 규칙) 결과는 `samples/goldset/REPORT.md`에 숫자와 실패 패턴만 정리합니다.

```bash
# 키 없이 입력 검증·호출 수만 확인(--dry-run을 빼면 실제 호출)
deno run --allow-net=api.anthropic.com --allow-env=ANTHROPIC_API_KEY \
  --allow-read=supabase/functions/parse-screenshot-text/samples \
  --allow-write=supabase/functions/parse-screenshot-text/samples/goldset/out \
  supabase/functions/parse-screenshot-text/samples/goldset-eval.ts --runs 3 --dry-run
```

- 기준선 결과(`goldset/out/`의 results.csv·summary.md)는 덮어쓰지 않습니다. 재측정은 `--variants v1`과 `--exclude-holdout`(고치는 동안) 또는 `--only-holdout`(최종 1회)로 하고, `--out supabase/functions/parse-screenshot-text/samples/goldset/out/<하위 폴더>`에 씁니다. 부분 측정 결과 파일엔 접미사가 붙고, 다시 잴 땐 이전 결과를 옮긴 뒤 실행합니다(`--force` 금지).
- 실행기 자체 검증은 가상 fixture로: `--data supabase/functions/parse-screenshot-text/samples/goldset/fixture --dry-run`.
- 홀드아웃은 `samples/goldset-holdout.ts`가 유형마다 25%를 시드 고정으로 지정합니다(`--write`일 때만 `labels.csv`의 `holdout` 열을 쓰고, 이미 지정돼 있으면 `--force` 없이 중단). 프롬프트를 고칠 때는 홀드아웃을 보지 않고 마지막 확인에만 씁니다.

```bash
deno run --allow-read=supabase/functions/parse-screenshot-text/samples \
  --allow-write=supabase/functions/parse-screenshot-text/samples/goldset/data \
  supabase/functions/parse-screenshot-text/samples/goldset-holdout.ts --write
```

**요청 한도·입력 상한·실패 기록** (익명 로그인이 열려 있어 공개 키만으로 함수를 부를 수 있으므로 API 비용을 묶는다):

- **입력 상한**: OCR 텍스트 2,000자, 카테고리 목록(프롬프트에 들어가는 JSON 형태) 2,000자. 넘으면 LLM을 부르지 않고
  `400`(`text_too_long` / `categories_too_long`) — 자르지 않으므로 상한 안의 요청은 Anthropic 요청이 이전과 같습니다.
- **요청 한도**: 검증을 통과한 요청만 셉니다. 사용자 시간당 30 · 하루 100(한국 시간 0시 기준) · 전체 하루 300(차단기).
  넘으면 `429` + `{ "error": "rate_limited", "scope": "user" | "global" }` + `Retry-After`(초). 앱은 다른 실패와 같은 수동 입력 경로로 갑니다.
  카운터는 DB 함수 `consume_parse_quota`(`0005`)이고 **service_role 전용**이라 앱에서 직접 부를 수 없습니다.
  카운터 응답이 3초를 넘기면 `503`(`quota_unavailable`)으로 거절하고(요청을 한꺼번에 쏟아내 한도를 우회하는 것 방지),
  그 밖의 카운터 DB 오류면 호출을 허용합니다(fail-open). 이미지 요청은 `PARSE_IMAGE_WEIGHT`(기본 1)만큼 셉니다.
- **실패 기록**: 로그인 확인 뒤의 실패 응답(입력 오류·한도 초과·LLM 실패)은 원인을 `ops.parse_failures`에 남깁니다
  (사용자·한국 날짜·사유·횟수, LLM 오류는 Anthropic 상태 코드, 상한 초과는 넘은 길이 — 텍스트·이미지 내용 없음).
  함수 로그는 Free 플랜에서 1일만 보관되기 때문입니다. 빈 익명 계정이 정리돼도 기록은 남겨, 에러를 만나고
  저장 없이 떠난 사용자도 집계에 들어갑니다. 조회: `supabase/tests/parse_failures.sql`.
- **한도 조정**(선택, 미설정이면 위 기본값 — 함수가 요청마다 읽어 재배포 없이 반영):

```bash
npx supabase@2.121.0 secrets set PARSE_LIMIT_USER_HOURLY=30 PARSE_LIMIT_USER_DAILY=100 PARSE_LIMIT_GLOBAL_DAILY=300 PARSE_IMAGE_WEIGHT=1
```

**OCR 엔진 참고**: 지시서의 Google ML Kit 대신 **Apple Vision**(로컬 모듈 `modules/expo-vision-ocr`)을
씁니다 — iOS 전용이라 ML Kit iOS 이슈를 피하고 Expo SDK 57/New Architecture 호환 문제도 없습니다.
이 모듈은 **네이티브라 추가·변경 시 EAS 재빌드**가 필요합니다.

## 구매처 링크 찾기 Edge Function (`find-purchase-links`, Phase 21)

등록 폼에서 AI 정제가 제품명을 채우고 링크 칸이 비어 있으면, 앱이 **제품명·브랜드·입구 채널**만 보내 판매처 링크를 찾습니다.
입구 채널은 기기에서 OCR 원문으로 판별합니다(`src/lib/purchaseChannel.ts` — 캡처에 보인 판매처 도메인 또는 몰 이름·고유 문구). 원문·이미지는 보내지 않습니다.

1. **요청 한도**: 전용 카운터(`0007`)로 사용자 시간당 10 · 하루 30 + 전체 하루 100. 카운터를 쓸 수 없으면 거절합니다(`503`, fail-closed — 웹 검색 비용이 커서 정제 함수와 다릅니다).
2. **카페24 사이트 안 검색**: 도메인 채널이고 몰 사전(`malls.ts`)에 없는 곳이면 그 사이트의 `/product/search.html?keyword=`를 읽어 검색 결과 영역의 상품 번호로 상세 주소를 만듭니다(이 단계 전체 8초).
3. **웹 검색**: 못 찾았으면 Claude Haiku 5.5(`claude-haiku-5-5`) 웹 검색(`web_search_20250305`)으로 그 사이트(채널이 없으면 몰을 뺀 공식 홈페이지) 안의 같은 상품 페이지를 찾고, 구조화 출력으로 **후보 번호만** 고릅니다(주소는 서버가 모은 후보에서만 꺼냄).
4. **링크 확인**: Google Web Risk 대조 + 접속 확인(https·인증서·같은 사이트 안 리다이렉트·2xx, 대형 몰은 401·403·429 허용). 통과한 것만 넣습니다.
5. 상품 페이지가 없으면 확인된 몰 검색 주소(지금은 쿠팡·무신사·29CM·오늘의집 — 검색어에서 상품명의 대괄호 홍보 표기는 뗌)나 상품이 검색된 카페24 사이트의 검색 결과 링크(`kind: 'search'`)를 넣습니다. 사용자에게는 같은 '연결된 링크'라 폼에서 상품 링크와 따로 안내하지 않습니다. 링크를 못 찾으면 링크 칸에 "링크를 직접 입력하세요"를 보입니다.
6. 결과가 오기 전에 저장하면, 저장 뒤 3분 안에 도착한 링크를 **링크가 비어 있을 때만** 붙이고 흐름을 끊지 않게 알립니다 — 3초 스낵바([보기]), 알림 탭 배지·기록, 타일 좌상단 와인색 점(기기 안에만 저장). 찾는 동안 그 위시 타일은 약간 흐리고, 못 찾으면 흐림만 사라집니다. 앱 쪽 호출은 90초가 지나면 조용히 빈칸으로 둡니다.

**배포** (`0007`을 먼저 적용 — 한도 없이 배포하지 않습니다. 키는 함수 시크릿에만):

```bash
npx supabase@2.121.0 secrets set WEB_RISK_API_KEY=...          # Google Cloud Web Risk API 키(없으면 링크를 항상 비움)
npx supabase@2.121.0 functions deploy find-purchase-links      # 함수 이름을 꼭 붙인다(앱 재빌드와 무관)
# (선택) 한도 조정 — 요청마다 읽어 재배포 없이 반영
npx supabase@2.121.0 secrets set PURCHASE_LIMIT_USER_HOURLY=10 PURCHASE_LIMIT_USER_DAILY=30 PURCHASE_LIMIT_GLOBAL_DAILY=100
```

- 이름 없이 `functions deploy`를 하면 이 폴더의 함수가 전부 올라갑니다.
- 단위 시험(네트워크·키 없음): `deno test --no-lock supabase/tests/find_purchase_links_test.ts supabase/tests/purchase_channel_test.ts`(앱 입구 채널 판별 포함). 타입 검사: `deno check --no-lock supabase/functions/find-purchase-links/index.ts`.
- 한도 권한·동작 검증 SQL: `supabase/tests/purchase_link_quota.sql`(SQL Editor, rollback)
- 실패 원인은 `ops.purchase_link_failures`에 남습니다(사용자·한국 날짜·사유·횟수 — 내용 없음).
- 후보를 확인할 시험 때만 `PURCHASE_DEBUG_LOG=1`로 후보 주소·제목을 함수 로그에 남기고, 시험 뒤 지웁니다.
- 네이버 검색 API는 약관(AI 입력·처리 금지) 때문에 쓰지 않습니다.

## 참고: 옛 웹 코드

이 저장소는 웹(Vite + Express + SQLite)에서 **iOS 네이티브 앱(Expo + Supabase)** 으로 전환되었습니다. 옛 웹 코드는 `web-v0` 태그에 보존돼 있습니다(`git show web-v0:<path>`). 폐기된 Next.js 계획과 v1 데이터 이관 스크립트는 `docs/archive/`에 참고용으로 있습니다.
