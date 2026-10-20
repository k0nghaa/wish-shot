# parse-screenshot-text — 회귀 검증 샘플

배포 후, 아래 OCR 원문(입력)으로 함수를 호출해 기대 형태의 JSON이 나오는지 확인한다.
값은 모델 판단이라 정확히 일치하지 않을 수 있으나, **필드 형태와 핵심 값(제품명·가격)**이
맞으면 통과로 본다. 실기기 OCR로 실제 뽑힌 텍스트들이다.

호출 예 (로그인 사용자 토큰 필요):

```bash
# 기본(카테고리 추천 없이) — 출력에 suggestedCategory: null 이 붙는다(하위호환)
curl -s -X POST "$SUPABASE_URL/functions/v1/parse-screenshot-text" \
  -H "Authorization: Bearer <로그인 사용자 access token>" \
  -H "Content-Type: application/json" \
  -d '{"text":"<아래 원문>"}'

# FR-8 카테고리 추천 — 사용자의 기존 카테고리 이름을 함께 보낸다
curl -s -X POST "$SUPABASE_URL/functions/v1/parse-screenshot-text" \
  -H "Authorization: Bearer <로그인 사용자 access token>" \
  -H "Content-Type: application/json" \
  -d '{"text":"<아래 원문>","categories":["운동","향수","주방"]}'
```

> Phase 4부터 출력에 `suggestedCategory: string | null` 이 추가됐다. `categories` 를 안 보내거나
> 빈 배열이면 **항상 null**(하위호환). 보낸 목록 밖의 값은 서버가 null 로 무시한다(할루시네이션 차단).
>
> **2026-10 정제 규칙 변경** (스키마 불변, 프롬프트만):
> ① price 는 **정가(할인 전) 우선** — 하나만 보이면 그 가격. ② brand 는 **통용 한국어 공식 표기
> 우선**(나이키), 없으면 영문 공식 표기(Aesop). ③ productName 에 **브랜드명을 반복하지 않는다**
> (브랜드는 brand 필드로만).

---

## 1) 8fter 브라탑 (정가·할인가 병기 — 정가를 골라야 함)

입력:
```
9:47 / 5G 78 / 8fter.co.kr / 신규가입 혜택 | 쿠폰팩 3만원 + 무료배송 /
8fter. / 지금까지 61407명이 관심을 보였어요. / 홀터 이지 브라탑 /
42,700원 / 32,900원 23% / 리뷰 80 / 구매하기
```
기대(형태):
```json
{ "productName": "홀터 이지 브라탑", "brand": "8fter", "price": 42700, "confidence": 0.8 }
```
핵심: price 는 할인가(32,900)가 아니라 **정가 42,700**(2026-10 규칙).

## 2) Aesop 향수 (영어 제품명 + 한국어 캡션)

입력:
```
12:58 / 5G / Aesop. / Rōzu / Eau de Parfum / 296 / 25 / 30 / 203 /
working.hoho / 잔향은 또 파우더리한게 미친 향수예요. / Follow / Add comment...
```
기대(형태):
```json
{ "productName": "Rōzu Eau de Parfum", "brand": "이솝", "price": null, "confidence": 0.6 }
```
핵심: 가격이 화면에 없으므로 **price=null**. 좋아요/댓글 수(296/25/30/203)는 가격이 아님.
brand 는 통용 한국어 표기 우선이라 **"이솝"**(영문 "Aesop" 도 형태상 허용 — 모델 판단).

## 3) DEAR.CUS 피니셔 스퀴지 (할인가 + 쿠폰 금액 노이즈)

입력:
```
5:20 / 5G 33 / m.dearcus.com / Instagram / DEAR.CUS /
오직 여기서만, 피니셔 스퀴지 UP TO 33% / 3차 입고 품절 되기 전에 놓치지 마세요 /
[비밀특가] 두 번 닦은 듯 깔끔하게 피니셔 스퀴지 / 30% 26,900원 18,900원 /
카카오톡 친구추가하면 2,000원 추가할인! / 5,000원 / 후기 보기 / 구매하기
```
기대(형태):
```json
{ "productName": "피니셔 스퀴지", "brand": "DEAR.CUS", "price": 26900, "confidence": 0.7 }
```
핵심: price 는 **26,900**(정가, 2026-10 규칙). 할인가(18,900)·쿠폰 금액(2,000/5,000)이 아님.

