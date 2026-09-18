# Phase 3 — OCR + LLM 정제 자동채움

> **이 문서 사용법**: Claude Code에 이 파일 전체를 컨텍스트로 넘기고 "Step N을 진행해달라"고 요청한다. Step은 순서대로 진행하고, 각 Step의 **DoD**를 사람이 확인한 뒤 다음으로 넘어간다. 아이폰 설치·공유 시트·OCR 실기기 동작은 에이전트가 검증할 수 없으므로 사람이 직접 한다.
>
> 관련 문서(원본): 노션 「WishShot v2 PRD (iOS 앱)」 §6.2(분석)·§9(예외)·§8(비기능), 「WishShot v2 — 플랫폼·아키텍처 결정 문서」 4.3(OCR 파이프라인)·6장(Phase 3)·7장(계약 3·4). 이 문서는 그 둘에서 Phase 3에 필요한 부분만 **증류**한 작업 지시서다. 요구사항 원본은 노션이다.

---

## 목표 (Goal)

Phase 2까지 **수동 입력**으로 저장하던 등록 화면 위에, **온디바이스 OCR + LLM 정제로 제품명·가격·브랜드를 자동으로 채우는** 경험을 얹는다. 이 Phase가 끝나면: 공유 시트 또는 앱 내 사진 선택으로 이미지가 들어오면 즉시 OCR이 돌고, 추출한 텍스트를 Edge Function이 LLM으로 정제해 폼을 자동채움하며, "AI가 채움" 표시와 상태 인디케이터가 보인다. 실패해도 저장 흐름은 깨지지 않고 수동 입력으로 폴백한다.

**이 Phase의 핵심 검증(PRD S1 Happy Path)**: 스크린샷 → 공유 시트 → WishShot → OCR 자동 시작 → 제품명·가격 자동채움("AI가 채움") → 확인·수정 → 저장. 예외 3종 이상(빈 OCR / 정제 실패 / 제품명 미인식) 확인.

## 이 Phase에서 하지 않는 것

- **저장 후 편집, 카테고리 이동, 메모/태그 고급 UX, 기존 데이터 이관** → **Phase 4**.
- **카테고리 자동 추천(FR-8)** → 이후. Phase 3는 카테고리를 추천하지 않는다(사용자가 고른다 — Phase 2 그대로).
- URL 공유 수신, 이미지 자르기, 검색/정렬, Apple 로그인, Android → 이후.
- OCR 신뢰도 기반 학습·튜닝, 다국어 OCR 최적화 → 범위 밖(한국어/영어 텍스트 인식이면 충분).

---

## 사전 조건 (사람이 준비)

- [x] Phase 2 완료: 데이터 계약(`categories`/`items`/`analysis_logs` + RLS + Storage), 등록/목록/상세/삭제 화면, 공유 시트 수신 → 수동 저장.
- [x] Supabase 대시보드 접근 (Edge Function 배포·시크릿 설정용) 또는 Supabase CLI 로그인.
- [x] **Claude API 키** (Anthropic Console에서 발급). 이 키는 **앱에 넣지 않고** Edge Function 시크릿으로만 등록한다. (사람이 발급·보관)
- [x] `analysis_logs` 테이블은 Phase 2에서 이미 생성됨(GRANT·RLS 포함). 이 Phase는 **테이블을 만들지 않고 쓰기만** 한다 — 스키마 변경 없음(변경이 필요하면 `0002_*.sql` 추가 규칙을 따른다).

---

## 제약 (Constraints) — 에이전트가 지킬 것

Phase 1·2 규칙(한국어 문자열, 디자인 토큰, 비밀값 커밋 금지, 커밋 컨벤션, 문서 동기화, 데이터 레이어 경유, 모르면 묻기)을 그대로 승계하고 다음을 추가한다.

