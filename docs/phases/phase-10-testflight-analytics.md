# Phase 10 — TestFlight 테스트 계측 (PostHog 트래킹 플랜)

> **이 문서 사용법**: Claude Code에 이 파일 전체를 컨텍스트로 넘기고 "**A/B/C/D/E(+채택 시 F)를 진행해달라**"고 요청한다. 갈래 A~E(+선택 F)는 **한 브랜치·한 세션**에서 순서대로 구현하는 것을 전제로 자족적으로 적었다(B·C가 같은 파일 `register.tsx`를 공유하므로 병렬로 쪼개지 않는다). PostHog 대시보드에서의 이벤트 실발화 확인과 SQL 드라이런은 **에이전트가 검증할 수 없으므로 사람이 확인**한다.
>
> **브랜치**: 이 작업은 `feat/phase-10-analytics`(= `dev`에서 분기)에서 한다. **release/v1.0.0 직접 작업 금지** — 심사 제출된 릴리스 브랜치다(2026-10 현재 **심사 통과·출시 대기**). 세션 시작 시 `git status --short --branch`로 브랜치를 먼저 확인한다. 완료 후 PR로 `dev`에 머지한다.
>
> **재빌드 없음(중요)**: 이 Phase는 **새 네이티브 모듈을 추가하지 않는다**. `posthog-react-native`는 **코어가 순수 JS**로 동작하며, 스토리지는 이미 설치된 `@react-native-async-storage/async-storage`를 커스텀 스토리지로 넘겨 쓴다. 선택적 peer 의존성(`expo-application`, `expo-device`, `expo-localization`)은 **네이티브 모듈이므로 설치하지 않는다**(설치 시 EAS 재빌드 유발 — 기기 메타데이터 보강은 다음 네이티브 배치로 미룬다). 설치·빌드 과정에서 네이티브 요구가 확인되면 **즉시 멈추고 사람에게 보고**한다.
>
> **선행 조건(사람 작업 — 코드 작업은 이것 없이도 진행 가능)**:
> 1. PostHog 가입(US/EU 리전 결정) → 프로젝트 API 키·호스트 전달. 키는 공개 write-only 키라 `EXPO_PUBLIC_*`로 안전. 대시보드에서 **과금 한도(billing limit)를 설정**해 무료 한도(월 100만 이벤트) 초과 시 자동 과금을 차단한다.
> 2. `.env`에 `EXPO_PUBLIC_POSTHOG_KEY`·`EXPO_PUBLIC_POSTHOG_HOST` 기입 + EAS 환경에도 등록(`eas env:create` — Supabase anon 키와 같은 패턴).
> 3. App Store Connect **App Privacy 라벨**에 "사용 데이터(제품 상호작용)" 수집 반영. **라벨·방침 반영 전에는 production 채널에 배포하지 않는다**(아래 "배포 순서").
> 4. 노션 개인정보 방침 동기화.
>
> **근거 원칙**: 판단은 공식 문서로 검증한 사실에 기반한다(맨 아래 "근거·출처"). PostHog SDK의 정확한 옵션명(커스텀 스토리지·라이프사이클 이벤트)은 **설치된 버전의 공식 문서로 확인 후** 사용한다(CLAUDE.md 규칙 6).
>
> 관련 문서: `CLAUDE.md`(현행 구조·규칙), `docs/phases/phase-7-*.md`(온보딩 구조), `docs/legal/privacy.html`(개정 대상), `supabase/tests/rls.sql`(SQL 파일 패턴).

---

## 목표 (Goal)

TestFlight 외부 테스트 기간에 아래 4가지 질문에 **숫자로 답할 수 있는 상태**를 만든다. 테스트 결과는 개선 → OTA 배포 → 전후 비교 루프의 입력이 된다.

1. **방문 빈도** — 테스터가 얼마나 자주 들어오는가 (주간 방문일수, DAU/WAU, D1/D7 리텐션)
2. **중도 이탈** — ⓐ 퍼널형: 담기 시작했다가 저장 전에 포기하는 비율 ⓑ 리텐션형: 앱을 더 안 쓰게 되는 비율
3. **공유 시트 비중** — 핵심 가설인 "공유 시트로 담기"가 실제 주 진입 경로인가
4. **AI 자동채움 품질** — 자동채움이 실제로 작동하는가(상태 분포), 사용자가 얼마나 고치는가(수정률)

