# WishShot (위시샷)

스크린샷으로 저장한 관심 제품을 카테고리별 개인 위시리스트로 관리하는 **iOS 앱**입니다. iOS 공유 시트에서 스크린샷을 바로 받아 등록하는 진입 경로를 갖습니다.

> **v2 전환 안내**: 이 저장소는 웹(Vite + Express + SQLite)에서 **iOS 네이티브 앱(Expo + Supabase)** 으로 전환되었습니다. 옛 웹 코드는 `web-v0` 태그에 보존돼 있습니다 (`git show web-v0:<path>`). 현재 `main`/`dev`은 Expo 앱입니다.

## 기술 스택

- **앱**: Expo SDK 57 (React Native) + Expo Router + TypeScript, iOS 우선
- **백엔드**: Supabase (Postgres + Storage + Auth), `@supabase/supabase-js`로 직접 호출 + RLS
- **인증**: **익명 로그인**(로그인 벽 없음, 기기별 세션). 세션은 AsyncStorage에 저장, RLS가 `auth.uid()`로 행 격리. (이메일 가입/승격은 이후 Phase)
- **공유 시트**: `expo-share-intent` (iOS Share Extension)
- **OCR**: 온디바이스 Apple Vision — 자작 로컬 Expo 네이티브 모듈 `modules/expo-vision-ocr` (한국어+영어 인식). `src/lib/ocr`의 `OcrEngine` 뒤에 캡슐화
- **LLM 정제 + 카테고리 추천(FR-8)**: Supabase Edge Function `parse-screenshot-text` (Deno) + Claude Haiku. OCR 원문을 정제하고, 기존 카테고리 이름을 함께 보내면 그중 하나를 추천(`suggestedCategory`). **텍스트가 부족하면 사용자가 선택한 제품 영역 크롭만 예외 전송해 분석(Phase 6, 하위호환·미저장)**
- **빌드**: EAS 클라우드 빌드 → TestFlight (Windows PC + Mac 없이 iOS 개발·배포)
- **디자인**: 흰 배경 + iOS 시스템 그레이 모노톤 리스킨(색 토큰 = `src/constants/theme.ts`)

주요 화면: **하단 알약 탭바(전체·폴더·검색)** · 폴더 홈(2×2 모자이크 카드·설정 진입) · 전체(전체 아이템 3열 그리드) · 등록(OCR 자동채움·카테고리 추천·메모/태그) · **상세 풀스크린 뷰어 + 정보(i) 하프시트**(편집·카테고리 이동·삭제) · 편집 · 설정(개인정보 안내). **로그인 화면 없이 익명 로그인으로 바로 사용.**

## 로컬 실행

사전 준비: Node.js LTS, git. Supabase 프로젝트의 URL·anon 키.

```bash
# 1) 의존성 설치
npm install

# 2) 환경 변수 설정
cp .env.example .env
#   .env 에 EXPO_PUBLIC_SUPABASE_URL 과 EXPO_PUBLIC_SUPABASE_ANON_KEY 입력

# 3) 개발 서버 (이 환경은 --tunnel 필수)
npx expo start --tunnel            # Expo Go 로 접속 (네이티브 모듈 없는 화면 확인용)
npx expo start --dev-client --tunnel  # 개발 빌드가 설치된 아이폰으로 접속
```

- `expo-share-intent`·`expo-vision-ocr`(OCR) 등 네이티브 모듈은 Expo Go에서 동작하지 않습니다. 공유 시트·OCR까지 확인하려면 EAS 개발 빌드가 설치된 실기기가 필요합니다(개발 서버·시뮬레이터에선 `MockOcrEngine`으로 폴백).
- `.env` 변경 후에는 `npx expo start --clear`로 재시작해야 반영됩니다.

## 자주 쓰는 명령어

| 명령어 | 용도 |
|---|---|
| `npx tsc --noEmit` | 타입 체크 |
| `npx expo lint` | ESLint |
| `npx expo-doctor` | 설정·의존성 정합성 점검 |
| `npx eas-cli build --platform ios --profile development` | 개발 빌드 (Apple 인증 필요, 사람이 실행) |

## 데이터베이스 (Supabase)

스키마 계약은 `supabase/migrations/0001_init.sql` 한 파일에 모여 있습니다 — 테이블
(`categories`/`items`/`analysis_logs`), GRANT, RLS 정책, Storage private 버킷(`item-images`)·정책.

**마이그레이션 적용** (둘 중 하나):

```bash
# 방법 A: 대시보드 SQL Editor 에 0001_init.sql 전체를 붙여넣고 Run (링크 불필요, 권장)
# 방법 B: CLI
npx supabase link --project-ref <project-ref>   # DB 비밀번호 입력
npx supabase db push
```

**타입 재생성** (스키마를 바꿀 때마다):

```bash
npx supabase login   # 최초 1회 (브라우저 인증)
npx supabase gen types typescript --project-id <project-ref> > src/types/database.ts
npx tsc --noEmit
```