1. **비밀 값은 앱에 절대 넣지 않는다.** Claude API 키·Supabase `service_role` 키는 **Edge Function 환경 변수(시크릿)에만** 존재한다. 앱 번들(`EXPO_PUBLIC_*` 포함)에 들어가면 안 된다. 앱은 로그인 사용자의 세션(anon 클라이언트)으로 Edge Function을 호출한다.
2. **이미지는 기기를 떠나지 않는다.** OCR은 **온디바이스**(ML Kit). 서버(Edge Function → LLM)로는 **OCR로 추출한 텍스트만** 보낸다. 원본 이미지는 저장용 Storage 업로드(Phase 2)를 제외하고 어디로도 전송하지 않는다. 이 방침을 **첫 업로드 시 사용자에게 고지한다**(NFR-3). *(각주 — Phase 6 개정: 텍스트를 찾지 못한 경우에 한해 사용자가 직접 선택한 제품 영역 크롭만 동의 후 전송된다. `docs/phases/phase-6-hackathon-submission.md` 참고.)*
3. **OCR 엔진은 인터페이스 뒤에 캡슐화한다(FR-8a).** `interface OcrEngine { recognize(uri): Promise<{ text; confidence? }> }` 를 두고, 구현체 `MlKitOcrEngine`(실기기)·`MockOcrEngine`(개발/테스트)를 그 뒤에 숨긴다. 화면·상태머신은 인터페이스만 안다 — 나중에 엔진을 갈아끼워도 로직 레이어는 무변경.
4. **네이티브 의존성은 이 Phase 초반에 한 번에 추가.** ML Kit 텍스트 인식 래퍼는 **네이티브 모듈**이라 추가 시 EAS 재빌드가 필요하다. Step 1에서 미리 추가하고 재빌드를 한 번 돌린다. 이후 이 Phase 안에서 네이티브 의존성을 추가하지 않는다. **ML Kit 래퍼 패키지의 Expo SDK 57 호환 버전은 착수 시 먼저 확인**한다(결정 문서 §8 미결). 불확실하면 임의 버전을 쓰지 말고 사람에게 보고한다.
5. **서버는 Edge Function 1개뿐.** Next.js·Express·별도 API 서버를 만들지 않는다. `parse-screenshot-text` Edge Function(Supabase, Deno 런타임) 하나로 LLM 정제를 처리한다. 더 필요해 보이면 사람에게 묻는다.
6. **정제 실패가 저장을 막지 않는다(NFR-2).** OCR 없음/정제 실패/타임아웃/네트워크 오류는 전부 **수동 입력 폴백**으로 이어진다. 자동채움은 편의 기능이지 저장의 전제 조건이 아니다.
7. **`normalized_name`은 여전히 앱에서 계산한다.** 자동채움된 `brand`·`product_name`으로 저장할 때도 중복 판정은 **`src/lib/normalize.ts` 한 곳**을 쓴다(정규화 소스 1개, Phase 2 그대로).
8. **자동채운 필드는 시각적으로 구별한다(FR-4).** "AI가 채움" 표시. 사용자가 손대면 수동 값으로 전환된다.

---

## Edge Function 계약 (Step 2에서 구현, 병렬 작업의 기준선)

결정 문서 7장 계약 3·4에 해당. **입출력을 먼저 고정**한다.

- **함수명**: `parse-screenshot-text` (Supabase Edge Function, Deno)
- **입력**: `{ "text": string }` — 온디바이스 OCR 원문(여러 줄 가능)
- **출력**: `{ "productName": string | null, "price": number | null, "brand": string | null, "confidence": number }`
  - `productName`: 정제된 제품명. 못 뽑으면 `null`(→ 앱에서 E-3 수동 입력 유도).
  - `price`: 숫자만(원 단위 정수). 통화 KRW 고정. 없으면 `null`.
  - `brand`: 브랜드. 없으면 `null`.
  - `confidence`: 0~1. 낮으면(임계값은 앱에서 판단, 잠정 `< 0.5`) "확인이 필요해요"(FR-7a) 표시.
- **모델**: Claude **Haiku**(현재 `claude-haiku-4-5`) — 텍스트만 보내는 저비용 정제(결정 문서 5장). 정확한 모델 ID·파라미터는 착수 시 `claude-api` 레퍼런스로 확인한다. 파싱 안정성을 위해 **구조화 출력**(`output_config.format`의 json_schema, 위 출력 스키마)을 쓴다.
- **키 관리**: `ANTHROPIC_API_KEY`는 Edge Function 시크릿(`supabase secrets set` 또는 대시보드). 앱에는 없음.
- **인증**: 함수는 로그인 사용자만 호출(Supabase가 JWT 검증). 익명 호출 거부.
- **실패 응답**: LLM 오류·타임아웃 시 5xx 또는 `{ error }` — 앱은 이를 E-2로 처리(원문 표시 + 재시도 + 수동 폴백).