### 설계 원칙 (이 Phase의 결정 배경 — 구현 전 반드시 이해)

- **질문 없는 이벤트는 노이즈다.** 이벤트는 위 4개 질문에 대응하는 최소셋(커스텀 7종)만 심는다. 화면·버튼마다 이벤트를 늘리지 않는다. 변형은 이벤트를 쪼개지 말고 **속성(properties)으로 접는다**.
- **도구는 PostHog.** JS-only로 동작 가능(재빌드 없음 = OTA 배포 가능), 무료 월 100만 이벤트, 퍼널·리텐션 내장. Amplitude·Firebase Analytics는 네이티브 SDK라 심사 중인 지금 넣을 수 없어 탈락.
- **"초기화"는 하지 않는다. 코호트 분리로 거른다.** 기존 Supabase 데이터(전부 개발자 데이터)는 지우지 않고, 집계 시 `created_at >= 테스트 시작일` 필터 + 개발자 uid 제외 목록으로 분리한다. 기존 데이터의 "현재값"은 지표가 아니라 **SQL 검증용 드라이런**으로만 쓴다.
- **온보딩은 제품을 바꾸지 않는다.** 공유 인텐트 첫 실행 시 온보딩 스킵은 유지한다(`_layout.tsx`의 OnboardingGate — 플래그를 세우지 않아 다음 일반 실행에서 노출됨). 완주율은 **"표시된 모수" 기준**으로만 계산하고, "온보딩 경유 → 활성화" 상관 분석은 하지 않는다(자기선택 편향 + 소표본).
- **링크 이벤트는 보류.** `source_link_opened`는 심지 않는다. "링크를 챙기는가"는 DB 쿼리(링크 보유율)로 답한다. 이벤트는 AI 링크 기능을 검토·출시하는 결정이 생길 때 품질 퍼널(`link_suggested → accepted → opened`)로 확장해 심는다.
- **소표본 전제.** 테스터 수십 명 규모라 A/B·유의성 주장은 하지 않는다. 퍼널 + 릴리스 전후 비교 + UT 정성 데이터 삼각측량이 분석 프레임이다.

---

## 승인된 범위 (사람이 확정한 값 — 임의 변경 금지)

| 갈래 | 내용 | 확정값 |
|---|---|---|
| **A** | PostHog 설치 + 캡슐화 모듈 | `posthog-react-native` 단독 설치(선택 peer 의존성 금지). 신규 `src/lib/analytics.ts` — 이벤트명 타입 유니언으로 강제, `__DEV__` 기본 옵트아웃, 키 미설정 시 no-op |
| **B** | 이벤트 계측 | 커스텀 7종(아래 택소노미 표). 앱 라이프사이클(열림/세션)은 SDK 자동 수집 활성화 |
| **C** | 프라이버시 문구 | `src/constants/privacy.ts` 문구 갱신 + `docs/legal/privacy.html` 개정 **초안**(사람 검토 후 확정). App Privacy 라벨·노션 동기화는 사람 |
| **D** | 트래킹 플랜 문서 | 신규 `docs/testing/tracking-plan.md` — 코호트 정의·택소노미·SQL 지표·**의도적 보류(별도 섹션)**·프라이버시 체크리스트 |
| **E** | SQL 지표 | 신규 `supabase/tests/metrics.sql`(rls.sql 패턴) — 링크 보유율, AI 정제 성공률, 필드 수정률, 카테고리 추천 채택률. 실행(드라이런)은 사람이 대시보드 SQL Editor에서 |
| F(선택) | 피드백 채널 + JS 에러 이벤트 | 아래 F 섹션. **채택 여부는 사람 결정** — 실제 앱(App Store) 배포로 테스트하면 TestFlight 내장 피드백·크래시 리포트가 없어지므로 **채택 권장** |

---

## 이벤트 택소노미 (B의 구현 명세)

명명 규칙: `목적어_동사(과거형)`, snake_case. 속성 값은 전부 아래 enum·수치만.

