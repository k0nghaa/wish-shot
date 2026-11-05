# Phase 13 — 가격 자동채움 정확도 측정: 정답셋 만들기와 첫 측정

> **최소판으로 진행 (2026-10-27 결정 — 아래 본문보다 이 상자가 우선한다)**
> - **왜 지금**: 이후 Phase에서 프롬프트나 LLM에 보내는 OCR 텍스트를 바꾼다(가격 정확도 개선, OCR 텍스트 개인정보 가리기 등). 바꾸고 나면 지금 버전을 같은 조건으로 잴 수 없다. 그래서 **프롬프트·입력을 바꾸기 전에 기준선 측정(Step 2~5)을 끝낸다**. 개선은 같은 정답셋(홀드아웃 포함)으로 다음 Phase에서 다시 잰다.
> - **표본**: 30~40장, 실제 쓰임대로 품목을 섞는다(생활용품·가구/인테리어·패션·뷰티·기타).
>   - A 정가·할인가, B 할인가만, C 릴스·피드, D 추천 섞임 — 각 7~10장
>   - E 외화 — 3~5장
>   - F 텍스트 적음 — 생략
>   - 2026-11-04 변경(사람 결정): 실제 사용자는 생활용품·가구를 많이 담는다. 그래서 '패션·뷰티 위주'를 '실제 쓰임대로 품목 섞기'로 바꿨다. 화면 유형 A~E와 장수는 그대로이고, 이미 캡처한 패션·뷰티 화면도 그대로 쓴다. 품목은 라벨 `item_category` 열에 적고, 결과를 품목별로도 나눠 본다. 품목별 장수 할당은 없다.
> - **변형**: `v0`(10/04)·`v1`(현재)·`v2`(현재 프롬프트 + 당시 온도)·`v1h`(최신 Haiku, thinking 끔)·`v1h-think`(최신 Haiku, thinking 기본), 각 3회.
>   - 2026-11-03 변경(Step 1): 최신 Haiku는 temperature 0을 받지 않는다(공식 문서: 생략해야 함 → 기본 1.0). 그래서 v1→v1h 비교에 온도 효과가 섞인다. 이를 나누려고 `v2`를 다시 넣었다(v0→v2 = 규칙 효과, v2→v1 = 온도 효과, v2→v1h = 모델 효과).
>   - thinking은 최신 Haiku에서 기본으로 켜져 있다. 끈 경우와 켠 경우를 둘 다 잰다.
> - **3일 일정**
>   - 1일차: Step 0~1(에이전트), Step 2(캡처·담기)
>   - 2일차: Step 3~5(내보내기·라벨링·실행)
>   - 3일차: Step 6(리포트)

