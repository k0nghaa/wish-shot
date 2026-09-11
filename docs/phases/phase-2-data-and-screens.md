# Phase 2 — 데이터 계약 + 공유 저장 + 핵심 화면

> **이 문서 사용법**: Claude Code에 이 파일 전체를 컨텍스트로 넘기고 "Step N을 진행해달라"고 요청한다. Step은 순서대로 진행하고, 각 Step의 **DoD**를 사람이 확인한 뒤 다음으로 넘어간다. 아이폰 설치·공유 시트·실기기 동작은 에이전트가 검증할 수 없으므로 사람이 직접 한다.
>
> 관련 문서(원본): 노션 「WishShot v2 PRD (iOS 앱)」, 「WishShot v2 — 플랫폼·아키텍처 결정 문서」 6장(Phase 2)·7장(계약). 이 문서는 그 둘에서 Phase 2에 필요한 부분만 **증류**한 작업 지시서다. 요구사항 원본은 노션이다.

---

## 목표 (Goal)

Phase 1의 빈 앱(로그인 + 공유 수신 스텁) 위에, **데이터 계약을 확정하고 위시리스트의 핵심 CRUD 경험**을 완성한다. 이 Phase가 끝나면: 스크린샷을 공유 시트 또는 앱 내 사진 선택으로 받아 **수동 입력으로 저장**하고, 카테고리별 목록에서 보고, 상세에서 확인·삭제할 수 있다.

**이 Phase의 핵심 검증(PRD/결정문서 DoD)**: 공유 시트에서 WishShot 아이콘 → 수동 입력 저장 → 목록에서 확인. 본인 데이터만 보임(RLS).

## 이 Phase에서 하지 않는 것

- **OCR·LLM 자동채움** (제품명/가격 자동 추출) → **Phase 3**. 이 Phase는 전부 **수동 입력**이다.
- 저장 후 편집, 카테고리 이동, 메모/태그 고급 UX, 기존 데이터 이관 → **Phase 4**.
- (※ **중복 차단**은 하드 UNIQUE 제약이 되어 **Phase 2로 들어옴** — Step 1의 UNIQUE + Step 4의 덮어쓰기 모달. PRD 원안은 Phase 4였음.)
- 카테고리 자동 추천, 검색/정렬 옵션, 이미지 자르기, URL 공유 수신, Apple 로그인, Android → 이후.

---

## 사전 조건 (사람이 준비)

- [x] Phase 1 완료: Supabase Auth 로그인, `expo-share-intent` 수신(경로 표시), EAS 개발 빌드 설치
- [x] Supabase 프로젝트 (URL·anon 키는 `.env`에 있음)
- [x] Supabase 대시보드 접근 (SQL 실행·Storage 버킷 생성용) 또는 Supabase CLI 로그인

---

## 제약 (Constraints) — 에이전트가 지킬 것

Phase 1 규칙(한국어 문자열, 디자인 토큰, 비밀값 커밋 금지, 커밋 컨벤션, 문서 동기화, 모르면 묻기)을 그대로 승계하고 다음을 추가한다.

1. **계약(스키마·타입) 먼저.** Step 1에서 DB 스키마·RLS·타입을 확정하기 전에는 화면의 데이터 레이어를 **타입 기반 mock**으로 시작하지 않는다 — 이 Phase는 솔로 진행이므로 계약을 먼저 굳히고 실제 쿼리로 간다.
2. **RLS는 타협 불가.** `categories`, `items`, `analysis_logs` 세 테이블 모두 SELECT/INSERT/UPDATE/DELETE에 `user_id = auth.uid()`. Storage 버킷도 경로 첫 세그먼트 = `auth.uid()`. 앱 코드에서 `user_id`를 신뢰하지 말고 DB가 강제하게 한다.
3. **네이티브 의존성은 이 Phase 초반에 한 번에 추가.** 앱 내 사진 선택(FR-1)에 `expo-image-picker`(네이티브 모듈)가 필요하다. Step 3~4에서 쓰기 전에 **미리 추가하고 EAS 재빌드**를 한 번 돌린다. 이후 이 Phase 안에서 네이티브 의존성을 추가하지 않는다.
4. **이미지는 서버로 보내되(저장용 Storage 업로드), 원본은 private.** Storage private 버킷 + signed URL로만 렌더. DB에는 객체 키만 저장.
5. **`price`는 `numeric`, 통화 KRW 고정.** (PRD §11 확정. v1 text → numeric.)
6. **테이블명은 `items`** (v1의 `products`에서 개명 — PRD §11 기준).

---

## Step 1 — 데이터 "계약" 확정 (스키마 + RLS + Storage + 타입)

이 Phase의 기준선. 여기가 흔들리면 이후 전부 재작업이므로 신중히.

