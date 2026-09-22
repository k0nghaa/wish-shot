# Phase 8 — App Store 정식 배포 (심사 · 출시)

> **이 문서 사용법**: Phase 7(기능 1·2·온보딩·다중선택) 완료·머지 후 진행. Claude Code에 이 파일을 컨텍스트로 넘겨 준비 작업을 돕게 하되, EAS 빌드·App Store Connect 조작·심사 제출·출시는 Apple 인증이 필요하므로 사람이 직접 실행한다(에이전트는 검증·조작 불가). 심사·실기기 동작도 사람이 확인한다.
>
> **근거 원칙**: 아래 Apple 동작은 공식 문서(App Store Connect Help·Apple Developer)로 검증한 사실이며 출처 URL을 병기했다. Anthropic 레이트리밋·과금은 Anthropic 공식 문서(platform.claude.com) 기준. 불확실하면 지어내지 말고 문서를 재확인하거나 사람에게 묻는다.

## 목표 (Goal)

Phase 7까지 기능이 완성되고 TestFlight로 검증 가능한 상태다. Phase 8은 App Store 정식 심사를 통과해 앱을 공개한다. 절차는 (Step 0) 릴리스 브랜치·버전·정리 준비 → 내부 검증 → (선택) 외부 베타 → App Store 버전 준비 → 심사 제출 → 출시.

## 사전 조건 (사람이 준비)

- [ ] Phase 7 완료·dev 머지, 최종 production 빌드 대상 커밋 확정.
- [ ] App Store Connect 앱 레코드 존재: WishShot 위시샷 / 번들 com.k0nghaa.wishshot / SKU wishshot.
- [ ] EAS 환경변수(production) 등록됨(EXPO_PUBLIC_*). 미등록이면 앱이 켜지자마자 실패.
- [ ] .npmrc(legacy-peer-deps) 커밋 유지(EAS npm ci peer 충돌 방지).
- [ ] App Store 심사용 자료: 앱 설명·키워드·카테고리·연령 등급·가격(무료)·지원 URL·개인정보처리방침 URL(docs/legal/privacy.html 공개 게시), 필수 기기 크기 스크린샷, App Privacy(개인정보 라벨) 답변. (TestFlight엔 없던 항목 — App Store 심사는 이 전체가 필요.)
- [ ] app.json에 ITSAppUsesNonExemptEncryption: false 유지(HTTPS만 사용 → 수출규정 면제, 매 제출 프롬프트 회피).

## 하지 않는 것 / 주의

- 에이전트가 대신 못 하는 것: EAS 빌드(Apple 로그인), eas submit, App Store Connect 웹 조작, 심사 제출/취소, 출시 클릭 — 전부 사람.
- OTA 사용(Phase 9 F, `expo-updates`). production 프로필 `channel: "production"` + `app.json`의 `runtimeVersion(fingerprint)`·`updates.url` → **이번 production 빌드부터** JS-only 수정은 `eas update`로 재빌드 없이 배포된다. **네이티브 변경(모듈·권한·plugins·에셋)만 새 빌드**가 필요(fingerprint가 달라짐).

## 핵심 사실 · 함정 (반드시 이해)

1. **한 빌드가 TestFlight·App Store 심사에 모두 쓰인다.** 빌드에 "TestFlight 전용" 플래그는 없다. 베타 테스트하던 그 빌드를 그대로 심사에 제출 가능.
   - 근거: https://developer.apple.com/help/app-store-connect/manage-builds/choose-a-build-to-submit/ , https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/
2. **TestFlight ≠ App Store.** 외부 테스터가 받는 건 TestFlight 앱으로 설치하는 베타 빌드(최대 90일 만료). Beta App Review 통과 ≠ App Store 공개. 정식 앱은 공개 출시 후 App Store에서 설치.
3. **심사 관문 3종 구분:** 내부 테스터(베타 심사 없음·즉시) / 외부 테스터(첫 빌드 Beta App Review 필요) / App Store 심사(정식 공개).
   - 근거: https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/