> **이 문서 사용법**: Claude Code에 이 파일 전체를 컨텍스트로 넘기고 "**Step N을 진행해달라**"고 한 Step씩 요청한다.
> - Step마다 담당이 정해져 있다. **사람** Step(캡처·앱으로 담기·SQL 실행·라벨링·API 실행)은 에이전트가 대신하지 않는다.
> - 에이전트는 각 Step이 끝나면 무엇을 했는지 보고하고, **사람의 확인을 받은 다음 커밋**한다. PR도 사람의 확인을 받고 올린다. 커밋 메시지에 Phase·Step 번호를 넣지 않는다.
>
> **브랜치**: 최신 `dev` 기준 `feat/phase-13-goldset-eval`에서 작업한다. 이 브랜치는 별도 worktree(`../wish-shot-eval`)에 둔다. 원문 데이터 파일(git 제외)이 측정 내내 이 폴더에 머물고, 이후 정확도 Phase도 같은 데이터로 다시 재기 때문이다. 세션 시작 시 `git status --short --branch`로 확인한다.
>
> **재빌드·배포·앱 변경 없음(중요)**:
> - 이 Phase는 **측정만** 한다. 프롬프트(`prompt.ts`), Edge Function, 앱 코드(`src/**`), 마이그레이션은 바꾸지 않는다. 운영 모델(`MODEL`)도 바꾸지 않는다 — 최신 Haiku는 실행기 안에서만 비교한다.
> - 개선은 측정 결과를 본 뒤 **다음 Phase에서 한 번에 하나씩** 한다.
> - 바꿔야 할 것 같으면 멈추고 사람에게 보고한다.
>
> **근거 원칙**: API 동작(기본 temperature, usage 필드, 모델 ID, 구조화 출력 지원, 가격 등)은 추측하지 말고 Anthropic 공식 문서로 확인한다(CLAUDE.md 규칙 6). 숫자는 **"N장 중 M장"** 으로만 보고한다. 소표본이므로 통계적 유의성은 주장하지 않는다.
>
> **개인정보 원칙**:
> - 정답셋은 **개발자 본인 계정(`ops.internal_users`)의 기록만** 쓴다. 다른 사용자의 `analysis_logs.raw_text`는 조회하지 않는다.
> - OCR 원문에는 타인의 계정명·댓글이 섞일 수 있다. 그래서 원문 데이터 파일은 **git에 올리지 않는다**(레포가 공개돼 있다).
> - 커밋하는 것은 코드·라벨 규칙·숫자 리포트뿐이다.
>
> **다른 Phase와의 순서**: OCR 텍스트 개인정보 가리기(기기에서 가림)가 배포되면 이후 `analysis_logs.raw_text`는 가린 글이 된다. **Step 2~3(캡처를 담고 원문을 내보내기)은 그 배포 전에 끝낸다.**
>
> 관련 문서:
> - `supabase/functions/parse-screenshot-text/prompt.ts`(현재 프롬프트·temperature 0)
> - `samples/eval.ts`(회귀 검증 실행기 — 이번 실행기의 바탕)
> - `samples/samples.md`(회귀 케이스 1~7)
> - `supabase/tests/metrics.sql` §3(필드 수정률)
> - `docs/testing/tracking-plan.md`

---

## 목표 (Goal)

지금 정확도 근거는 두 가지뿐이다. 둘 다 정확도가 아니다.
- 회귀 eval 21/21: 실패를 본 뒤 만든 7케이스이므로 회귀 테스트다.
- 수정률 3/16: 사용자가 고쳤는지를 보는 값이라, 틀렸는데 그냥 둔 값은 정답으로 잡힌다.

이 Phase는 **사람이 정답을 붙인 정답셋**으로 가격 자동채움을 처음 잰다.

1. **베이스라인**: 현재 프롬프트(10/20, temperature 0)의 가격 정답률·오추출률·누락률을 'N장 중 M장'으로 잰다.
2. **전후 비교**: 같은 정답셋으로 10/04 프롬프트(오추출 방지 규칙 전, 당시 temperature 기본값)를 돌린다. 10/20 규칙이 실제로 무엇을 바꿨는지 숫자로 확인한다.
3. **모델 비교**: 현재 프롬프트를 최신 Haiku로 돌려 정확도와 토큰을 현재 모델(`claude-haiku-4-5`)과 비교한다. 운영 모델은 바꾸지 않는다.
4. **오류 분해**: 틀린 것이 OCR 단계 문제(원문에 정답 숫자가 없음)인지, LLM 단계 문제인지 나눈다.
5. **리포트 1장**: 숫자와 실패 패턴만 담은 결과 문서를 남긴다.

## 하지 않는 것

- 프롬프트·스키마·Edge Function·앱 수정, 함수 배포, 운영 모델 변경(측정이 끝난 뒤 다음 Phase에서)
- 서버 측 가격 검증 구현(10/20 보류 결정 유지)
- 다른 사용자의 OCR 원문·아이템 열람
- 이미지(크롭) 분기 측정. 이번에는 텍스트 분기만 잰다. 텍스트가 부족한 화면은 'OCR 부족 판정' 건수만 센다.
- 홀드아웃(4절)을 보면서 프롬프트를 고치는 것

