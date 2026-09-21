# CLAUDE.md

이 파일은 이 저장소에서 작업하는 Claude Code에게 제공하는 가이드입니다.

> 상태: **Phase 6 앱 코드 완료 · 제출(Step 8) 진행 중** (원티드 AI Championship 2026 제출용). Phase 5(리스킨·하단 탭바·상세 뷰어/정보 시트·익명 로그인·TestFlight) 위에 다음을 추가했습니다: (1) **iCloud "저장 공간 최적화" 사진 업로드 대응** — 파일 준비 폴링(`ensureFileReady`, exists&&size>0 재시도)·안내·재시도 + `__DEV__` 계측(1차). (2) **등록/편집 폼 키보드 가림 수정** — ScrollView `automaticallyAdjustKeyboardInsets`. (3) **텍스트가 부족한 제품 사진용 "제품 영역 지정" 이미지 폴백** — 사용자가 고른 사각 영역만 동의 후 Edge Function→Claude로 전송(하위호환, 미저장). (4) **NFR-3 문구 개정** — 방침·인앱 고지·README 정합, 과장 문구 제거. (5) **검색**(클라이언트 필터). 네이티브 모듈 `expo-image-manipulator`(크롭)·`expo-media-library`(iCloud 2차 대비)를 dev 재빌드 1회에 묶었습니다. **최종 production 빌드·외부 TestFlight 제출·랜딩·영상(Step 8)과 방침 Notion 동기화는 사람 진행.** 이 문서는 현재 저장소 상태를 반영합니다.

## 프로젝트 개요

WishShot(위시샷)은 스크린샷으로 저장한 관심 제품을 카테고리별 개인 위시리스트로 관리하는 **iOS 앱**입니다. 홈 화면 아이콘으로 여는 일반 앱이 본체이며, iOS 공유 시트(Share Extension)에서 스크린샷을 바로 받아 등록하는 진입 경로를 갖습니다. 웹 버전은 목표에서 제외되었습니다.

- 제품 요구사항: 노션 「WishShot — 스크린샷으로 시작되는 개인 위시리스트」(v1 PRD, v2 PRD 작성 중)
- 기술 결정: 노션 「WishShot v2 — 플랫폼·아키텍처 결정 문서 (Expo + Supabase)」
- Phase 1 작업 기록: `docs/phases/phase-1-toolchain.md`
- Phase 3 작업 지시·결과: `docs/phases/phase-3-ocr-and-autofill.md`
- Phase 4 작업 지시·결과: `docs/phases/phase-4-edit-and-manage.md`
- Phase 5 작업 지시·결과: `docs/phases/phase-5-redesign-and-deploy.md` (리스킨·탭바·상세 뷰어·익명 로그인·TestFlight)
- 디자인 정본: `docs/design/phase-5-visual-spec.md`, `docs/design/color_tokens.md`
- 개인정보처리방침 원문: `docs/legal/privacy.html` (TestFlight 외부 공개용)

## 기술 스택 (현재)

