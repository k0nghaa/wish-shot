# WishShot (위시샷)

스크린샷으로 저장한 관심 제품을 카테고리별 개인 위시리스트로 관리하는 **iOS 앱**입니다. iOS 공유 시트에서 스크린샷을 바로 받아 등록하는 진입 경로를 갖습니다.

> **v2 전환 안내**: 이 저장소는 웹(Vite + Express + SQLite)에서 **iOS 네이티브 앱(Expo + Supabase)** 으로 전환되었습니다. 옛 웹 코드는 `web-v0` 태그에 보존돼 있습니다 (`git show web-v0:<path>`). 현재 `main`/`dev`은 Expo 앱입니다.

## 기술 스택

- **앱**: Expo SDK 57 (React Native) + Expo Router + TypeScript, iOS 우선
- **백엔드**: Supabase (Postgres + Storage + Auth), `@supabase/supabase-js`로 직접 호출 + RLS
- **인증**: **익명 로그인**(로그인 벽 없음, 기기별 세션). 세션은 AsyncStorage에 저장, RLS가 `auth.uid()`로 행 격리. (이메일 가입/승격은 이후 Phase)
- **공유 시트**: `expo-share-intent` (iOS Share Extension). 받은 공유는 루트 레이아웃의 공유 처리기(`ShareIntentHandler`)가 어느 탭·화면에서든 처리합니다 — 사진은 등록 폼, URL은 전체 탭 링크 저장 모드. 등록·편집 폼을 작성 중이면 [지금 열기](작성 중인 내용 버림)·[저장 후 열기](폼을 닫으면 이어서 열림) 중에서 고르게 묻습니다
- **OCR**: 온디바이스 Apple Vision — 자작 로컬 Expo 네이티브 모듈 `modules/expo-vision-ocr` (한국어+영어 인식). `src/lib/ocr`의 `OcrEngine` 뒤에 캡슐화
- **LLM 정제 + 카테고리 추천(FR-8)**: Supabase Edge Function `parse-screenshot-text` (Deno) + Claude Haiku. OCR 원문을 정제하고, 기존 카테고리 이름을 함께 보내면 그중 하나를 추천(`suggestedCategory`). **텍스트가 부족하거나 사용자가 "제품 영역으로 분석"을 누르면, 사용자가 선택한 제품 영역 크롭만 '분석' 때 예외 전송해 분석(Phase 6, 하위호환·미저장)**. 요청 한도(사용자·전체)·입력 크기 상한으로 API 비용 제한
- **구매처 링크 찾기(Phase 21)**: Supabase Edge Function `find-purchase-links` (Deno) + Claude Haiku 5.5 웹 검색. 등록 폼에서 제품명이 채워지고 링크 칸이 비면 **제품명·브랜드·입구 채널(캡처에 보인 도메인 또는 몰)만** 보내 판매처 상품 페이지 링크를 채웁니다. 주소가 보인 카페24 쇼핑몰은 그 사이트의 검색 페이지를 먼저 읽고, 링크는 Google Web Risk 대조와 접속 확인을 거친 것만 넣습니다. 전용 요청 한도(`0007`)
- **빌드**: EAS 클라우드 빌드 → TestFlight (Windows PC + Mac 없이 iOS 개발·배포)
- **계측(Phase 10)**: PostHog (`posthog-react-native`). 커스텀 이벤트 + 자동 라이프사이클 수집, 전부 `src/lib/analytics.ts` 경유. **키 미설정 시 no-op**, `__DEV__` 기본 옵트아웃. 속성은 enum·수치만 — 사진·텍스트 등 콘텐츠 미수집, IP로 추정한 위치 미수집. 1.0.2부터 앱 버전·언어·시간대 자동 수집(`expo-application`·`expo-localization`). 정본: [`docs/testing/tracking-plan.md`](docs/testing/tracking-plan.md)
- **오류·크래시 수집(Phase 14, 1.0.2)**: Sentry (`@sentry/react-native` 7.11). 오류·크래시만(성능 추적·리플레이·스크린샷 끔), 전부 `src/lib/monitoring.ts` 경유, 사용자 내용·IP·위치 제외. **DSN 미설정 시 no-op**, `__DEV__` 기본 비활성. 소스맵은 EAS Build가 자동 업로드
- **개발용 앱 분리(Phase 14)**: `APP_VARIANT=development`(EAS development 프로필)면 `app.config.js`가 번들 ID·이름·scheme을 바꿔 `WishShot Dev`로 빌드 — 스토어 앱과 한 기기에 나란히 설치, 별도 익명 계정
- **디자인**: 흰 배경 + iOS 시스템 그레이 모노톤 리스킨(색 토큰 = `src/constants/theme.ts`)

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
# 개발용 앱(WishShot Dev — 스토어 앱과 나란히 설치되는 개발 빌드)으로 접속 (PowerShell)
$env:APP_VARIANT='development'; npx expo start --dev-client --tunnel --scheme wishshot-dev
```

- `expo-share-intent`·`expo-vision-ocr`(OCR) 등 네이티브 모듈은 Expo Go에서 동작하지 않습니다. 공유 시트·OCR까지 확인하려면 EAS 개발 빌드가 설치된 실기기가 필요합니다(개발 서버·시뮬레이터에선 `MockOcrEngine`으로 폴백).
- `.env` 변경 후에는 `npx expo start --clear`로 재시작해야 반영됩니다.

## 자주 쓰는 명령어

| 명령어 | 용도 |
|---|---|
| `npx tsc --noEmit` | 타입 체크 |
| `npx expo lint` | ESLint |
| `npx expo-doctor` | 설정·의존성 정합성 점검 |
| `npx eas-cli build --platform ios --profile development` | 개발 빌드 (Apple 인증 필요, 사람이 실행) |

## 데이터베이스 (Supabase)

스키마 계약은 `supabase/migrations/0001_init.sql` 한 파일에 모여 있습니다 — 테이블
(`categories`/`items`/`analysis_logs`), GRANT, RLS 정책, Storage private 버킷(`item-images`)·정책.
운영 정리 잡은 `0002_cleanup_anon_users.sql`(빈 익명 계정 주 1회 삭제 pg_cron)과
`0003_orphan_images_fn.sql`(고아 이미지 키 열거 함수)에 있습니다(아래 "익명 계정·고아 파일 정리").
`0004_internal_users.sql`은 지표 집계에서 뺄 개발자 uid 목록 테이블(`ops.internal_users`, API 비노출)입니다 —
uid는 git에 두지 않고 SQL Editor에서 직접 insert하며, `supabase/tests/metrics.sql`이 이를 참조합니다.
`0005_parse_quota.sql`은 AI 정제 함수의 요청 한도 카운터와 실패 기록입니다(`ops` 스키마, 함수는 service_role 전용 —
아래 "요청 한도·입력 상한·실패 기록"). `0006_permissions_and_retention.sql`은 권한 정리(public 테이블의 CRUD 외 권한 회수,
새 함수 기본 실행 권한 끔), `item-images` 업로드 제한(3MB·JPEG), 위시 삭제 시 분석 로그의 원문·AI 결과 비우기(개발자 계정 제외)입니다.
`0007_purchase_link_quota.sql`은 구매처 링크 찾기 함수의 전용 요청 한도 카운터와
실패 기록입니다(같은 구조 — 아래 "구매처 링크 찾기 Edge Function"). 운영 DB 하나로 시험하므로 되돌리는 SQL을 `supabase/rollback/`에 함께 둡니다.

**마이그레이션 적용** (둘 중 하나):

```bash
# 방법 A: 대시보드 SQL Editor 에 0001_init.sql 전체를 붙여넣고 Run (링크 불필요, 권장)
# 방법 B: CLI
npx supabase link --project-ref <project-ref>   # DB 비밀번호 입력
npx supabase db push
```

**타입 재생성** (스키마를 바꿀 때마다):

```bash
npx supabase login   # 최초 1회 (브라우저 인증)
npx supabase gen types typescript --project-id <project-ref> > src/types/database.ts
npx tsc --noEmit
```

- 스키마 변경은 기존 파일을 고치지 말고 **새 `000N_*.sql`** 을 추가합니다.
- RLS/권한 검증은 `supabase/tests/rls.sql` 을 대시보드 SQL Editor 에서 실행합니다(테스트 4·5는 블록 단위 — 끝에 "통과"가 나오면 통과, 시험 데이터는 블록 안에서 되돌림).
- RLS·GRANT·함수 권한·Storage 정책 점검은 `supabase/tests/audit.sql`(읽기 전용 한 문장 — 결과가 표 하나로 나옴)을 같은 방식으로 실행합니다.
- 테스트 지표(링크 보유율·AI 정제 상태 분포·필드 수정률·추천 채택률)는 `supabase/tests/metrics.sql` 을 같은 방식으로 실행합니다(블록 상단 코호트 값 기입 후 — Phase 10).
- 요청 한도 검증은 `supabase/tests/quota.sql`(권한 확인 + 트랜잭션 안 동작 시험 후 rollback), AI 정제 실패 원인 조회는 `supabase/tests/parse_failures.sql` 을 같은 방식으로 실행합니다.
- 요청 한도 실제 동작 시험은 `supabase/tests/parse_quota_live.ts`(Deno, 공개 anon 키만 사용)로 합니다. 사용자 시간당 한도를 시크릿으로 잠시 낮춘 뒤 실행하고 바로 되돌립니다(실행 방법은 파일 상단 주석).
- `src/types/database.ts` 는 자동 생성 파일이라 직접 수정하지 않습니다.

## 이미지 저장·전송 (egress 최적화, Phase 9)

Free 플랜(월 Egress 5GB)을 출시·성장까지 유지하기 위해 이미지 전송량을 코드로 줄입니다.

- **업로드 전 리사이즈·압축**: 저장 시점에만 원본을 **긴 변 1600px · JPEG q0.8**로 최적화합니다(`src/lib/imageResize.ts`). OCR·AI·원본 확대 보기는 사용자가 고른 **원본 uri** 그대로 씁니다.
- **그리드는 썸네일 객체만**: 아이템 1개당 원본(`{uid}/{id}.jpg`)과 별도 **400px 썸네일**(`{uid}/{id}_thumb.jpg`, q0.6, DB에 저장하지 않는 파생 키)을 함께 올립니다. 목록/홈 그리드는 썸네일, **상세 뷰어만 원본**을 봅니다. 썸네일이 없는 레거시 아이템은 그리드에서 원본으로 폴백합니다(화면 비지 않음).
- **signed URL 영속 캐시**: 발급한 signed URL을 AsyncStorage에 저장(TTL 1일)해 앱 콜드스타트·리로드 후에도 같은 URL을 재사용합니다 → `expo-image` 디스크 캐시가 살아남아 **재방문 다운로드 ≈ 0**. 업로드 시 `cacheControl: 604800`.
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
- **재설치 시 데이터 미보존은 의도된 동작**입니다 — 복원은 미래 계정 연결(Apple/이메일) Phase 소관.
- 적용·활성화는 사람이 합니다: 마이그레이션 실행 → dry-run 카운트 확인 → cron 등록,
  `npx supabase secrets set CRON_SECRET=<임의 난수>` → `npx supabase functions deploy cleanup-orphan-images`
  (JWT 검증 해제는 `supabase/config.toml`의 `verify_jwt = false`가 배포 시 적용) → dryRun 확인 → 주간 스케줄 등록.

## OCR 정제 Edge Function (`parse-screenshot-text`)

온디바이스 OCR(Apple Vision)로 뽑은 **텍스트만** Edge Function으로 보내 Claude Haiku가
제품명·가격·브랜드를 정제합니다. 이미지는 비공개 저장소까지만 가고(업로드 시 긴 변 1600px JPEG로 최적화 저장), AI 정제엔 텍스트만 전송합니다.
단, 텍스트가 부족하거나 사용자가 "제품 영역으로 분석"을 누른 경우, 사용자가 직접 선택한 **제품 영역 크롭만** '분석'을 누를 때 전송하며 저장하지 않습니다(NFR-3, Phase 6 개정 — 문구는 Phase 14에서 실제 동작에 맞게 정정).

**시크릿 등록 & 배포** (Claude 키는 함수 시크릿에만 — 앱·커밋 금지):

```bash
npx supabase login                                     # 최초 1회
npx supabase link --project-ref <project-ref>
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...  # 함수 시크릿
npx supabase functions deploy parse-screenshot-text    # 배포(앱 재빌드와 무관)
```

- Docker가 없어도 클라우드 번들로 배포됩니다 (`WARNING: Docker is not running`은 무시).
- 정제 프롬프트/로직·**입출력 계약**만 바꿀 땐 **재배포만** 하면 됩니다(앱 재빌드 불필요). 예: Phase 4에서 입력 `categories?`·출력 `suggestedCategory`를 하위호환으로 추가.
- 로그인 사용자만 호출 가능(익명 거부). 회귀 케이스: `supabase/functions/parse-screenshot-text/samples/`.
- 프롬프트·출력 스키마는 `prompt.ts` 한 곳에 있습니다. **배포 전 회귀 검증**은 `samples/eval.ts`(Deno)로 — 같은 프롬프트로 Anthropic API를 직접 호출해 케이스별 PASS/FAIL을 냅니다. 키는 셸 환경 변수로만(실행법은 `samples/samples.md` "자동 검증").

```bash
deno run --allow-net=api.anthropic.com --allow-env=ANTHROPIC_API_KEY supabase/functions/parse-screenshot-text/samples/eval.ts 3
```

- **정답셋 정확도 측정**은 `samples/goldset-eval.ts`로 합니다. 사람이 붙인 정답(라벨 규칙: `samples/goldset/LABELING.md`)으로 프롬프트·온도·모델 변형별 가격 정답률을 'N장 중 M장'으로 냅니다. 원문 데이터(`samples/goldset/data/`)와 결과(`samples/goldset/out/`)는 git에 올리지 않습니다. 기준선(Phase 13)과 재측정(Phase 17 — 중고거래 가격 규칙) 결과는 `samples/goldset/REPORT.md`에 숫자와 실패 패턴만 정리합니다. 재측정은 `--out`으로 `samples/goldset/out/` 아래 하위 폴더에 써서 기준선 결과를 덮어쓰지 않습니다.

```bash
# 키 없이 입력 검증·호출 수만 확인(--dry-run을 빼면 실제 호출)
deno run --allow-net=api.anthropic.com --allow-env=ANTHROPIC_API_KEY \
  --allow-read=supabase/functions/parse-screenshot-text/samples \
  --allow-write=supabase/functions/parse-screenshot-text/samples/goldset/out \
  supabase/functions/parse-screenshot-text/samples/goldset-eval.ts --runs 3 --dry-run
```

- 홀드아웃은 `samples/goldset-holdout.ts`가 유형마다 25%를 시드 고정으로 지정합니다(`--write`일 때만 `labels.csv`의 `holdout` 열을 씀). 프롬프트를 고칠 때는 홀드아웃을 보지 않고 마지막 확인에만 씁니다.

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
npx supabase secrets set PARSE_LIMIT_USER_HOURLY=30 PARSE_LIMIT_USER_DAILY=100 PARSE_LIMIT_GLOBAL_DAILY=300 PARSE_IMAGE_WEIGHT=1
```

**OCR 엔진 참고**: 지시서의 Google ML Kit 대신 **Apple Vision**(로컬 모듈 `modules/expo-vision-ocr`)을
씁니다 — iOS 전용이라 ML Kit iOS 이슈를 피하고 Expo SDK 57/New Architecture 호환 문제도 없습니다.
이 모듈은 **네이티브라 추가·변경 시 EAS 재빌드**가 필요합니다.

## 구매처 링크 찾기 Edge Function (`find-purchase-links`, Phase 21)

등록 폼에서 AI 정제가 제품명을 채우고 링크 칸이 비어 있으면, 앱이 **제품명·브랜드·입구 채널**만 보내 판매처 링크를 찾습니다.
입구 채널은 기기에서 OCR 원문으로 판별합니다(`src/lib/purchaseChannel.ts` — 캡처에 보인 판매처 도메인 또는 몰 이름·고유 문구). 원문·이미지는 보내지 않습니다.

1. **요청 한도**: 전용 카운터(`0007`)로 사용자 시간당 10 · 하루 30 + 전체 하루 100. 카운터를 쓸 수 없으면 거절합니다(`503`, fail-closed — 웹 검색 비용이 커서 정제 함수와 다릅니다).
2. **카페24 사이트 안 검색**: 도메인 채널이고 몰 사전에 없는 곳이면 그 사이트의 `/product/search.html?keyword=`를 읽어 검색 결과 영역의 상품 번호로 상세 주소를 만듭니다.
3. **웹 검색**: 못 찾았으면 Claude Haiku 5.5 웹 검색으로 그 사이트(채널이 없으면 몰을 뺀 공식 홈페이지) 안의 같은 상품 페이지를 찾고, 구조화 출력으로 **후보 번호만** 고릅니다(주소는 서버가 모은 후보에서만 꺼냄).
4. **링크 확인**: Google Web Risk 대조 + 접속 확인(https·인증서·같은 사이트 안 리다이렉트·응답 코드). 통과한 것만 넣습니다.
5. 상품 페이지가 없으면 확인된 몰 검색 주소(지금은 쿠팡·무신사·29CM·오늘의집)나 상품이 검색된 카페24 사이트의 검색 결과 링크를 넣습니다. 사용자에게는 같은 '연결된 링크'라 폼에서 상품 링크와 따로 안내하지 않습니다. 링크를 못 찾으면 링크 칸에 "링크를 직접 입력하세요"를 보입니다.
6. 결과가 오기 전에 저장하면, 저장 뒤 3분 안에 도착한 링크를 **링크가 비어 있을 때만** 붙이고 흐름을 끊지 않게 알립니다 — 3초 스낵바([보기]), 알림 탭 배지·기록, 타일 좌상단 와인색 점(기기 안에만 저장). 찾는 동안 그 위시 타일은 약간 흐리고, 못 찾으면 흐림만 사라집니다.

**배포** (`0007`을 먼저 적용 — 한도 없이 배포하지 않습니다. 키는 함수 시크릿에만):

```bash
npx supabase secrets set WEB_RISK_API_KEY=...          # Google Cloud Web Risk API 키(없으면 링크를 항상 비움)
npx supabase functions deploy find-purchase-links      # 함수 이름을 꼭 붙인다(앱 재빌드와 무관)
# (선택) 한도 조정 — 요청마다 읽어 재배포 없이 반영
npx supabase secrets set PURCHASE_LIMIT_USER_HOURLY=10 PURCHASE_LIMIT_USER_DAILY=30 PURCHASE_LIMIT_GLOBAL_DAILY=100
```

- 단위 시험(네트워크·키 없음): `deno test --no-lock supabase/tests/find_purchase_links_test.ts supabase/tests/purchase_channel_test.ts`(앱 입구 채널 판별 포함)
- 한도 권한·동작 검증 SQL: `supabase/tests/purchase_link_quota.sql`(SQL Editor, rollback)
- 실패 원인은 `ops.purchase_link_failures`에 남습니다(사용자·한국 날짜·사유·횟수 — 내용 없음).
- 네이버 검색 API는 약관(AI 입력·처리 금지) 때문에 쓰지 않습니다.

## 문서

