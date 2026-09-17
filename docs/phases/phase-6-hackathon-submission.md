# Phase 6 — 해커톤 제출 요건 + 제품 영역 지정(이미지 폴백) + 검색

> **이 문서 사용법**: Claude Code에 이 파일 전체를 컨텍스트로 넘기고 "Step N을 진행해달라"고 요청한다. Step은 순서대로 진행하고, 각 Step의 **DoD**를 사람이 확인한 뒤 다음으로 넘어간다. 참가 신청·TestFlight 베타 심사·실기기 iCloud 재현·영상 촬영·제출 폼은 에이전트가 할 수 없으므로 사람이 직접 한다.
>
> **마감 (원티드 AI Championship 2026)**: 참가 신청 **9/18(금)** · 프로젝트 제출 **9/20(일)** · 예선 심사·온라인 투표 **9/21~10/5**(이 기간 내 **서비스 링크가 정상 작동**해야 하며, 미작동 시 평가 제외 가능). 오늘 9/17(목) 기준 **제출까지 3일**. 예선 = 내부 심사 80% + 온라인 투표 20%, 기준 = 기획력·실현 가능성·확장성·**AI 활용의 적절성**.
>
> ⚠️ **이 Phase의 성격**: 기능 Phase가 아니라 **"3일 안에 제출 가능한 상태 만들기" Phase**다. Step 순서 = 우선순위. **Step 0~3이 끝나기 전에 Step 4 이후를 시작하지 않는다.** 시간이 모자라면 Step 7(검색)부터 버린다. Phase 5에서 "Phase 6"로 넘긴 목록(찜·New·필름스트립·공유·다크 모드 등)은 **대부분 Phase 7로 재이관**한다(아래 "하지 않는 것").

---

## 목표 (Goal)

Phase 5까지 리스킨·탭바·익명 로그인·내부 TestFlight가 끝났다. Phase 6는 (1) **심사위원이 실제로 열 수 있는 서비스 링크**(외부 TestFlight 공개 링크 + 랜딩 페이지 + 데모 영상)를 만들고, (2) **첫 사용에서 실패하는 버그**(iCloud 저장 공간 최적화 업로드 실패, 등록 폼 키보드 가림)를 고치고, (3) AI 파이프라인에 **텍스트가 부족한 스크린샷을 위한 "제품 영역 지정" 이미지 폴백**을 얹고, (4) 여유가 있으면 **검색**을 붙인다.

**이 Phase의 핵심 검증**: (1) 아이폰만 있는 심사위원이 랜딩 링크 → TestFlight 공개 링크로 설치·익명 즉시 사용. (2) iCloud "저장 공간 최적화" ON + 기기에 원본 없는 사진을 담아도 업로드 성공. (3) 등록 폼 하단 필드가 키보드에 가리지 않음. (4) OCR 텍스트가 거의 없는 스크린샷 → "제품 영역 지정" 시트 → **사용자가 고른 사각 영역만** Edge Function → Claude로 전송 → 제품명·브랜드 자동채움. (5) 개인정보처리방침·인앱 고지·README가 (4)와 **정확히 일치**. (6) 9/20 이전 제출 완료.

## 포함되는 변경 (주의 지점)

- **새 네이티브 모듈 1개(+조건부 1개) → dev client 재빌드 1회**: `expo-image-manipulator`(크롭·리사이즈). iCloud 버그가 picker 옵션만으로 안 잡히면 `expo-media-library`도 **같은 재빌드에 묶는다**(Phase 5 제약 1 "모아서 추가"). 재빌드는 Step 3 **딱 한 번**, 이후 최종 TestFlight 빌드 1회.
- **Edge Function 계약 확장(하위호환)**: `parse-screenshot-text` 입력에 `image?` 필드 추가. 기존 텍스트 전용 호출은 그대로 동작.
- **NFR-3 문구 개정**: "이미지는 AI에 전송되지 않는다" → "이미지는 비공개 저장소까지만 간다. AI에는 텍스트만 전송한다. **단, 텍스트를 찾지 못한 경우 사용자가 직접 선택한 제품 영역만 동의 후 전송**한다." 방침·인앱 고지·README·CLAUDE.md 4곳을 **한 커밋**에서 맞춘다.

