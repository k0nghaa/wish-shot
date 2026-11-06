# Phase 15 — AI 정제 함수 요청 제한

> **이 문서 사용법**: Claude Code에 이 파일 전체를 컨텍스트로 넘기고 "**Step N을 진행해달라**"고 한 Step씩 요청한다. **사람** Step(한도 값 결정·마이그레이션 적용·함수 배포·대시보드 확인)은 에이전트가 대신하지 않는다. 에이전트는 Step마다 변경 요약을 보고하고 **승인을 받은 뒤 커밋**한다. PR은 모든 에이전트 Step이 끝난 뒤 승인받고 올린다. 커밋 메시지에 Phase·Step 번호를 넣지 않는다.
>
> **브랜치**: 최신 `dev`에서 분기한 `feat/phase-15-ai-rate-limit`. worktree `../wish-shot-sec`에서 작업한다(Phase 16과 같은 폴더를 순서대로 쓴다 — 둘 다 마이그레이션을 추가하므로 번호 충돌을 막기 위해). 세션 시작 시 `git status --short --branch`로 확인한다.
>
> **서버 측만 바뀐다**: 마이그레이션 1개와 Edge Function `parse-screenshot-text` 재배포. 앱 재빌드·OTA 없음.
>
> **레인 경계(중요)**:
> - `src/**`, `app.json`/`app.config.js`는 건드리지 않는다(다른 브랜치가 네이티브 빌드 작업 중).
> - `supabase/functions/parse-screenshot-text/prompt.ts`·`samples/**`·`.gitignore`는 건드리지 않는다(정확도 측정 브랜치가 작업 중).
> - **LLM에 보내는 입력·프롬프트·출력 스키마는 바꾸지 않는다.** 정확도 측정 조건을 유지하기 위해서다.
>
> **운영 DB 하나로 시험한다**: 개발용 Supabase 프로젝트가 없다. 마이그레이션마다 **되돌리는 SQL을 함께** 둔다.
>
> **근거 원칙**: Supabase·Postgres·Deno 동작(Edge Function에서 RPC 호출, `security definer` 함수의 `auth.uid()`, 응답 헤더 등)은 공식 문서로 확인한 뒤 쓴다(CLAUDE.md 규칙 6).
>
> 관련 문서: `CLAUDE.md`(규칙 9 GRANT 명시), `supabase/functions/parse-screenshot-text/index.ts`, `src/lib/queries/parse.ts`, `src/hooks/useAnalysis.ts`, `supabase/migrations/0003_orphan_images_fn.sql`·`0004_internal_users.sql`(함수 권한·비노출 스키마 패턴), `docs/phases/phase-8-app-store-release.md` Step 7-2(LLM 지출 방어).

---

## 목표 (Goal)

- **지금 상태**: 함수는 로그인 사용자만 통과시키지만, 익명 로그인이 열려 있어 공개 anon 키만 있으면 누구나 세션을 받아 함수를 부를 수 있다. 사용자별·전체 호출 수 제한이 없어 Claude API 비용이 제한 없이 늘 수 있다.
- **이 Phase**: 사용자별 한도와 전체 일일 한도(차단기)로 호출 수에 상한을 둔다.
- **남길 것**: 제한이 실제로 동작하는지 시험한 결과.

## 하지 않는 것

- 프롬프트·입력·출력 스키마 변경
- 앱 코드 변경. 제한에 걸리면 앱은 지금처럼 정제 실패(E-2) 경로로 간다. 제한 전용 안내 문구가 필요하면 후속으로 둔다(Step 1에서 현재 동작을 확인). PostHog에서 실패 사유를 구분하는 것도 앱 수정이 필요해 그 후속에서 함께 한다(이번엔 서버 DB에만 기록 — 불변식 10).
- IP 기반 제한, CAPTCHA(후속 후보 — Step 1에서 가능 여부만 조사)

---

## 불변식 (Invariants)