---

## 1. 정답 정의 (라벨 규칙) — `goldset/LABELING.md`로 고정

**가격(`price_gold`)**: 현재 제품 정책을 따른다.
- 화면의 **주 상품** 가격만 본다. 추천·목록·다른 상품 가격은 제외한다.
- 정가와 할인가가 같이 있으면 **정가**(할인 전, 보통 더 높거나 취소선이 있는 값)를 고른다.
- 가격이 하나만 있으면 그 값을 쓴다.
- **원화 금액만** 인정한다. 외화만 있으면, 원화 가격이 없으면, 주 상품을 판별할 수 없으면 **null**이다.
- 쿠폰 금액, 배송비, 적립금, 좋아요·리뷰·조회·구매 수, 사이즈, 날짜는 가격이 아니다.

**정책 대비용 보조 칸**: 정가 우선 정책 자체를 나중에 다시 판단할 수 있게 둔다.
- `price_list`: 정가(있으면)
- `price_sale`: 할인가(있으면)

**제품명(`name_keywords`)**: 핵심어 1~2개. `|`로 구분하고 부분 일치로 판정한다.

**브랜드(`brand_aliases`)**: 한·영 별칭을 `|`로 구분한다(예: `이솝|Aesop`). 하나라도 일치하면 정답이다.

**품목(`item_category`)**: 주 상품의 품목 하나. `생활용품` / `가구·인테리어` / `패션` / `뷰티` / `전자` / `기타` 중에서 고른다(2026-11-04 추가). 정답 판정에는 쓰지 않고, 결과를 품목별로 나눠 보는 데만 쓴다.

**라벨은 모델 출력을 보지 않고 붙인다.** 운영 함수의 출력(`parsed`)은 라벨링 시트에서 빼 둔다(Step 3).

## 2. 표본 설계

40~60장(최소판은 30~40장 — 맨 위 상자). 아래 유형별로 7~10장씩 모은다. 실제 쓰임과 같은 맥락에서 **본인이 직접 캡처**한다. 대상은 패션·뷰티·라이프스타일 커머스 상세 화면과 릴스·피드다. 같은 상품을 두 번 넣지 않는다.

| 유형 | 내용 | 정답 예 |
|---|---|---|
| A | 정가·할인가 병기(커머스 상세) | 정가 |
| B | 할인가만 + 쿠폰·적립·배송비 노이즈 | 그 가격 |
| C | SNS 게시물 — 좋아요·조회·댓글 수만, 가격 없음 | null |
| D | 상세 + 추천·목록 상품 가격이 섞임 | 주 상품 가격 또는 null |
| E | 외화 가격만(해외 몰) | null |
| F | 텍스트가 거의 없는 이미지 중심 화면 | 'OCR 부족' 판정만 기록 |

수집이 끝나면 목록을 **고정**한다(파일 목록 + 행 수). 측정을 시작한 뒤에는 정답셋을 고치거나 추가하지 않는다. 고칠 일이 생기면 다음 버전 세트로 따로 만든다.

## 3. 지표

대표 출력은 3회 실행 중 **다수결 값**(2회 이상 같은 값)으로 정한다. 다수결이 없으면 '불안정'으로 따로 센다.

