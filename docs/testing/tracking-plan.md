# WishShot 트래킹 플랜 (Phase 10)

> **이 문서가 이벤트 택소노미의 정본이다.** 코드(`src/lib/analytics.ts`의 `AnalyticsEventMap`)와 이 문서가 다르면 이 문서를 기준으로 코드를 맞춘다. 이벤트·속성을 늘리려면 먼저 여기에 "답하려는 질문"을 적는다 — **질문 없는 이벤트는 심지 않는다.**

## 1. 테스트 목적·기간·코호트

테스트 기간에 아래 4가지 질문에 숫자로 답한다. 결과는 개선 → OTA 배포 → 전후 비교 루프의 입력이다.

1. **방문 빈도** — 주간 방문일수, DAU/WAU, D1/D7 리텐션
2. **중도 이탈** — ⓐ 퍼널형(담기 시작 후 저장 전 포기) ⓑ 리텐션형(앱을 더 안 쓰게 됨)
3. **공유 시트 비중** — "공유 시트로 담기"가 실제 주 진입 경로인가
4. **AI 자동채움 품질** — 작동률(상태 분포)과 수정률

- **기간**: 테스트 시작일 `____-__-__` (사람 기입) ~ 종료일 미정(릴리스 전후 비교 루프 지속)
- **배포 경로**: **실제 앱(App Store) 사용자 + TestFlight 테스터가 같은 production 채널**로 받는다. 익명 인증 특성상 모집 테스터와 오가닉 사용자를 구분할 수 없으므로, **코호트 = "테스트 기간 내 전체 실사용자"** 로 정의한다.
- **코호트 필터(모든 집계 공통)**: `created_at >= 테스트 시작일` + 개발자 uid 제외. 기존 Supabase 데이터(전부 개발자 데이터)는 지우지 않고 이 필터로 거른다 — 기존 데이터의 "현재값"은 지표가 아니라 SQL 드라이런용이다.
- **개발자 uid 제외 목록** (사람 기입 — `select id from auth.users;` 또는 설정 화면에서 확인):
  - `________-____-____-____-____________` ← 개발 기기 1
- **PostHog 쪽 오염 방지**: `__DEV__` 빌드는 기본 옵트아웃이라 개발 중 이벤트는 대부분 자동 제외된다. 개발자가 production 빌드를 실사용하는 경우 해당 uid(Person)를 PostHog 코호트/필터에서 수동 제외한다.

## 2. 이벤트 택소노미 (정본)

명명 규칙: `목적어_동사(과거형)`, snake_case. 속성 값은 전부 아래 enum·boolean·수치만 — **사용자 콘텐츠(사진·OCR 원문·상품명·가격·URL·메모)는 절대 싣지 않는다.**

| 이벤트 | 트리거 시점 | 속성 | 답하는 질문 | 구현 위치 |
|---|---|---|---|---|
| (자동) 앱 열림·세션 | SDK 라이프사이클 자동 수집(`captureAppLifecycleEvents`) | — | 질문 1 | `src/lib/analytics.ts` 초기화 옵션 |
| `share_intent_received` | 홈이 공유 인텐트를 소비한 직후 | `type: image \| url` | 질문 3 | `src/app/(tabs)/index.tsx` |
| `register_opened` | 등록 화면 마운트 | `entry: share \| manual` | 질문 2ⓐ·3 | `src/app/register.tsx` |
| `analysis_completed` | 분석 상태머신 종료 전이 시 | `status: parsed \| low_confidence \| parse_failed \| ocr_empty` (analysis_logs와 동일 enum) | 질문 4 | `src/hooks/useAnalysis.ts` |
| `autofill_edited` | AI가 채운 필드를 사용자가 **변경**했을 때, 필드당 1회 | `field: name \| price \| brand \| category` | 질문 4 | `src/app/register.tsx` |
| `item_saved` | 저장 **성공 응답** 시(버튼 탭 아님, 덮어쓰기 포함) | `source: share \| picker \| recent_photo`, `duration_ms`(마운트→성공), `had_analysis: boolean` | 질문 2ⓐ | `src/app/register.tsx` |
| `onboarding_step_viewed` | 온보딩 각 스텝 표시 시 | `step: card_1 \| card_2 \| card_3 \| category_coachmark` | 완주율·이탈 스텝 | `src/components/Onboarding/OnboardingOverlay.tsx` |
| `onboarding_finished` | 완주 또는 스킵 시 | `result: completed \| skipped`, `last_step`(step과 동일 enum) | 이탈 지점 | 〃 |
| `app_error` (갈래 F) | 전역 JS 에러 핸들러 | `name: string`(에러 클래스명), `is_fatal: boolean` — **메시지·스택 미수집** | 임시 에러 가시성 | `src/lib/analytics.ts` |