1. **검사 위치**: 입력 검증을 통과한 뒤, Anthropic을 부르기 전에 센다. 검증 실패(400)는 세지 않는다. LLM 실패·타임아웃은 센다(비용이 났을 수 있다).
2. **원자성**: 동시에 요청이 와도 한도를 넘지 않게, 증가와 판정을 DB 한 문장(예: `insert ... on conflict do update ... returning`)으로 한다.
3. **앱에서 직접 부르지 못한다**: 카운터 함수는 Edge Function(`service_role`)만 부르고, 사용자 id는 Edge Function이 로그인을 확인한 값을 넘긴다. `authenticated`에 열면 앱의 공개 키로 함수를 직접 불러 남의 한도나 전체 카운터를 채울 수 있다(Step 3에서 `auth.uid()` 방식 대신 채택). 가중치는 함수 안에서 허용 범위(1~3)를 검사한다(음수 등으로 카운터를 줄이지 못하게).
4. **비노출**: 카운터 테이블은 API로 노출되지 않는 스키마(`ops` 등 — `0004` 패턴)에 둔다. 카운터 함수는 `security definer` + `search_path` 고정, `public`·`anon`·`authenticated`에서 EXECUTE를 revoke하고 `service_role`에만 grant한다(`0003` 패턴, CLAUDE.md 규칙 9).
5. **콘텐츠 미저장**: 카운터에는 `user_id`·시간 창·횟수만 둔다. 텍스트·이미지 길이 등 요청 내용은 넣지 않는다. 실패 기록(불변식 10)에도 텍스트·이미지는 넣지 않고, 예외로 입력 상한을 넘은 길이의 최대값(숫자)만 둔다 — 상한을 조정할 근거.
6. **응답 형식**: 한도를 넘으면 `429` + `{ "error": "rate_limited", "scope": "user" | "global" }` + `Retry-After` 헤더. 카운터 응답이 3초를 넘기면 `503` + `{ "error": "quota_unavailable" }`(Step 3 리뷰 반영 — 같은 계정 요청을 동시에 쏟아내 시간 초과를 일으키는 방식으로 한도를 우회하지 못하게). 다른 응답은 지금과 같다.
7. **되돌리기**: 마이그레이션마다 되돌리는 SQL을 함께 둔다(테이블·함수·권한 제거).
8. **문서 정합(규칙 8)**: `CLAUDE.md`·`README.md`에 같은 PR로 반영한다. 영역 이미지 전송 서술은 실제 동작(텍스트 부족 시 자동, 또는 '제품 영역으로 분석' 버튼으로 언제든 — 사용자가 고른 영역만)으로 맞춘다.
9. **입력 크기 상한**: OCR 텍스트가 2,000자(`length` 기준)를 넘거나, 카테고리 목록이 프롬프트에 들어가는 형태(정리 후 `JSON.stringify` — 따옴표·쉼표 포함)로 2,000자를 넘으면 LLM을 부르지 않고 `400`(`text_too_long` / `categories_too_long`)으로 거절한다. 자르지 않는다 — 상한 안의 요청은 LLM 입력이 지금과 같고, 입력 형태(필드·타입)도 그대로다. 이 거절은 불변식 1의 검증 실패라 세지 않는다. 이미지는 기존 검사(요청당 1장, base64 길이 상한)를 그대로 쓴다.
10. **실패 기록**: 함수가 실패 응답을 돌려줄 때 원인을 DB에 남긴다(함수 로그는 Free 플랜에서 1일만 보관되고, 앱·PostHog는 원인을 구분하지 못한다).
    - 남기는 것: `user_id`·날짜(한국 시간)·사유(응답의 `error` 코드, 한도 초과는 `scope`까지)·횟수. `llm_error`는 Anthropic 상태 코드, 입력 상한 초과는 넘은 길이의 최대값을 함께 둔다.
    - 성공은 세지 않는다(실패율 분모는 전체 하루 카운터로 대략 계산). 인증 전 실패(`401`·`500`)는 사용자를 알 수 없어 남기지 않는다.
    - 기록은 함수만 쓴다: 기록 함수는 `service_role` 전용(`0003` 패턴)이고 `anon`·`authenticated`에는 권한이 없다(앱에서 기록을 꾸미지 못하게).
    - 기록에 실패해도 응답은 바뀌지 않는다(오류 종류만 로그). 테이블은 카운터와 같이 `ops` 비노출.
    - `auth.users` FK는 두지 않는다(카운터는 FK cascade): 빈 익명 계정 정리(`0002`)로 계정이 지워져도 기록은 남는다. 에러를 만나고 저장 없이 떠난 사용자가 바로 그 계정이라, 함께 지우면 상한을 판단할 통계가 줄어든다(Step 3에서 결정).