## 4) FR-8 카테고리 추천 (categories 함께 전송)

케이스 2의 Aesop 향수 원문에 `"categories":["운동","향수","주방"]` 를 함께 보냈을 때:
```json
{ "productName": "Rōzu Eau de Parfum", "brand": "이솝", "price": null, "confidence": 0.6, "suggestedCategory": "향수" }
```
핵심: 향수 제품이므로 목록 중 **"향수"** 를 고른다. 만약 목록이 `["운동","주방"]` 처럼 맞는 게
없으면 **suggestedCategory=null**. 목록에 없는 새 이름은 서버가 null 로 무시한다.

---

## 가격 오추출 방지 케이스 (2026-10-19 추가 — 가상 원문)

실데이터 점검(`metrics.sql` §3)에서 가격 수정 3건 중 2건이 **가격이 아닌 숫자를 가격으로 집은 오추출**이었다.
아래는 그 유형을 재현한 **가상 원문**이다(실제 사용자 OCR 원문은 쓰지 않는다). 원칙: 원화 금액만 가격, 애매하면 null.

## 5) 상세 + 추천 상품 목록 (다른 상품 가격이 섞임 — 주 상품 가격만)

입력:
```
10:12 / LTE 64 / 상품 상세 / 무드 린넨 셔츠 / 59,000원 / 리뷰 1,204 / 4.8 / 구매하기 /
함께 보면 좋은 상품 / 코튼 와이드 팬츠 / 45,000원 / 데님 버킷햇 / 29,000원
```
기대(형태):
```json
{ "productName": "무드 린넨 셔츠", "price": 59000 }
```
핵심: 추천 상품 가격(45,000·29,000)이나 리뷰 수(1,204)가 아니라 **주 상품 59,000**.

## 6) 숫자 노이즈만 있고 가격 없음 (SNS 게시물)

입력:
```
8:03 / 5G / dailyfit.official / 이번 시즌 최애 러닝화 / 구매 12,000+ / 리뷰 3,512 /
좋아요 2,348 / 245mm / 2024.09.12 / Follow
```
기대(형태):
```json
{ "price": null }
```
핵심: 구매·리뷰·좋아요 수, 사이즈, 날짜는 **가격이 아님** → price=null.

## 7) 외화 가격만 표시 (해외 쇼핑몰)

입력:
```
11:30 / 5G / store.example.com / Ceramic Pour-Over Dripper / $17.51 /
Free shipping over $50 / Add to cart
```
기대(형태):
```json
{ "price": null }
```
핵심: 원화 금액이 없으므로 null. **환산하거나 소수점을 지워 1751로 만들지 않는다.**

## 자동 검증 (`eval.ts`)

케이스 1~7을 배포 없이 Anthropic API로 직접 호출해 가격(·제품명·추천)을 확인한다.
프롬프트는 배포 함수와 같은 `prompt.ts`를 쓴다. API 키는 **각자 셸 환경 변수로만** 넣는다(커밋·채팅 금지).

```powershell
# PowerShell — 키를 가려서 입력받아 이 셸 세션에만 설정(명령 히스토리에 남지 않음, 5.1 호환)
$s = Read-Host -AsSecureString "Anthropic API key"
$env:ANTHROPIC_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
deno run --allow-net=api.anthropic.com --allow-env=ANTHROPIC_API_KEY supabase/functions/parse-screenshot-text/samples/eval.ts 3
```
마지막 인자는 케이스당 반복 횟수(기본 1). LLM 출력은 호출마다 조금씩 달라 3회 권장. 하나라도 FAIL 이면 종료 코드 1.

---

## 예외 확인(앱의 E-1/E-3 유도)

- 제품명 미인식: 제품 텍스트가 없는 원문 → `productName: null` (앱에서 "제품명을 입력해주세요").
- 저신뢰: 노이즈만 많은 원문 → `confidence < 0.5` (앱에서 "확인이 필요해요").
