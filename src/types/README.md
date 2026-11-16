# src/types

## database.ts — 자동 생성 (직접 수정 금지)

`database.ts`는 Supabase DB 스키마에서 **자동 생성**한다. 손으로 고치지 않는다
(스키마와 타입이 어긋나는 드리프트를 막기 위함). 마이그레이션
(`supabase/migrations/*.sql`)을 바꿀 때마다 재생성한다.

재생성 명령 (마이그레이션을 원격 DB에 적용한 뒤):

```bash
npx supabase@2.121.0 login            # 최초 1회 (브라우저 인증)
npx supabase@2.121.0 gen types typescript --project-id vcvzuiyxcmvrkxscgvwp > src/types/database.ts
```

생성 후 `npx tsc --noEmit`로 타입 정합성 확인. 마이그레이션 적용 순서는 [개발 가이드](../../docs/development.md)의 "데이터베이스".