4. **제출 후 빌드 무중단 교체 불가.** "제출 준비됨" 상태에선 자유 교체 가능하나, 제출 후엔 "심사에서 제거" → 재제출뿐이고 재제출 시 심사가 처음부터 다시 시작된다(큐 위치 유지 불가). → "미리 심사 올리고 오류나면 빌드만 스왑" 전략은 실익 적음.
   - 근거: https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/remove-a-submission-from-review/
5. **출시 옵션 3가지:** 자동 출시 / 수동 출시(승인 후 "개발자 출시 대기" → 내가 클릭) / 예약 출시(지정 시각 자동). 같은 빌드가 심사 중이면서 TestFlight 테스트도 병행 가능.
   - 근거: https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option/
6. **심사 시간:** Apple 공식 "제출의 90%가 24시간 내 심사"(평균, 보장 아님).
   - 근거: https://developer.apple.com/distribute/app-review/

---

## Step 0 — 릴리스 브랜치·버전·정리 준비 (사람 + 에이전트 보조) ⭐ 신규

이 저장소는 지금까지 **dev를 트렁크**로 썼고(`origin/HEAD → dev`), `origin/main`은 초기 스냅샷에서 108커밋 뒤처져 있다(dev가 main을 완전히 포함). **정식 배포부터는 표준 릴리스 플로우로 전환한다: main = 출시본, dev = 통합, 릴리스마다 release 브랜치 + 태그 + 버전업.**

### 0-1. main을 dev로 정렬 (1회)

- dev가 main을 완전히 포함하므로 main을 dev로 **fast-forward** 가능. 이후 main은 "출시된 것만" 담는다.
- 방법(사람): GitHub에서 dev→main PR을 만들어 머지하거나, 로컬에서 `git checkout main && git merge --ff-only dev && git push origin main`.
- 이후 규칙: **기능 작업은 dev(및 feature 브랜치)**, **출시 시점의 스냅샷만 main**.

### 0-2. 릴리스 브랜치 + 버전업

- 릴리스마다 dev에서 `release/vX.Y.Z` 브랜치를 자른다.
- **버전 2종을 올린다**(둘 다 필요):
  - **마케팅 버전** `app.json`의 `expo.version`(현재 `1.0.0`) — 사용자에게 보이는 버전. 새 기능/출시마다 SemVer로 올림(예: 1.0.0 → 1.1.0, 버그픽스 1.0.0 → 1.0.1).
  - **iOS 빌드 번호** — App Store Connect는 **같은 마케팅 버전 안에서 빌드 번호가 매 업로드마다 증가**해야 새 빌드를 받는다. 두 방법 중 하나로 관리:
    - `app.json`의 `expo.ios.buildNumber`를 수동으로 문자열 증가(`"1"` → `"2"` …), 또는
    - `eas.json` production 프로필에 `"autoIncrement": true`(EAS가 원격 최신 빌드 번호 기준으로 자동 증가) — 권장(수동 실수 방지).
  - 근거: App Store Connect 빌드 요구사항 https://developer.apple.com/help/app-store-connect/manage-builds/ , Expo 버전 관리 https://docs.expo.dev/build-reference/app-versions/
- release 브랜치에서 production 빌드·검증(Step 1~) 진행. release 브랜치엔 **버전업/막판 릴리스 수정만** 올린다(새 기능 금지).

### 0-3. 출시 후 병합·태그

- 심사 승인·출시 완료 후:
  - `release/vX.Y.Z` → **main 머지**(PR), main에 **태그 `vX.Y.Z`**(`git tag vX.Y.Z <sha> && git push origin vX.Y.Z`). 태그 = App Store 바이너리 ↔ 재현 가능한 커밋.
  - **release(또는 main) → dev 역머지**로 버전업 커밋을 dev에도 반영(다음 개발이 올바른 버전에서 출발).
- **핫픽스**: main에서 `hotfix/vX.Y.(Z+1)` 브랜치 → 수정 + 패치 버전업 → main 머지 + 태그 → dev 역머지.

### 0-4. 출시 전 데이터 정리 (익명 유저·고아 파일) — 사용자 결정: **정리하고 간다**