### 구현 노트 (코드와 1:1)

- **`register_opened.entry` vs `item_saved.source`**: 마운트 시점엔 인텐트 여부만 알 수 있어 `entry`는 2값(`share` = 공유 인텐트 경유 — 이미지 `imageUri` 또는 URL `sourceLink` 프리필). 사진 출처는 저장 시점에 확정되므로 `source` 3값은 `item_saved`에 싣는다. 공유로 열었다가 picker/최근사진으로 사진을 바꾸면 `source`가 갱신된다.
- **퍼널형 이탈은 파생 계산**: "register_opened 있고 item_saved 없음"을 PostHog 퍼널에서 계산한다. "이탈" 이벤트는 만들지 않는다.
- **`autofill_edited` 중복 방지**: AI가 채운 초기값과 다르게 바꾼 **첫 변경에만** 필드별 1회(화면 세션 내 Set). AI가 채우기 전에 사용자가 먼저 입력한 필드는 "AI가 채운 필드"가 아니므로 발화하지 않는다. `category`는 FR-8 추천이 미리선택된 상태에서 다른 폴더를 고를 때 1회.
- **`analysis_completed` 세부 결정**(상태머신 → 4값 enum 매핑):
  - `filled` 전이 → 신뢰도 임계값(`LOW_CONFIDENCE_THRESHOLD`) 미만이면 `low_confidence`, 아니면 `parsed`.
  - `parse_failed`·`image_parse_failed`(제품 영역 분석 실패) → `parse_failed`로 접는다(앱의 `analysisLogStatus` 매핑과 동일).
  - 제품 영역 지정 시트 **취소** → `ocr_empty`(텍스트 없음 + 이미지 분석 미시도 = E-1 경로).
  - `image_not_ready`(iCloud 사진 미준비)는 **발화하지 않는다** — 분석이 시작되지 못한 회복형 상태로, 4값 enum에 대응하지 않는다.
  - 재시도(reparse·영역 재지정)마다 1회씩 발화한다 — 단위는 "분석 실행"이지 "이미지"가 아니다.
- **`register_opened` 해석 유의**: 첫 실행 온보딩이 여는 등록 폼도 `manual`로 1회 집계된다(설치당 최대 1회). 퍼널 전환율을 읽을 때 감안한다.
- **`onboarding_step_viewed`는 스텝당 1회**(뒤로 스와이프 재노출은 중복 발화하지 않음). 단 `last_step`은 재노출을 반영한다(스킵 시점에 보고 있던 스텝). `completed` = 카드·코치마크를 지나 등록 폼 투어 진입. 등록 폼 위 코치마크 2스텝(RegisterCoachmarkTour)은 계측하지 않는다.
- **identify**: 익명 인증 부트스트랩 완료 후 Supabase 익명 uid로 `identify()` 1회(`_layout.tsx`) — PostHog 퍼널과 DB(`analysis_logs`·`items`) 지표를 같은 식별자로 조인하기 위함. uid는 가명 식별자이며 추가 개인정보를 싣지 않는다.
- **수집 경로 강제**: 화면·훅은 `src/lib/analytics.ts`의 `capture()`만 쓴다(이벤트명·속성 타입 유니언으로 컴파일 타임 강제). 키 미설정 시 전 호출 no-op, 실패는 삼킨다.

## 3. 이벤트 없이 나오는 지표 (SQL — `supabase/tests/metrics.sql`)

| 지표 | 계산 방법 |
|---|---|
| 방문 빈도 (질문 1) | PostHog 자동 세션 → 주간 방문일수, DAU/WAU |
| 리텐션형 이탈 (질문 2ⓑ) | PostHog 자동 세션 → D1/D7 리텐션 |
| 퍼널형 이탈 (질문 2ⓐ) | `register_opened` → `item_saved` 퍼널 전환율(파생) |
| 링크 보유율 | `items.source_link` 채움 비율 — metrics.sql §1 |
| AI 정제 성공률·상태 분포 | `analysis_logs.status` 집계 — metrics.sql §2 |
| 필드 수정률(정밀) | `analysis_logs.parsed`(AI 원본) vs `items`(최종 저장값) 조인 비교 — metrics.sql §3. `autofill_edited` 이벤트의 교차 검증용 |
| 카테고리 추천 채택률 (FR-8) | `analysis_logs.parsed->>'suggestedCategory'`(추천 이름) vs `items.category_id`의 최종 카테고리 이름 — metrics.sql §4 |

유의: `analysis_logs`는 **저장 성공 시에만** 기록된다(앱의 `recordAnalysisLog`). 따라서 DB의 상태 분포는 "저장으로 이어진 분석"만 포함 — 저장 전 이탈까지 포함한 전체 분포는 `analysis_completed` 이벤트로 본다(둘을 교차 검증).

## 4. 의도적 보류 (추가 조건이 생기면 그때 심는다)

| 항목 | 추가 조건 |
|---|---|
| `source_link_opened` | AI 구매 링크 기능 검토·출시 결정 시 품질 퍼널(`link_suggested → accepted → opened`)로 확장 |
| `tab_viewed`, 폴더/태그 CRUD, `settings_opened` | 해당 영역에 구체적 질문이 생길 때 (OTA로 추가 가능) |
| 온보딩→활성화 상관 분석 | 하지 않음(자기선택 편향 + 소표본) — 완주율만 본다 |
| 세션 리플레이 | 화면에 사용자 사진이 상시 노출되는 앱 특성상 비권장 |
| A/B 테스트 | 표본상 무의미 — 릴리스 전후 비교로 대체 |
| Sentry(크래시) | 네이티브 — 공개 홍보 시작 전에 v1.1 네이티브 배치로(기기 메타데이터 보강과 한 빌드, 심사 1회). 그 전 커버리지: JS 에러는 `app_error`, TestFlight 크래시는 App Store Connect 웹, App Store 사용자 크래시(동의 기기분)는 Mac의 Xcode Organizer 열람 |
| 기기 메타데이터 보강(`expo-application`·`expo-device`·`expo-localization` — 선택 peer 의존성) | 다음 네이티브 배치(현재는 네이티브 추가 금지) |

## 5. 프라이버시 체크리스트 (사람 확인란 — 전부 체크 전에는 production 채널 배포 금지)

- [x] App Store Connect **App Privacy 라벨**에 수집 반영 — 사용 데이터(제품 상호 작용)·식별자(사용자 ID, 목적에 분석 추가)·진단(충돌 데이터), 전부 연결됨=예·추적=아니오 (2026-10-03)
- [x] `docs/legal/privacy.html` 개정 초안 검토·확정(§4 국외 이전 — 리전 **미국(US)** 확정, 개정일 기입) 후 공개 반영
- [x] 노션 개인정보 방침 동기화 (현행 privacy.html 전체 미러링 — Phase 6 크롭 예외·지원 이메일 통일 포함)
- [x] 인앱 고지(`src/constants/privacy.ts`)와 방침 내용 일치 재확인
- [x] 과금 차단 확인 — **카드 미등록(Free 플랜)** 유지로 한도 초과 시 수집만 중단되고 과금 자체 불가(향후 카드 등록 시 billing limit 설정 필요). 부가로 "Discard client IP data" 켜서 GeoIP 비활성
- [x] `.env` + EAS production 환경에 `EXPO_PUBLIC_POSTHOG_KEY`/`EXPO_PUBLIC_POSTHOG_HOST` 등록

## 6. 실발화 확인 체크리스트 (dev client — 사람 확인)

준비: ① `.env`에 PostHog 키·호스트 기입 후 `npx expo start --dev-client --tunnel --clear` ② 설정 → **계측 토글(개발용)** 켬(`__DEV__`는 기본 옵트아웃) ③ PostHog → Activity 열기. `__DEV__`에선 이벤트가 즉시 전송된다(flushAt 1).

※ 2026-10-03 dev client(빌드 6 + Metro)에서 전 항목 확인 완료.

- [x] (자동) `Application Opened` / `Application Became Active` 수신
- [x] identify — Person의 distinct ID가 Supabase 익명 uid와 일치
- [x] `share_intent_received` `type=image`(공유 시트로 스크린샷) / `type=url`(사파리 페이지 공유)
- [x] `register_opened` `entry=share`(공유 경유) / `entry=manual`(온보딩 경유 폼 열림으로 확인 — §2 구현 노트의 알려진 케이스)
- [x] `analysis_completed` — `parsed`·`low_confidence`(텍스트 적은 사진)·`ocr_empty`(영역 시트 취소 = 별도 분석 실행 1회) 모두 확인
- [x] `autofill_edited` — AI가 채운 가격 수정(`field=price`)과 추천 폴더 변경(`field=category`)으로 확인
- [x] `item_saved` — `source`·`duration_ms`·`had_analysis` 속성 확인(저장 성공 시에만 발화)
- [x] `onboarding_step_viewed` `card_1~3`·`category_coachmark` (※ SDK 비동기 초기화로 `Application Opened`가 card_1 뒤에 찍힐 수 있음 — 정상)
- [x] `onboarding_finished` `result=completed`(last_step=category_coachmark) / `result=skipped`
- [x] `app_error` — 설정 → **테스트 에러 발생(개발용)**: redbox **정상 표시**(핸들러 체이닝 확인) + 이벤트 수신

## 7. 측정 한계

- **OTA 첫 세션 유실**: 계측은 OTA로 배포되므로 v1.0.0 바이너리 설치자의 **첫 세션은 내장 번들(계측 없음)로 동작**한다. 설치 직후 첫 실행 이벤트(온보딩 퍼널, 설치 당일 첫 저장)는 구조적으로 유실되고 두 번째 실행부터 정상 수집된다. **온보딩 지표는 계측이 내장된 다음 바이너리(v1.1) 이후 신규 설치자부터 유효**하다.
- **전송 지연·유실**: production은 이벤트를 20개 단위로 묶어 전송한다(배터리 절약). 미전송 큐는 로컬에 영속돼 다음 실행 때 전송되지만, 앱 삭제 직전 이벤트는 유실될 수 있다.
- **`app_error`는 JS 에러만** 잡는다. 네이티브 크래시는 수집 불가 — 크래시 모니터링의 대체가 아니라 임시 가시성이다(Sentry는 보류 목록 참고).
- **개발 기기 미수집(의도)**: `__DEV__` 기본 옵트아웃. production 빌드를 쓰는 개발자 uid는 §1 제외 목록으로 거른다.
- **소표본**: 테스터 수십 명 규모 — A/B·통계적 유의성 주장은 하지 않는다. 퍼널 + 릴리스 전후 비교 + UT 정성 데이터 삼각측량이 분석 프레임이다.