| 이벤트 | 트리거 시점 | 속성 | 답하는 질문 | 구현 위치 |
|---|---|---|---|---|
| (자동) 앱 열림·세션 | SDK 라이프사이클 자동 수집 | — | 질문 1 (방문 빈도·리텐션) | `analytics.ts` 초기화 옵션 |
| `share_intent_received` | 홈이 공유 인텐트를 소비한 직후 | `type: image \| url` | 질문 3 (공유 진입 전체량) | `src/app/(tabs)/index.tsx` |
| `register_opened` | 등록 화면 마운트 | `entry: share \| manual` | 질문 2ⓐ·3 (퍼널 시작) | `src/app/register.tsx` |
| `analysis_completed` | 분석 상태머신 종료 전이 시 | `status: parsed \| low_confidence \| parse_failed \| ocr_empty` (analysis_logs와 동일 enum) | 질문 4 (AI 작동률) | `src/hooks/useAnalysis.ts` |
| `autofill_edited` | AI가 채운 필드를 사용자가 **변경**했을 때, 필드당 1회 | `field: name \| price \| brand \| category` | 질문 4 (수정률) | `src/app/register.tsx` |
| `item_saved` | 저장 **성공 응답** 시(버튼 탭 시점 아님) | `source: share \| picker \| recent_photo`, `duration_ms`(마운트→성공), `had_analysis: boolean` | 질문 2ⓐ (퍼널 완료), 소요 시간 | `src/app/register.tsx` |
| `onboarding_step_viewed` | 온보딩 각 스텝 표시 시 | `step`(캐러셀 장 번호·코치마크 단계) | 완주율·이탈 스텝 | `src/components/Onboarding/OnboardingOverlay.tsx` |
| `onboarding_finished` | 완주 또는 스킵 시 | `result: completed \| skipped`, `last_step` | 이탈 지점 | 〃 |

구현 노트:
- **`register_opened.entry`와 `item_saved.source`는 역할이 다르다.** 마운트 시점엔 인텐트 여부만 알 수 있으므로 `entry`는 2값. 사진 출처(picker/recent_photo)는 저장 시점에 확정되므로 `source`는 `item_saved`에 싣는다.
- **퍼널형 이탈은 이벤트를 따로 만들지 않는다.** "register_opened 있고 item_saved 없음"으로 PostHog 퍼널에서 파생 계산한다("이탈" 이벤트 금지).
- **`autofill_edited` 중복 방지**: AI가 채운 초기값을 기억해 두고(이미 analysis_logs 기록용 원본값이 있다) 사용자가 그 값과 다르게 바꾼 **첫 변경에만** 1회 발화(필드별 Set).
- **identify**: 익명 인증 부트스트랩 완료 후 Supabase 익명 uid로 `identify()` 1회 — PostHog 퍼널과 DB(analysis_logs·items) 지표를 같은 식별자로 조인하기 위함. uid는 가명 식별자이며 추가 개인정보를 싣지 않는다.

## 이벤트 없이 나오는 지표 (D 문서·E SQL의 명세)

| 지표 | 계산 방법 |
|---|---|
| 방문 빈도 (질문 1) | PostHog 자동 세션 → 주간 방문일수, DAU/WAU |
| 리텐션형 이탈 (질문 2ⓑ) | PostHog 자동 세션 → D1/D7 리텐션 |
| 퍼널형 이탈 (질문 2ⓐ) | `register_opened` → `item_saved` 퍼널 전환율(파생) |
| 링크 보유율 | `items`에서 소스 링크 컬럼 채움 비율 — SQL (컬럼명은 `src/types/database.ts`에서 확인) |
| AI 정제 성공률·상태 분포 | `analysis_logs`의 status 집계 — SQL |
| 필드 수정률(정밀) | `analysis_logs`(AI 원본 정제값) vs `items`(최종 저장값) 조인 비교 — SQL. `autofill_edited` 이벤트의 교차 검증용 |
| 카테고리 추천 채택률 (FR-8) | `analysis_logs`의 추천값 vs `items.category_id` 최종값 — SQL (추천값 저장 여부를 스키마에서 먼저 확인, 없으면 이 지표는 이벤트 속성으로 대체 검토 후 사람에게 보고) |

모든 SQL은 **코호트 필터를 내장**한다: `created_at >= :테스트시작일` + 개발자 uid 제외 목록(`tracking-plan.md`에 자리 표시, 값은 사람이 기입).