## 이 Phase에서 하지 않는 것 (→ Phase 7)

- **찜(하트) · New 점 · 탭바 New 배지 · 전체 탭 찜 필터 칩** — DB 마이그레이션 필요, AI와 무관, 심사 가점 없음.
- **OCR 텍스트 탭-투-필 오버레이** — `ExpoVisionOcrModule.swift`가 바운딩 박스를 반환하지 않아 Swift 수정 + 좌표계 매핑 + 재빌드가 필요. 본선용.
- **피사체 분리(누끼, VisionKit subject lifting)** — 새 Swift 모듈 필요. **이번엔 사각 크롭으로 같은 메시지("선택한 부분만 전송")를 낸다.** 랜딩·발표에서 "다음 단계: iOS 피사체 분리로 확장"으로 언급.
- **Google Cloud Vision API / Vertex AI / Gemini 도입** — 기존 Claude Haiku가 이미지 입력을 지원하므로 새 수탁자·새 시크릿·방침 추가 없이 해결. 검토 결과는 결과 기록에 한 줄.
- 빠른 담기 팝업 · 필름스트립 · 상세 공유 · 출처 앱 표시 · 다크 모드 실적용 · 이메일 가입/승격 · Step 7(Phase 5) 새로고침·스켈레톤 · 이미지 자르기(저장용) · Android.
- **앱 아이콘 개선(저대비·획 잘림)** — 여유 시 stretch(Step 8 빌드 전 30분 이내에 끝나면 포함, 아니면 Phase 7).

---

## 사전 조건 (사람이 준비)

- [x] Phase 5 완료·`dev` 머지(`1.0.0 (4)` TestFlight 처리 완료).
- [ ] **원티드 AI Championship 2026 참가 신청 완료(9/18까지)** — Step 0.
- [ ] **ASC → TestFlight → 외부 테스트 그룹 생성 + 공개 링크 활성 + 베타 앱 심사 제출** (개인정보처리방침 URL = `docs/legal/privacy.html` Notion 게시본) — Step 0. **첫 빌드 심사는 1~2일 걸릴 수 있어 오늘 반드시 제출.**
- [ ] iCloud 재현 환경: 테스트 아이폰에 **설정 → 사진 → "iPhone 저장 공간 최적화" ON** + 기기에 원본이 없는(클라우드 아이콘 뜨는) 사진 1장 이상.
- [ ] Supabase Edge Function 시크릿 `ANTHROPIC_API_KEY` 유효, 로컬 `supabase functions serve` 가능.
- [ ] 랜딩 페이지 자리(Notion 페이지 권장 — 방침과 같은 워크스페이스) + 화면 녹화 가능한 아이폰.

---

## 제약 (Constraints) — 에이전트가 지킬 것

Phase 1~5 규칙(한국어·단답형 카피, 디자인 토큰, 비밀값 커밋 금지, 커밋 컨벤션, 문서 동기화, 데이터 레이어 경유, 모르면 묻기, 버전 임의 인상 금지, 네이티브 모듈은 트레이드오프 제시 후 승인·모아서 추가)을 승계하고 다음을 추가한다.

