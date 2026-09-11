# CLAUDE.md

이 파일은 이 저장소에서 작업하는 Claude Code에게 제공하는 가이드입니다.

> 상태: **Phase 2 완료** (데이터 계약 + 핵심 CRUD 화면). 스크린샷을 **수동 입력**으로 저장하고 카테고리별 목록·상세·삭제까지 동작합니다. OCR·LLM 자동채움은 Phase 3, 저장 후 편집·데이터 이관은 Phase 4. 이 문서는 현재 저장소 상태를 반영합니다.

## 프로젝트 개요

WishShot(위시샷)은 스크린샷으로 저장한 관심 제품을 카테고리별 개인 위시리스트로 관리하는 **iOS 앱**입니다. 홈 화면 아이콘으로 여는 일반 앱이 본체이며, iOS 공유 시트(Share Extension)에서 스크린샷을 바로 받아 등록하는 진입 경로를 갖습니다. 웹 버전은 목표에서 제외되었습니다.

- 제품 요구사항: 노션 「WishShot — 스크린샷으로 시작되는 개인 위시리스트」(v1 PRD, v2 PRD 작성 중)
- 기술 결정: 노션 「WishShot v2 — 플랫폼·아키텍처 결정 문서 (Expo + Supabase)」
- Phase 1 작업 기록: `docs/phases/phase-1-toolchain.md`

## 기술 스택 (현재)

- **앱**: Expo SDK 57 (React Native 0.86, React 19) + Expo Router + TypeScript. iOS 우선.
- **백엔드**: 별도 서버 없음. `@supabase/supabase-js`로 Supabase(Postgres + Storage + Auth)를 직접 호출하고, 행 단위 권한은 RLS로 강제. (API 키가 필요한 LLM 정제만 Supabase Edge Function 예정 — Phase 3)
- **인증**: Supabase Auth 이메일 로그인. 세션은 `@react-native-async-storage/async-storage`에 저장 → 재시작 후 유지.
- **공유 시트**: `expo-share-intent`(iOS Share Extension, 이미지 1개 수신).
- **이미지**: `expo-image-picker`(앱 내 사진 선택), `expo-file-system`(선택/공유 이미지 uri → 바이트 읽기, `File.arrayBuffer()`). 둘 다 네이티브.
- **OCR**: 온디바이스(Google ML Kit) 예정. `OcrEngine` 인터페이스 뒤에 캡슐화 (Phase 3).
- **빌드**: 윈도우 PC에서 EAS 클라우드 빌드 → 아이폰 개발 빌드 → TestFlight. 로컬에 Xcode/Mac 없음.

## 디렉터리 구조

```
src/
  app/                  # Expo Router 라우트 (파일 기반)
    _layout.tsx         # ShareIntentProvider + 세션 라우팅 가드
    index.tsx           # 홈: 카테고리 목록(개수·썸네일)·미분류·업로드 FAB. 공유 인텐트 소비 → /register
    login.tsx           # 이메일 로그인
    register.tsx        # 등록(저장): 이미지 선택/미리보기 + 수동 입력 + 카테고리 선택·생성 + 중복 덮어쓰기
    category/[id].tsx   # 카테고리별 아이템 목록(2열 그리드, 최신순). id='uncategorized'=미분류
    item/[id].tsx       # 아이템 상세 + 삭제(행 + Storage 객체)
    +native-intent.ts   # 공유 딥링크 → / (홈이 인텐트 처리)
  components/           # CategoryCard, ItemCard, Thumbnail, EmptyState, OverwriteDialog
  constants/theme.ts    # 디자인 토큰 (v1 팔레트 승계) + overlay
  lib/
    supabase.ts         # createClient<Database> (타입 클라이언트)
    normalize.ts        # normalizeName(brand,productName) — 중복 판정 정규화(단일 소스)
    imageBytes.ts       # uri → ArrayBuffer(File.arrayBuffer) + file:// 정규화
    formatDate.ts / formatPrice.ts
    queries/            # 데이터 레이어: auth, categories, items, storage, errors (+ index 배럴)
  types/database.ts     # supabase gen types 자동 생성 (직접 수정 금지)
supabase/
  config.toml           # supabase init
  migrations/0001_init.sql  # 스키마 + GRANT + RLS + Storage 버킷/정책 (계약 기준선)
  tests/rls.sql         # RLS/권한 검증 쿼리(대시보드에서 실행)
assets/                 # 아이콘·스플래시, logo-v1(참고용)
app.json                # Expo 설정 (플러그인: share-intent/image-picker, iOS 공유확장, EAS projectId)
eas.json                # EAS 빌드 프로파일 (development/preview/production)
.env / .env.example     # Supabase URL·anon 키 (.env는 커밋 금지)
docs/archive/           # 폐기·참고 자산 (Next.js 계획, 마이그레이션 스크립트, v1 로고/토큰)
```