**작업**
1. `supabase/` 초기화(없으면 `supabase init`). 마이그레이션 파일 `supabase/migrations/0001_init.sql` 작성 — PRD §11 ERD 그대로:
   - `categories` (id uuid PK, user_id uuid NOT NULL FK→auth.users, name text NOT NULL, created_at). **`UNIQUE (user_id, name)`**.
   - `items` (id, user_id, category_id nullable FK→categories ON DELETE SET NULL, image_key text NOT NULL, product_name text NOT NULL, brand nullable, normalized_name text NOT NULL, **price numeric nullable**, source_link nullable, memo nullable, tags text[] nullable, created_at, updated_at).
     - `normalized_name` = **정규화(brand + '|' + product_name)** — 소문자화 + 공백/특수문자 제거, 앱 공용 유틸로 계산. **사용자에게 보이지 않는 서버 전용 중복 판정 컬럼**(화면엔 `product_name`·`brand`만 별도 노출).
     - **`UNIQUE (user_id, normalized_name)`** — 같은 브랜드+제품명 재저장을 DB가 차단(하드). 브랜드가 다르면 값이 달라 허용. 브랜드 빈 값은 `''`로 취급(브랜드 없는 동명끼리는 중복).
   - `analysis_logs` (id, user_id, item_id nullable FK→items ON DELETE SET NULL, raw_text, parsed jsonb, status text, fail_reason, created_at) — 개발자용, Phase 3에서 채움. 테이블만 생성.
2. **RLS 정책**: 세 테이블 `enable row level security` + 4개 정책(select/insert/update/delete) 모두 `user_id = auth.uid()`. insert는 `with check (user_id = auth.uid())`.
3. **Storage**: private 버킷 생성(예: `item-images`). 경로 규칙 `{user_id}/{item_id}.jpg`. 버킷 정책: 객체 경로 첫 세그먼트가 `auth.uid()`인 것만 read/insert/delete.
4. 마이그레이션 적용: Supabase CLI(`supabase db push` 또는 링크 후) **또는** 대시보드 SQL Editor에 붙여넣기. (사람이 실행/확인)
5. **타입 생성 (gen types 채택)**: `npx supabase login`(1회) 후 `npx supabase gen types typescript --project-id vcvzuiyxcmvrkxscgvwp > src/types/database.ts`. DB 스키마에서 타입을 자동 생성해 드리프트를 막는다. 마이그레이션 변경 시마다 재생성.
6. RLS 검증 SQL 작성: 다른 `user_id`로 조회 시 0행이 나오는지 확인하는 쿼리를 `supabase/tests/rls.sql`에 남긴다.
7. 커밋: `feat: DB 스키마 + RLS 정책 + 타입 (Phase 2 계약)`

**DoD**
- [x] `categories`/`items`/`analysis_logs` + RLS 정책 + Storage private 버킷/정책 생성됨
- [x] (사람) 대시보드에서 테이블·정책 확인. RLS 검증: 다른 유저 컨텍스트로 접근 시 0행 (rls.sql 테스트 1·2 통과)
- [x] `src/types/database.ts` 생성, `npx tsc --noEmit` 통과
- [x] `.env`/비밀값 커밋 없음

---

## Step 2 — Supabase 데이터 레이어 (타입 기반 쿼리)

**작업**
1. `src/lib/queries/` 에 타입(`database.ts`) 기반 함수: 카테고리 목록/생성/이름변경, 아이템 목록(카테고리별, 최신순)/단건/생성/삭제, Storage 이미지 업로드 + signed URL 발급.
2. `normalized_name` 생성 **공용 유틸**: 정규화(brand + '|' + product_name) — 소문자 + 공백/특수문자 제거. Step 4의 중복 사전조회와 저장이 **같은 유틸**을 쓴다(정규화 소스 1개). 편집(Phase 4)에서 브랜드/이름 변경 시 재계산 필요.
3. 커밋: `feat: Supabase 데이터 레이어 (categories/items/storage 쿼리)`

**DoD**
- [x] 각 쿼리 함수 존재, `tsc --noEmit` 통과
- [x] (선택) 로그인 상태에서 카테고리 1개 생성/조회가 실제 Supabase에 반영되는지 사람 확인 (Step 3 화면에서 검증)

---

## Step 3 — 홈(카테고리) + 아이템 목록 화면

**작업** (PRD §10 화면 구성)
1. 홈(카테고리): 카테고리 카드(이름/개수/대표 썸네일), "미분류", 업로드 버튼(FloatingAction 등), **빈 상태 안내 + CTA**. 빈 카테고리는 비노출.
2. 아이템 목록: 카테고리 진입 → 그리드 카드(썸네일/제품명/브랜드/저장일), **최신순**.
3. 카테고리 생성/이름 변경(FR-17) + **삭제**. 삭제는 확인 모달 + "안의 아이템은 미분류로 이동해요" 안내. 스키마의 `ON DELETE SET NULL`로 아이템은 자동 미분류 처리(삭제되지 않음).
4. 썸네일은 Storage signed URL. 로딩/빈 상태 한국어.
5. 커밋: `feat: 홈(카테고리) + 아이템 목록 + 카테고리 생성/이름변경/삭제`

