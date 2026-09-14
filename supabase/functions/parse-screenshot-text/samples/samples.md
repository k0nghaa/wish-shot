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

---

## 1) 8fter 브라탑 (할인가 있음 — 파는 가격을 골라야 함)

입력:
```
9:47 / 5G 78 / 8fter.co.kr / 신규가입 혜택 | 쿠폰팩 3만원 + 무료배송 /
8fter. / 지금까지 61407명이 관심을 보였어요. / 홀터 이지 브라탑 /
42,700원 / 32,900원 23% / 리뷰 80 / 구매하기
```
기대(형태):
```json
{ "productName": "홀터 이지 브라탑", "brand": "8fter.", "price": 32900, "confidence": 0.8 }
```
핵심: price 는 원가(42,700)가 아니라 **할인가 32,900**.

## 2) Aesop 향수 (영어 제품명 + 한국어 캡션)

입력:
```
12:58 / 5G / Aesop. / Rōzu / Eau de Parfum / 296 / 25 / 30 / 203 /
working.hoho / 잔향은 또 파우더리한게 미친 향수예요. / Follow / Add comment...
```
기대(형태):
```json
{ "productName": "Rōzu Eau de Parfum", "brand": "Aesop", "price": null, "confidence": 0.6 }
```
핵심: 가격이 화면에 없으므로 **price=null**. 좋아요/댓글 수(296/25/30/203)는 가격이 아님.

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
{ "productName": "피니셔 스퀴지", "brand": "DEAR.CUS", "price": 18900, "confidence": 0.7 }
```
핵심: price 는 **18,900**(할인가). 쿠폰 금액(2,000/5,000)이나 원가(26,900)가 아님.

## 4) FR-8 카테고리 추천 (categories 함께 전송)

케이스 2의 Aesop 향수 원문에 `"categories":["운동","향수","주방"]` 를 함께 보냈을 때:
```json
{ "productName": "Rōzu Eau de Parfum", "brand": "Aesop", "price": null, "confidence": 0.6, "suggestedCategory": "향수" }
```
핵심: 향수 제품이므로 목록 중 **"향수"** 를 고른다. 만약 목록이 `["운동","주방"]` 처럼 맞는 게
없으면 **suggestedCategory=null**. 목록에 없는 새 이름은 서버가 null 로 무시한다.

---

## 예외 확인(앱의 E-1/E-3 유도)

- 제품명 미인식: 제품 텍스트가 없는 원문 → `productName: null` (앱에서 "제품명을 입력해주세요").
- 저신뢰: 노이즈만 많은 원문 → `confidence < 0.5` (앱에서 "확인이 필요해요").