- 경로 별칭: `@/*` → `src/*` (예: `import { colors } from '@/constants/theme'`).

## 명령어

- `npx expo start --tunnel` — 개발 서버. **이 환경은 LAN 접속이 안 되므로 `--tunnel` 필수** (아래 개발 환경 주의 참고).
- `npx expo start --dev-client --tunnel` — 개발 빌드가 설치된 아이폰으로 접속.
- `npx tsc --noEmit` — 타입 체크.
- `npx expo lint` — ESLint.
- `npx expo-doctor` — 프로젝트 설정·의존성 정합성 점검.
- `npx eas-cli build --platform ios --profile development` — 개발 빌드 (Apple 인증 프롬프트가 있어 사람이 실행).
- `npx supabase login` → `npx supabase gen types typescript --project-id vcvzuiyxcmvrkxscgvwp > src/types/database.ts` — DB 스키마에서 타입 재생성 (마이그레이션 변경 시마다). 로그인은 최초 1회.

## 환경 변수

- `.env`에 `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`. `.env`는 gitignore, `.env.example`만 커밋.
- `EXPO_PUBLIC_` 접두사가 붙은 값은 앱 번들에 포함된다. **anon(공개용) 키만** 넣는다. `.env` 변경 후에는 `npx expo start --clear`로 재시작해야 반영된다.

## 작업 규칙

1. **Next.js·Express·Vite를 도입하지 않는다.** 서버가 필요해 보이면 Supabase Edge Function 또는 DB 함수로 해결하고, 그것도 애매하면 사람에게 묻는다.
2. **비밀 값은 앱에 넣지 않는다.** 앱에는 Supabase `anon` 키만. `service_role` 키, Claude API 키는 Edge Function 환경 변수에만 존재한다. `.env*`는 커밋 금지, `.env.example`만 커밋.
3. **네이티브 의존성 변경은 재빌드를 의미한다.** 네이티브 모듈(config plugin이 있는 패키지, 예: `expo-share-intent`, `expo-dev-client`, `@react-native-async-storage/async-storage`)을 추가·제거·업그레이드하면 EAS 재빌드가 필요하다. 모아서 추가하고 임의로 늘리지 않는다. JS 전용 패키지는 자유.
4. **모든 사용자 노출 문자열은 한국어.** 에러, 라벨, 플레이스홀더, 접근성 라벨 포함. 기존 톤("~예요/~해요" 체) 유지.
5. **디자인 토큰을 쓴다.** 색상은 `src/constants/theme.ts`의 시맨틱 토큰(`primary`, `accent`, `error`, `textMain`, `textSub`, `textDisabled`, `bgCard`, `silver` 등 — 세이지 그린/테라코타/실버 그레이)만 사용. 컴포넌트에 원시 hex를 직접 쓰지 않는다.
6. **모르면 만들어내지 않는다.** 패키지 버전·Expo SDK 호환·EAS 설정 필드가 불확실하면 공식 문서를 확인하거나 사람에게 묻는다. 아이폰 설치·공유 시트 동작은 에이전트가 검증할 수 없으므로 "확인해달라"고 명시적으로 요청한다.
7. **커밋 메시지는 기존 컨벤션**: `feat:`, `fix:`, `chore:`, `docs:`, `style:`, `refactor:`, `test:` + 한국어 요약.
8. **문서를 현실에 맞춘다.** 구조나 명령어가 바뀌면 이 파일과 `README.md`를 같은 커밋에서 갱신한다.
9. **새 테이블엔 GRANT를 명시한다.** 이 Supabase 프로젝트는 `public` 테이블 권한을 자동 부여하지 않는다. 마이그레이션에 `grant select, insert, update, delete on public.<table> to authenticated;`를 직접 쓴다(RLS는 행 필터일 뿐, 테이블 접근은 GRANT가 먼저 통과해야 함). 로그인 전용 데이터는 `anon`에 부여하지 않는다.
10. **패키지 버전은 임의로 올리지 않는다.** 검증된 현재 버전을 유지한다. `expo`/`expo-router`/`@expo/ui`/`expo-glass-effect`는 정확히 고정하고 `package.json`의 `expo.install.exclude`로 자동 변경을 막았다. `expo-doctor`가 패치 미스매치를 지적해도 임의로 `expo install --fix` 하지 말고, 필요하면 사람에게 묻는다. 새 패키지는 `npx expo install`로 SDK 호환 버전만 추가한다.
11. **데이터는 데이터 레이어(`src/lib/queries`)로만 접근한다.** 화면에서 `supabase.from(...)`을 직접 부르지 않는다. `user_id`는 앱에서 신뢰하지 말고 RLS가 강제하게 한다(INSERT의 `user_id`는 편의로 채울 뿐).