> 이 계약이 고정되면 앱 쪽(OcrEngine·상태머신·화면)과 Edge Function을 독립적으로 진행할 수 있다. 다만 Phase 2처럼 **솔로 순차**로 가는 것을 기본으로 한다(worktree·병렬 트랙은 선택).

---

## Step 1 — OcrEngine 인터페이스 + ML Kit 네이티브 추가 + EAS 재빌드

네이티브가 걸리는 Step이므로 먼저. 여기서 재빌드를 한 번 돌려두면 이후 Step은 JS 전용으로 진행된다.

**작업**
1. **ML Kit 래퍼 패키지 확정·추가**: 온디바이스 텍스트 인식(Google ML Kit) 래퍼를 조사해 **Expo SDK 57 호환 버전**을 확인하고 `npx expo install`(또는 필요 시 config plugin 등록)로 추가한다. 네이티브 모듈이므로 **`app.json` plugins/설정 확인 → EAS 재빌드**가 필요하다. 버전이 불확실하면 임의로 정하지 말고 사람에게 보고(제약 4).
2. `src/lib/ocr/` 신설:
   - `OcrEngine.ts` — `export interface OcrEngine { recognize(uri: string): Promise<{ text: string; confidence?: number }> }`
   - `MlKitOcrEngine.ts` — ML Kit 래퍼로 구현(실기기 전용). `file://` uri 정규화는 기존 `src/lib/imageBytes.ts`의 방식을 참고.
   - `MockOcrEngine.ts` — 고정 샘플 텍스트를 반환(개발 서버·Expo Go·시뮬레이터에서 화면 로직 검증용).
   - `index.ts` — 환경에 따라 엔진 선택(예: 네이티브 모듈 가용 여부/개발 플래그). 화면은 `@/lib/ocr`만 import.
3. iOS config plugin 주입은 `npx expo config --type introspect`로 검증(Windows에선 실제 prebuild 불가 — Phase 1 규칙).
4. EAS 개발 빌드 재실행(사람이 터미널에서, Apple 인증 프롬프트). 아이폰에 재설치.
5. 커밋: `feat: OcrEngine 인터페이스 + MlKit/Mock 엔진 + ML Kit 네이티브 추가`

**DoD**
- [x] `OcrEngine` 인터페이스 + `MlKitOcrEngine`·`MockOcrEngine` 존재, `npx tsc --noEmit` 통과
- [x] `app.json`/introspect에 ML Kit config plugin(있다면) 반영 확인
- [x] (사람) EAS 재빌드 → 아이폰 재설치 → 앱 정상 실행(기존 Phase 2 기능 회귀 없음)
- [x] (사람) 실기기에서 이미지 1장에 대해 `MlKitOcrEngine.recognize`가 텍스트를 반환(콘솔/임시 표시로 확인)

---

## Step 2 — Edge Function `parse-screenshot-text`

위 "Edge Function 계약"을 구현한다.

**사람이 하는 것**
- Anthropic Console에서 Claude API 키 발급.
- Edge Function 시크릿 등록: `npx supabase secrets set ANTHROPIC_API_KEY=...` (또는 대시보드). **채팅에 키를 붙이지 말 것.**

**에이전트가 하는 것**
1. `supabase/functions/parse-screenshot-text/index.ts` 작성(Deno). 입력 `{ text }` 검증 → Claude Haiku 호출(구조화 출력 json_schema) → `{ productName, price, brand, confidence }` 반환.
   - 프롬프트: OCR 원문에서 제품명/브랜드/가격을 뽑고, 불확실하면 낮은 confidence를 매기게 한다. 한국어/영어 스크린샷 대응. 가격은 숫자만(원).
   - 키는 `Deno.env.get('ANTHROPIC_API_KEY')`. 앱에 노출 금지.
   - JWT 검증(로그인 사용자만). 익명 거부.
2. 에러/타임아웃 처리: 상위(앱)가 E-2로 폴백할 수 있게 명확한 실패 응답.
3. 배포: `npx supabase functions deploy parse-screenshot-text` (사람이 실행/확인).
4. **단위 테스트용 샘플**: 대표 OCR 텍스트 2~3개 → 기대 JSON을 `supabase/functions/parse-screenshot-text/samples/`(또는 문서)에 남겨 회귀 확인 근거로.
5. 커밋: `feat: parse-screenshot-text Edge Function (Claude Haiku 정제)`

**DoD**
- [x] 함수 배포됨. (사람) 샘플 텍스트로 호출 → 기대 형태 JSON 반환(예: `{"productName":"무선 이어폰","price":189000,"brand":"소니","confidence":0.8}`)
- [x] `ANTHROPIC_API_KEY`가 앱 번들·`.env`·커밋 어디에도 없음(Edge Function 시크릿에만)
- [x] 익명(미로그인) 호출 거부 확인
- [x] LLM 실패/타임아웃 시 앱이 구분할 수 있는 실패 응답 반환

---

## Step 3 — 분석 상태머신 훅 + `analysis_logs` 데이터 레이어

**작업**
1. **상태머신 훅**(`src/hooks/useAnalysis.ts` 등, `useReducer`) — 결정 문서 4.3의 상태 전이:
   `idle → imageReceived → ocrRunning → parsing → filled → submitted`, 실패 시 `error`(→ 수동 입력 폴백).
   불가능한 상태 조합을 리듀서로 차단. 입력: 이미지 uri. 출력: 현재 상태 + 정제 결과(productName/price/brand/confidence).
   흐름: 이미지 수신 → `OcrEngine.recognize` → 텍스트 있으면 Edge Function 호출 → 결과로 `filled`, 없으면/실패면 `error`.
2. **`analysis_logs` 데이터 레이어**(`src/lib/queries/analysisLogs.ts`, 배럴에 추가): 분석 결과를 개발자용 로그로 기록.
   - 필드: `raw_text`(OCR 원문), `parsed`(jsonb, 정제 결과), `status`(`ocr_empty` / `parsed` / `parse_failed` / `low_confidence`), `fail_reason`, `item_id`(저장 후 연결 — 저장 전 이탈이면 null).
   - RLS·GRANT는 Phase 2에서 이미 있음(`user_id = auth.uid()`). `user_id`는 편의로 채우되 RLS가 강제. 화면에서 직접 `supabase.from`을 부르지 말고 이 쿼리를 쓴다(제약: 데이터 레이어 경유).
   - **로그 기록이 저장을 막지 않는다** — 로그 insert 실패는 삼켜서 사용자 흐름에 영향 없게.
3. 커밋: `feat: 분석 상태머신 훅 + analysis_logs 데이터 레이어`

**DoD**
- [x] `useAnalysis`(useReducer) 존재, 상태 전이·에러 폴백 구현. `tsc --noEmit` 통과
- [x] `analysisLogs` 쿼리(`@/lib/queries`) 존재, `status` 4종 사용
- [x] `MockOcrEngine` + 배포된 Edge Function으로 상태머신이 `idle→…→filled` / `→error`를 정상 순회(개발 서버에서 확인)

---

## Step 4 — 등록 화면 자동채움 통합  ⭐

이 Phase의 핵심. Phase 2에서 비워둔 "AI 자동 채움" 자리(`register.tsx`의 `ocrHint` 플레이스홀더)를 실제 기능으로 대체한다.

**작업** (PRD §10 등록 화면, S1/S2)
1. `register.tsx`에 `useAnalysis` 연결: **이미지가 들어오면(공유/사진 선택) 즉시 분석 시작**. 기존 `ocrHint` 자리를 **상태 인디케이터**로 교체 — "인식 중 / 정리 중 / 완료 / 실패"(NFR-1). 화면 골격 먼저 표시(NFR-4).
2. **자동채움**: `filled` 상태가 되면 `productName`·`price`·`brand`를 폼에 채운다. 자동채운 필드는 **"AI가 채움" 배지로 시각 구별**(FR-4). 사용자가 편집하면 수동 값으로 전환(배지 제거).
3. **저신뢰 표시(FR-7a)**: `confidence`가 임계값 미만이면 "확인이 필요해요" 안내.
4. **저장 시 `analysis_logs` 연결**: 저장 성공 후 `item_id`를 로그에 연결(또는 저장 직전 로그를 남기고 item_id를 업데이트). 저장 전 이탈이면 `item_id=null`로 남는다.
5. 기존 저장·중복 덮어쓰기 플로우(Phase 2)는 그대로. 자동채움은 그 위에 얹히는 레이어일 뿐 — `normalizeName`·Storage 업로드·UNIQUE 폴백 로직 무변경.
6. 커밋: `feat: 등록 화면 OCR 자동채움 + 상태 인디케이터 + "AI가 채움" 표시`

**DoD**
- [x] (사람) **공유 시트 → WishShot → 등록 화면 진입 시 OCR 자동 시작 → 제품명/가격 자동채움 확인** ← Phase 3 핵심(PRD S1)
- [x] (사람) **앱 내 사진 선택 → 자동채움** 동일 동작(S2)
- [x] 자동채운 필드에 "AI가 채움" 표시, 편집 시 표시 사라짐(FR-4)
- [x] 저신뢰 시 "확인이 필요해요" 노출(FR-7a)
- [x] 저장 후 `analysis_logs`에 `item_id` 연결 확인(대시보드)
- [x] 디자인 토큰만 사용(원시 hex 없음), 문자열 한국어. `tsc --noEmit` 통과

---

## Step 5 — 예외 처리 + 개인정보 고지 + 접근성

**작업** (PRD §9 예외, §8 비기능)
1. **예외 UI** — 상태머신 `error` 분기를 화면에 연결:
   - E-1(OCR 인식 결과 없음) → 자동채움 없이 수동 입력 안내. `analysis_logs.status='ocr_empty'`.
   - E-2(LLM 정제 실패/타임아웃/네트워크) → **OCR 원문을 보여주고** 수동 입력 폴백 + **재시도** 버튼. `status='parse_failed'`.
   - E-3(제품명 미인식, 부분 성공) → "제품명을 입력해주세요" + 포커스 이동 + 저장 버튼 비활성(이미 Phase 2에 제품명 필수 로직 있음 — 재사용).
   - E-7(이미지 외 파일 수신)은 공유 확장 설정(이미지 only)으로 이미 차단 — 확인만.
2. **개인정보 고지(NFR-3)**: **첫 업로드 시 1회** "이미지는 기기에서 분석되고 비공개 저장소에만 저장돼요. 텍스트만 AI 정제에 전송돼요." 안내(예: AsyncStorage 플래그로 최초 1회). 설정 화면이 있으면 거기서도 열람 가능하게(선택).
3. **접근성(NFR-6)**: 자동채움 결과·상태 변화를 VoiceOver가 인지하도록 접근성 라벨/`accessibilityLiveRegion` 등 적용. 상태 인디케이터 변화를 접근성 안내로.
4. 커밋: `feat: OCR 예외 처리 + 개인정보 고지(NFR-3) + 접근성`

**DoD**
- [x] (사람) **예외 3종 이상 확인**: 빈 OCR(E-1) / 정제 실패·재시도(E-2) / 제품명 미인식(E-3) — 각각 수동 입력으로 폴백되고 저장 흐름이 깨지지 않음
- [x] (사람) 첫 업로드 시 개인정보 고지 1회 노출, 이후 미노출
- [x] (사람) VoiceOver로 자동채움·상태 변화 인지 가능
- [x] `analysis_logs.status`가 상황별로(`ocr_empty`/`parsed`/`parse_failed`/`low_confidence`) 기록됨

---

## Step 6 — 문서 정리 + PR

**작업**
1. `CLAUDE.md` 갱신: 상태를 **Phase 3 완료**로. OCR 파이프라인(`src/lib/ocr/`, `OcrEngine`), Edge Function(`supabase/functions/parse-screenshot-text`), 상태머신 훅, `analysis_logs` 사용, 데이터 흐름 다이어그램의 "Phase 3까지 동작" 반영. "비밀 값은 Edge Function 시크릿에만" 규칙 강조.
2. `README.md`에 Edge Function 배포·시크릿 설정법, ML Kit 래퍼/재빌드 안내 추가.
3. 이 문서 DoD 채우고 "결과 기록" 작성(ML Kit 래퍼 버전, 채택 모델·파라미터, EAS 재빌드, confidence 임계값, 발생 이슈).
4. 커밋: `docs: Phase 3 완료 — 문서 갱신, 결과 기록`. `dev`로 PR.

