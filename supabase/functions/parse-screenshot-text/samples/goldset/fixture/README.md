# fixture — 실행기 검증용 가상 데이터

`goldset-eval.ts --dry-run` 이 입력 파싱·라벨 검증·호출 수 계산을 제대로 하는지 확인하는 **가상 원문 3행**입니다.
실제 OCR 원문이 아니며(가게·계정·상품 모두 지어낸 것), 그래서 커밋합니다. 실제 데이터는 `goldset/data/`(git 제외)에 둡니다.

```
deno run --allow-read=supabase/functions/parse-screenshot-text/samples \
  supabase/functions/parse-screenshot-text/samples/goldset-eval.ts \
  --data supabase/functions/parse-screenshot-text/samples/goldset/fixture --dry-run
```

- `raw.csv` 는 따옴표 안 줄바꿈·콤마·`""` 를 일부러 넣어 CSV 파서를 검증합니다.
- 유형: A(정가·할인가) 1 · C(SNS, 가격 없음) 1 · E(외화만) 1. 품목: 패션 1 · 뷰티 1 · 생활용품 1.