**DoD**
- [x] (사람) 실기기에서 홈 → 카테고리 → 목록 탐색. 빈 상태 문구 확인
- [x] (사람) 카테고리 삭제 → 안의 아이템이 미분류로 이동(삭제 안 됨) 확인
- [x] 디자인 토큰만 사용(원시 hex 없음), 문자열 한국어

---

## Step 4 — 등록(저장) 화면 + 이미지 업로드  ⭐

이 Phase의 핵심. **OCR 없이 수동 입력**으로 저장까지 완성.

**작업**
1. `expo-image-picker` 추가(네이티브 — 제약 3에 따라 여기서 추가하고 EAS 재빌드). 앱 내 업로드(FR-1): 사진 라이브러리에서 이미지 선택.
2. 등록 화면(PRD §10): 이미지 미리보기, 제품명(**필수**)/브랜드/가격/링크/메모, 카테고리 선택·**생성**, 저장 버튼. (OCR 상태 인디케이터·"AI가 채움" 표시는 Phase 3 자리만 비워둠)
3. **공유 시트 연결(FR-1a)**: Phase 1의 `share.tsx` 스텁을 이 등록 화면으로 대체/연결 — 공유로 받은 이미지가 채워진 상태로 진입. 미로그인 진입은 로그인 후 이미지 유지(FR-1b, E-8).
4. **중복 사전조회 + 모달**: 저장 시 앱이 `normalized_name`(brand+제품명 정규화)을 계산해 기존 아이템을 조회한다. 있으면 **덮어쓰기 / 기존 보기 / 취소** 모달(기존 카드: 썸네일/제품명/브랜드/저장일).
   - **덮어쓰기** = 기존 아이템을 새 입력으로 **UPDATE**(이미지는 같은 Storage 키에 새 스크린샷을 덮어쓰기, 필드도 새 값, `updated_at` 갱신). **새 행 추가 아님.**
   - **기존 보기** = 기존 아이템 상세로 이동(Phase 2에선 보기/삭제까지. 필드 편집은 Phase 4).
   - **취소** = 저장 중단.
   - DB `UNIQUE`는 사전조회를 놓친 경우의 안전망(23505 unique_violation을 잡아 모달로 폴백).
5. 저장 플로우: 이미지 → Storage 업로드 → 성공 시 `items` insert(+ normalized_name). 실패 처리: 제품명 없으면 저장 비활성(E-3), 가격/브랜드/링크 빈 값 허용(E-4), **Storage 업로드 실패 시 저장 중단**(이미지 없는 아이템 금지, E-5).
6. 커밋: `feat: 등록 화면 + 이미지 업로드/저장 + 중복 차단(덮어쓰기)`

**DoD**
- [x] (사람) **앱 내 사진 선택 → 저장 → 목록 확인**
- [x] (사람) **공유 시트 → WishShot → 등록 화면(이미지 채워짐) → 저장 → 목록 확인** ← Phase 2 핵심 (공유 콜드스타트 시 dev client의 "Finding Dev Servers"는 개발 빌드 특성 — 프로덕션에선 바로 진입)
- [x] (사람) **같은 브랜드+제품명 재저장 → 덮어쓰기/기존보기/취소 모달** → 덮어쓰기 시 기존 아이템 이미지·필드 갱신(새 행 안 생김), 브랜드만 다르면 정상 저장
- [x] 다른 계정으로는 안 보임(RLS). 제품명 빈 값 저장 차단
- [x] `tsc --noEmit` 통과

---

## Step 5 — 상세 + 삭제

**작업** (PRD §10, 정책)
1. 상세 화면: 원본 이미지(signed URL), 제품명/브랜드/가격/링크/메모/태그/카테고리 표시.
2. 삭제: 확인 1회(모달) → `items` 삭제 + **Storage 객체도 삭제**. 복구 없음.
3. (편집·카테고리 이동은 Phase 4 — 여기선 표시와 삭제만)
4. 커밋: `feat: 상세 화면 + 삭제`

**DoD**
- [x] (사람) 목록 → 상세 → 삭제 → 목록/Storage에서 사라짐 확인

---

## Step 6 — 문서 정리 + PR