| 지표 | 정의(분모) |
|---|---|
| 가격 정답 | 대표 출력 = `price_gold` (N) |
| 오추출 | 정답이 null인데 숫자를 냄 (정답 null인 장) |
| 오값 | 정답이 숫자인데 다른 숫자를 냄 (정답 숫자인 장) |
| 누락 | 정답이 숫자인데 null을 냄 (정답 숫자인 장) |
| 3회 일치 | 세 번 모두 같은 가격 (N) |
| 오답 중 저신뢰 안내 | 오답 가운데 confidence < 0.5라서 앱이 "확인 필요"를 띄운 장 (오답 수) |
| 정답 중 괜한 안내 | 정답 가운데 confidence < 0.5라서 "확인 필요"가 괜히 뜬 장 (정답 수). confidence 기준값을 조정하려면 위 지표와 이 지표를 함께 봐야 한다 |
| 기준값별 표 | 기준값 0.3·0.4·0.5·0.6·0.7마다 위 두 지표를 다시 센다. `results.csv`의 confidence로 계산하므로 API를 다시 부르지 않는다. 기준값은 바꾸지 않고 재기만 한다(바꾸는 것은 다음 Phase) |
| OCR 포함 | 정답 숫자(콤마 제거)가 `raw_text`에 들어 있음 (정답 숫자인 장) — OCR 단계 한계 분리 |
| 보조 | 제품명 핵심어 포함, 브랜드 별칭 일치 |
| 비용 | 응답 `usage`의 input/output 토큰 합계(변형별) |

모든 지표는 **유형별(A~F)** 과 **품목별(`item_category`)** 로도 나눠 보고한다.

---

## Step 0 — 준비 (사람)

- worktree `../wish-shot-eval`의 `feat/phase-13-goldset-eval` 브랜치를 확인한다.
- `ANTHROPIC_API_KEY`는 **이 셸 세션에만** 설정한다(`samples/samples.md` "자동 검증" 절의 PowerShell 방식). 에이전트는 키를 다루지 않는다.
- 대시보드 SQL Editor에서 `ops.internal_users`에 지금 쓰는 기기의 uid가 있는지 확인한다.

**DoD**: 브랜치 확인. 키는 값을 노출하지 않고 설정 여부만 확인. 내부 uid 확인.

## Step 1 — 실행기 골격 (에이전트)

1. **사실 확인 먼저**: `src/hooks/useAnalysis.ts`, `src/lib/queries/analysisLogs.ts`, `supabase/functions/parse-screenshot-text/index.ts`를 읽는다. `analysis_logs.raw_text`가 Edge Function에 보내는 텍스트와 **같은지** 확인한다(자르기·정규화가 있으면 실행기에서 똑같이 재현). 결과를 보고한다.
2. `.gitignore`에 아래 두 줄을 추가한다. `goldset/LABELING.md`, `goldset/REPORT.md`, 코드는 커밋 대상이다.
   ```
   supabase/functions/parse-screenshot-text/samples/goldset/data/
   supabase/functions/parse-screenshot-text/samples/goldset/out/
   ```
3. `samples/goldset/LABELING.md`: 이 문서 1·2절을 라벨러용으로 정리한다. 열 정의와 애매한 경우의 처리 예를 넣는다.
4. `samples/prompt-2026-10-04.ts`: `git show 2a484b6:supabase/functions/parse-screenshot-text/index.ts`에서 당시 시스템 프롬프트와 출력 스키마를 **그대로** 옮긴 고정 사본이다.
   - 맨 위에 출처 커밋과 "측정용 고정 사본 — 수정 금지" 주석을 단다.
   - 당시에는 temperature를 지정하지 않았다. API 기본값을 공식 문서로 확인해 주석에 적는다.