- 스키마 변경은 기존 파일을 고치지 말고 **새 `000N_*.sql`** 을 추가합니다.
- RLS/권한 검증은 `supabase/tests/rls.sql` 을 대시보드 SQL Editor 에서 실행합니다.
- `src/types/database.ts` 는 자동 생성 파일이라 직접 수정하지 않습니다.

## 이미지 저장·전송 (egress 최적화, Phase 9)

Free 플랜(월 Egress 5GB)을 출시·성장까지 유지하기 위해 이미지 전송량을 코드로 줄입니다.

- **업로드 전 리사이즈·압축**: 저장 시점에만 원본을 **긴 변 1600px · JPEG q0.8**로 최적화합니다(`src/lib/imageResize.ts`). OCR·AI·원본 확대 보기는 사용자가 고른 **원본 uri** 그대로 씁니다.
- **그리드는 썸네일 객체만**: 아이템 1개당 원본(`{uid}/{id}.jpg`)과 별도 **400px 썸네일**(`{uid}/{id}_thumb.jpg`, q0.6, DB에 저장하지 않는 파생 키)을 함께 올립니다. 목록/홈 그리드는 썸네일, **상세 뷰어만 원본**을 봅니다. 썸네일이 없는 레거시 아이템은 그리드에서 원본으로 폴백합니다(화면 비지 않음).
- **signed URL 영속 캐시**: 발급한 signed URL을 AsyncStorage에 저장(TTL 1일)해 앱 콜드스타트·리로드 후에도 같은 URL을 재사용합니다 → `expo-image` 디스크 캐시가 살아남아 **재방문 다운로드 ≈ 0**. 업로드 시 `cacheControl: 604800`.
- 삭제·덮어쓰기·이미지 교체는 **원본과 썸네일을 항상 함께** 처리합니다(고아 객체 없음, 양쪽 캐시 무효화). 전 구간 `src/lib/queries` 경유(화면에서 Storage 직접 호출 금지).
- Supabase **Image Transformation은 Pro 전용**이라 Free에선 못 쓰므로 썸네일을 **별도 객체**로 만듭니다.

## OCR 정제 Edge Function (`parse-screenshot-text`)

온디바이스 OCR(Apple Vision)로 뽑은 **텍스트만** Edge Function으로 보내 Claude Haiku가
제품명·가격·브랜드를 정제합니다. 이미지는 비공개 저장소까지만 가고(업로드 시 긴 변 1600px JPEG로 최적화 저장), AI 정제엔 텍스트만 전송합니다.
단, 텍스트를 찾지 못한 경우에 한해 사용자가 직접 선택한 **제품 영역 크롭만** 확인 후 전송하며 저장하지 않습니다(NFR-3, Phase 6 개정).

**시크릿 등록 & 배포** (Claude 키는 함수 시크릿에만 — 앱·커밋 금지):

```bash
npx supabase login                                     # 최초 1회
npx supabase link --project-ref <project-ref>
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...  # 함수 시크릿
npx supabase functions deploy parse-screenshot-text    # 배포(앱 재빌드와 무관)
```

- Docker가 없어도 클라우드 번들로 배포됩니다 (`WARNING: Docker is not running`은 무시).
- 정제 프롬프트/로직·**입출력 계약**만 바꿀 땐 **재배포만** 하면 됩니다(앱 재빌드 불필요). 예: Phase 4에서 입력 `categories?`·출력 `suggestedCategory`를 하위호환으로 추가.
- 로그인 사용자만 호출 가능(익명 거부). 회귀 케이스: `supabase/functions/parse-screenshot-text/samples/`.

**OCR 엔진 참고**: 지시서의 Google ML Kit 대신 **Apple Vision**(로컬 모듈 `modules/expo-vision-ocr`)을
씁니다 — iOS 전용이라 ML Kit iOS 이슈를 피하고 Expo SDK 57/New Architecture 호환 문제도 없습니다.
이 모듈은 **네이티브라 추가·변경 시 EAS 재빌드**가 필요합니다.

## 문서

- 아키텍처·플랫폼 결정: 노션 「WishShot v2 — 플랫폼·아키텍처 결정 문서 (Expo + Supabase)」
- Phase 1 작업 기록: [`docs/phases/phase-1-toolchain.md`](docs/phases/phase-1-toolchain.md)
- Phase 3 작업 지시·결과: [`docs/phases/phase-3-ocr-and-autofill.md`](docs/phases/phase-3-ocr-and-autofill.md)
- Phase 4 작업 지시·결과: [`docs/phases/phase-4-edit-and-manage.md`](docs/phases/phase-4-edit-and-manage.md)
- Phase 5 작업 지시·결과(리스킨·탭바·상세 뷰어·익명 로그인·TestFlight): [`docs/phases/phase-5-redesign-and-deploy.md`](docs/phases/phase-5-redesign-and-deploy.md)
- 개인정보처리방침 원문(TestFlight 외부 공개용): [`docs/legal/privacy.html`](docs/legal/privacy.html)
- 저장소 작업 규칙: [`CLAUDE.md`](CLAUDE.md)