- **앱**: Expo SDK 57 (React Native 0.86, React 19) + Expo Router + TypeScript. iOS 우선.
- **백엔드**: 별도 서버 없음. `@supabase/supabase-js`로 Supabase(Postgres + Storage + Auth)를 직접 호출하고, 행 단위 권한은 RLS로 강제. API 키가 필요한 **LLM 정제만 Supabase Edge Function `parse-screenshot-text`(Deno)** 로 처리(Phase 3 완료).
- **인증**: **익명 로그인**(Phase 5). 세션이 없으면 `auth.signInAnonymouslyIfNeeded()`가 `supabase.auth.signInAnonymously()`로 기기별 익명 세션을 만든다 → **로그인 벽 없이 즉시 사용**. 세션은 `@react-native-async-storage/async-storage`에 저장 → 재시작 후 유지, RLS가 익명 세션의 `auth.uid()`로 행 격리(익명도 `authenticated` 롤이라 기존 GRANT·정책 그대로 적용). 대시보드 **Authentication → Anonymous sign-ins 토글 ON**(하단 Save)이 필요하다. 이메일 로그인 라우트(`login.tsx`)는 보존하되 정상 흐름에선 도달하지 않는다(계정 승격은 Phase 6). `signInWithPassword`/`signOut`은 `__DEV__` 왕복 버튼에서만 쓴다.
- **공유 시트**: `expo-share-intent`(iOS Share Extension, 이미지 1개 수신).
- **이미지**: `expo-image-picker`(앱 내 사진 선택), `expo-file-system`(선택/공유 이미지 uri → 바이트 읽기, `File.arrayBuffer()`). 둘 다 네이티브.
- **OCR**: 온디바이스 **Apple Vision**(iOS 내장). 자작 로컬 Expo 네이티브 모듈 `modules/expo-vision-ocr/`가 `recognitionLanguages=["ko-KR","en-US"]`로 한국어+영어를 인식. `OcrEngine` 인터페이스(`src/lib/ocr/`) 뒤에 캡슐화해 교체 가능. **엔진 결정**: 지시서의 Google ML Kit 대신 Apple Vision 채택 — iOS 전용이라 ML Kit의 iOS CocoaPods/arm64 문제를 피하고, 어떤 RN용 ML Kit 래퍼도 Expo SDK 57/New Architecture 호환을 확인하지 못했기 때문. OCR은 온디바이스라 이미지가 서버로 가지 않고, AI 정제엔 **텍스트만** 전송한다. **단, 텍스트를 찾지 못한 경우에 한해 사용자가 직접 선택한 제품 영역 크롭만 동의 후 전송한다**(NFR-3 개정, Phase 6 — 통이미지·자동 전송 없음, 크롭 미저장).
- **LLM 정제 + 카테고리 추천(FR-8)**: Edge Function `parse-screenshot-text`(Deno)가 Claude Haiku(`claude-haiku-4-5`)로 OCR 원문을 정제해 `{productName, price, brand, confidence, suggestedCategory}` 반환. 입력에 `categories?: string[]`(사용자 기존 카테고리 이름)을 받으면 그중 하나를 추천(`suggestedCategory`), 없거나 빈 배열이면 `null`(하위호환). 목록 밖 값은 서버·앱 양쪽에서 무시. 구조화 출력(json_schema) 사용. Claude 키는 함수 시크릿에만. **Phase 6**: 입력에 `image?: {base64, mediaType}`(사용자가 선택한 제품 영역 크롭)을 추가로 받는다 — OCR 텍스트 부족 시에만, 명시 동의 후. 이미지가 있으면 이미지+텍스트로 정제하고 없으면 기존과 바이트 동일(하위호환). 출력 스키마 불변. 크롭 이미지는 서버에서 미저장·미로깅(길이만 기록).
- **빌드**: 윈도우 PC에서 EAS 클라우드 빌드 → 아이폰 개발 빌드 → TestFlight. 로컬에 Xcode/Mac 없음.

## 디렉터리 구조