5. **최신 Haiku 확인**: Anthropic 공식 문서(모델 개요·구조화 출력·가격)로 비교 대상 모델 ID(후보 `claude-haiku-5-5`)가 현재 쓰는 `output_config`(json_schema)와 `temperature`를 그대로 지원하는지, 입출력 단가가 얼마인지 확인해 보고한다. 지원하지 않는 옵션이 있으면 멈추고 보고한다.
6. `samples/goldset-eval.ts`: `eval.ts`의 호출·판정 구조를 재사용한다. 입력·출력·옵션은 아래와 같다.
   - **입력**: `goldset/data/raw.csv`(id, raw_text), `goldset/data/labels.csv`(1절 열)
   - **변형**
     - `v0` = 10/04 프롬프트 + 당시 temperature + 현재 모델
     - `v1` = 현재 `prompt.ts` + `TEMPERATURE`(0) + `MODEL`(현재 운영 모델)
     - `v1h` = 현재 `prompt.ts` + `TEMPERATURE`(0) + 최신 Haiku(5번에서 확인한 ID). 모델 ID는 실행기 안의 상수로만 둔다(`prompt.ts`의 `MODEL`은 바꾸지 않는다)
     - 선택 `v2` = 현재 프롬프트 + 당시 temperature. 규칙 효과와 온도 효과를 나눠 보려면 쓴다.
     - **2026-11-03 확정(5번 확인 결과 반영)**: 최신 Haiku는 temperature 0을 거부하므로 `v1h`는 temperature를 **생략**(기본 1.0)한다. 변형은 다섯 개다.
       - `v0`: 10/04 프롬프트 + temperature 생략 + `claude-haiku-4-5`
       - `v1`: 현재 프롬프트 + temperature 0 + `claude-haiku-4-5`(운영과 같은 바디)
       - `v2`: 현재 프롬프트 + temperature 생략 + `claude-haiku-4-5`
       - `v1h`: 현재 프롬프트 + temperature 생략 + `claude-haiku-5-5`, `thinking: disabled`, effort `medium`, max_tokens 400
       - `v1h-think`: 현재 프롬프트 + temperature 생략 + `claude-haiku-5-5`, `thinking: adaptive`(기본), effort `medium`, max_tokens 4000(생각 토큰 몫. 잘리면 `TRUNCATED`로 따로 셈)
   - **옵션**: `--runs 3`, `--variants v0,v1,v1h`, `--dry-run`(API를 부르지 않고 입력 검증과 호출 수만 출력), `--only-holdout` / `--exclude-holdout`
   - **출력**
     - `goldset/out/results.csv`: 행 = 장 × 변형 × 회차. 변형·모델 ID, price, productName, brand, confidence, usage 토큰을 담는다.
     - `goldset/out/summary.md`: 3절 지표를 'N장 중 M장'으로 정리한다(변형별).
   - **권한**: `--allow-net=api.anthropic.com --allow-env=ANTHROPIC_API_KEY --allow-read=<goldset 폴더> --allow-write=<goldset/out>`
   - 카테고리는 보내지 않는다(`buildSystemPrompt([], false)`). 가격 측정에는 영향이 없고, 변형 사이 조건을 같게 둔다.
   - API 오류는 회차별로 1회 재시도하고, 그래도 실패하면 결과에 `ERROR`로 남긴다(조용히 빼지 않는다).
7. `samples/goldset/fixture/`에 **가상 원문 3행**과 라벨을 두고 `--dry-run`으로 검증한다. 실제 OCR 원문은 쓰지 않는다.

**DoD**
- `deno check` 통과
- dry-run 출력 확인: 변형·N·총 호출 수
- `git status`에 데이터 파일이 잡히지 않음
- 보고 → 사람 확인 → 커밋

## Step 2 — 캡처 수집과 앱으로 담기 (사람)

- 2절 할당표대로 캡처한다. 유형별 개수표를 채운다.
- 운영 앱(내부 계정)에서 임시 폴더 `goldset`을 만들고, **AI가 채운 값을 고치지 않고** 그대로 저장한다.
  - 저장해야 `analysis_logs`에 `raw_text`가 남는다.
  - F 유형에서 크롭 시트가 뜨면 진행하지 말고 '부족 판정'으로만 기록한다.
- 수집 시작·끝 시각을 적어 둔다.

**DoD**: 유형별 개수표. 담은 개수가 캡처 수와 같다(F 제외).

## Step 3 — 원문 내보내기 (사람 → 에이전트)

사람이 SQL Editor에서 본인 기록만 조회한다.
```sql
select l.id, l.created_at, l.status, l.raw_text, l.parsed
from public.analysis_logs l
where l.user_id in (select user_id from ops.internal_users)
  and l.created_at >= '<수집 시작 시각>' and l.created_at <= '<수집 끝 시각>'
order by l.created_at;
```
결과를 CSV로 받아 `goldset/data/export.csv`에 둔다(git 제외 폴더).