TestFlight가 **프로덕션 Supabase를 그대로** 썼기 때문에, 테스트 중 만든 익명 유저·데이터·이미지가 이미 실데이터에 섞여 있다. 공개 전 1회 정리한다.

- **주의(스키마 사실)**: `categories`/`items`/`analysis_logs`의 `user_id`는 `references auth.users(id) on delete cascade` → **auth 유저를 지우면 DB 행은 자동 삭제**. 단 **Storage(`item-images`) 파일은 cascade 대상이 아니다** → `{user_id}/…` 객체를 **따로** 지워야 진짜 정리된다.
- **본인 기기 데이터(실제로 담아둔 위시)를 살리려면** 그 유저는 남긴다(통삭제 금지).
- **정리 순서(사람이 service_role/대시보드로 실행 — anon 키로는 불가):**
  1. 삭제 대상 유저 목록 확정(테스트로 만든 익명 유저들; 본인 실사용 유저 제외).
  2. 각 대상 유저의 Storage 객체 삭제: `item-images` 버킷의 prefix `"{user_id}/"` 객체 일괄 삭제(Storage API/대시보드).
  3. `auth.users`에서 해당 유저 삭제 → categories/items/analysis_logs 행은 cascade로 정리.
- **고아 파일 감사(선택)**: `item-images` 객체 중 대응하는 `items.image_key`가 없는 것을 목록화(앱이 E-5 순서로 고아를 막으므로 거의 없어야 정상). 있으면 삭제.
- ⚠️ 파괴적 작업 — 실행 전 대상 목록을 사람이 눈으로 확인. 필요하면 에이전트에게 "정리 스크립트/SQL 초안"을 요청(service_role 전용, 커밋 금지).

**DoD(Step 0)**: main이 dev로 정렬, release/vX.Y.Z 브랜치·버전(마케팅+빌드번호) 확정, 테스트 데이터·고아 파일 정리 완료(또는 의도적으로 보존 결정).

---

## Step 1 — production 빌드 생성·업로드 (사람)

- release 브랜치 체크아웃 상태에서:
  `npx eas-cli build --platform ios --profile production` → `npx eas-cli submit --platform ios --profile production --latest`.
- 빌드가 App Store Connect에서 처리 완료(이메일 수신) 될 때까지 대기(처리돼야 선택 목록에 나타남).
- DoD: production 빌드가 ASC에 처리 완료로 표시.

## Step 2 — 내부 검증 (TestFlight 내부 테스터, 사람)

- ASC → TestFlight → 내부 테스터(팀원 최대 100)로 배포. 베타 심사 없음·즉시.
- Phase 7 기능 실기기 검증: URL 공유→링크 붙이기, 앨범 삭제(전체접근·OS 확인창), 온보딩 1회, 다중선택, 사진 권한창 개선, 기존 회귀.
- DoD: 내부 테스터가 최신 빌드로 핵심 시나리오 정상 확인. 문제 발견 시 — JS-only는 `eas update`(OTA), 네이티브 변경은 새 빌드(Step 1) — 로 반복.

## Step 3 — (선택) 외부 베타 (Beta App Review, 사람)

- 넓은 피드백이 필요할 때만. 외부 그룹 추가 시 첫 빌드는 Beta App Review 대기. 개인정보처리방침 URL·베타 테스트 정보·수출규정 필요.
- 소규모 공개 목표면 생략 가능(내부 검증으로 충분).
- DoD: (진행 시) 외부 베타 심사 통과·피드백 반영.

## Step 4 — App Store 버전 준비 (사람)

- ASC에서 새 App Store 버전 생성 후 채우기: 설명·키워드·카테고리·연령 등급·가격(무료)·지원 URL·개인정보처리방침 URL·필수 스크린샷·App Privacy 라벨·수출규정(면제).
- DoD: 모든 필수 메타데이터·자료 입력 완료(제출 가능 상태).

## Step 5 — 빌드 붙이기 + 심사 제출 (사람)