## 의도적 보류 (이 Phase에서 하지 않는다 — D 문서에 "추가 조건"과 함께 기록)

| 항목 | 추가 조건(이게 생기면 그때 심는다) |
|---|---|
| `source_link_opened` | AI 구매 링크 기능 검토·출시 결정 시 품질 퍼널로 확장 |
| `tab_viewed`, 폴더/태그 CRUD, `settings_opened` | 해당 영역에 구체적 질문이 생길 때 (OTA로 추가 가능) |
| 온보딩→활성화 상관 분석 | 하지 않음(표본·편향상 불가) — 완주율만 본다 |
| 세션 리플레이 | 화면에 사용자 사진이 상시 노출되는 앱 특성상 비권장 |
| A/B 테스트 | 표본상 무의미 — 릴리스 전후 비교로 대체 |
| Sentry(크래시) | 네이티브 — **공개 홍보(인스타그램 등) 시작 전에 v1.1 네이티브 배치로 넣는다**(사람 확정, 2026-10. 기기 메타데이터 보강과 한 빌드에 묶어 심사 1회 — 심사 1~3일을 홍보 일정에서 역산할 것). 그 전(지인 출시 단계) 커버리지: JS 에러는 F-2, TestFlight 테스터 크래시는 자동 공유(App Store Connect 웹), App Store 사용자 크래시는 동의 기기분을 **Mac의 Xcode Organizer로 열람**(개발 머신 아니어도 됨 — Xcode 설치 + 같은 Apple 계정 로그인이면 소스 없이 조회 가능) |
| 기기 메타데이터 보강(선택 peer 의존성) | 다음 네이티브 배치 |

---

## 불변식 (Invariants) — 전 갈래 공통

1. **콘텐츠 미수집.** 이벤트 속성에 사진·OCR 원문·상품명·브랜드·가격·URL·메모 등 사용자 콘텐츠를 절대 싣지 않는다. 위 표의 enum·boolean·수치만 허용. (NFR-3 정합)
2. **네이티브 추가 금지.** `posthog-react-native` 외 어떤 패키지도 추가하지 않는다. 선택 peer 의존성 경고는 무시한다(동작에 영향 없음 — 공식 문서 확인).
3. **화면에서 직접 호출 금지.** 모든 수집은 `src/lib/analytics.ts` 경유. 이벤트명·속성은 타입 유니언으로 강제해 오타를 컴파일 타임에 잡는다. (데이터 레이어 규칙과 동일 사상)
4. **수집 실패가 앱을 막지 않는다.** 초기화·capture 실패는 삼킨다(`analysisLogs` 패턴). 키 미설정 시 모든 호출이 no-op — **키 없이 빌드해도 크래시·경고 없이 동작해야 한다.**
5. **`__DEV__`에서는 기본 수집 안 함.** 개발 기기 이벤트 오염 방지. 단, 계측 검증을 위한 명시적 활성화 수단(예: `settings.tsx`의 `__DEV__` 토글 또는 env 플래그) 1개를 둔다.
6. **방침 선행.** privacy 문구(C)가 머지에 포함되지 않으면 계측 코드(B)도 배포하지 않는다. 같은 PR로 묶는다.
7. **카피·토큰·커밋 컨벤션 승계.** 한국어 단답형, 디자인 토큰만, `feat:`+한국어 커밋.
8. **문서 정합(규칙 8).** `CLAUDE.md`·`README.md`에 analytics 모듈·환경 변수·명령어 변화를 같은 PR에서 반영한다.

---

## A — PostHog 설치 + `src/lib/analytics.ts`

**대상**: `package.json`, `.env.example`, 신규 `src/lib/analytics.ts`, `src/app/_layout.tsx`.

**작업**:
1. `npx expo install posthog-react-native` (SDK 호환 버전만 — CLAUDE.md 규칙 10).
2. `.env.example`에 `EXPO_PUBLIC_POSTHOG_KEY=`·`EXPO_PUBLIC_POSTHOG_HOST=` 추가(값 비움).
3. `analytics.ts`: 클라이언트 생성(커스텀 스토리지 = 기존 AsyncStorage, 앱 라이프사이클 자동 수집 켬 — 옵션명은 설치 버전 공식 문서로 확인), `capture(event, props)` 래퍼(타입 강제), `identifyUser(uid)`, 옵트아웃 로직(불변식 4·5).
4. `_layout.tsx`: 초기화 1회 + 익명 부트스트랩 후 `identifyUser` (hydrateSignedUrlCache와 같은 패턴으로 비차단).