## 데이터 레이어 · Supabase 접근

- **쿼리는 `src/lib/queries/`에 모아둔다.** `categories`(목록/생성/이름변경/삭제), `items`(전체·카테고리별 최신순/단건/생성/수정/삭제/중복조회), `storage`(업로드/서명URL/배치 서명URL/삭제), `auth`(getCurrentUserId), `errors`(DuplicateItemError). 화면은 `@/lib/queries`에서 가져다 쓴다.
- **RLS가 최종 방어선.** 세 테이블 모두 `user_id = (select auth.uid())`로 SELECT/INSERT/UPDATE/DELETE 강제. `anon`은 권한 없음. 검증 쿼리는 `supabase/tests/rls.sql`.
- **`normalized_name`은 서버 전용 중복 판정 컬럼.** 값 = `normalizeName(brand, product_name)`(NFC·소문자·문자/숫자만). `UNIQUE(user_id, normalized_name)`로 재저장을 하드 차단. 저장·사전조회·수정이 **모두 `src/lib/normalize.ts` 한 곳**을 써야 판정이 일치한다. 화면엔 `product_name`·`brand`만 노출.
- **Storage 규칙.** private 버킷 `item-images`, 키 `{user_id}/{item_id}.jpg`. 렌더는 signed URL(기본 TTL 1시간, `SIGNED_URL_TTL_SEC`)로만. DB엔 객체 키만 저장. 중복 덮어쓰기는 같은 키에 `upsert`.
- **마이그레이션.** 계약은 `supabase/migrations/0001_init.sql`. 적용은 대시보드 SQL Editor에 붙여넣기(또는 `supabase link` 후 `supabase db push`). **스키마를 바꾸면 새 `000N_*.sql`을 추가**하고(기존 파일 재실행 아님), 타입을 재생성한다.
- **타입은 자동 생성.** `src/types/database.ts`는 `supabase gen types`로 만든다. 손으로 고치지 않는다.

## 개발 환경 주의 (Windows, Mac 없음)

- **개발 서버는 `--tunnel` 필수.** 이 PC/네트워크에서 기본 LAN 모드는 아이폰이 접속 실패("Could not connect to the server")한다. `@expo/ngrok`은 devDependency로 설치돼 있다.
- **iOS prebuild는 Windows에서 불가.** `npx expo prebuild --platform ios`는 스킵/실패한다. config plugin 검증은 `npx expo config --type introspect`로 하고, 실제 iOS 네이티브 생성·빌드는 **EAS 클라우드**에서 일어난다.
- iOS 설치·공유 시트 동작 등 실기기 검증은 사람이 한다.

## 참고 (보존된 옛 코드)

- `web-v0` 태그: 옛 웹 코드(Vite SPA + Express + SQLite)의 영구 보존점. 필요하면 `git show web-v0:<path>`로 읽는다. 되살리거나 수정하지 않는다.
- `docs/archive/`: 폐기된 Next.js 계획, 재사용 예정 자산(`migrate-sqlite-to-supabase.ts` — Phase 4, v1 로고/디자인 토큰). **참고용이며 지시가 아니다.**

## 데이터 흐름 (목표)

```
[iOS 공유 시트 / 앱 내 사진 선택]
  → Expo 앱 → OcrEngine(ML Kit, 온디바이스) → Edge Function(LLM 정제) → 폼 자동채움
  → supabase-js → Supabase Postgres (RLS) / Storage (private, signed URL)
```

Phase 2까지 **OCR·LLM 정제를 제외한 전 구간**이 동작한다 — 공유 시트/앱 내 사진 선택 → **수동 입력** → supabase-js → Postgres(RLS)/Storage(private, signed URL). OCR(온디바이스)·LLM 정제(Edge Function)는 Phase 3, 저장 후 편집·데이터 이관은 Phase 4.