- 버전의 Build 섹션 → (+) → 검증 끝난 그 빌드 선택 → Save. (버전당 빌드 1개.)
- 출시 옵션 선택: 발표 타이밍 통제가 필요하면 수동 출시(권장, 아래 미결), 아니면 자동/예약.
- 심사 제출.
- 주의: 제출 후 오류 발견 시 빌드 무중단 교체 불가 → "심사에서 제거" 후 새 빌드 재제출(심사 재시작).
- DoD: 심사 제출 완료(상태 "심사 대기/심사 중").

## Step 6 — 심사 결과 대응 + 출시 (사람)

- 승인 시: 자동/예약이면 자동 공개, 수동이면 "이 버전 출시" 클릭(공개까지 최대 24h).
- 반려 시: 사유 확인 → 수정 → 새 빌드(Step 1) → 재제출.
- 출시 완료 후 Step 0-3(main 머지 + 태그 `vX.Y.Z` + dev 역머지) 마무리.
- DoD: App Store 공개 완료(정식 다운로드 가능).

## Step 7 — 운영 점검 (출시 전후 준비) ⭐ 신규

정식 공개 후 트래픽·유저·비용이 늘어난다. 계정 승격(익명→이메일)은 시간이 걸려 이번 범위 밖(후속)이지만, 아래 2개는 이번에 준비한다.

### 7-1. 익명 유저 주기 정리

- **문제**: 설치/기기마다 익명 유저 1개가 `auth.users`에 쌓인다("열고 아무것도 안 담은 유령" 포함). 익명도 MAU에 잡혀 Supabase 플랜 한도를 압박할 수 있다.
- **정책**: "비활성 + 데이터 0" 익명 유저를 주기적으로 삭제. Supabase도 오래된 익명 유저 정기 삭제를 권장.
- **구현(택1)**: `pg_cron` 스케줄 잡 또는 크론 Edge Function에서, 조건(예: `is_anonymous = true` AND `last_sign_in_at < now() - interval 'N days'` AND items 행 0개)에 맞는 유저를 삭제. **행은 cascade로 정리되지만 Storage 객체는 별도 삭제** 필요. service_role/보안정의자(security definer) 권한 필요, anon 키로는 불가.
- ⚠️ 파괴적 — 삭제 조건·건수를 먼저 dry-run으로 확인. 정확한 한도 수치는 Supabase 대시보드에서 본인 플랜 확인.
- **후속(범위 밖)**: 계정 승격(`linkIdentity`/이메일)으로 앱 삭제·재설치 시 데이터 유실을 막는 것. 리텐션이 중요해지면 우선순위 상향.

### 7-2. OCR 정제 LLM(Claude) 지출·레이트리밋 방어

- **모델**: Edge Function `parse-screenshot-text`가 `claude-haiku-4-5`(Haiku 4.5) 사용. 저렴하지만($1/$5 per MTok급) 공개 후 호출 수 = 비용.
- **키**: 함수 시크릿에만 존재(안전). "키를 더 추가"할 필요 없음 — 대신 아래 운영 세팅.
- **지출 방어**: Anthropic Console에서 **월 지출 상한(spend limit)** 설정 + **지출 알림**. (지출/과금은 월 단위 주기.)
- **레이트리밋(중요·아래 상세)**: 계정 티어별 **분당 요청(RPM)·분당 토큰(입력/출력)**, 경우에 따라 **일당 토큰** 한도가 있다. **월 단위로 리셋되지 않는다.** 급증 시 429가 나면 앱은 수동 입력 폴백(NFR-2)으로 degrade하지만, 예상 트래픽 대비 티어 한도를 확인.
  - 근거: https://platform.claude.com/docs/en/api/rate-limits
- **남용 방어**: 이 함수는 **익명 인증만 있으면 누구나 호출** 가능(진입장벽 낮음). per-user 일일 호출 상한 등 **간단한 레이트리밋을 함수에 추가** 권장(비용 폭주 방지). 현재 함수에 제한이 있는지 확인 후 없으면 보강.

#### 레이트리밋이 "월에 한 번 리셋"인가? → 아니오