에이전트가 할 일:
- `export.csv`를 둘로 나눈다.
  - `raw.csv`: id, raw_text — 라벨링용
  - `prod_parsed.csv`: id, status, parsed — 운영 출력 참고용, 라벨이 끝날 때까지 열지 않는다
- 행 수와 status 분포만 보고한다. **원문 내용은 채팅에 출력하지 않는다.**

**DoD**: 행 수 일치. 조회 조건에 내부 uid가 들어갔는지 확인. 파일 분리 확인.

## Step 4 — 라벨링 (사람)

- `raw.csv`를 보고 `labels.csv`를 채운다(반나절 예상). 열은 다음과 같다.
  - id, type(A~F), item_category(생활용품 / 가구·인테리어 / 패션 / 뷰티 / 전자 / 기타), price_gold, price_list, price_sale, name_keywords, brand_aliases, holdout, note
- 애매한 행은 `note`에 사유를 적는다. 규칙에 없는 사례가 나오면 `LABELING.md`에 예를 추가한다(라벨 전부를 고친 뒤 측정 시작).
- **홀드아웃**: 에이전트가 시드를 고정한 스크립트로 25%를 무작위 지정해 준다. 이후 프롬프트를 개선할 때는 홀드아웃을 보지 않고, 마지막 확인에만 쓴다.

**DoD**: 모든 행에 라벨. 라벨 규칙과 맞지 않는 행 0. 홀드아웃 지정 완료.

## Step 5 — 측정 실행 (사람)

```
deno run --allow-net=api.anthropic.com --allow-env=ANTHROPIC_API_KEY \
  --allow-read=supabase/functions/parse-screenshot-text/samples \
  --allow-write=supabase/functions/parse-screenshot-text/samples/goldset/out \
  supabase/functions/parse-screenshot-text/samples/goldset-eval.ts --runs 3 --variants v0,v1,v2,v1h,v1h-think --dry-run
```
- dry-run으로 호출 수를 확인한 뒤 `--dry-run`을 빼고 실행한다.
- 비용은 실행기가 보고한 토큰 합계에 **공식 가격 페이지의 단가**(모델별)를 곱해 사람이 계산한다.

**DoD**
- `results.csv` 행 수 = 장 × 변형 × 3
- `ERROR` 행은 재실행했거나 사유가 기록돼 있다(같은 옵션에 `--retry-errors`를 붙이면 ERROR 행만 다시 부르고 summary를 다시 만든다)
- 토큰 합계 기록(변형별)

## Step 6 — 집계와 리포트 (에이전트)

`samples/goldset/REPORT.md` 1장을 쓴다. **원문·계정명·상품명 인용 없이** 숫자와 실패 패턴만 담는다(예: "SNS 좋아요 수(네 자리 숫자)", "외화 소수점 누락").

```
## 정답셋 v1 — N장 (A a장 · B b장 · C c장 · D d장 · E e장 · F f장), 2026-MM-DD, 본인 캡처
품목: 생활용품 ?장 · 가구·인테리어 ?장 · 패션 ?장 · 뷰티 ?장 · 전자 ?장 · 기타 ?장

| 지표 | v0 10/04 프롬프트 | v1 현재(운영) | v2 현재 프롬프트 + 온도 1.0 | v1h 최신 Haiku(thinking 끔) | v1h-think 최신 Haiku(thinking 켬) |
|---|---|---|---|---|---|
| 가격 정답 | ?/N | ?/N | ?/N | ?/N | ?/N |
| 오추출(정답 없음인데 숫자) | ?/N_null | ?/N_null | ?/N_null | ?/N_null | ?/N_null |
| 오값 | ?/N_num | ?/N_num | ?/N_num | ?/N_num | ?/N_num |
| 누락 | ?/N_num | ?/N_num | ?/N_num | ?/N_num | ?/N_num |
| 3회 일치 | ?/N | ?/N | ?/N | ?/N | ?/N |
| 오답 중 저신뢰 안내 | ?/오답 | ?/오답 | ?/오답 | ?/오답 | ?/오답 |
| 입력·출력 토큰 합계 | ? | ? | ? | ? | ? |
| OCR에 정답 숫자 포함(공통) | ?/N_num | | | | |

- 효과 분리: v0→v2 = 10/20 규칙 효과, v2→v1 = 온도(1.0→0) 효과, v2→v1h = 모델 효과, v1h→v1h-think = thinking 효과

- 기준값별 표(0.3~0.7, 현재 프롬프트 기준)
- 유형별 정답표
- 품목별 정답표(생활용품 / 가구·인테리어 / 패션 / 뷰티 / 전자 / 기타)
- 실패 유형 Top 3
- 다음 개선 후보 1개(한 번에 하나)
- 한계: 본인 캡처 편향, 소표본, 텍스트 분기만
```