```
src/
  app/                  # Expo Router 라우트 (파일 기반)
    _layout.tsx         # ShareIntentProvider + AuthGate(익명 부트스트랩 — 세션 없으면 signInAnonymouslyIfNeeded; 첫 세션 후엔 세션이 잠깐 null이어도 네비게이터 유지). 등록·편집=모달, 상세=세로 풀스크린 모달, info=formSheet(네이티브 반시트). OnboardingTargetProvider(코치마크 대상 등록소)로 스택+오버레이를 감싸고, OnboardingGate가 첫 실행 온보딩을 최초 마운트 1회 판단(공유 인텐트로 열렸으면 스킵=인텐트 우선, 본 뒤엔 미노출) — Phase 7 Batch D
    (tabs)/             # 하단 알약 탭바 그룹 (Expo Router Tabs + CustomTabBar). 상세·등록·편집·설정·태그는 이 그룹 위 스택으로 push
      _layout.tsx       # Tabs 레이아웃(기본 탭=index/폴더). tabBar=CustomTabBar(플로팅 알약, JS 전용)
      index.tsx         # 폴더 홈: 카테고리 2×2 모자이크 카드(개수·대표 4장, 빈 카테고리도 노출)·미분류·설정 진입. 공유 인텐트 소비 → 이미지=/register, URL/웹페이지=/all(링크붙이기 모드) (Phase 7, useIsFocused+ref 재진입 가드). 롱프레스/··· = 폴더 이름변경·삭제
      all.tsx           # 전체: 모든 위시 3열 정사각 그리드(최신순) + 업로드 FAB + 다중 선택. 링크붙이기 모드(Phase 7, attachLink 파라미터): 배너+새로담기, 타일 탭→편집(링크 프리필). 선택 모드와 상호 배타. (찜 필터·New 배지는 Phase 6)
      search.tsx        # 검색: "검색 기능 추가 예정" 플레이스홀더 (실제 검색은 Phase 6)
    login.tsx           # 이메일 로그인(익명 도입으로 정상 흐름 미도달; __DEV__ 왕복용). 성공 시 홈 복귀 + 취소 버튼
    register.tsx        # 등록(저장): 이미지 선택/미리보기 + OCR 자동채움("AI가 채움") + 수동 입력 + 폴더 선택·생성·**FR-8 추천 미리선택** + 메모/**태그** + 중복 덮어쓰기 + 개인정보 고지(NFR-3). Phase 7: sourceLink 프리필(링크붙이기 새로담기) + "방금 캡처한 사진 담기"(getRecentPhotoAsset, 탭 시점 권한 요청) + 저장 성공 후 "앨범에서 삭제" 옵션(Batch C, 앱 내 선택 사진(picker·최근사진)의 assetId만·전체 접근 필요·공유 시트 비노출·제한/거부 시 제안 자체 생략)
    settings.tsx        # 설정: 개인정보 안내(NFR-3) 열람. (익명이라 로그아웃·계정 섹션 없음.) __DEV__ 전용: 세션 리셋 · 이메일 로그인 왕복
    category/[id].tsx   # 카테고리(폴더)별 아이템 목록(3열 그리드, 최신순). id='uncategorized'=미분류. 삭제된 카테고리 진입 시 홈으로 리다이렉트
    tag/[name].tsx      # 태그별 모아보기(FR-15a): 그 태그가 달린 아이템만(카테고리 무관, 3열 그리드, 최신순)
    item/[id]/index.tsx # 상세 뷰어(세로 풀스크린 모달): 큰 이미지 탭 → 풀스크린 뷰어(원본 비율·핀치 줌) + 하단 액션바(정보(i)·링크·편집·삭제) + 카테고리 이동
    item/[id]/info.tsx  # 정보(i) 하프시트(M7, expo-router formSheet — 네이티브 반시트): 제품명/브랜드/가격/링크·폴더/메모/태그·담은 시각 + 편집 진입
    item/[id]/edit.tsx  # 편집(FR-14): 제품명/브랜드/가격/링크/메모/태그/폴더 + 이미지 교체. OCR·분석 없음. 중복 시 차단·안내. Phase 7: linkPrefill 파라미터(링크붙이기) — 기존 링크 없으면 프리필, 있으면 교체 확인
    +native-intent.ts   # 공유 딥링크 → / (홈이 인텐트 처리)
  components/           # CategoryCard(폴더 모자이크), PhotoTile(그리드 정사각 썸네일), CustomTabBar(플로팅 탭바), TabHeaderLogo(헤더 로고), EmptyState, OverwriteDialog, Thumbnail, FormField(FormCard/FormRow/DisclosureRow/FormBlock), FolderPickerSheet(폴더 선택 반시트 — 키보드 회피·슬라이드업), TagInput, Onboarding/(첫 실행 온보딩 — onboardingStorage[플래그 wishshot.onboardingShown], onboardingTarget[코치마크 대상 등록소·measureInWindow·안전 스킵], CoachmarkSpotlight[react-native-svg 둥근 마스크 스포트라이트·다단계], CardMock[CaptureFlowMock 캡처→편집→공유시트→위시담기폼 연결 흐름 모션 그래픽(레이어 슬라이드업+대상 도형 밝아짐 펄스)], OnboardingOverlay[카드 캐러셀 reanimated 도트 → 카테고리 코치마크 → 등록 폼 open, safe-area 인셋·reduce-motion 대응], RegisterCoachmarkTour[등록 폼 위 코치마크 2스텝 — 등록 화면이 직접 렌더해 네이티브 모달 위에 표시] — Phase 7 Batch D)
  constants/
    theme.ts            # 디자인 토큰 (Phase 5 목업 팔레트 — 흰 배경 모노톤, 이름 유지·값 교체) + colorsDark(준비만) + type/spacing/radius/shadow + overlay
    privacy.ts          # 개인정보 안내 문구 단일 소스(register 최초 고지 + 설정 열람 공유)
  hooks/
    useAnalysis.ts      # 분석 상태머신(useReducer): idle→imageReceived→ocrRunning→parsing→filled→submitted, 실패 시 error. reparse(E-2 재시도)·needsConfirmation 제공
  lib/
    supabase.ts         # createClient<Database> (타입 클라이언트)
    normalize.ts        # normalizeName(brand,productName) — 중복 판정 정규화(단일 소스)
    imageBytes.ts       # uri → ArrayBuffer(File.arrayBuffer) + file:// 정규화
    photoLibrary.ts     # 앨범 접근(Phase 7, expo-media-library/legacy, 순수 JS). getRecentPhotoAsset: 최근 사진 1장의 읽을 수 있는 localUri(ph://→file://)+assetId, 적시 권한. deletePhotoAsset(Batch C): 전체 접근 요청→deleteAssetsAsync([assetId]) (OS 확인창 불가피), 반환 'deleted'|'denied'|'error'. canOfferAlbumDelete: 무프롬프트로 제안 여부 판별(미결정 or 전체 접근이면 true, 제한/거부면 false)
    emptyCategory.ts    # promptDeleteIfCategoryEmpty — 이동·편집·삭제로 카테고리가 0이 되면 삭제/유지 안내(응답 대기 후 반환)
    formatDate.ts / formatPrice.ts
    ocr/                # OcrEngine 인터페이스 + VisionOcrEngine(Apple Vision)·MockOcrEngine + index(환경별 엔진 선택). 화면은 @/lib/ocr만 import
    queries/            # 데이터 레이어: auth(getCurrentUserId·getCurrentUserEmail·signOut), categories, items(updateItem·moveItemCategory·findDuplicateItem), storage, errors(DuplicateItemError·DuplicateCategoryError), analysisLogs, parse (+ index 배럴)
  types/database.ts     # supabase gen types 자동 생성 (직접 수정 금지)
modules/
  expo-vision-ocr/      # 자작 로컬 Expo 네이티브 모듈(iOS/Apple Vision). ko-KR+en-US 인식. 네이티브라 변경 시 EAS 재빌드
supabase/
  config.toml           # supabase init
  migrations/0001_init.sql  # 스키마 + GRANT + RLS + Storage 버킷/정책 (계약 기준선)
  functions/
    parse-screenshot-text/  # Edge Function(Deno): OCR 원문 → Claude Haiku 정제 → {productName,price,brand,confidence}. samples/ 회귀 케이스
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
- `npx eas-cli build --platform ios --profile production` → `npx eas-cli submit --platform ios --profile production --latest` — TestFlight 배포 (사람이 실행, Apple 인증). production 프로필은 channel 없음 = **OTA 미사용**(수정본은 새 빌드로만).
- `npx eas-cli env:create` / `env:push` / `env:list production` — EAS 환경 변수 관리(클라우드 빌드용 `EXPO_PUBLIC_*` 등록).
- `npx supabase login` → `npx supabase gen types typescript --project-id vcvzuiyxcmvrkxscgvwp > src/types/database.ts` — DB 스키마에서 타입 재생성 (마이그레이션 변경 시마다). 로그인은 최초 1회.
- `npx supabase secrets set ANTHROPIC_API_KEY=...` — Edge Function 시크릿 등록(Claude 키). **앱·커밋·채팅엔 절대 넣지 않는다.**
- `npx supabase functions deploy parse-screenshot-text` — Edge Function 배포(정제 프롬프트/로직 변경 시). **앱 재빌드와 무관**(서버 측). Docker 없이도 클라우드 번들로 배포됨(경고는 무시).

## 환경 변수

- `.env`에 `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`. `.env`는 gitignore, `.env.example`만 커밋.
- `EXPO_PUBLIC_` 접두사가 붙은 값은 앱 번들에 포함된다. **anon(공개용) 키만** 넣는다. `.env` 변경 후에는 `npx expo start --clear`로 재시작해야 반영된다.
- **EAS 클라우드 빌드는 로컬 `.env`를 읽지 않는다**(gitignore). `EXPO_PUBLIC_*`를 **EAS 환경(production 등)에 등록**해야 한다(`eas env:create`/`env:push` 또는 대시보드). 미등록이면 빌드는 되지만 앱이 켜지자마자 Supabase 환경 변수 없음으로 실패한다(공개 anon 값이라 EAS 등록은 안전).

## 작업 규칙

1. **Next.js·Express·Vite를 도입하지 않는다.** 서버가 필요해 보이면 Supabase Edge Function 또는 DB 함수로 해결하고, 그것도 애매하면 사람에게 묻는다.
2. **비밀 값은 앱에 넣지 않는다.** 앱에는 Supabase `anon` 키만. `service_role` 키, Claude API 키는 Edge Function 환경 변수에만 존재한다. `.env*`는 커밋 금지, `.env.example`만 커밋.
3. **네이티브 의존성 변경은 재빌드를 의미한다.** 네이티브 모듈(config plugin이 있는 패키지, 예: `expo-share-intent`, `expo-dev-client`, `@react-native-async-storage/async-storage`)을 추가·제거·업그레이드하면 EAS 재빌드가 필요하다. 모아서 추가하고 임의로 늘리지 않는다. JS 전용 패키지는 자유.
4. **모든 사용자 노출 문자열은 한국어 — 간결한 단답형(iOS 기본 앱 톤).** 에러·라벨·플레이스홀더·접근성 라벨 포함. 대화체("~예요/~해요")를 쓰지 않는다.
   - 라벨·버튼·탭·플레이스홀더: **명사 또는 동사 원형의 단답**. 예: "저장", "삭제", "취소", "편집", "카테고리 이동", "다른 사진 선택".
   - 안내·에러: 짧은 서술("~습니다") 또는 명사구. 예: "불러오지 못했어요" → "불러오지 못했습니다"(또는 더 짧게 "불러오기 실패"). 감탄·수다·군더더기 배제.
   - 확인 다이얼로그: 제목은 짧은 질문 가능("삭제할까요?"), 본문은 담백하게("복구할 수 없습니다").
   - ※ Phase 5에서 기존 대화체("~예요/~해요/~어요") 문자열을 이 톤(단답/"~습니다")으로 **정리 완료**(데이터 레이어 `queries/*` 에러 문자열·공유 컴포넌트 포함).
5. **디자인 토큰을 쓴다.** 색상은 `src/constants/theme.ts`의 시맨틱 토큰(`primary`, `accent`, `error`, `textMain`, `textSub`, `textDisabled`, `bgCard`, `silver` 등 — 세이지 그린/테라코타/실버 그레이)만 사용. 컴포넌트에 원시 hex를 직접 쓰지 않는다.
6. **모르면 만들어내지 않는다.** 패키지 버전·Expo SDK 호환·EAS 설정 필드가 불확실하면 공식 문서를 확인하거나 사람에게 묻는다. 아이폰 설치·공유 시트 동작은 에이전트가 검증할 수 없으므로 "확인해달라"고 명시적으로 요청한다.
7. **커밋 메시지는 기존 컨벤션**: `feat:`, `fix:`, `chore:`, `docs:`, `style:`, `refactor:`, `test:` + 한국어 요약.
8. **문서를 현실에 맞춘다.** 구조나 명령어가 바뀌면 이 파일과 `README.md`를 같은 커밋에서 갱신한다.
9. **새 테이블엔 GRANT를 명시한다.** 이 Supabase 프로젝트는 `public` 테이블 권한을 자동 부여하지 않는다. 마이그레이션에 `grant select, insert, update, delete on public.<table> to authenticated;`를 직접 쓴다(RLS는 행 필터일 뿐, 테이블 접근은 GRANT가 먼저 통과해야 함). 로그인 전용 데이터는 `anon`에 부여하지 않는다.
10. **패키지 버전은 임의로 올리지 않는다.** 검증된 현재 버전을 유지한다. `expo`/`expo-router`/`@expo/ui`/`expo-glass-effect`는 정확히 고정하고 `package.json`의 `expo.install.exclude`로 자동 변경을 막았다. `expo-doctor`가 패치 미스매치를 지적해도 임의로 `expo install --fix` 하지 말고, 필요하면 사람에게 묻는다. 새 패키지는 `npx expo install`로 SDK 호환 버전만 추가한다.
11. **데이터는 데이터 레이어(`src/lib/queries`)로만 접근한다.** 화면에서 `supabase.from(...)`을 직접 부르지 않는다. `user_id`는 앱에서 신뢰하지 말고 RLS가 강제하게 한다(INSERT의 `user_id`는 편의로 채울 뿐).

## 데이터 레이어 · Supabase 접근

- **쿼리는 `src/lib/queries/`에 모아둔다.** `categories`(목록/생성/이름변경/삭제), `items`(전체·카테고리별·**태그별 listItemsByTag**/**전체 태그 listAllTags**/단건/생성/**수정 updateItem**/**카테고리 이동 moveItemCategory**/삭제/중복조회), `storage`(업로드/서명URL/배치 서명URL/삭제), `auth`(getCurrentUserId·getCurrentUserEmail·signOut), `errors`(DuplicateItemError·DuplicateCategoryError), `analysisLogs`(분석 로그 기록·item_id 연결 — 실패는 삼켜 저장을 막지 않음), `parse`(parseScreenshotText(text, image?) — Edge Function 호출. 기본은 **텍스트 + 카테고리 이름 목록만** 전송. OCR 텍스트 부족 시 사용자가 고른 **제품 영역 크롭**만 동의 후 함께 전송 — Phase 6). 화면·훅은 `@/lib/queries`에서 가져다 쓴다.
- **편집·이동의 중복 판정.** `updateItem`은 `normalizeName`을 재계산하고, 편집으로 **다른 아이템**과 정규화명이 겹치면 23505 → `DuplicateItemError`로 변환해 화면이 **차단·안내**(덮어쓰기 없음). `moveItemCategory`는 `category_id`만 바꿔(정규화명 불변) 중복 위험이 없다. 카테고리 생성/이름변경 중복은 `DuplicateCategoryError`("동일한 이름의 카테고리가 있어요")로 변환(원본 메시지는 콘솔).
- **빈 카테고리 표시(Phase 4 UX 결정).** 홈은 개수 0인 카테고리도 노출한다(Phase 2의 "빈 카테고리 비노출" 규칙을 뒤집음 — 삭제 여부를 사용자가 인지하도록). 대신 이동·편집·삭제로 카테고리가 0이 되면 `promptDeleteIfCategoryEmpty`로 삭제/유지를 묻는다.
- **OCR/정제는 데이터 레이어·훅 경유.** 화면은 OCR 엔진을 `@/lib/ocr`로, 상태 흐름을 `useAnalysis`(hooks)로만 다룬다. `analysis_logs`는 Phase 2에서 만든 테이블을 **쓰기만** 한다(스키마 변경 없음). `status`는 `ocr_empty`/`parsed`/`parse_failed`/`low_confidence` 4종. `parsed`에는 **AI 원본 정제값**을 남긴다(실제 저장값은 `items` — AI 정확도 평가용 로그이기 때문).
- **RLS가 최종 방어선.** 세 테이블 모두 `user_id = (select auth.uid())`로 SELECT/INSERT/UPDATE/DELETE 강제. `anon`은 권한 없음. 검증 쿼리는 `supabase/tests/rls.sql`.
- **`normalized_name`은 서버 전용 중복 판정 컬럼.** 값 = `normalizeName(brand, product_name)`(NFC·소문자·문자/숫자만). `UNIQUE(user_id, normalized_name)`로 재저장을 하드 차단. 저장·사전조회·수정이 **모두 `src/lib/normalize.ts` 한 곳**을 써야 판정이 일치한다. 화면엔 `product_name`·`brand`만 노출.
- **Storage 규칙.** private 버킷 `item-images`, 키 `{user_id}/{item_id}.jpg`. 렌더는 signed URL(기본 TTL 1시간, `SIGNED_URL_TTL_SEC`)로만. DB엔 객체 키만 저장. 중복 덮어쓰기는 같은 키에 `upsert`.
- **마이그레이션.** 계약은 `supabase/migrations/0001_init.sql`. 적용은 대시보드 SQL Editor에 붙여넣기(또는 `supabase link` 후 `supabase db push`). **스키마를 바꾸면 새 `000N_*.sql`을 추가**하고(기존 파일 재실행 아님), 타입을 재생성한다.
- **타입은 자동 생성.** `src/types/database.ts`는 `supabase gen types`로 만든다. 손으로 고치지 않는다.