1. **사진 전체를 LLM에 보내지 않는다.** Edge Function으로 가는 이미지는 **사용자가 명시적으로 선택한 사각 영역의 크롭본**만. 트리거는 OCR 결과 부족일 때만, 시트에는 **"선택한 영역만 AI 분석에 전송됩니다"** 문구와 **취소(수동 입력)** 가 항상 있다. 자동 전송·백그라운드 전송 금지.
2. **Edge Function은 하위호환.** `image` 없는 요청은 Phase 5와 바이트 단위로 같은 동작. 스키마(`OUTPUT_SCHEMA`)·출력 계약 불변. 크롭 이미지는 서버에서 **로그·저장하지 않는다**(Anthropic 요청에만 사용).
3. **DB 스키마 변경 없음.** 이미지 폴백 사용 여부는 기존 `items.parsed`(jsonb)에 `source: 'image_region'` 같은 키로만 남긴다. 검색은 클라이언트 필터(서버 쿼리·인덱스 추가 없음).
4. **재빌드는 Step 3에서 1회, 최종 TestFlight 1회.** 그 밖의 네이티브 모듈 추가 금지. 크롭 UI는 이미 설치된 gesture-handler + reanimated로 만든다(재빌드 0).
5. **개인정보 문구는 단일 소스.** 인앱 문구는 `src/constants/privacy.ts` 한 곳, 웹 문구는 `docs/legal/privacy.html`. 두 곳과 README·CLAUDE.md의 NFR-3 문구가 **같은 사실**을 말하는지 Step 6에서 대조한다. "이미지는 기기를 떠나지 않습니다"류 **과장 문구 잔재 금지**(grep).
6. **모든 실패는 수동 입력으로 떨어진다.** 크롭 실패·이미지 파싱 실패·타임아웃 모두 기존 E-2/E-3 경로(원문·재시도·수동)로. 새 에러 상태를 만들어 사용자를 막지 않는다.
7. **제출 리스크 우선.** 어떤 Step에서든 Step 0·8(심사·빌드·제출)에 영향이 생기면 그 Step을 중단하고 보고한다. 9/19 저녁 이후 코드 변경은 **버그 수정만**.

---

## Step 0 — 참가 신청 + 외부 TestFlight 베타 심사 제출  ⭐ (사람 — 오늘 9/17 즉시)

**작업**
1. 원티드 AI Championship 2026 참가 신청(9/18 마감).
2. ASC → TestFlight → **외부 테스트 그룹**(예: "심사위원") 생성 → 현재 빌드 `1.0.0 (4)` 추가 → **공개 링크 활성**(사용자 수 제한 넉넉히) → 테스트 정보(설명·피드백 이메일·**개인정보처리방침 URL**) 입력 → **베타 앱 심사 제출**.
3. 심사 통과 전이라도 링크 URL은 확보해 랜딩 초안에 넣는다.

**주의**: 외부 그룹 **첫 빌드**는 정식 베타 심사(보통 1~2일). Step 8의 최종 빌드는 같은 그룹에 추가 시 재심사가 짧거나 생략되는 경우가 많지만 보장은 없다 → **9/19 저녁까지 최종 빌드를 그룹에 올린다.** 심사가 9/20까지 안 끝날 경우 대비: 랜딩에 `1.0.0 (4)` 공개 링크 + 영상으로 제출하고 최종 빌드는 심사 기간 중 교체.

**DoD**
- [ ] 참가 신청 완료 · 외부 그룹 베타 심사 "제출됨" · 공개 링크 URL 확보

## Step 1 — iCloud "저장 공간 최적화" 업로드 실패 수정 (`register.tsx` · `useAnalysis` · `imageBytes.ts` · picker 호출부)  ⭐ P0

**작업**
1. **재현·계측**: 저장 공간 최적화 ON + 원본 없는 사진 담기. picker 결과 `uri` 스킴·`fileSize`·`File(uri).exists/size`·에러 메시지를 `__DEV__` 로그로 확인. 실패 지점이 (a) picker가 다운로드 전 반환, (b) `File.arrayBuffer()` 읽기 실패, (c) OCR 모듈 로드 실패 중 어디인지 특정.
2. **1차(재빌드 0)**: `expo-image-picker` 옵션 점검(`exif:false`, `quality:1`, `legacy` 여부 등) + `readImageBytes`에 **존재/크기 확인 → 짧은 간격 재시도(예: 500ms × 최대 6회)** + 실패 시 **명확한 안내("사진을 아직 내려받지 못했습니다. 잠시 후 다시 시도")와 재시도 버튼**. OCR·업로드 모두 같은 바이트 경로를 타게 정리.
3. **2차(1차로 안 잡힐 때만, Step 3 재빌드에 포함)**: `expo-media-library` `getAssetInfoAsync({shouldDownloadFromNetwork:true})`로 `localUri` 확보 후 진행. 트레이드오프(권한 프롬프트 추가·재빌드) 제시 후 승인.
4. 공유 익스텐션 경로(스킴 없는 절대경로)도 동일 재시도 적용.

**DoD**
- [ ] 저장 공간 최적화 ON + 원본 없는 사진 담기 → OCR·업로드·저장 성공(실기기). 캐시된 사진·OFF 상태 회귀 없음. 실패 시 재시도 안내 노출

## Step 2 — 등록/편집 폼 키보드 가림 등 사소 UX (`register.tsx` · `edit` · `FormField`)

**작업**
- `KeyboardAvoidingView`(현재 `behavior:'padding'`)가 헤더 높이를 모른다 → `keyboardVerticalOffset`에 헤더 높이 반영 **또는** `ScrollView`에 `automaticallyAdjustKeyboardInsets`(iOS) + `keyboardDismissMode="interactive"` 로 교체. 포커스된 필드가 키보드 위로 스크롤되는지 하단 3개 필드(메모·태그·링크)에서 확인. 편집 화면도 동일.
- 그 외 데모 중 눈에 띄는 1분짜리 수정(오탈자·정렬)만. 구조 변경 금지.

**DoD**
- [ ] 등록·편집에서 최하단 필드 탭 → 키보드에 가리지 않고 입력·확인 가능

## Step 3 — 네이티브 모듈 추가 + dev client 재빌드 1회 (`expo-image-manipulator` [+ `expo-media-library`])

**작업**
1. `npx expo install expo-image-manipulator` (+ Step 1-3 필요 시 `expo-media-library`, `app.json` 권한 문구 한국어).
2. `npx eas-cli build --platform ios --profile development` → 설치. 이후 Phase 6 내 네이티브 추가 금지.
3. 재빌드 대기 중 Step 4(Edge Function)를 진행한다.

**DoD**
- [ ] 새 dev client 설치, 기존 기능(OCR·업로드·탭바·시트) 회귀 없음

## Step 4 — Edge Function 이미지 분기 (`supabase/functions/parse-screenshot-text/index.ts`)

**작업**
1. 입력 계약 확장(주석 갱신):
   `{ text: string, categories?: string[], image?: { base64: string, mediaType: 'image/jpeg' | 'image/png' } }`
2. 검증: `image.base64` 길이 상한(예: 2MB) 초과 → `400 image_too_large`. `mediaType` 화이트리스트.
3. `image` 있으면 user 메시지 content를 `[ {type:'image', source:{type:'base64', media_type, data}}, {type:'text', text: "OCR text (may be empty): ..."} ]` 블록으로 구성. 없으면 기존 텍스트 메시지 그대로(바이트 동일).
4. `SYSTEM_PROMPT`에 이미지 있을 때 지침 추가: 사용자가 잘라낸 제품 영역이다 → 피사체·패키지·로고로 productName/brand 추정, 가격은 **보이지 않으면 null**(추측 금지), 확신 낮으면 confidence 낮게. 출력 스키마 불변(`MODEL='claude-haiku-4-5'` 유지 — 이미지 입력 지원).
5. 이미지 데이터는 로그에 남기지 않는다(길이만). `LLM_TIMEOUT_MS`는 이미지 시 25s로 상향 검토.
6. `supabase functions serve`로 (a) 텍스트만 (b) 이미지+빈 텍스트 (c) 초과 크기 3케이스 curl 검증 후 `supabase functions deploy`.

**DoD**
- [ ] 텍스트 전용 호출 응답 Phase 5와 동일 · 크롭 JPEG 호출 시 productName/brand 반환 · 크기 초과 400 · 배포 완료

## Step 5 — "제품 영역 지정" 시트 + 이미지 폴백 흐름 (`useAnalysis` · `queries/parse.ts` · 신규 `RegionSelectSheet` · `register.tsx`)  ⭐ AI

**작업**
1. **트리거**: OCR 완료 후 `rawText.trim().length < 20`(상수 `OCR_MIN_CHARS`, 미결) → 텍스트 파싱을 **건너뛰고** `regionSelect` 단계로. `useAnalysis` 상태에 `regionSelect` · `imageParsing` 추가(`idle → imageReceived → ocrRunning → (parsing | regionSelect → imageParsing) → filled`). 사용자가 시트를 취소하면 기존 `ocr_empty` 경로(수동 입력).
2. **`RegionSelectSheet`**(expo-router `formSheet` 또는 풀스크린 모달): 원본 비율 이미지 + **드래그로 그리는 사각 선택 영역**(gesture-handler `Pan` + reanimated, 최소 크기·이미지 경계 클램프, 모서리 핸들은 선택). 상단 안내 **"제품 영역 지정"**, 하단 고정 문구 **"선택한 영역만 AI 분석에 전송됩니다"**, 버튼 **"분석" / "취소"**. 카피는 단답형(규칙 4).
3. **크롭·전송**: 화면 좌표 → 이미지 픽셀 좌표 변환 후 `expo-image-manipulator`로 `crop` → 긴 변 ≤ 1024 `resize` → JPEG 0.8 → base64. `parseScreenshotText({ text: rawText, categories, image })` 호출(`queries/parse.ts` 시그니처 확장, 타입 동기화). 원본 업로드 파이프라인은 **그대로 원본**(저장용 크롭 아님).
4. 결과는 기존 `filled`로 합류("AI가 채움" 표시 동일). `parsed`에 `source:'image_region'` 기록. 실패·타임아웃은 E-2(재시도 = 시트 재열기) / E-3.
5. 시트 첫 노출 시 1회 인라인 고지(기존 첫 업로드 고지와 같은 AsyncStorage 패턴): 텍스트를 찾지 못했을 때만 선택 영역이 전송된다는 설명.

**DoD**
- [ ] 텍스트 없는 제품 사진(예: 신발 단독 촬영) 담기 → 시트 → 영역 지정 → 제품명·브랜드 자동채움 → 저장. 텍스트 충분한 스크린샷은 시트 없이 기존 흐름. 취소 시 수동 입력. 네트워크에 전송된 페이로드에 크롭 영역 외 픽셀 없음(로컬 서버 로그로 크기·치수 확인)

## Step 6 — 개인정보 문서·고지·README 정합 (NFR-3 개정)

**작업**
- `docs/legal/privacy.html` §2·§3(현재 "이미지는 전송되지 않습니다") → "AI 정제에는 인식된 텍스트만 전송됩니다. **텍스트를 찾지 못한 경우, 사용자가 직접 선택한 제품 영역 이미지만 확인 후 전송**되며 원본 전체·그 외 부분은 전송되지 않습니다. 전송된 영역 이미지는 정제 목적으로만 사용되며 저장하지 않습니다." Anthropic 항목 동일 취지로. Notion 게시본 동기화.
- `src/constants/privacy.ts` 첫 업로드 고지 문구 개정(단답형). 설정 화면 열람 반영.
- `README.md` "이미지는 기기를 떠나지 않습니다(NFR-3)" → 실제(비공개 저장소 + 텍스트 전송 + 선택 영역 예외)로. `CLAUDE.md` OCR/NFR-3 설명·Edge Function 계약 갱신. `docs/phases/phase-3` 38행은 이력이라 유지, 각주로 Phase 6 개정 표기.
- grep으로 "기기를 떠나지" "이미지는 전송되지" 잔재 0 확인.

**DoD**
- [ ] 방침 HTML·Notion·인앱 고지·README·CLAUDE.md가 같은 사실 진술. 과장 문구 잔재 없음

## Step 7 — (여유 시) 검색 (`src/app/(tabs)/search.tsx`)

**작업**: 플레이스홀더 → 상단 `TextInput`(자동 포커스, 지우기) + 기존 items 쿼리 재사용 클라이언트 필터(제품명·브랜드·태그·메모, 대소문자·공백 무시, 300ms 디바운스) → `PhotoTile` 3열 그리드 → 상세 진입. 빈 상태 `EmptyState` 2종(입력 전 / 결과 없음). 서버 쿼리·인덱스 없음. **9/19 오후까지 시작 못 하면 Phase 7.**

**DoD**
- [ ] (선택) 검색어 입력 → 결과 그리드 → 상세. 빈 상태 표시

## Step 8 — 최종 빌드·제출 + 랜딩 페이지 + 데모 영상  ⭐ (사람 — 9/19 저녁 빌드, 9/20 제출)

**작업**
1. **9/19 저녁**: `eas build --profile production` → `eas submit` → 외부 그룹에 추가(빌드 번호 인상은 EAS 자동 증가만). 이후 코드 변경은 버그 수정만.
2. **데모 영상 1~2분**(아이폰 화면 녹화, 무음 또는 자막): 쇼핑 스크린샷 공유 → OCR 자동채움 → 저장 → 텍스트 없는 제품 사진 → **제품 영역 지정 → AI 채움** → 폴더/전체/상세·정보 시트. 마지막 5초에 "선택한 영역만 전송" 문구 클로즈업.
3. **랜딩 페이지(Notion 1장)**: 제목·한 줄 소개 / **TestFlight 공개 링크**(+ "iPhone에서 TestFlight 앱 설치 후 열기" 안내) / 영상 / 해결하는 문제 / **AI 활용 방식 다이어그램**: 온디바이스 OCR(Apple Vision) → Edge Function → Claude Haiku 정제(제품명·가격·브랜드·카테고리 추천) → **텍스트 부족 시 선택 영역 이미지 분석**, 프라이버시 설계(이미지는 비공개 저장소까지, AI에는 텍스트/선택 영역만) / 사용 도구(Claude Haiku·Claude Code·Expo·Supabase) / 다음 단계(피사체 분리·검색·찜) / 개인정보처리방침 링크 / GitHub.
4. **9/20 제출 폼**: 서비스 링크 = 랜딩 URL. 문제·AI 활용·도구 항목은 랜딩 문안 재사용.

**주의**: 온라인 투표자·안드로이드 심사위원은 앱을 못 연다 → **영상과 다이어그램이 실질 제출물**. 심사 기간(~10/5) 중 TestFlight 빌드 만료(90일)·Supabase 프로젝트 일시정지(무료 티어 7일 비활성) 여부 점검 — 주 1회 앱 실행으로 유지.

**DoD**
- [ ] 최종 빌드 외부 그룹 반영 · 영상 · 랜딩 공개 · 제출 완료(9/20) · 심사 기간 링크 작동 점검 계획

## Step 9 — 문서 갱신

**작업**: `CLAUDE.md`(상태 머신·Edge Function 계약·네이티브 모듈 목록·NFR-3)·`README.md` 갱신 + 이 문서 "결과 기록". 커밋 `fix: iCloud 최적화 사진 업로드 + 폼 키보드` / `feat: Edge Function 이미지 분기(선택 영역)` / `feat: 제품 영역 지정 시트 + 이미지 폴백` / `docs: NFR-3 개정(선택 영역 전송)` / `feat: 검색` / `docs: Phase 6 완료`, `dev`로 PR.

**DoD**
- [ ] 문서 동기화 + PR

---

## 일정 (권장)

| 날짜 | Step | 비고 |
|---|---|---|
| 9/17(목) | 0 → 1 → 2 → 3(저녁 재빌드) | **참가 신청·베타 심사 제출은 오전에** |
| 9/18(금) | 4 → 5 | 참가 신청 마감일 |
| 9/19(토) | 5 마무리 → 6 → (7) → **저녁 production 빌드·submit** | 이후 버그 수정만 |
| 9/20(일) | 8(영상·랜딩·제출) → 9 | 제출 마감일 |

## 미결 사항 (구현 중 결정)

- `OCR_MIN_CHARS` 임계값(20자 가정) — 실기기 샘플 10장으로 조정. 텍스트가 있어도 productName null·confidence 낮으면 시트를 **제안**할지(이번엔 미포함 권장).
- 크롭 UI: 자유 드래그 사각 vs 기본 중앙 박스 + 핸들 조절. 후자가 구현 단순·오조작 적음.
- 이미지 폴백 시 `suggestedCategory`도 요청할지(categories 그대로 전달, 프롬프트 동일 → 요청 권장).
- iCloud 1차 수정으로 충분한지(2차 `expo-media-library` 필요 여부) — Step 1 계측 후 Step 3 전에 결정.
- 랜딩 호스팅: Notion(빠름) vs GitHub Pages(`docs/`에 HTML, 방침과 동거).

## 이 문서에서 확정한 결정

- 범위 = **제출 요건(외부 TestFlight·랜딩·영상) + P0 버그 2건 + 제품 영역 지정 이미지 폴백 + (여유 시) 검색**. 찜·New·오버레이·누끼·다크 모드 등은 **Phase 7**.
- 이미지 폴백 = **사용자가 선택한 사각 영역만**, OCR 부족 시에만, 명시 동의·취소 가능. 통이미지 전송·자동 전송 없음. 누끼(VisionKit)는 Phase 7.
- LLM = **Claude Haiku 4.5 유지**(이미지 입력 지원). Google Cloud Vision API(태그·OCR만 반환, 온디바이스 OCR과 중복)·Vertex AI(엔터프라이즈 플랫폼, 설정 비용)·Gemini API(같은 능력, 수탁자·시크릿 추가만 발생)는 **도입하지 않음**.
- 네이티브 추가 = `expo-image-manipulator`(+조건부 `expo-media-library`) **Step 3 한 번**. 크롭 UI는 gesture-handler+reanimated.
- Edge Function = **하위호환 확장**, 스키마 불변, 크롭 이미지 미저장·미로깅.
- NFR-3 문구는 4곳(방침 HTML·Notion·`privacy.ts`·README/CLAUDE.md) 동시 개정, 과장 문구 제거.
- 검색 = 클라이언트 필터, **9/19 오후 시작 못 하면 드롭**.
- 9/19 저녁 이후 코드 변경 = 버그 수정만. 제출 링크 = 랜딩 페이지(TestFlight 링크·영상·다이어그램 포함).

## 결과 기록

- **완료일**:
- **참가 신청 / 외부 TestFlight 베타 심사 결과(제출일·통과일·공개 링크)**:
- **iCloud 업로드 실패 원인(계측 결과)과 적용한 수정(1차/2차)**:
- **키보드 가림 수정 방식**:
- **재빌드 1회에 포함된 네이티브 모듈**:
- **Edge Function 이미지 분기 결과(계약·크기 상한·프롬프트·타임아웃·배포)**:
- **제품 영역 지정 시트 구현 결과(트리거 임계값·크롭 UI 방식·상태 머신 변경·페이로드 크기)**:
- **NFR-3 개정 최종 문구(4곳)**:
- **검색 구현 여부·범위**:
- **최종 빌드 번호 / 영상 / 랜딩 URL / 제출 완료 시각**:
- **발생한 이슈와 해결**:
- **다음(Phase 7)으로 넘길 것**: 찜·New·배지 · OCR 탭-투-필 오버레이(bbox 모듈) · 피사체 분리(VisionKit) · 빠른 담기 · 필름스트립 · 공유 · 출처 앱 · 다크 모드 · 이메일 승격 · 새로고침·스켈레톤 · 아이콘 개선 · (미구현 시) 검색