**DoD**: 사람 검토 → 커밋. 커밋 대상은 REPORT·LABELING·코드뿐이다. 데이터 폴더가 git에 잡히지 않는지 다시 확인한다.

---

## 근거·출처
- 현재 프롬프트·온도: `supabase/functions/parse-screenshot-text/prompt.ts`(커밋 `6046a2a`, `79b816a`, `ee24cf7`, 2026-10-20)
- 10/04 프롬프트: 커밋 `2a484b6`("AI 정제 규칙 개정 — 정가 우선·브랜드 한국어 표기·제품명 브랜드 중복 제거")
- 실행기 바탕: `samples/eval.ts`
- 수정률 쿼리: `supabase/tests/metrics.sql` §3
- 내부 사용자 테이블: `supabase/migrations/0004_internal_users.sql`

---

## 결과 기록 (구현 세션이 채움)

- **완료일**:
- **Step 1** (2026-11-03)
  - **raw_text = 전송 텍스트(텍스트 분기)**: 일치한다. 실행기는 자르기·정규화를 재현할 필요가 없다.
    - 흐름: `VisionOcrEngine`이 줄을 `\n`으로 잇는다 → `useAnalysis.analyze`가 `ocr.text.trim()`한 **같은 문자열**을 상태 `rawText`에 넣고 `parseScreenshotText(rawText)`로 보낸다.
    - Edge Function은 `body.text`를 그대로 user content로 쓴다(trim은 빈 값 검사에만 씀).
    - 저장 시 `register.tsx`가 같은 `analysisState.rawText`를 `analysis_logs.raw_text`로 기록한다. 재시도(`reparse`)도 같은 문자열이다.
  - **운영과 다른 점(의도)**
    - 카테고리를 보내지 않는다(운영은 사용자 카테고리 목록을 함께 보냄 → 시스템 프롬프트 끝 한 줄이 다름).
    - 원문이 20자 미만이면 앱은 텍스트 정제를 부르지 않고 영역 지정 시트로 간다. 실행기도 같은 기준으로 건너뛰고 'OCR 부족'으로 센다.
    - 이미지 분기 행(`parsed.source = 'image_region'`)은 운영 출력이 이미지 기반이다. 측정은 텍스트 분기로 다시 돌린다.
    - 로그는 저장했을 때만 남는다.
  - **10/04 당시 temperature**: 요청에 필드가 없었다 → API 기본값 **1.0**. 공식 문서 「Migrating to API version 2026-10-21」: "Without these parameters, a request samples with their defaults, including a `temperature` of 1.0, the same as a `2023-06-01` request that leaves them out."
  - **최신 Haiku**: `claude-haiku-5-5`(2026-10-07 출시, 날짜 접미사·별칭 없음).
    - 구조화 출력(`output_config` json_schema): 지원(구조화 출력 문서 지원 모델 목록).
    - **temperature**: 생략해야 한다("Omit `temperature`, `top_p`, and `top_k`") → **0 불가 → 멈추고 보고 → 사람 결정**.
    - thinking: adaptive가 기본으로 켜져 있고 effort 기본 `medium`. 생각 토큰도 `max_tokens`에 포함된다.
    - 단가: 입력 $0.10, 출력 $0.50 /MTok(프롬프트 10만 토큰 이하. 초과 시 $0.50 / $2.50). Haiku 4.5는 $1 / $5. 같은 글이 약 30% 더 많은 토큰이 된다(토크나이저 변경).
  - **검증**
    - `deno check` 통과.
    - fixture dry-run: 변형 5 · 측정 3장 · 총 호출 45회.
    - API 없이 돌린 검증 59건 통과: v1 바디 = 운영 index.ts 바디 바이트 동일, v0 바디 = 10/04 바디, 응답 처리(thinking 블록·잘림·거부·깨진 출력·재시도·ERROR), 판정(다수결·불안정·응답 부족·오추출/오값/누락), 라벨 검증(품목 포함), 인코딩·CR 검사, 품목별 집계.
    - `--retry-errors`: 키 없이 summary 재생성, 키가 없으면 중단, 옵션 불일치 시 중단을 확인했다.
    - 데이터·결과 폴더가 git에 잡히지 않음.
    - 별도 리뷰어 검토 후 반영:
      - ERROR가 섞인 장을 '불안정'이 아니라 '응답 부족'으로 분리하고 저신뢰 지표에서 제외.
      - 유형별로 전체 지표 표를 출력.
      - UTF-8이 아닌 CSV(엑셀 CP949)와 원문 CR을 감지해 중단.
      - 빈 출력·깨진 JSON은 재시도하지 않고 `BAD_OUTPUT`으로 기록. 재시도로 성공한 경우 첫 오류 코드를 보존.
      - 저신뢰 판정을 '안내가 뜬 회차가 과반'으로 정의.