## 개발 환경 주의 (Windows, Mac 없음)

- **개발 서버는 `--tunnel` 필수.** 이 PC/네트워크에서 기본 LAN 모드는 아이폰이 접속 실패("Could not connect to the server")한다. `@expo/ngrok`은 devDependency로 설치돼 있다.
- **iOS prebuild는 Windows에서 불가.** `npx expo prebuild --platform ios`는 스킵/실패한다. config plugin 검증은 `npx expo config --type introspect`로 하고, 실제 iOS 네이티브 생성·빌드는 **EAS 클라우드**에서 일어난다.
- iOS 설치·공유 시트 동작 등 실기기 검증은 사람이 한다.
- **EAS `npm ci` peer 충돌 방지**: `react-native-awesome-gallery`(peer `reanimated@^3`) ↔ 설치된 `reanimated@4` 충돌로 EAS 설치(Install dependencies)가 즉시 실패한다. 루트 **`.npmrc`(`legacy-peer-deps=true`)를 커밋**해 로컬·EAS 동일하게 통과시킨다(삭제 금지).
- **iOS 빌드 크레덴셜**: 앱 본체 + `share-extension` 두 타깃 + App Group(`group.com.k0nghaa.wishshot`)의 프로비저닝이 필요하다 — EAS가 Apple 로그인 시 자동 생성. 배포 인증서는 다른 앱과 공유(재사용 권장).