---

## Step 1 — 현재 동작 확인 (에이전트, 읽기만)

1. `parse.ts`·`useAnalysis.ts`·`register.tsx`를 읽고 함수가 `429`를 돌려줄 때 앱이 어떻게 보이는지 정리한다(오류 종류, 재시도 버튼, 수동 입력 가능 여부, 계측 이벤트).
2. Supabase 공식 문서에서 Edge Function 요청 제한 권장 방식을 확인한다. Postgres 카운터로 충분한지, 클라이언트 IP를 믿을 수 있는 헤더가 있는지(후속용)를 확인한다.
3. 지금 운영 사용량을 추정할 근거를 찾는다(`analysis_logs`의 일별 건수는 사람이 SQL Editor에서 집계 — 원문은 조회하지 않는다).

**DoD**: 보고. 코드 변경 없음.

## Step 2 — 한도 값 결정 (사람 결정, 에이전트 보조)

에이전트가 Step 1 근거로 후보 표를 낸다. 사람이 값을 고른다.

| 항목 | 후보(예) | 근거 |
|---|---|---|
| 사용자 시간당 | 30회 | 한 번에 여러 장 담는 사용 |
| 사용자 하루 | 100회 | |
| 전체 하루(차단기) | 1,000회 | 최악의 하루 비용 = 이 값 × 호출당 비용(공식 가격으로 계산) |
| 이미지 요청 가중치 | 1 또는 2 | 이미지 요청은 입력 토큰이 크다 |

- 한도 값은 Edge Function 환경 변수(예: `PARSE_LIMIT_USER_HOURLY`)로 두고, 코드에 기본값을 둔다. 마이그레이션 없이 바꿀 수 있고, Step 5에서 낮은 값으로 시험하기 쉽다.
- 카운터 DB 오류 때의 동작: **fail-open**(호출 허용 + 로그) 권장. 최종 방어선은 Anthropic Console의 월 지출 상한이다(Step 6). fail-closed를 원하면 사람이 정한다.

**DoD**: 결정 값을 이 문서 결과 기록에 적는다.

## Step 3 — 구현 (에이전트)

**대상**: 새 `supabase/migrations/0005_parse_quota.sql`, 새 되돌리기 SQL(`supabase/rollback/0005_parse_quota_down.sql`), `supabase/functions/parse-screenshot-text/index.ts`, 새 `supabase/tests/quota.sql`, 새 `supabase/tests/parse_failures.sql`, `CLAUDE.md`, `README.md`.