- **Anthropic API 레이트리밋 = 분(minute) 단위**가 기본: RPM(분당 요청), ITPM/OTPM(분당 입력/출력 토큰). **연속 충전(토큰버킷)** — 매분 리셋이 아니라 쓰는 만큼 줄고 시간이 지나며 회복. 일부는 **TPD(하루 토큰)** 로 **매일** 리셋.
- 429 응답에 `retry-after` 헤더가 오고, `anthropic` SDK/HTTP 재시도는 지수 백오프로 자동 재시도. 헤더 `x-ratelimit-remaining-*`로 잔여 확인.
- **"월"과 엮인 것은 두 가지뿐**: (1) **과금 주기**(월 청구), (2) Console에서 **설정 가능한 월 지출 상한**. 둘 다 레이트리밋과 별개.
- **티어(Usage tier)**: 누적 지출이 임계를 넘으면 계정 티어가 자동 상향(Tier 1→2→…)되며 RPM/TPM/TPD 한도가 커진다. 이건 "리셋"이 아니라 **상향**. 본인 티어의 실제 수치는 Console에서 확인(문서는 시점에 따라 변함 — 지어내지 말 것).
- 근거: https://platform.claude.com/docs/en/api/rate-limits

**DoD(Step 7)**: 익명 유저 정리 잡(또는 계획) 준비, Anthropic 월 지출 상한·알림 설정, (권장) Edge Function per-user 레이트리밋 보강 또는 후속 과제로 명시.

## Step 8 — 문서 갱신

- CLAUDE.md(상태: TestFlight → App Store 정식, 브랜치 전략 = main 출시본/dev 통합/release+태그), README.md, 이 문서 "결과 기록" 작성. 커밋 `docs: Phase 8 App Store 배포`.

## 미결 사항 (진행 중 결정)

- 출시 방식: 자동 / 수동 / 예약 — 발표(챔피언십) 타이밍에 맞출지.
- 외부 베타 진행 여부(Step 3) — 내부 검증만으로 갈지.
- 카테고리·연령 등급·가격·지원 URL 최종값.
- 스크린샷 세트(필수 기기 크기)·앱 미리보기 영상 여부.
- iOS 빌드 번호 관리: 수동(app.json) vs `eas.json autoIncrement`.
- 익명 유저 정리 주기·조건(N일), Edge Function 레이트리밋 상한 값.

## 확정한 결정 (조사 기반)

- 배포 순서 = (Step 0 릴리스 준비·정리) → 내부 검증 → (선택) 외부 베타 → App Store 버전 준비 → 심사 제출 → 출시.
- **브랜치 전략 = main(출시본) / dev(통합) / 릴리스마다 release 브랜치 + 태그 `vX.Y.Z` + 버전업(마케팅+빌드번호).** 출시 후 release→main 머지+태그, dev로 역머지. 핫픽스는 main 분기.
- **출시 전 데이터 정리 = 진행**(테스트 익명 유저·고아 파일). auth 유저 삭제로 행은 cascade, **Storage는 별도 삭제** 필수. 본인 실사용 데이터는 보존.
- **익명 유저 = 주기 정리 도입**(비활성+데이터0), 계정 승격은 후속.
- **LLM = 월 지출 상한·알림 + (권장) 함수 레이트리밋.** Anthropic 레이트리밋은 분/일 단위(월 리셋 아님), 티어는 지출로 자동 상향.
- TestFlight 빌드 = App Store 심사에 그대로 사용 가능(전용 플래그 없음).
- 제출 후 빌드 무중단 스왑 불가(재제출=심사 재시작) → 검증 먼저 → 제출.
- "승인은 받되 공개 시점은 통제"가 필요하면 수동 출시 사용.
- TestFlight 익명 유저는 같은 앱·같은 프로젝트라 정식 출시 후에도 세션·데이터 유지(자동 업데이트).

## 결과 기록 (완료 시 작성)

- 완료일 / 릴리스 태그·버전(마케팅+빌드번호) / 데이터 정리 결과 / 내부·외부 베타 결과 / 심사 소요·반려 사유·재제출 여부 / 출시 방식(자동·수동·예약) / 공개일 / 익명 정리·LLM 방어 세팅 / 발생 이슈와 해결.