**DoD**: `npx tsc --noEmit`·`npx expo lint` 통과. 키 없는 상태로 타입·린트·코드 경로상 no-op 확인. 네이티브 모듈 0개 추가(`package.json` diff로 확인).

## B — 이벤트 7종 계측

**대상**: 택소노미 표의 구현 위치 5개 파일.

**작업**: 표의 트리거·속성 그대로. 구현 노트 4개 항목 준수.

**DoD**: 타입·린트 통과. 각 이벤트가 표의 트리거 시점과 1:1 대응함을 코드 리뷰로 확인. **실발화 확인은 사람**: dev client에서 `__DEV__` 활성화 수단을 켜고 7종을 각 1회 이상 발생시켜 PostHog Activity에서 수신 확인(체크리스트를 `tracking-plan.md`에 포함).

## C — 프라이버시 문구

**대상**: `src/constants/privacy.ts`, `docs/legal/privacy.html`.

**작업**: 수집 항목(앱 사용 이벤트 — 기능 사용 여부·상태값·소요 시간, **기기 기본 정보 — 모델·OS 버전·앱 버전**, 익명 식별자), 미수집 항목(사진·텍스트 콘텐츠), **국외 이전 고지**(이전받는 자=PostHog, 국가(선택한 리전), 이전 항목, 목적·보유 기간 — 개인정보보호법상 국외 이전은 방침에 명시)를 기존 문구 톤에 맞춰 추가. 기기 기본 정보를 **처음부터 포괄**해 써서 v1.1 메타데이터 보강(선택 peer 의존성 추가) 때 재고지가 필요 없게 한다. **초안** — PR 설명에 "사람 검토 필요" 명시.

**DoD**: 인앱 고지(등록 최초 고지 + 설정 열람)와 privacy.html이 같은 내용을 말함(constants/privacy.ts 단일 소스 원칙 유지).

## D — `docs/testing/tracking-plan.md`

**작업**: 섹션 구성 — ① 테스트 목적·기간·코호트 정의(필터 기준, 개발자 uid 제외 목록 자리. **배포 경로도 명시한다**: TestFlight 한정이면 코호트=테스터 전원, 실제 앱(App Store)으로 받으면 익명 인증 특성상 모집 테스터와 오가닉 사용자를 구분할 수 없으므로 코호트를 "테스트 기간 내 전체 실사용자"로 정의) ② 이벤트 택소노미 표(이 문서에서 복사 후 **이쪽을 정본**으로 선언) ③ 이벤트 없이 나오는 지표 + `metrics.sql` 링크 ④ 의도적 보류(위 표 그대로 + 추가 조건) ⑤ 프라이버시 체크리스트(라벨·방침·노션 동기화 — 사람 확인란) ⑥ 실발화 확인 체크리스트 ⑦ **측정 한계**: 계측은 OTA로 배포되므로 v1.0.0 바이너리 설치자의 **첫 세션은 내장 번들(계측 없음)로 동작** — 설치 직후 첫 실행 이벤트(온보딩 퍼널, 설치 당일 첫 저장)는 구조적으로 유실된다. 두 번째 실행부터 정상 수집되며, 온보딩 지표는 계측이 내장된 다음 바이너리(v1.1) 이후 신규 설치자부터 유효하다.

**DoD**: 이 지시서 없이 tracking-plan.md만 읽어도 "뭘 왜 재는지"가 자족적으로 읽힘.

## E — `supabase/tests/metrics.sql`

**작업**: 위 "이벤트 없이 나오는 지표" 표의 SQL 4종. 각 쿼리에 코호트 필터 파라미터 주석. 스키마 확인은 `src/types/database.ts`·`supabase/migrations/`를 정본으로.

**DoD**: 문법 검증(타입 파일과 컬럼명 대조). **실행은 사람**이 대시보드 SQL Editor에서(에이전트는 DB 접근 불가) — 현 개발 데이터로 드라이런해 쿼리 동작만 확인(수치는 버린다).