## 참고 (보존된 옛 코드)

- `web-v0` 태그: 옛 웹 코드(Vite SPA + Express + SQLite)의 영구 보존점. 필요하면 `git show web-v0:<path>`로 읽는다. 되살리거나 수정하지 않는다.
- `docs/archive/`: 폐기된 Next.js 계획, 재사용 예정 자산(`migrate-sqlite-to-supabase.ts` — Phase 4, v1 로고/디자인 토큰). **참고용이며 지시가 아니다.**

## 데이터 흐름 (목표)

```
[iOS 공유 시트 (이미지) / 앱 내 사진 선택]
  → Expo 앱 → OcrEngine(Apple Vision, 온디바이스)
       ├ (텍스트 충분) 텍스트만 → Edge Function(Claude Haiku 정제)
       └ (텍스트 부족) 제품 영역 지정 시트 → 선택 영역 크롭만(동의 후) → Edge Function
  → 폼 자동채움("AI가 채움") → supabase-js → Supabase Postgres (RLS) / Storage (private, signed URL, 원본 저장)

[iOS 공유 시트 (URL/웹페이지) — Phase 7]  ※ 스크린샷 원본 URL 자동추출은 불가, 페이지 직접 공유만
  → 홈이 인텐트 분기 → '전체' 탭 링크붙이기 모드
       ├ 기존 위시 탭 → 편집(링크 프리필) → 저장
       └ 새로 담기 → 등록(링크 프리필 + "방금 캡처한 사진" 제안) → 위 등록 흐름
```

Phase 4까지 **전 구간**이 동작한다 — 공유 시트/앱 내 사진 선택 → 온디바이스 OCR → 텍스트(+카테고리 이름)만 Edge Function으로 전송해 정제·**카테고리 추천(FR-8)**(**텍스트 부족 시엔 사용자가 고른 제품 영역 크롭만 동의 후 전송 — Phase 6**) → 폼 자동채움·추천 미리선택(확인·수정 가능) → supabase-js → Postgres(RLS)/Storage(private, signed URL). OCR 없음/정제 실패/저신뢰는 수동 입력으로 폴백(NFR-2). 저장 후에는 **편집·카테고리 이동**, **하단 탭바(전체/폴더/검색)** 이동, **상세 풀스크린 뷰어·정보(i) 하프시트** 열람이 가능하고, **로그인 벽 없이 익명 세션**으로 바로 쓴다(설정=개인정보 열람). **기존 v1 데이터 이관은 범위에서 제외**(archive 보존만). Phase 5는 리스킨·탭바·정보 시트·익명 로그인 모두 **JS/설정 변경**이라 새 네이티브 모듈 없음(브랜딩 아이콘/스플래시 반영 + TestFlight 빌드만 EAS).