**작업**
1. `CLAUDE.md` 갱신: 데이터 레이어 구조(`src/lib/queries`, `src/types/database.ts`), Supabase 접근 패턴, Storage 규칙, 마이그레이션 위치.
2. `README.md`에 스키마/마이그레이션 실행법 추가.
3. 이 문서 DoD 채우고 "결과 기록" 작성(스키마 확정 사항, price 타입, 네이티브 추가분, 빌드 등).
4. 커밋: `docs: Phase 2 완료 — 문서 갱신, 결과 기록`. `dev`로 PR.

**DoD**
- [x] `CLAUDE.md`가 현재 구조를 정확히 설명
- [x] `dev`로 PR (열림 — 사람이 머지)

---

## 미결 사항 (진행 중 결정, 결과 기록에 남길 것)

- `price` 타입은 numeric로 확정(PRD). 통화 KRW 고정 — 해외 쇼핑몰 대응 시점은 이후.
- Storage signed URL TTL(캐시 효율 vs 보안).
- `analysis_logs`는 테이블만 만들고 Phase 3에서 사용.
- **덮어쓰기 갱신 범위**: 현재 문서는 "이미지 + 입력필드 전체로 기존 아이템 UPDATE" 가정. "이미지만 교체"를 원하면 조정 가능.
- 정규화 규칙 세부(어떤 특수문자까지 제거, 한글 처리)는 앱 공용 유틸에서 확정.

**이 문서에서 확정한 결정:**
- 카테고리 삭제 → **Phase 2 포함** (Step 3). 스키마 `ON DELETE SET NULL`로 아이템은 미분류로.
- 타입 → **`supabase gen types` 자동 생성 채택** (드리프트 방지).
- `normalized_name` → **UNIQUE(user_id, normalized_name)로 하드 차단**(중복 허용 안 함). 값 = 정규화(brand+'|'+product_name), 서버 전용 숨김 컬럼(화면엔 product_name·brand만). 중복 시 **덮어쓰기(기존 UPDATE)/기존 보기/취소**. → **중복 차단이 PRD 원안(Phase 4)에서 Phase 2로 이동**. (PRD FR-9/10·S3·§11 수정 필요)

## 결과 기록 (Phase 완료 시 작성)

- **완료일**: 2026-09-11
- **확정된 스키마(테이블/주요 제약)**:
  - `categories`: `UNIQUE(user_id, name)`
  - `items`: `UNIQUE(user_id, normalized_name)`(하드 중복 차단), `category_id` FK→categories `ON DELETE SET NULL`(미분류로), `updated_at` 자동 트리거
  - `analysis_logs`: 테이블만 생성(Phase 3에서 사용)
  - 세 테이블 모두 RLS(`user_id = (select auth.uid())`, 성능 위해 select 래핑) + **`authenticated` GRANT 명시**
- **price 타입 / 통화**: `numeric` nullable / KRW 고정
- **추가한 네이티브 의존성 / EAS 재빌드**: `expo-image-picker ~57.0.16`, `expo-file-system ~57.0.6` → 개발 빌드 **1회 재빌드**. 아이템 id 는 `expo-modules-core`의 `uuid.v4()`로 생성(신규 네이티브 아님). 이미지 바이트는 `File.arrayBuffer()`.
- **Storage 버킷명 / 정책**: `item-images`(private). 경로 `{user_id}/{item_id}.jpg`, 첫 세그먼트가 `auth.uid()`인 객체만 select/insert/update/delete. signed URL TTL 1시간(잠정).
- **발생한 이슈와 해결**:
  1. 이 프로젝트는 `public` 테이블 **GRANT 자동부여가 안 됨** → 마이그레이션에 `grant ... to authenticated` 명시(안 하면 `permission denied`).
  2. 마이그레이션 부분 적용/재실행 문제 → 초기화 스니펫 제공 + Storage 정책 `drop policy if exists`로 멱등화.
  3. `storage.buckets` 직접 DELETE는 트리거(`protect_delete`)로 차단 → 초기화에서 버킷 삭제 제외(멱등 insert 재사용).
  4. 공유로 받은 파일 경로가 스킴 없는 절대경로일 수 있어 `file://` 정규화(`toFileUri`).
  5. Expo Router 타입 라우트는 `expo start`로 재생성해야 `tsc` 통과.
  6. `expo` 코어 패치 미스매치는 기존 드리프트(Step 4 무관) → 현재 버전 고정 + `expo.install.exclude`로 자동 변경 차단.
- **덮어쓰기 갱신 범위(미결 해소)**: 이미지 + 입력필드 전체로 기존 아이템 UPDATE(같은 Storage 키에 upsert), 새 행 생성 아님.
- **Phase 3로 넘길 것**: OCR(온디바이스 ML Kit) + LLM 정제(Edge Function) 자동채움, `analysis_logs` 사용, 등록 화면의 "AI 자동 채움" 자리 채우기, 중복 모달 "기존 보기" 이후 UX 다듬기.