- 아키텍처·플랫폼 결정: 노션 「WishShot v2 — 플랫폼·아키텍처 결정 문서 (Expo + Supabase)」
- Phase 1 작업 기록: [`docs/phases/phase-1-toolchain.md`](docs/phases/phase-1-toolchain.md)
- Phase 3 작업 지시·결과: [`docs/phases/phase-3-ocr-and-autofill.md`](docs/phases/phase-3-ocr-and-autofill.md)
- Phase 4 작업 지시·결과: [`docs/phases/phase-4-edit-and-manage.md`](docs/phases/phase-4-edit-and-manage.md)
- Phase 5 작업 지시·결과(리스킨·탭바·상세 뷰어·익명 로그인·TestFlight): [`docs/phases/phase-5-redesign-and-deploy.md`](docs/phases/phase-5-redesign-and-deploy.md)
- Phase 10 작업 지시(테스트 계측 — PostHog): [`docs/phases/phase-10-testflight-analytics.md`](docs/phases/phase-10-testflight-analytics.md)
- Phase 11 작업 지시(익명 계정 수명주기 — 빈 계정·고아 파일 정리): [`docs/phases/phase-11-anon-account-lifecycle.md`](docs/phases/phase-11-anon-account-lifecycle.md)
- Phase 14 작업 지시·결과(Sentry 오류·크래시 수집 · App Store 메타데이터 · 개발용 앱 분리): [`docs/phases/phase-14-sentry-and-store-metadata.md`](docs/phases/phase-14-sentry-and-store-metadata.md)
- Phase 17 작업 지시·결과(가격 정확도 — 중고거래 가격 규칙 · 좋아요 수 오추출 재현): [`docs/phases/phase-17-price-accuracy.md`](docs/phases/phase-17-price-accuracy.md)
- Phase 21 작업 지시·결과(구매처 찾기 — 등록 폼 링크 자동 채움·저장 뒤 붙이기 · 입구 채널 판별 · 카페24 사이트 안 검색): [`docs/phases/phase-21-purchase-finder.md`](docs/phases/phase-21-purchase-finder.md)
- Phase 24 작업 지시·결과(UX 개선 — 탭 순서·기본 탭 전체 · 공유 시트 처리를 루트로 · 등록·편집 폼 정리 · 알림): [`docs/phases/phase-24-ux-improvements.md`](docs/phases/phase-24-ux-improvements.md)
- 트래킹 플랜(이벤트 택소노미 정본): [`docs/testing/tracking-plan.md`](docs/testing/tracking-plan.md)
- 개인정보처리방침 원문(TestFlight 외부 공개용): [`docs/legal/privacy.html`](docs/legal/privacy.html)
- 저장소 작업 규칙: [`CLAUDE.md`](CLAUDE.md)