- **Step 2**: 유형별 개수 / 수집 시각 /
- **Step 3**: 행 수·status 분포 /
- **Step 5**: 총 호출 수·ERROR 처리·변형별 토큰 /
- **Step 6**: 리포트 요약(변형별 가격 정답) /
- **사람이 정한 것**
  - (2026-11-03) 최신 Haiku는 thinking 끔(`v1h`)·켬(`v1h-think`) 둘 다 측정한다.
  - (2026-11-03) 생략했던 `v2`를 다시 넣는다. 규칙·온도·모델 효과를 나누기 위해서다.
  - (2026-11-04) 표본을 '패션·뷰티 위주'에서 '실제 쓰임대로 품목 섞기(생활용품·가구/인테리어·패션·뷰티·기타)'로 바꾼다. 실제 사용자는 생활용품·가구를 많이 담기 때문이다. 화면 유형 A~E와 장수는 그대로이고, 이미 캡처한 패션·뷰티 화면은 유지한다. 라벨에 `item_category` 열을 더하고 summary에 품목별 표를 넣는다.
- **에이전트가 제안해 채택한 것**
  - `v2` 재도입(온도 효과 분리).
  - `v1h-think`의 max_tokens 4000.
  - 라벨 잠정 처리안(가격 범위·묶음가·외화+원화 환산·회원가 — LABELING.md 3절, 라벨링 시작 전 확인).
- **에이전트가 구현한 것**
  - `.gitignore`(data·out).
  - `.gitattributes`(fixture CSV를 LF로 고정. 이 저장소는 autocrlf라 체크아웃 때 CR이 섞이면 CR 검사에 걸린다).
  - `samples/goldset/LABELING.md`.
  - `samples/prompt-2026-10-04.ts`(2a484b6 고정 사본 — 원본 블록과 글자 단위 대조).
  - `samples/goldset-eval.ts`(5변형·다수결·지표·유형별·품목별 표·`--dry-run`·홀드아웃 옵션·`--force` 덮어쓰기 보호·`--retry-errors`·`--crlf-to-lf`).
  - `samples/goldset/fixture/`(가상 3행).