## F — (선택) 피드백 채널 + JS 에러 이벤트

실제 앱(App Store) 배포로 테스트할 때 사라지는 TestFlight 내장 기능 2가지(스크린샷 피드백, 베타 크래시 리포트)의 **JS-only 대체재**. 네이티브 추가 없음 — 불변식 2 유지.

**F-1. 피드백 진입점** — 대상: `src/app/settings.tsx`.
- 설정에 "의견 보내기" 행(DisclosureRow 패턴) → `Linking.openURL('mailto:...')`. 주소는 기존 지원 이메일(= `docs/legal/support.html`·방침에 통일된 wishshot2026 주소 — 저장소에서 확인해 그대로 사용, 새 주소 만들지 않는다).
- 카피는 단답형("의견 보내기"). `__DEV__` 전용 아님 — 모든 사용자 노출.

**F-2. JS 에러 이벤트** — 대상: `src/lib/analytics.ts`.
- `ErrorUtils.setGlobalHandler`로 전역 JS 에러를 `app_error` 이벤트로 수집. 속성은 `{name: string(에러 클래스명), is_fatal: boolean}` **만** — 메시지·스택은 싣지 않는다(콘텐츠 유입 가능성 차단, 불변식 1).
- **기존 핸들러 체이닝 필수**: 이전 핸들러를 보관했다가 capture 후 반드시 호출한다(안 그러면 개발 redbox·기본 크래시 동작이 사라진다).
- **한계를 문서에 명시**: 이 방식은 **JS 에러만** 잡는다. 네이티브 크래시는 여전히 수집 불가 — Sentry는 보류 목록 그대로 유지(다음 네이티브 배치). `app_error`는 크래시 모니터링의 대체가 아니라 임시 가시성이다.

**DoD**: 타입·린트 통과. F-2 체이닝 동작(의도적 throw로 redbox 정상 표시 + 이벤트 발화)을 dev client에서 사람이 확인. tracking-plan.md 택소노미에 `app_error` 추가(채택 시).

---

## 배포 순서 (고지 선행 — 순서 위반 금지)

게이트는 심사 상태가 아니라 **고지 선행**이다: 수집을 시작하는 번들이 사용자에게 닿기 전에, 라벨·방침이 먼저 사실과 맞아야 한다. (현재 심사 통과·출시 대기 상태라 심사 게이트는 이미 충족. 라벨 수정은 버전 제출 없이 가능하며 재심사를 유발하지 않는다. 이 Phase는 JS-only라 OTA도 재심사 대상이 아니다 — 재심사는 네이티브 변경(보류 목록의 Sentry 등) 때만 발생하고, 그땐 새 빌드 + `runtimeVersion` 변경으로 이전 OTA와 자동 분리된다.)

1. **사람**: App Privacy 라벨·노션 방침 반영(언제든 가능·재심사 없음) → 2. PR → `dev` 머지 → 3. 실기기 검증 — preview 채널 빌드가 따로 없으면 **dev client로 검증**(`__DEV__` 활성화 수단을 켜고 PostHog Activity에서 7종 수신 확인) → 4. `eas update --branch production` — TestFlight 테스터·App Store 사용자 모두 같은 production 채널로 받는다.

## 완료 기준 (Phase DoD)

- [ ] A~E(+채택 시 F) 전부 DoD 충족, 타입·린트 통과
- [ ] 네이티브 모듈 추가 0개 (재빌드 불필요 확인)
- [ ] 사람 체크: PostHog Activity에서 7종 수신, metrics.sql 드라이런, 라벨·방침 반영
- [ ] CLAUDE.md·README 갱신 포함 PR (`.github/pull_request_template.md` 구조 준수)

## 근거·출처

- PostHog React Native 공식 문서(설치·Expo·커스텀 스토리지·옵트아웃): https://posthog.com/docs/libraries/react-native
- Expo 공식 PostHog 가이드: https://docs.expo.dev/guides/using-posthog/
- 구현 시 "선택 peer 의존성 없이 코어 동작"과 정확한 옵션명은 **설치된 버전** 문서로 재확인할 것(버전 간 옵션명 차이 있음).