1. 마이그레이션: 카운터 테이블(사용자별 시간 창, 전체 일 창)과 카운터 함수(불변식 2~5), 실패 기록 테이블과 기록 함수(불변식 10). 전체 하루 카운터 행은 실패율 분모로 쓰므로 지우지 않는다. 오래된 창은 같은 함수 안에서 정리하거나 기존 cron 패턴을 쓴다(선택 근거 보고). 사용자 행은 `auth.users` 삭제 시 함께 지워진다(FK cascade — 빈 익명 계정 정리 cron과 맞물림).
2. `index.ts`: 입력 검증(크기 상한 포함 — 불변식 9) 뒤 카운터 함수를 `service_role`로 호출(사용자 id는 로그인 확인 값) → 넘으면 `429`(불변식 6). 인증 뒤의 실패 응답마다 기록 함수를 부른다(불변식 10). 카운터 오류는 Step 2 결정대로 처리하고 `console.log`에는 사용자 콘텐츠 없이 오류 종류만 남긴다. 맨 위 계약 주석의 영역 이미지 서술을 실제 동작으로 고친다.
3. `quota.sql`: SQL Editor에서 한 트랜잭션 안에 가짜 사용자를 만들고 `set local role service_role`로 카운터를 한도+1번 호출해 마지막만 거부되는지 확인한 뒤 `rollback`으로 흔적을 남기지 않는 시험(`rls.sql` 패턴). 전체 한도도 같은 방식으로 시험한다. `anon`·`authenticated`가 카운터·기록 함수를 못 부르는지도 확인한다.
4. `parse_failures.sql`: SQL Editor용 조회(읽기만). 날짜·사유별 횟수와 사용자 수(개발자 `ops.internal_users` 제외), 상한 초과 길이 최대값, 전체 하루 카운터 대비 실패율.
5. `CLAUDE.md`: 데이터 레이어·Edge Function 설명에 요청 제한·실패 기록, 명령어·환경 변수에 한도 변수, 디렉터리에 `rollback/`.

**DoD**
- `deno check supabase/functions/parse-screenshot-text/index.ts` 통과
- `prompt.ts`·`src/**`·`samples/**` diff 없음
- 상한 안의 요청은 이미지 유무와 관계없이 Anthropic 요청 바디가 이전과 같음(코드 리뷰로 확인)
- 보고 → 승인 → 커밋

## Step 4 — 적용 (사람)

1. SQL Editor에서 `0005` 적용 → `quota.sql` 실행(전부 통과, 흔적 없음).
2. 한도 환경 변수 등록(`npx supabase secrets set ...`) → `npx supabase functions deploy parse-screenshot-text`.

**DoD**: `quota.sql` 결과와 배포 완료를 에이전트에 전달.

## Step 5 — 실제 동작 시험 (사람, 에이전트가 스크립트 준비)

1. 에이전트가 시험 스크립트(Deno, 공개 anon 키만 사용)를 준비한다: 새 익명 세션을 만들고 짧은 가짜 텍스트로 함수를 한도+1번 부른 뒤 응답 코드를 표로 출력한다. 실제 사진·OCR 원문은 쓰지 않는다.
2. 사람이 사용자 시간당 한도를 잠시 **2**로 낮춰 배포 → 스크립트 실행(3번째가 `429`인지) → 원래 값으로 되돌려 재배포. LLM 호출은 2번만 나간다. `parse_failures.sql`로 시험 계정에 사용자 한도 초과 1건이 기록됐는지 확인한다.
3. 전체 한도는 운영 사용자에게 영향을 주므로 실제 시험하지 않고 `quota.sql`로만 확인한다.
4. 시험으로 생긴 익명 계정은 빈 계정이라 주간 정리 잡이 지운다(또는 대시보드에서 삭제).

**DoD**: "한도 2 → 3번째 요청 429(scope=user), Retry-After 값" 같은 시험 결과를 결과 기록에 적는다.

## Step 6 — 바깥 방어선 확인 (사람)

- Anthropic Console: 월 지출 상한·알림 설정 값
- Supabase Auth: 익명 로그인 IP당 한도 값(대시보드 Rate Limits)

**DoD**: 값만 결과 기록에 적는다(키·토큰은 적지 않는다).

## Step 7 — 마무리 (에이전트)

결과 기록을 채우고 PR을 템플릿 구조로 올린다(승인 후). PR 직전에 `dev`로 rebase해 `CLAUDE.md` 충돌을 정리한다.

---

## 미결 사항 (사람 결정)