**DoD**
- [x] `CLAUDE.md`가 현재 구조를 정확히 설명(아직 없는 것을 있다고 쓰지 않음)
- [x] `dev`로 PR (열림 — 사람이 머지)

---

## 미결 사항 (진행 중 결정, 결과 기록에 남길 것)

- **ML Kit 래퍼 패키지·버전**: Expo SDK 57 호환 버전 확인 필요(결정 문서 §8 미결). config plugin 유무·재빌드 영향.
- **정제 모델·파라미터**: Claude Haiku(`claude-haiku-4-5`) 잠정. 정확도/비용 실측 후 조정 가능. 구조화 출력 스키마 확정.
- **confidence 임계값**: "확인이 필요해요" 기준(잠정 `< 0.5`) — 실사용 관찰 후 조정.
- **OCR 엔진 선택 로직**: 실기기=MlKit, 개발/시뮬레이터=Mock을 어떤 플래그로 가를지.
- **`analysis_logs` 기록 시점**: 저장 전(분석 직후) vs 저장 후 연결 — item_id 연결 방식 확정.
- **개인정보 고지 위치**: 최초 1회 모달 + 설정 화면 열람(설정 화면 존재 여부에 따라).

**이 문서에서 확정한 결정:**
- 정제 공급자: **Claude Haiku(유료) 유지.** 무료 LLM 티어(예: Gemini 무료)는 입력을 제품 개선·사람 검토에 사용하는 데이터 정책이라 NFR-3(텍스트만·프라이버시) 스탠스와 충돌 → 제외. 또한 OCR은 제품 필드만이 아니라 화면 전체 텍스트를 긁으므로 이름·주소가 섞일 수 있어 "제품 정보만"은 보장이 아님. 유료 티어는 입력을 학습에 쓰지 않음.
- Edge Function은 `parse-screenshot-text` **1개**. 입력 `{ text }`, 출력 `{ productName, price, brand, confidence }`. Claude 키는 Edge Function 시크릿에만.
- 이미지는 기기를 떠나지 않음(온디바이스 OCR). **텍스트만** 서버로. NFR-3 고지 포함. *(Phase 6 개정: 텍스트 부족 시 선택 영역 크롭만 예외 전송.)*
- OCR은 `OcrEngine` 인터페이스 뒤에 캡슐화(MlKit/Mock 교체 가능).
- `analysis_logs`는 Phase 2에서 만든 테이블을 **쓰기만**(스키마 변경 없음).
- 카테고리 자동 추천(FR-8)은 Phase 3 범위 밖 — 이후.

## 결과 기록 (Phase 완료 시 작성)

- **완료일**: 2026-09-14
- **OCR 엔진 / 버전 / 재빌드**: **Google ML Kit 대신 Apple Vision 채택.** 서드파티 래퍼 조사 결과 어떤 것도 Expo SDK 57 / RN 0.86 / New Architecture 호환을 공식 확인 못 함(`@react-native-ml-kit/text-recognition@2.0.0`은 New Arch open issue #85, `@infinitered/...`는 SDK 56용 6.0.0이 npm 미발행). iOS 전용이라 Apple Vision이 ML Kit iOS CocoaPods/arm64 문제를 회피. 처음엔 `expo-text-extractor@2.0.0`을 썼으나 `recognitionLanguages` 미설정으로 **영어만 인식(한국어 누락)** + 언어 옵션 미노출 → 제거하고 **자작 로컬 Expo 네이티브 모듈 `modules/expo-vision-ocr`**로 전환(`recognitionLanguages=["ko-KR","en-US"]`, `.accurate`, `usesLanguageCorrection`). config plugin 없이 autolinking(`modules/`는 expo가 자동 인식, introspect로 확인). **EAS 개발 빌드 2회**(① expo-text-extractor 추가 ② 로컬 모듈 전환·서드파티 제거). 이후 Step은 JS 전용이라 추가 재빌드 없음.
- **채택 모델 / 파라미터 / 구조화 출력**: `claude-haiku-4-5`, `max_tokens: 400`, thinking 미사용, **구조화 출력** `output_config.format` = `json_schema`(nullable은 `anyOf`). 호출은 Deno에서 REST 직접 `fetch`(설치 SDK의 `output_config` 지원 불확실 회피). 프롬프트: 한/영 공존 시 **한국어 제품명 우선** + 수량/구성 노이즈 제거, 가격은 원 단위 정수(할인가 우선).
- **confidence 임계값**: `0.5`(`LOW_CONFIDENCE_THRESHOLD`, `src/hooks/useAnalysis.ts`). 미만이면 "확인이 필요해요"(FR-7a). 실사용 관찰 후 조정 가능.
- **Edge Function 배포 / 시크릿**: `parse-screenshot-text` 배포됨(project `vcvzuiyxcmvrkxscgvwp`). `ANTHROPIC_API_KEY`는 함수 시크릿에만(`supabase secrets set`) — 앱·`.env`·커밋에 없음. `supabase.auth.getUser()`로 로그인 사용자만 통과(익명 401 확인). 실패는 `llm_timeout`/`llm_error`/`llm_refusal` 등 구분 응답 → 앱이 E-2 폴백.
- **엔진 선택 로직**: `src/lib/ocr/index.ts` — `isVisionAvailable()`(네이티브 모듈 존재)면 `VisionOcrEngine`, 아니면 `MockOcrEngine`(Expo Go·시뮬레이터·개발 서버). `FORCE_MOCK` 플래그로 강제 가능.
- **analysis_logs 기록 시점**: 저장 성공 시 `createAnalysisLog`로 기록 + `item_id` 연결(`recordAnalysisLog`). `parsed`에는 AI 원본 정제값(실제 저장값은 `items`). `status` 4종 사용. 로그 실패는 삼켜 저장을 막지 않음.
- **개인정보 고지 위치**: 첫 이미지 업로드 시 1회 모달(AsyncStorage `wishshot.privacyNoticeShown`). 설정 화면은 아직 없음(Phase 4 여지).
- **발생한 이슈와 해결**:
  - 한국어 미인식 → Apple Vision `recognitionLanguages`에 `ko-KR` 명시(자작 모듈로 제어).
  - curl 테스트 시 Windows Git Bash가 한국어를 mojibake로 전송 → `--data-binary @UTF-8파일`로 검증(실제 앱은 supabase-js가 UTF-8 전송이라 무관).
  - E-2 원문이 `numberOfLines=4`로 상태바 잡텍스트만 보임 → 전체 표시로 수정. 이후 "줄 탭 → 제품명 칸 자동 입력"(정제 실패 시 LLM이 없어 앱은 어느 줄이 제품명인지 모르므로 사용자가 탭해서 선택)으로 개선. 탭한 줄은 배경 강조(파생값). `expo-clipboard`(탭→복사·피드백·전체 복사)는 재빌드가 걸려 Phase 4로 미룸.
  - E-3(제품명 null) 시 상태 문구가 일반 "확인이 필요해요"였음 → "제품명을 인식하지 못했어요…"로 명시.
  - **중복 판정 한계(알려진 한계, Phase 3 범위 밖)**: 같은 제품이라도 스크린샷 소스가 다르면(공홈 한국어명 vs 인증샷 영어 라벨) OCR 텍스트가 달라 `normalized_name`이 달라짐 → 크로스-소스 중복은 못 잡음. `normalized_name`은 "동일 재저장 하드 차단" 용도 유지. 이미지·카탈로그 기반 중복/후보 선택 UX는 Phase 4 백로그.
- **Phase 4로 넘길 것**: 저장 후 편집(FR-14)·카테고리 이동(FR-15)·메모/태그, 기존 SQLite/uploads 데이터 이관(`docs/archive/migrate-sqlite-to-supabase.ts` 개조), TestFlight 내부 테스트, 카테고리 자동 추천(FR-8), **`expo-clipboard` 도입(E-2 원문 탭→복사·복사 피드백·전체 복사)**, 크로스-소스 중복 판정·제품명 후보 선택 UX, 개인정보 고지 설정 화면 열람은 그 이후. (expo-clipboard 등 네이티브 추가는 Phase 4 재빌드에 묶어서)