1. 한도 값(Step 2 표) — 결정(결과 기록 Step 2)
2. 카운터 DB 오류 때 fail-open / fail-closed(권장 fail-open) — fail-open으로 결정. 단 3초 시간 초과는 거절(Step 3 리뷰 반영)
3. 제한 전용 앱 안내 문구가 필요한지(Step 1 결과를 보고 — 필요하면 후속 Phase) — 후속으로 결정(이번엔 앱 변경 없음)

## 결과 기록 (구현 세션이 채움)

- **완료일**:
- **Step 1**: 429 때 앱 동작 — 다른 정제 실패와 같은 E-2 경로(실패 안내·재시도·직접 입력 가능, 저장은 막히지 않음). 앱·PostHog·`analysis_logs`에서는 429를 다른 실패와 구분할 수 없고 함수 로그에만 남는다(Free 플랜 보관 1일) → 제한 전용 안내·계측은 후속 / IP 헤더 조사 — 공식 문서에서 신뢰할 수 있는 클라이언트 IP 헤더를 찾지 못함(`x-forwarded-for` 첫 값은 위조 가능), Edge Function 기본 요청 제한 없음. Postgres 카운터로 충분하다고 판단(공식 문서 예시도 Redis·Postgres 카운터) → IP 제한 보류. CAPTCHA는 `signInAnonymously`가 토큰을 받지만 앱에 위젯(네이티브 작업)이 필요해 후속 /
- **Step 2**: 한도 값 — 사용자 시간당 30, 사용자 하루 100, 전체 하루 300, 이미지 가중치 1. Edge Function 환경 변수 `PARSE_LIMIT_USER_HOURLY`·`PARSE_LIMIT_USER_DAILY`·`PARSE_LIMIT_GLOBAL_DAILY`·`PARSE_IMAGE_WEIGHT`(코드 기본값 같음). 하루 경계는 한국 시간 0시. 전체 한도는 홍보 전 트래픽에 맞춰 낮게 시작하고 홍보 시작 때 올린다. 이미지 요청 비중이 커지면 가중치를 올린다. 입력 크기 상한(불변식 9) — OCR 텍스트 2,000자, 카테고리 2,000자 / 실패 시 동작 — fail-open(호출 허용 + 오류 종류만 로그), 단 카운터 응답 3초 초과는 `503 quota_unavailable`로 거절(Step 3 리뷰 반영) / 실패 기록 — 서버 DB에 실패만 기록(불변식 10), 계정이 정리돼도 유지, PostHog 사유 구분은 429 안내 후속과 함께 / 받아들인 한계 — 익명 계정을 여러 개 만들면 전체 하루 한도를 채워 그날 모든 사용자의 AI 정제를 멈출 수 있다(비용은 늘지 않음, `parse_failures.sql` §3의 `rate_limited_global`로 감시) /
- **Step 5**: 시험 결과 /
- **Step 6**: 지출 상한·익명 로그인 한도 값 /
- **사람이 정한 것**: 한도 값·하루 경계·fail-open·입력 상한 값·실패 기록 범위(실패만)(Step 2), 카운터 함수 service_role 전용·카운터 시간 초과 거절·실패 기록 계정 정리 뒤 유지(Step 3)
- **에이전트가 제안해 채택한 것**: 입력 크기 상한(횟수 한도만으로는 요청 하나의 크기가 묶이지 않음), 이미지 가중치 환경 변수화와 범위 검사, 실패 원인 서버 DB 기록(앱 버전·계측 설정과 무관하게 전부 잡힘), 카운터 함수 service_role 전용(앱 공개 키로 직접 불러 전체 차단기를 채우는 것 방지), 한도 환경 변수를 요청마다 읽기(시크릿 변경이 재배포 없이 반영), 리뷰 반영(하루 창을 먼저 확인해 Retry-After가 0시를 가리키게, LLM 응답 본문 읽기 실패도 `llm_read_error`로 기록, `quota.sql`을 명시적 트랜잭션 없이 블록 안에서 되돌려 실패해도 잠금이 남지 않게), 429 앱 안내·계측은 후속
- **에이전트가 구현한 것**:
