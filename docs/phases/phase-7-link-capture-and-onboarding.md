# Phase 7 — URL 링크 저장 · 앨범 원본 정리 · 온보딩 · 전체 탭 다중 선택

> **이 문서 사용법**: Claude Code에 이 파일 전체를 컨텍스트로 넘기고 "**Batch X를 진행해달라**"고 요청한다. Batch는 **A → (재빌드) → B/C/D** 순으로 나뉜다. 각 Batch는 독립 세션에서 진행하는 것을 전제로, 대상 파일·작업·DoD를 자족적으로 적었다. 아이폰 설치·공유 시트·사진 권한/삭제·PHAsset 동작은 **에이전트가 검증할 수 없으므로 사람이 실기기(dev client)로 확인**한다.
>
> **여러 세션 운용 규칙(한 문서 공유)**: 이 한 파일을 모든 Batch 세션이 공유한다. 각 세션은 **자기 Batch 섹션만** 구현하고, 다른 Batch의 작업 지시는 건드리지 않는다. **D는 B/C와 병렬 가능**(대개 별 브랜치/워크트리), **B와 C는 순차**(`register.tsx`·`src/lib/photoLibrary.ts` 공유 — B 완료 후 C가 그 위에 얹음). 병합 충돌을 피하려고, 각 세션은 완료 시 **자기 Batch의 "결과 기록" 항목만** 수정·커밋한다(제약·확정 결정 등 공용 섹션은 임의로 바꾸지 않음 — 바꿔야 하면 사람에게 확인). 세션 시작 시 `git status --short --branch`로 브랜치/워크트리를 먼저 확인한다.
>
> **브랜치 이름(내용 기반)**: `feat/phase-7-multiselect-and-native-prep`(A) · `feat/phase-7-url-link-capture`(B) · `feat/phase-7-album-photo-delete`(C) · `feat/phase-7-onboarding`(D). 각 Batch는 별 브랜치 + 별 PR로 `dev`에 머지.
>
> **빌드는 A 이후 1회뿐 — 이유(반드시 이해)**: dev client는 **네이티브 모듈·네이티브 설정만 빌드 시점에 구워지고, JS는 이후 Metro로 교체**된다. B/C/D가 필요로 하는 네이티브는 **전부 A-3에 포함**되고(expo-media-library·react-native-svg·공유확장 URL 규칙·사진 권한 문구), **B/C/D는 새 네이티브 모듈을 추가하지 않는다(순수 JS)**. 따라서 **A에서 네이티브를 모두 설치·설정 → 1회 빌드 → 그 dev client로 B/C/D의 JS를 실행**하면 재빌드가 필요 없다. 만약 B/C/D 세션이 새 네이티브(모듈/네이티브 config)가 필요하다고 판단하면 **즉시 멈추고 사람에게 보고**한다(그 경우에만 A를 고쳐 재빌드 — 이 Phase의 "1회 빌드" 원칙을 깨는 것이므로 임의 진행 금지).
>
> **근거 원칙(중요)**: 이 문서의 iOS/Expo 관련 판단은 공식 문서로 검증한 사실에 기반한다(각 Batch에 출처 URL 명시). 구현 중 불확실한 API·동작이 나오면 **추측하지 말고** 공식 문서를 확인하거나 사람에게 묻는다(CLAUDE.md 규칙 6). "된다/안 된다"를 지어내지 않는다.
>
> 관련 문서: `CLAUDE.md`(현행 구조·규칙), `docs/phases/phase-6-hackathon-submission.md`(직전 상태), `docs/design/`(디자인 토큰·명세).

---

## 목표 (Goal)

Phase 6까지 공유 시트/앱 내 선택 → 온디바이스 OCR → AI 정제 → 저장 → 편집·이동·탭바·상세 뷰어까지 완성됐다. Phase 7은 사용성을 넓히는 4개 기능을 **재빌드 1회**로 묶어 추가한다.

1. **기능 1 — URL 공유로 링크 저장**: Safari/앱에서 **페이지(URL)를 WishShot으로 공유**하면, '전체' 탭이 "링크 붙이기 모드"로 열려 **기존 위시(스크린샷)에 링크를 달거나**, "새로 담기"로 **새 위시(링크 프리필 + '방금 캡처한 사진' 제안)** 를 만든다.
2. **기능 2 — 앨범 원본 정리**: 앱 내에서 **직접 고른** 사진에 한해, 저장 후 **원본 스크린샷을 iOS 사진 앨범에서 삭제**하는 옵션. (공유 시트로 받은 사진은 원본 참조가 없어 불가.)
3. **온보딩**: 첫 설치 시 앱 사용법 안내(카드 + 코치마크 스포트라이트).
4. **전체 탭 다중 선택**: '전체' 탭에서 여러 위시를 선택해 **폴더 이동/일괄 삭제**(앨범 앱 톤).

**핵심 검증**: (1) Safari에서 URL 공유 → '전체' 탭 링크붙이기 모드 진입, 기존 위시에 링크 달기/새로 담기 동작. (2) 앱 내 선택 사진 저장 후 앨범 삭제 옵션(전체 접근 권한 요청 → OS 확인창 → 삭제). (3) 첫 실행 온보딩 1회 노출. (4) 전체 탭 다중 선택 → 폴더 이동/일괄 삭제. (5) 사진 고르기 시 불필요한 권한창이 더 이상 뜨지 않음.

---

## 포함되지 않는 것 (범위 밖)

- **스크린샷 캡처 순간의 원본 URL 자동 추출** — iOS 스크린샷 메타데이터에 원본 주소가 없어 **불가능**(공식 확인). URL은 "Safari/앱에서 페이지 직접 공유" 경로로만 들어온다.
- **공유 시트로 받은 사진의 앨범 삭제** — 공유 확장은 원본 PHAsset 참조를 못 받으므로 **불가능**(Apple 문서 확인). 기능 2는 **앱 내 picker 경로 한정**.
- **이미지(사진)로 기존 위시 매칭** — 이 앱은 사진이 아니라 **제품명 정규화**로 중복을 판정한다. 링크 붙이기 모드의 "기존 위시 선택"은 사용자가 그리드에서 **직접 고르는** 것이지 자동 매칭이 아니다.
- **무음 자동 앨범 삭제** — iOS가 삭제 시 시스템 확인창을 강제하므로 불가. 최선은 "옵션 탭 → OS 확인 → 삭제".
- **제한된 사진 접근으로 삭제** — 제한 접근이면 `assetId`가 null이라 삭제 대상 특정 불가. 삭제는 **전체 접근**만 가능(앨범 단위 권한은 iOS에 없음).

---

## 사전 조건 (사람이 준비/확인)

- [ ] Phase 6 완료·머지, `dev` 최신.
- [ ] Batch A의 네이티브 변경 후 **EAS dev 빌드 1회**(사람, Apple 인증). B/C/D는 이 빌드 위에서 JS만 얹어 검증.
- [ ] 실기기 iPhone(dev client) — 공유 시트·사진 권한·삭제·PHAsset는 시뮬레이터로 검증 불가.

---

## 제약 (Constraints) — 에이전트가 지킬 것

Phase 1~6 규칙을 그대로 승계한다: **한국어 간결 단답형 카피**(라벨=명사/동사 단답, 안내·에러="~습니다"/명사구, 대화체 금지), **디자인 토큰만 사용**(원시 hex 금지), **비밀값 커밋 금지**, **데이터는 `src/lib/queries` 경유**(화면에서 `supabase.from` 직접 호출 금지), **커밋 컨벤션**(`feat:`/`fix:`/…+한국어), **문서 동기화**(구조·명령 바뀌면 `CLAUDE.md`·`README.md` 같은 커밋), **버전 임의 인상 금지**(`npx expo install`로 SDK 호환 버전만), **모르면 만들지 말고 공식 문서 확인/질문**. 추가로:

1. **네이티브 모듈은 Batch A에서만 추가하고 한 번에 재빌드한다.** B/C/D에서 새 네이티브 모듈을 추가하지 않는다(추가가 필요하면 멈추고 사람에게 보고). 재빌드는 이 Phase 전체에서 **1회뿐**.
2. **사진 권한은 최소·적시 요청**(HIG). 사진 **고르기**엔 권한을 요청하지 않는다(PHPicker는 권한 불필요). **삭제**를 실제로 시도할 때만 전체 접근을 요청한다. **최근 사진 읽기(제안)** 는 그 기능을 처음 쓸 때만 읽기 권한을 요청한다.
3. **이미지 원본은 온전.** picker `quality:1`·크롭 없음. 앨범 삭제는 사용자가 명시적으로 선택했을 때만.
4. **데이터·RLS·정규화·Storage 스키마 불변.** 이번 기능들은 스키마 변경이 없다(아이템에 assetId를 저장하지 않는다 — 삭제는 picker가 준 assetId를 그 자리에서만 쓴다).
5. **문서를 현실에 맞춘다.** 각 Batch 완료 시 이 문서의 "결과 기록"과 필요한 경우 `CLAUDE.md`·`README.md`를 갱신한다.

---

## 의존·병렬 관계 (반드시 지킬 것)

```
feat/phase-7-multiselect-and-native-prep (A: 즉시개선 + 카테고리 표기 + 다중선택 + 네이티브 준비)
   │  A-1/A-2/A-4(JS)는 현재 dev client로 검증 가능. A-3(네이티브)만 빌드 필요.
   ├─ (PR·머지 → dev)
   ▼
[사람] EAS dev 빌드 1회  ← 네이티브 4종(expo-media-library·react-native-svg·공유확장 URL 규칙·권한 문구)을 앱에 심음.
   │                        이후 B/C/D는 이 빌드 위에서 JS만(Metro) — 재빌드 없음.
   ├─▶ feat/phase-7-url-link-capture     (B: 기능 1)  ┐  B와 C는 register.tsx·photoLibrary.ts 공유
   ├─▶ feat/phase-7-album-photo-delete   (C: 기능 2)  ┘  → 순차(B 머지 후 C). 병렬이면 병합 충돌.
   └─▶ feat/phase-7-onboarding           (D: 온보딩)      ← 대부분 신규 파일, B/C와 병렬 안전
```

- **A는 모든 것의 선행이자 유일한 빌드 지점.** 네이티브 준비(A-3)가 A에 모두 들어가고, **A 머지 후 사람이 dev에서 EAS dev 빌드 1회**. 그 빌드가 B/C/D의 네이티브 표면을 전부 포함한다(위 "빌드는 A 이후 1회뿐" 참고). B/C/D는 순수 JS라 그 빌드로 계속 검증한다.
- **빌드 시점**: A 브랜치에서 A-3까지 완료·검증(`expo config --type introspect`, `expo-doctor`) → PR·머지 → **dev에서 1회 빌드**. (원하면 A 브랜치에서 먼저 빌드해 dev client 동작을 확인한 뒤 머지해도 됨 — 어느 쪽이든 빌드는 1회.)
- **분기 기준**: B·D는 **A 머지된 dev**에서 분기. C는 **B 머지 후 dev**에서 분기(C는 B의 `register.tsx`·`photoLibrary.ts` 위에 얹음; B 미머지면 B 브랜치에서 분기).
- **B와 C는 순차 권장**: 둘 다 `register.tsx`(그리고 신규 `src/lib/photoLibrary.ts`)를 수정한다. B를 먼저 끝내고 C가 그 위에 얹는다. 부득이 병렬이면 `register.tsx`·`photoLibrary.ts` 병합을 사람이 조정.
- **D는 병렬 안전**: 신규 `src/components/Onboarding/*` 위주. `_layout.tsx`(또는 홈) 게이트 삽입만 소폭 겹치므로 병합이 쉽다.
- `src/lib/photoLibrary.ts`는 B(`getRecentPhotoAsset`)·C(`deletePhotoAsset`)가 **서로 다른 export 함수**를 추가하도록 못박아 충돌을 최소화한다.

---

## Batch A — 즉시 개선 + 다중 선택 + 카테고리 표기 + 네이티브 준비  ⭐ (선행)

브랜치 `feat/phase-7-multiselect-and-native-prep`. 네 갈래(A-1~A-4)를 한 세션·한 PR로. **재빌드는 A 머지 후 사람이 dev에서 1회 실행**(B/C/D 착수 전, 이 Phase 유일의 빌드).

### A-1. 즉시 개선 — 사진 고르기 전 불필요한 권한 요청 제거 (JS, 재빌드 무관)

- **대상**: `src/app/register.tsx`의 `pickImage`, `src/app/item/[id]/edit.tsx`의 `pickImage`.
- **작업**: 두 곳에서 `ImagePicker.requestMediaLibraryPermissionsAsync()` 사전 호출 및 `!perm.granted` 분기를 **제거**하고 곧바로 `launchImageLibraryAsync(...)`를 부른다. (권한이 없어도 PHPicker는 동작하며, 이 사전 호출이 "제한된 접근" 권한창을 불필요하게 띄우던 원인.)
  - 근거: Expo ImagePicker — *"No permissions request is necessary for launching the image library."* (https://docs.expo.dev/versions/latest/sdk/imagepicker/)
- **주의**: 이 권한은 **삭제(기능 2)** 에는 여전히 필요하다. A에서는 "고르기"에서만 제거하고, 삭제용 권한 요청은 Batch C가 별도로 다룬다. picker 결과 처리(`result.canceled`, `assetId` 등)는 건드리지 않는다.
- **DoD**: 첫 사용에서 사진 고르기 시 사진 권한 다이얼로그가 뜨지 않고 바로 PHPicker가 열린다(사람 실기기 확인). `npx tsc --noEmit`·`npx expo lint` 통과.

### A-2. 전체 탭 다중 선택 → 폴더 이동 / 일괄 삭제 (JS, 재빌드 무관)

- **대상**: `src/app/(tabs)/all.tsx`(+ 필요 시 하단 선택 액션바용 신규 컴포넌트 `src/components/SelectionBar.tsx`), 데이터는 기존 `src/lib/queries`(`moveItemCategory`, 아이템 삭제, `deleteItem`류) 재사용.
- **작업**:
  - '전체' 탭에 **선택 모드**: 타일 롱프레스로 진입, 각 타일에 선택 체크 오버레이(`PhotoTile`에 selected 표시 추가), 헤더에 "선택"/"취소"·선택 개수.
  - 하단 액션바: **폴더 이동**(FolderPickerSheet 재사용 → 선택 항목 `moveItemCategory` 반복) · **삭제**(확인 다이얼로그 → 반복 삭제). 삭제로 원래 카테고리가 비면 `promptDeleteIfCategoryEmpty` 규칙 준수.
  - **주의**: 여기서 "삭제"는 **위시(앱 데이터) 삭제**이지 앨범 사진 삭제가 아니다(그건 기능 2). 혼동 없게 카피 구분.
  - 데이터 접근은 반드시 `queries` 경유. 배치 처리 헬퍼가 필요하면 `queries/items`에 `moveItems`/`deleteItems`(내부에서 기존 단건 함수 반복 또는 in-list 쿼리)를 추가.
- **DoD**: 롱프레스로 선택 모드 진입, 다중 선택 후 폴더 이동·일괄 삭제 동작, 빈 카테고리 안내 유지, 카피가 앱 톤. `tsc`·`lint` 통과.

### A-3. 네이티브 준비 (설정·설치만 — 코드 로직은 B/C/D에서) ⚠️ 재빌드 유발

한 커밋에 네이티브 4종을 모아 넣는다. **이 커밋 후 사람이 EAS dev 빌드 1회.**

1. **공유 확장 URL 수신** — `app.json` `expo-share-intent` 플러그인의 `iosActivationRules`에 URL/웹페이지 수신을 추가:
   ```json
   "iosActivationRules": {
     "NSExtensionActivationSupportsImageWithMaxCount": 1,
     "NSExtensionActivationSupportsWebURLWithMaxCount": 1,
     "NSExtensionActivationSupportsWebPageWithMaxCount": 1
   }
   ```
   (앱마다 URL을 `public.url` 또는 웹페이지로 넘겨 둘 다 넣는다.) 근거: https://towa.co/articles/2023.05.08-getting-your-app-to-show-up-in-the-sharesheet-for-urls.html , Apple `NSExtensionActivationRule` https://developer.apple.com/documentation/bundleresources/information-property-list/nsextension/nsextensionattributes/nsextensionactivationrule
2. **expo-media-library** — `npx expo install expo-media-library`(SDK 57 호환 버전). 앱 config 플러그인에 등록되며 권한 문구 필요. 근거: https://docs.expo.dev/versions/latest/sdk/media-library/
3. **react-native-svg** — `npx expo install react-native-svg`(온보딩 둥근 마스크 스포트라이트용, Fabric/New Arch 대응). 근거: https://docs.expo.dev/versions/latest/sdk/svg/
4. **사진 권한 문구** — `app.json`:
   - `expo-image-picker`의 `photosPermission`은 현행 유지(고르기용이지만 실제로는 삭제/최근사진에서 씀).
   - **삭제/쓰기 권한 문구** 추가: `expo-media-library` 플러그인 옵션 또는 `ios.infoPlist`의 `NSPhotoLibraryUsageDescription`(그리고 필요 시 `NSPhotoLibraryAddUsageDescription`)에 한국어 문구. 예: "저장한 스크린샷을 사진 앨범에서 정리(삭제)하려면 사진 접근 권한이 필요합니다."
- **검증**: Windows에선 prebuild 불가 → `npx expo config --type introspect`로 플러그인/Info.plist 반영을 확인. 실제 네이티브 생성·빌드는 EAS.
- **DoD(A-3)**: `app.json`에 네이티브 4종 반영, `package.json`에 두 모듈 추가, `expo config --type introspect`로 공유확장 규칙·권한 문구 확인. `tsc`·`lint`·`npx expo-doctor` 통과. **사람이 EAS dev 빌드 1회 성공** 후 B/C/D 착수 가능.

### A-4. 화면 표기 "폴더" → "카테고리" 통일 (JS, 재빌드 무관)

현재 UI는 "폴더"와 "카테고리"가 섞여 있다(Phase 5에서 UI 라벨만 "폴더"로 두기로 했던 결정을 이번에 뒤집어 **"카테고리"로 통일**). **사용자 노출 문자열만** 바꾸고, **코드·라우트·데이터·파일명·컴포넌트명(예: `FolderPickerSheet`)·주석은 그대로 둔다**(내부는 계속 category/folder 혼용 무방).

- **대상(사용자 노출 문자열 — grep으로 확정)**:
  - `src/components/CustomTabBar.tsx`: 탭 라벨 `'폴더'` → `'카테고리'` **⚠️ 레이아웃 위험**(2→4자, 알약 탭바 폭·정렬 확인 필수).
  - `src/app/(tabs)/_layout.tsx`: `Tabs.Screen name="index"`의 `title: '폴더'` → `'카테고리'`.
  - `src/app/(tabs)/index.tsx`: 홈 Large Title `'폴더'` → `'카테고리'` **⚠️ 레이아웃 위험**(타이틀 폭), Alert `'폴더 없음'`/`'삭제할 폴더가 없습니다.'`, accessibilityLabel `'새 폴더'`/`'폴더 삭제'`.
  - `src/components/FolderPickerSheet.tsx`: 제목 `'폴더 선택'`, placeholder `'새 폴더 이름'`, 에러 `'폴더를 만들지 못했습니다.'`.
  - `src/app/register.tsx`: `DisclosureRow label="폴더"`, accessibilityLabel `"AI가 추천한 폴더"`, 안내문 `"AI가 추천한 폴더입니다. 바꾸려면 눌러 선택하세요."`.
  - `src/app/item/[id]/edit.tsx`: `DisclosureRow label="폴더"`.
  - `src/app/item/[id]/info.tsx`: `InfoRow label="폴더"`.
- **레이아웃 확인(필수)**: "카테고리"는 "폴더"보다 길어 **줄바꿈·잘림·간격**이 생길 수 있다. 특히 (a) 하단 알약 탭바(`CustomTabBar`) — 3탭 폭·중앙 정렬·아이콘+라벨 간격, (b) 홈 Large Title, (c) 폼 `DisclosureRow` 라벨 열 폭, (d) 정보 시트 `InfoRow` 라벨 열. 육안(사람 실기기) + 필요 시 스타일 미세조정. 원시 hex/토큰 규칙 준수.
- **DoD(A-4)**: 위 사용자 노출 문자열이 모두 "카테고리"로 통일, "폴더" 잔재 없음(grep 확인 — 주석 제외), 탭바·타이틀·라벨에 줄바꿈/잘림 없음(사람 실기기 확인). `tsc`·`lint` 통과.

> **A 전체 DoD 요약**: A-1(권한 사전호출 제거)·A-2(다중선택)·A-4(카테고리 표기)는 현재 빌드로 JS 검증 가능(실기기 육안은 사람), A-3(네이티브 준비) 커밋 + **재빌드 1회**로 마무리.

---

## Batch B — 기능 1: URL 공유로 링크 저장  (재빌드 후, JS)

> 브랜치 `feat/phase-7-url-link-capture` (A 머지된 dev에서 분기). 선행: Batch A 재빌드 완료(공유확장 URL 규칙 + expo-media-library). **C와 `register.tsx`를 공유하므로 B→C 순서 권장.** 새 네이티브 모듈 추가 금지(필요하면 멈추고 보고).

### 흐름
```
Safari/앱에서 URL 공유 → WishShot
  → '전체' 탭 "링크 붙이기 모드"(안내 배너 + [새로 담기] 버튼)
     ├ 기존 위시(스크린샷) 탭 → 그 위시 편집 폼(링크 프리필) → 저장
     └ [새로 담기] → 새 위시 담기 폼(링크 프리필 + "방금 캡처한 사진" 제안)
```

### 대상 파일 · 작업
- **`src/app/(tabs)/index.tsx`** (공유 인텐트 핸들러 분기):
  - 현재는 `shareIntent.files[0]`(이미지)만 처리한다. `useShareIntentContext()`의 `shareIntent.type`/`webUrl`을 보고 분기:
    - `type === 'media'`(이미지): 기존대로 `/register`로.
    - `type === 'weburl'` 또는 `type === 'text'`이고 `webUrl`이 있으면: **링크 붙이기 모드로 '전체' 탭 진입** — 예) `router.push({ pathname: '/(tabs)/all', params: { attachLink: shareIntent.webUrl } })` 후 `resetShareIntent()`.
  - `expo-share-intent` 데이터 형태: `{ type: 'media'|'file'|'text'|'weburl'|null, webUrl: string|null, files, text, meta }`. 근거: https://github.com/achorein/expo-share-intent (타입 정의 `src/ExpoShareIntentModule.types.ts`).
  - **재진입 가드(중요)**: 폼/모드가 열린 채 두 번째 공유가 오면 중복 push가 날 수 있다. 홈의 공유 처리 effect를 `useIsFocused()`로 게이팅하고 "처리 중" ref로 잠근다. 새 인텐트는 상황에 따라 `push` 대신 `replace`. 근거·주의(연속 공유 lock-up 가능성, 실기기 검증 필요): https://github.com/achorein/expo-share-intent/blob/main/src/useShareIntent.ts , 이슈 https://github.com/achorein/expo-share-intent-demo/issues/32
- **`src/app/(tabs)/all.tsx`** (링크 붙이기 모드):
  - `useLocalSearchParams`로 `attachLink` 수신. 있으면 **링크 붙이기 모드**: 상단 안내 배너("링크를 저장할 스크린샷을 선택하세요") + **[새로 담기]** 버튼.
  - 이 모드에서 타일 탭 → 상세(`/item/[id]`)가 아니라 **편집으로**: `router.push({ pathname: '/item/[id]/edit', params: { id, linkPrefill: attachLink } })`.
  - **[새로 담기]** → `router.push({ pathname: '/register', params: { sourceLink: attachLink } })`.
  - 그리드가 비어 있으면(신규 사용자) [새로 담기]만 노출. 모드 취소 동선(뒤로/취소 → 일반 '전체' 탭 또는 홈) 정의.
  - **주의**: A-2의 다중 선택 모드와 **상태가 충돌하지 않게** 한다(선택 모드 vs 링크붙이기 모드는 상호 배타). A가 먼저 들어오므로 B는 A의 all.tsx 위에서 모드 플래그를 분리해 얹는다.
- **`src/app/item/[id]/edit.tsx`** (linkPrefill):
  - `useLocalSearchParams`에 `linkPrefill?` 추가. 아이템 로드 후, 기존 `source_link`가 **비어 있으면** `linkPrefill`로 채우고, **이미 있으면** 덮어쓰기 전 확인(Alert: "기존 링크가 있습니다. 교체할까요?") 후 반영. (무단 덮어쓰기 금지.)
- **`src/app/register.tsx`** (sourceLink 프리필 + "방금 캡처한 사진" 제안):
  - `params`에 `sourceLink?` 추가 → `useState(params.sourceLink ?? '')`로 링크 필드 초기값(기존 `sourceLink` state 활용).
  - **"방금 캡처한 사진" 제안**: 이미지가 아직 없을 때, `src/lib/photoLibrary.ts`의 `getRecentPhotoAsset()`로 최근 사진 1장을 읽어 **제안 썸네일**("방금 캡처한 사진 담기")을 보여준다. 탭하면 그 사진을 `imageUri`로 설정(그러면 기존 OCR/AI 파이프라인이 돈다). 무시하고 기존 "사진 선택"(PHPicker) 사용 가능.
    - 최근 사진 읽기는 **읽기 권한 필요** → 이 제안을 처음 쓸 때만 `MediaLibrary.requestPermissionsAsync()`. 권한 거부/제한이면 제안을 숨기고 PHPicker만 남긴다.
- **`src/lib/photoLibrary.ts`** (신규, B가 생성):
  - `export async function getRecentPhotoAsset(): Promise<{ uri: string; assetId: string } | null>` — `MediaLibrary.getAssetsAsync({ first: 1, mediaType: 'photo', sortBy: [MediaLibrary.SortBy.creationTime] })`로 최근 1장. 권한 없으면 null. (원하면 iOS "Screenshots" 앨범으로 좁힐 수 있음 — 선택.) 근거: https://docs.expo.dev/versions/latest/sdk/media-library/
  - **C가 같은 파일에 `deletePhotoAsset`을 추가하므로, B는 이 export만 만든다.**

### 실기기 검증(사람)
- Safari/쇼핑앱에서 URL 공유 → '전체' 탭 링크붙이기 모드 진입.
- 기존 위시 탭 → 편집 폼 링크 프리필(기존 링크 있을 때 확인창) → 저장.
- [새로 담기] → 새 폼 링크 프리필 + "방금 캡처한 사진" 제안 → 저장.
- 이미지 공유(기존 경로)는 그대로 동작하는지 회귀 확인.
- **재진입**: 이미지 공유로 폼 연 채 → 백그라운드 → URL 공유로 재진입 시 폼 중복/먹통 여부.
- 앱이 URL을 `text`로 주는 경우도 처리되는지.

### DoD
- [ ] URL 공유 → 링크붙이기 모드 → 기존 위시 링크 달기 / 새로 담기(제안 포함) 동작. 재진입 가드로 폼 중복 없음. 이미지 공유 회귀 없음. `tsc`·`lint` 통과. 문서(`CLAUDE.md` 데이터 흐름·라우트) 갱신.

---

## Batch C — 기능 2: 앨범 원본 삭제  (재빌드 후, JS)

> 브랜치 `feat/phase-7-album-photo-delete` (B 머지된 dev에서 분기; B 미머지면 B 브랜치에서 분기). 선행: Batch A 재빌드 완료(expo-media-library). **B와 `register.tsx`·`photoLibrary.ts`를 공유하므로 B 이후 권장.** 앱 내 **picker로 고른** 사진에만 적용(공유 시트 경로 제외). 새 네이티브 모듈 추가 금지(필요하면 멈추고 보고).

### 대상 파일 · 작업
- **`src/app/register.tsx`**:
  - `pickImage`에서 `result.assets[0].assetId`를 상태로 보관(예: `pickedAssetId`). `assetId`는 **전체 접근이 아니면 null**일 수 있으니 null 가드. 근거: Expo — assetId *"might be null when ... the user gave limited permission."* (https://docs.expo.dev/versions/latest/sdk/imagepicker/)
  - **저장 성공 직후**(`performNewSave`/`handleOverwrite` 완료), `pickedAssetId`가 있으면 안내: "이 스크린샷을 앨범에서도 지울까요?"(수락/취소). 수락 시 `photoLibrary.deletePhotoAsset(pickedAssetId)` 호출.
  - **권한**: 삭제 시도 시점에 `deletePhotoAsset` 내부에서 전체 접근 요청. **제한/거부면** "앨범 삭제는 전체 사진 접근이 필요합니다" 안내 후 중단(위시는 이미 저장됨 — 앱은 정상).
  - 삭제는 **공유 시트로 들어온 이미지엔 노출하지 않는다**(그 경우 assetId 없음). 즉 assetId가 있는 picker 경로에서만 안내가 뜬다 — 자연히 구분됨.
- **`src/lib/photoLibrary.ts`** (B가 만든 파일에 함수 추가):
  - `export async function deletePhotoAsset(assetId: string): Promise<'deleted' | 'denied' | 'error'>`:
    - 권한: `const perm = await MediaLibrary.requestPermissionsAsync(true /* writeOnly? 확인 */)` — **전체 접근** 확인(`perm.accessPrivileges === 'all'` 또는 `perm.granted && !limited`). 제한/거부면 `'denied'`.
    - 삭제: `await MediaLibrary.deleteAssetsAsync([assetId])`. iOS는 여기서 **시스템 "사진 삭제?" 확인창을 강제로 띄운다**(억제 불가). 사용자가 확인해야 실제 삭제. 근거: https://docs.expo.dev/versions/latest/sdk/media-library/ , Apple `PHAssetChangeRequest.deleteAssets` https://developer.apple.com/documentation/photos/phassetchangerequest , DTS https://developer.apple.com/forums/thread/806349
    - 우리 앱이 별도 "정말 삭제?" 창을 또 띄우지 않는다(OS 창으로 충분, HIG).
- **(선택) `src/app/item/[id]/edit.tsx`**: 편집에서 사진을 **교체**할 때도 새 picker 사진의 assetId로 같은 삭제 옵션을 줄 수 있음(범위 넘치면 생략). 넣을 경우 register와 동일 패턴.

### 실기기 검증(사람)
- 앱에서 사진 고르기 → 저장 → "앨범에서 삭제" 안내 → 수락 → 전체 접근 권한 요청 → OS "사진 삭제?" → 삭제 확인(앨범에서 사라짐).
- **전체 접근 시 `assetId`가 실제로 non-null인지** 확인(문서가 "full→non-null"을 보장하진 않음 — 반드시 기기 로그로 확인).
- 제한 접근/거부 시 안내 후 위시는 정상 저장되는지.
- 공유 시트로 받은 사진엔 삭제 옵션이 안 뜨는지.

### DoD
- [ ] picker 경로 저장 후 앨범 삭제 옵션 동작(전체 접근 요청 → OS 확인 → 삭제), 제한/거부 폴백 안내, 공유 경로 비노출. assetId non-null 실기기 확인. `tsc`·`lint` 통과. 문서 갱신.

---

## Batch D — 온보딩 (카드 + 코치마크 스포트라이트)  (재빌드 후, JS)

> 브랜치 `feat/phase-7-onboarding` (A 머지된 dev에서 분기). 선행: Batch A 재빌드 완료(react-native-svg). **대부분 신규 파일 → B/C와 병렬 안전.** `_layout.tsx`(또는 홈) 게이트만 소폭 겹침. 새 네이티브 모듈 추가 금지(필요하면 멈추고 보고).

### 대상 파일 · 작업
- **`src/components/Onboarding/`** (신규):
  - **온보딩 카드**: 첫 실행 시 풀스크린 캐러셀 2~3장. RN `FlatList`(horizontal, pagingEnabled) + 이미 설치된 `reanimated`로 도트/전환. 새 네이티브 모듈 없음.
    - 내용 예(문구는 앱 톤 단답): ① "스크린샷을 공유 시트로 바로 담기" ② "Safari에서 링크를 공유하면 위시에 링크가 붙습니다" ③ "폴더로 정리하고 원본은 앨범에서 정리". (실제 기능과 일치하게, 없는 기능 홍보 금지.)
  - **코치마크 스포트라이트**(둥근 마스크): 대상 요소를 `measureInWindow`로 측정 → 전체 딤 오버레이 위에 **react-native-svg `<Mask>` 로 둥근 구멍** + 툴팁. 근거: react-native-svg 마스크 https://docs.expo.dev/versions/latest/sdk/svg/
    - 스포트라이트 대상(예): '전체' 탭 업로드 FAB, 공유 시트 사용 안내 지점. 대상 좌표는 실기기에서 조정 필요.
- **첫 실행 게이트**:
  - `@react-native-async-storage/async-storage`(이미 설치)에 `wishshot.onboardingShown` 플래그. 기존 `PRIVACY_NOTICE_KEY` 패턴(register.tsx)과 동일한 방식.
  - 표시 위치: `_layout.tsx` AuthGate 이후 또는 홈(`(tabs)/index.tsx`) 최초 마운트 시 1회. **B의 `_layout.tsx` 재진입 가드와 다른 구역**을 건드리도록 주의(병합 용이).
  - 근거: Expo Async Storage https://docs.expo.dev/versions/latest/sdk/async-storage/

### 실기기 검증(사람)
- 새 설치(또는 플래그 리셋)에서 온보딩 1회 노출, 이후 미노출.
- 스포트라이트 구멍이 대상 요소에 정확히 맞는지(좌표·회전·라운드).
- reduce-motion 등 접근성 확인(가능하면).

### DoD
- [ ] 첫 실행 온보딩 카드 + 코치마크 스포트라이트 1회 노출, 재노출 없음, 문구가 실제 기능과 일치·앱 톤. `tsc`·`lint` 통과. 문서 갱신.

---

## 미결 사항 (구현 중 결정)

- **링크 붙이기 모드에서 기존 위시에 링크가 이미 있을 때**: 확인 후 교체(권장) vs 항상 덮어쓰기. → 편집에서 확인창.
- **"방금 캡처한 사진" 범위**: 최근 사진 전체 vs iOS "Screenshots" 앨범 한정.
- **삭제 옵션 위치**: 저장 직후 안내(권장) vs 상세/편집에도 노출. "다시 묻지 않기" 옵션 여부.
- **온보딩 스포트라이트 대상·문구·장수** 최종안(실기기 좌표 조정).
- **다중 선택 배치 처리**: 단건 함수 반복 vs `in`-list 쿼리 헬퍼 추가.
- **재진입 시 새 인텐트 처리**: `push` vs `replace` vs 스택 리셋(실기기 관찰 후 확정).

## 이 문서에서 확정한 결정

- **기능 1** = URL은 "Safari/앱 직접 공유"로만 수신(스크린샷 원본 URL 자동추출 불가). 진입 시 **'전체' 탭 링크붙이기 모드** → 기존 위시 편집(링크 프리필) 또는 새로 담기(+최근사진 제안). 이미지 매칭 아님(제품명 정규화 중복 판정 유지).
- **기능 2** = **앱 내 picker 경로 한정** 앨범 삭제. **전체 접근 권한 필수**(제한/앨범단위 불가), **OS 확인창 불가피**, 저장 후 옵션. 공유 시트 경로엔 비노출.
- **온보딩** = 카드 + **둥근 마스크 스포트라이트(react-native-svg)**. AsyncStorage 플래그로 1회.
- **전체 탭 다중 선택** = 카테고리 이동/일괄(위시) 삭제, JS 전용.
- **즉시 개선** = 사진 고르기 전 불필요한 권한 요청 제거(register·edit).
- **화면 표기 통일** = 사용자 노출 "폴더" → **"카테고리"**(코드·라우트·데이터·컴포넌트명은 유지). Phase 5의 "UI 라벨 폴더" 결정을 뒤집음. 탭바·타이틀·라벨 레이아웃 확인 포함(A-4).
- **재빌드** = **총 1회**(Batch A 네이티브 4종: 공유확장 URL 규칙 · expo-media-library · react-native-svg · 사진 권한 문구). dev client 구조상 B/C/D는 순수 JS라 이 1회 빌드로 전부 동작. B/C/D에서 네이티브 추가가 필요하면 멈추고 보고(원칙 위반).
- **병렬 규칙** = A 선행·머지 → dev에서 1회 빌드 → **D 병렬 안전, B와 C는 순차(register.tsx·photoLibrary.ts 공유)**. 브랜치는 내용 기반 이름(위 참조).

## 결과 기록 (Batch별 완료 시 작성)

- **Batch A** (2026-09-20 구현 완료, 실기기 검증·재빌드는 사람):
  - **A-1 (권한 사전요청 제거)**: `src/app/register.tsx`·`src/app/item/[id]/edit.tsx`의 `pickImage`에서 `ImagePicker.requestMediaLibraryPermissionsAsync()` 사전 호출·`!perm.granted` 분기를 제거하고 곧바로 `launchImageLibraryAsync(...)` 호출. picker 결과 처리(`canceled`/`assetId`)는 불변. `Alert`·`ImagePicker` import는 다른 코드에서 계속 사용해 유지.
  - **A-2 (다중 선택 — 전체 탭 + 카테고리 그리드)**: `src/app/(tabs)/all.tsx`·`src/app/category/[id].tsx` 공통. 진입은 **우상단 "선택" 버튼**(전체=Title·개수 라인, 카테고리=이름 라인) **또는 타일 롱프레스**. 선택 모드에선 헤더가 `N개 선택`+우상단 `취소`로 바뀌고 하단 **SelectionBar**(`카테고리 이동`·`삭제`) 노출. 이동은 `FolderPickerSheet` 재사용→`moveItems`, 삭제는 확인 다이얼로그(`위시 N개를 삭제합니다. 복구할 수 없습니다.`)→`deleteItems`+`deleteItemImages`(Storage, 실패 무시). 이동·삭제 후 원래 카테고리가 비면 `promptDeleteIfCategoryEmpty`를 영향받은 카테고리마다 순차 안내(카테고리 화면은 비면 홈으로 리다이렉트).
    - **탭바 겹침 해결**: 전체 탭은 플로팅 `CustomTabBar`가 화면 하단 절대배치라 SelectionBar를 가렸다 → `src/components/tabBarVisibility.tsx`(컨텍스트, `(tabs)/_layout.tsx`에서 provider) 로 **선택 모드 동안 탭바를 숨겨** 액션바에 자리를 내준다(탭 이탈 시 복구). 카테고리 화면은 push 된 전체화면이라 탭바가 없어 그대로 노출.
    - **공통화**: 선택 로직은 `src/hooks/useItemSelection.ts`(상태·이동·삭제·빈 카테고리 안내), 액션바+이동 시트는 `src/components/ItemSelectionControls.tsx`로 묶어 두 화면이 재사용. 신규 `src/components/SelectionBar.tsx`, `PhotoTile`에 `selectionMode`/`selected`(체크 오버레이·딤)·`onLongPress` 추가. 데이터 레이어 `queries/items`에 `moveItems`·`deleteItems`, `queries/storage`에 `deleteItemImages`(모두 `.in()` 배치). "삭제"=위시(앱 데이터)만, 앨범 사진 아님(카피로 구분). 태그 모아보기 화면은 이번 범위 밖(미적용).
  - **A-3 (네이티브 준비 — 재빌드 유발)**: `app.json` — `expo-share-intent` `iosActivationRules`에 `NSExtensionActivationSupportsWebURLWithMaxCount`·`NSExtensionActivationSupportsWebPageWithMaxCount`(각 1) 추가(이미지 규칙 유지). `expo-media-library` 플러그인 등록(`photosPermission`·`savePhotosPermission` 한국어 + `isAccessMediaLocationEnabled:false`). `react-native-svg` `npx expo install`로 추가(`15.15.4`). `expo-media-library`는 Phase 6에 이미 설치돼 있어 플러그인 등록만. `expo-image-picker`의 `photosPermission`은 지시대로 현행 유지.
    - **검증(introspect)**: `npx expo config --type introspect` — 공유확장 `iosActivationRules`에 WebURL·WebPage 반영 확인, `NSPhotoLibraryUsageDescription`(한국어)·`NSPhotoLibraryAddUsageDescription`(한국어, savePhotos) 존재 확인.
    - **권한 문구 확정(사람 결정 반영)**: iOS `NSPhotoLibraryUsageDescription`는 단일 키라 읽기(직전 스크린샷 담기·B)·삭제(앨범 정리·C)가 **문구를 나눌 수 없다**. 그래서 image-picker·media-library의 `photosPermission`을 **동일한 통합 문구**로 통일해 병합 순서와 무관하게 같은 텍스트가 뜨게 했다: `"방금 캡처한 스크린샷을 위시샷에 바로 담거나, 위시샷에 담은 스크린샷을 아이폰 앨범에서 삭제하려면 '모든 사진' 접근 권한이 필요합니다."` (일반 "사진 선택"(PHPicker)은 권한 요청이 없어 이 문구가 뜨지 않음 — A-1). introspect로 메인 앱·공유확장 양쪽 반영 확인. 두 기능은 **전체("모든 사진") 접근 필요**(제한 접근은 assetId null·부분 목록이라 불가) — 거부/제한 시 앱이 "전체 접근 필요" 폴백 안내(B/C 구현).
  - **A-4 (표기 "폴더"→"카테고리")**: 사용자 노출 문자열만 변경 — `CustomTabBar`(탭 라벨, `numberOfLines={1}` 추가), `(tabs)/_layout.tsx`(탭 title), `(tabs)/index.tsx`(Large Title·Alert `카테고리 없음`/`삭제할 카테고리가 없습니다.`·accessibilityLabel `새 카테고리`/`카테고리 삭제`), `FolderPickerSheet`(제목·placeholder·에러), `register.tsx`(DisclosureRow·추천 안내·accessibilityLabel), `edit.tsx`(DisclosureRow), `info.tsx`(InfoRow). 코드·라우트·파일명·컴포넌트명(`FolderPickerSheet`)·주석은 유지(잔여 "폴더"는 grep상 전부 주석). 레이아웃 잘림/줄바꿈은 사람 실기기 확인 필요.
  - **검증 결과**: `npx tsc --noEmit` 통과, `npx expo lint` 통과, `npx expo config --type introspect` 성공. `npx expo-doctor`는 **기존부터 있던 패치 버전 미스매치**(expo-constants·dev-client 등 — 이번에 건드리지 않은 패키지, CLAUDE.md 규칙 10에 따라 `--fix` 안 함)만 지적하며, 이번에 추가한 `react-native-svg`·`expo-media-library`는 미스매치 목록에 없음(SDK 호환).
  - **재빌드**: A-3 네이티브 변경으로 **dev 머지 후 사람이 dev에서 EAS dev 빌드 1회 필요**. 이 빌드가 B/C/D의 네이티브 표면(공유확장 URL·media-library·svg·권한 문구)을 모두 포함하므로 **B/C/D는 재빌드 불필요**(순수 JS).
  - **실기기 검증(사람 체크리스트 — "검증 완료" 단정 아님)**: (1) 사진 고르기 시 권한창 미노출·PHPicker 바로 열림, (2) 전체 탭·카테고리 그리드에서 우상단 "선택" 버튼/타일 롱프레스로 선택 모드 진입→다중 선택→하단 액션바로 카테고리 이동·일괄 삭제→빈 카테고리 안내(선택 중 탭바가 숨고 취소 시 복구), (3) 탭바 "카테고리"·홈 Large Title·폼/시트 라벨 줄바꿈·잘림 없음, (4) 삭제 카피가 "위시 삭제"로 읽혀 앨범 삭제와 혼동 없음.
- **Batch B** (2026-09-20 구현 완료, 실기기 검증은 사람): 브랜치 `feat/phase-7-url-link-capture`(A 머지된 dev에서 분기). 새 네이티브 모듈 없음(순수 JS — A-3의 공유확장 URL 규칙·expo-media-library 위에 얹음). `tsc`·`expo lint` 통과.
  - **공유 인텐트 분기(`(tabs)/index.tsx`)**: `shareIntent.type`을 보고 분기 — `weburl`(또는 `text`에서 첫 http(s) URL 추출)이면 `router.push({ pathname: '/all', params: { attachLink: url } })`, 그 외 이미지(`files[0]`)는 기존대로 `/register`. URL 은 `shareIntent.webUrl ?? firstUrl(shareIntent.text)`로 얻는다(웹페이지·text 공유 모두 흡수). 근거: `expo-share-intent` 타입 `{ type: 'media'|'file'|'text'|'weburl'|null, webUrl: string|null }`(node_modules 타입 정의로 확인).
    - **재진입 가드**: 홈 처리 effect를 `useIsFocused()`(expo-router export)로 게이팅 + `shareHandled` ref 로 같은 인텐트 중복 push 잠금. 처리 직전 `resetShareIntent()` → `hasShareIntent` 내려가면 ref 해제.
    - **연속 공유(실기기 관찰 → 결정)**: 이미지 공유로 등록/편집 폼을 연 채 → 백그라운드 → URL 공유로 재진입하면, iOS 공유 딥링크가 앱을 **홈(/)으로 재진입시키며 그 폼을 pop** 한다(관찰, `+native-intent.ts`가 공유 딥링크를 `/`로 보냄). 폼이 이미 정리된 뒤 홈이 URL을 처리하므로 **JS만으로 폼 복원은 불가**. **결정**: 지금은 **소리 없이 새 공유 화면으로 이동**(이미지=위시 담기, 링크=링크 저장). **데이터 안전**: 저장 전이라 Storage 업로드·DB 행 생성이 없어 고아 파일 없음(`uploadItemImage`는 `performNewSave`/`handleOverwrite`에서만, E-5 순서). **후속(재빌드 시)**: 작성 중 폼을 메모리에 들고 있다가 `작성 중인 항목 … [이동(현재 공유)] / [이전 폼 저장]` 선택 제공 — 이번 JS-only 범위에서는 제외(사람 결정).
  - **링크붙이기 모드(`(tabs)/all.tsx`)**: `useLocalSearchParams`의 `attachLink`를 **단일 소스**로 삼음(별도 상태 없음 — 재진입 시 새 URL 그대로 반영, setState-in-effect 회피). 모드 진입 시 헤더 `링크 저장`+`취소`, 상단 배너("링크를 저장할 스크린샷을 선택하세요.")+**[새로 담기]**. 타일 탭 → `/item/[id]/edit`(`linkPrefill`), [새로 담기] → `/register`(`sourceLink`). 두 동선 모두 진입 전 `router.setParams({ attachLink: '' })`로 모드 종료(돌아오면 일반 탭). 빈 그리드면 링크붙이기용 EmptyState(“새로 담기”만). **A-2 선택 모드와 상호 배타**: attachMode가 렌더를 지배(선택 UI·FAB 숨김), 진입 시 잔여 선택 모드는 effect로 접음.
  - **편집 프리필(`item/[id]/edit.tsx`)**: `linkPrefill` 파라미터 추가. 아이템 로드 후 기존 `source_link`가 **비어 있으면 프리필**, **이미 있고 다르면** Alert `링크 교체`(유지/교체)로 확인 후에만 반영(무단 덮어쓰기 없음).
  - **등록 프리필 + 최근사진 제안(`register.tsx`)**: `sourceLink` 파라미터로 링크 필드 초기값. 이미지가 없을 때 **"방금 캡처한 사진 담기"** 버튼 노출 → 탭 시 `getRecentPhotoAsset()`로 최근 1장을 `imageUri`로 설정(기존 OCR/AI 파이프라인 자동 실행). **결정(미결 해소)**: 무단 권한창을 피하려 **자동 프리로드 대신 탭-투-로드**로 구현 — 제안을 처음 **탭할 때만** 사진 권한을 요청(HIG 적시요청). 거부·제한이거나 사진 없음이면 제안을 숨기고 안내 후 일반 "사진 선택"만 남김. 콘텐츠 타입은 uri 확장자로 추정(iOS 스크린샷=png).
  - **신규 `src/lib/photoLibrary.ts`**: `getRecentPhotoAsset(): Promise<{uri, assetId} | null>`만 추가(**`deletePhotoAsset`은 Batch C — 만들지 않음**). `getPermissionsAsync`(무프롬프트) → 미허용 시 `requestPermissionsAsync` → `getAssetsAsync({ first:1, mediaType:'photo', sortBy:[['creationTime', false]] })`로 **최신순 1장**. **iOS `ph://` uri 는 expo-file-system 으로 못 읽으므로 `getAssetInfoAsync().localUri`(file://)를 확보해 반환**(없으면 원 uri 폴백). 권한 거부·사진 없음·조회 실패는 모두 null. **import 는 `expo-media-library/legacy`** — SDK 57 부터 top-level `getAssetsAsync`/`getAssetInfoAsync` 는 deprecated 라 **런타임 에러를 던진다**(실기기 로그로 확인: `Method getAssetsAsync … is deprecated`). 권한(`accessPrivileges:'all'`)은 정상이었고 조회 함수만 문제였음. legacy 서브패스가 권한·조회·상수·타입을 모두 포함하므로 통째로 legacy 에서 import. `getAssetsAsync` 옵션은 파라미터 타입을 문맥 타입으로 뽑아 문자열 리터럴로 넘김.
  - **회귀**: 이미지 공유 경로는 URL 분기 뒤에 그대로 유지(`type==='media'` → webUrl null → 이미지 branch). 문서: `CLAUDE.md` 데이터 흐름·라우트·`src/lib` 갱신.
  - **실기기 검증(사람 체크리스트 — "검증 완료" 단정 아님)**: 아래 "실기기 검증(체크리스트)" 참조.
- **Batch C** (2026-09-20 구현 완료, 실기기 검증은 사람): 브랜치 `feat/phase-7-album-photo-delete`(B 머지된 dev에서 분기). 새 네이티브 모듈 없음(순수 JS — A-3의 `expo-media-library` 위에 얹음). `tsc`·`expo lint` 통과.
  - **assetId 취득(`register.tsx`)**: `pickImage`에서 `result.assets[0].assetId ?? null`을, **"방금 캡처한 사진"**(`useRecentPhoto`)에서 `recent.assetId`를 `pickedAssetId` 상태로 보관(null 가드 — picker 는 문서상 limited 권한 시 null 가능). **공유 시트 경로**(`params.imageUri`)만 원본 참조가 없어 `pickedAssetId`를 세우지 않아 삭제 옵션이 자연히 비노출된다(기능 2는 앱 내 선택 경로 한정). **결정(사용자 피드백 반영)**: 최근사진 경로는 처음엔 문서 Batch C 범위(pickImage)에 맞춰 제외했으나, `getRecentPhotoAsset`이 assetId 를 돌려주고 "방금 찍은 스크린샷 정리"라는 기능 취지에 가장 부합하므로 **삭제 대상에 포함**하도록 확장했다.
  - **삭제 옵션(`register.tsx` `offerAlbumDelete`)**: 저장 성공 직후(`performNewSave`·`handleOverwrite` 양쪽) `pickedAssetId`가 있고 **`canOfferAlbumDelete()`가 true 일 때만** `Alert`(`앨범에서 삭제` · 유지/삭제, destructive)로 제안 → 수락 시 `deletePhotoAsset(pickedAssetId)`. iOS `Alert`는 모달이라 제안이 뜬 동안 뒤 화면의 재저장 터치가 막힌다(중복 저장 방지). 결정 후 `goToSavedCategory()`로 이동(제안을 이동 **전에** 띄워 화면이 살아있게 함). 반환 매핑: `denied`→"앨범 삭제는 '모든 사진' 접근이 필요합니다…" 안내(최초 획득 시점의 거부에 한해 1회), `deleted`→무안내(OS 확인창으로 충분), `error`(취소 포함)→무안내(위시는 이미 저장).
  - **제안 게이트(`canOfferAlbumDelete`, 사용자 피드백 반영)**: 무프롬프트 `getPermissionsAsync()`로 사전 판별 — **미결정(`undetermined`)**(수락이 곧 최초 권한 획득 시점) 또는 **전체 접근(`all`)** 이면 제안, **제한(`limited`)/거부(`denied`)** 면 제안 자체를 건너뛴다. 이전 구조는 저장할 때마다 "삭제?"를 띄우고 수락해야 "전체 접근 필요"를 알려 제한/거부자를 매번 나그했다 → 이제 "전체 접근 필요" 안내는 **최초 획득 시점에 1회만** 뜨고 이후 제한/거부자에겐 안 뜬다. (`status` 는 string enum 이라 `MediaLibrary.PermissionStatus.UNDETERMINED` 로 비교, `accessPrivileges` 는 문자열 유니언이라 `=== 'all'`.)
  - **권한·삭제(`src/lib/photoLibrary.ts` `deletePhotoAsset`)**: `getPermissionsAsync()`로 무프롬프트 확인 → `accessPrivileges !== 'all'`이면 `requestPermissionsAsync()`(**writeOnly 기본 false = read-write 전체** 요청; writeOnly=true는 add-only라 삭제 불가라 넘기지 않음) → 그래도 `'all'`이 아니면 `'denied'` 반환(제한/거부: 특정 자산 삭제 불가, 앨범단위 권한은 iOS에 없음). 전체 접근이면 `deleteAssetsAsync([assetId])`(**iOS 시스템 "사진 삭제?" 확인창 강제, 억제 불가** — 사용자 확인해야 실제 삭제). 별도 앱 확인창은 띄우지 않음(HIG). 반환 `'deleted'|'denied'|'error'`. 사용자가 OS 확인창에서 취소하면 `deleteAssetsAsync`가 `false`(또는 throw) → `'error'`로 매핑해 조용히 넘긴다.
    - **API 확인(추측 금지)**: 설치본 `expo-media-library@57.0.5` 타입으로 확인 — `requestPermissionsAsync(writeOnly=false, …)`, `deleteAssetsAsync(assets): Promise<boolean>`, `PermissionResponse.accessPrivileges?: 'all'|'limited'|'none'`. top-level `deleteAssetsAsync`는 SDK 57에서 deprecated→런타임 throw라 **getRecentPhotoAsset과 동일하게 `expo-media-library/legacy`에서 import**(같은 파일이 이미 legacy 사용).
  - **회귀**: pickImage 결과 처리(`canceled`)·기존 저장·덮어쓰기 흐름 불변. 삭제 실패/거부는 저장을 되돌리지 않음(위시는 이미 저장됨).
  - **제한 접근 정책(사용자 결정)**: 제한(`limited`) 접근에서는 "방금 캡처한 사진 담기"(읽기)는 되지만 **저장 후 앨범 삭제 제안은 뜨지 않는다**(`canOfferAlbumDelete` 게이트) — 의도된 동작. 처음 전제("제한이면 assetId null")와 달리 방금 캡처한 사진은 허용 범위 안이라 assetId 가 non-null 이었지만, "삭제=전체 접근" 정책을 택해 제한/거부에는 제안을 조용히 생략(프라이버시 선택 존중·나그 방지, HIG). **후속 과제(미착수)**: 발견성 보완용으로 **설정 화면에 소극적 한 줄 안내**("앨범 정리를 원하면 전체 사진 접근을 허용하세요") 추가 — 매번 나그하지 않으면서 경로만 알리는 절충. 지금 범위엔 미포함(별도 작업).
  - **실기기 검증(사람)**: 전체 접근 경로(사진 업로드 + 앨범 삭제 확인)는 실기기에서 정상 확인됨(로그 `delete permission {accessPrivileges:'all'}` → `deleteAssetsAsync {ok:true}`). 제한 접근에서 삭제 제안 미노출도 확인됨(의도대로). 거부·취소 폴백은 아래 체크리스트에서 계속 확인.

### Batch C — 실기기 검증(체크리스트, 사람)
- [x] 앱에서 **사진 고르기**(PHPicker) → 저장 → "앨범에서 삭제" 제안이 뜬다. (**공유 시트 경로에선 안 뜨고**, "방금 캡처한 사진" 경로에선 뜬다.)
- [x] 수락 → **전체 접근이 아직 없으면** 사진 권한 요청 → 허용 → iOS "사진 삭제?" 시스템 확인창 → 확인 시 앨범에서 원본이 사라진다. (터미널 로그 확인: `delete permission {accessPrivileges: 'all', granted: true}` → `deleteAssetsAsync {ok: true}`.)
- [x] **전체 접근 시 `assetId`가 실제로 non-null**(전체 접근으로 업로드+삭제 정상 동작 확인).
- [ ] **제한 접근/거부**: 최초 획득 시점에 거부하면 "앨범 삭제는 '모든 사진' 접근이 필요합니다…" 안내가 1회 뜨고 **위시는 정상 저장**되며, **이후 저장부터는 삭제 제안이 더 이상 뜨지 않는다**(`canOfferAlbumDelete` 게이트).
- [ ] OS 확인창에서 **취소** 시 오류 알림 없이 조용히 넘어가고 위시는 저장돼 있는지.
- [ ] 덮어쓰기(중복) 저장 경로에서도 동일하게 삭제 제안이 뜨는지.
- **Batch D** (2026-09-21 구현 완료, 실기기 검증은 사람): 브랜치 `feat/phase-7-onboarding`(A 머지된 dev에서 분기). 새 네이티브 모듈 없음(순수 JS — A-3의 `react-native-svg`·`@react-native-async-storage/async-storage` 위에 얹음). `tsc`·`expo lint` 통과.
  - **신규 `src/components/Onboarding/`**:
    - `onboardingStorage.ts`: 첫 실행 플래그 `wishshot.onboardingShown`(register 의 `PRIVACY_NOTICE_KEY` 와 동일 패턴). `hasSeenOnboarding`(읽기 실패는 "봤음"으로 취급해 반복 노출 차단)·`markOnboardingSeen`·`resetOnboarding`(재검증용).
    - `onboardingTarget.tsx`: 코치마크 대상 등록소(context). 화면이 `register(key, node)` 로 강조 요소를 등록하면 오버레이가 `measure(key)`→`measureInWindow` 로 좌표를 얻는다. **미등록·미마운트·측정 실패·레이아웃 전(0 크기)·콜백 미도착(400ms 타임아웃)** 은 모두 `null` 반환 → 코치마크 **안전 스킵(크래시 금지)**.
    - `CoachmarkSpotlight.tsx`: 전체 화면 딤 위에 **react-native-svg `<Mask>` 로 둥근(스타디움) 구멍**(대상+8px 여백, `rx=높이/2`)을 뚫고 근처에 안내 툴팁 + 주 버튼(`primaryLabel`: "다음"/"시작하기") + 선택적 "건너뛰기". 구멍이 화면 위쪽이면 툴팁을 아래, 아래쪽이면 위에 배치. 배경/버튼 탭 = 다음 단계, "건너뛰기" = 전체 종료. **다단계 코치마크**를 위해 단일 컴포넌트를 단계별로 재사용. 좌표는 실기기 튜닝 전제.
    - `CardMock.tsx`(`CaptureFlowMock`): 첫 카드용 **코드 모션 그래픽** — "**캡처(스크린샷이 화면 크기에서 좌하단으로 축소)** → 좌하단 캡처 밝아짐 → **다시 커지며 편집 화면** → 공유 아이콘 밝아짐 → **공유 시트가 올라옴** → WishShot 타일 밝아짐 → **위시 담기 폼이 올라옴**"을 **하나의 연결된 흐름**으로 반복(4단계 `setInterval` 1.7s). 캡처 사진은 **하나의 모핑 요소**(레이아웃 애니메이션: `left/top/width/height/borderRadius` — 전체→좌하단 썸네일→편집 이미지)로 이어져 "축소→탭→확대"가 끊기지 않는다. 편집·공유·폼은 위로 슬라이드업, 탭 대상은 **도형 자체가 밝아지는 펄스**(`Glow` — 부모 테두리까지 덮어 딱 맞음, 부모 `overflow:'hidden'` 클리핑). 하단 단계 점(dots) 없음. **실제 스크린샷(인물·브랜드 포함)을 싣지 않고** 흐름만 재현(초상권/저작권 회피) — 에셋 불필요·토큰 기반·테마 자동 대응. reduce-motion 이면 위시 담기 폼 단계로 정적 표시. (사용자 결정: 코드 모션 그래픽으로 진행, 실제 스크린샷 PNG 교체는 실기기 확인 후 판단.)
    - `OnboardingOverlay.tsx`: RN `Modal`(transparent). 단계머신 **cards → (transition) → category 코치마크 → 등록 폼 open**. 카드 캐러셀은 `Animated.FlatList`(horizontal·pagingEnabled) + reanimated 스크롤 연동 도트, 첫 카드는 `CaptureFlowMock`. 마지막 카드 "시작하기" → 카테고리 대상 측정(성공 시 코치마크, 실패 시 바로 등록 투어). "다음" → `router.push('/register', { onboarding:'1' })` 후 `onDone`(오버레이 종료). **safe-area**: Modal 안에선 `SafeAreaView` top edge 가 0 으로 잡힐 수 있어 `useSafeAreaInsets` 로 상단/하단 인셋을 명시 적용(건너뛰기 헤더 가림 수정). **reduce-motion** 이면 Modal 전환·스크롤·도트 보간을 끄고 정적 표시.
    - `RegisterCoachmarkTour.tsx`(신규): **등록 폼 위 코치마크 2스텝**(이미지 박스 → 방금 캡처한 사진). ⚠️ **등록 화면이 직접 렌더**한다 — `_layout` 의 온보딩 Modal 위로 등록 네이티브 모달이 얹히므로(iOS 모달 표시 순서), 코치마크를 등록 화면이 띄워야 폼 위에 올라간다(RN Modal 은 자신을 띄운 화면 위에 표시). 마운트 시 이미지 박스를 재시도 측정(최대 10회×150ms — push 직후 레이아웃 지연 대비)→ "다음"에 방금-캡처 버튼 측정 → "시작하기". 측정 실패·건너뛰기는 어느 단계서든 안전 종료.
    - **카드(문구는 실제 기능과 일치·앱 톤)**: ① "스크린샷 바로 담기"(캡처 흐름 모션 그래픽 `CaptureFlowMock`) ② "AI가 자동 정리" — 사진이 들어온 폼에서 "AI 분석 중…" 스피너 → 완료 후 필드가 순차로 자동 채워지는 모션 그래픽(`AutoFillMock`) ③ "모아서 관리"(카테고리 정리 — `square.grid.2x2`). ※ Card3 최종 문구는 논의 중(카테고리 중심, 링크·앨범삭제·중복안내는 온보딩 헤드라인에서 제외 방향).
    - **코치마크 문구(3단계)**: 카테고리(홈) "여기서 카테고리를 추가하고 관리합니다." · 등록-이미지 "사진을 선택하면 AI가 제품명·가격을 채우고, 원하는 영역만 크롭해 다시 분석할 수 있습니다."(영역 크롭 버튼은 사진이 있어야 렌더돼 별도 스포트라이트 대신 이 툴팁에 흡수) · 등록-최근사진 "방금 캡처한 스크린샷은 여기서 바로 담을 수 있습니다."
  - **게이트(`src/app/_layout.tsx` `OnboardingGate`)**: `OnboardingTargetProvider` 로 Stack+오버레이를 함께 감싸(화면 등록↔오버레이 측정 연결). AuthGate 준비 후 **최초 마운트 1회만** 판단하는 `decided` ref — (1) **공유 인텐트로 열렸으면 온보딩 스킵**(`hasShareIntent` 우선, 플래그 미설정 → 다음 일반 실행에서 노출), (2) 이미 봤으면 미노출. 판단 사이 인텐트 도착/언마운트는 `cancelled`·재확인으로 방어. 완료 시 `markOnboardingSeen`.
  - **코치마크 대상 등록**: 홈(`(tabs)/index.tsx`)의 "카테고리 추가/관리" 알약 `View` → `register('home.addCategory', …)`; 등록 폼(`register.tsx`)의 이미지 박스·"방금 캡처한 사진 담기" 버튼 → `register('register.imageBox'|'register.recentPhoto', …)`. 모두 안정적 콜백 ref(`useCallback`). 대상은 `measureInWindow` 가진 요소면 되도록 등록소 타입을 `Measurable` 로 넓힘(`View`·`TouchableOpacity` 모두 가능).
  - **등록 폼 연결(`register.tsx`)**: `onboarding` 파라미터가 `'1'` 이면 `RegisterCoachmarkTour` 렌더. 투어 종료(`endOnboardingTour`)는 파라미터를 내리고 `router.back()`(없으면 `replace('/')`)로 홈 복귀 — 온보딩이 열었던 폼을 정리. 사진을 세팅하지 않아 실제 OCR/AI·권한 요청은 발생하지 않는다.
  - **설정 리셋(`src/app/settings.tsx`)**: `__DEV__` 전용 "온보딩 다시 보기(개발용)" — `resetOnboarding()` 후 안내(게이트가 최초 마운트 1회 판단이라 **재시작 후** 노출됨을 명시).
  - **결정/주의**: (a) 카테고리 코치마크 대상은 홈에서 항상 마운트되는 "카테고리 추가" 알약(FAB 는 '전체' 탭 포커스 때만 마운트라 launch 시 측정 불가). (b) 등록 폼 투어는 사용자가 + 버튼을 누를 필요 없이 **카테고리 코치마크 직후 자동으로** 폼을 열어 진행. (c) **핵심 수정**: 등록 폼 코치마크를 처음엔 `_layout` 오버레이가 띄웠더니 등록 네이티브 모달이 오버레이를 덮어 코치마크가 안 보였다 → **등록 화면이 자체 `RegisterCoachmarkTour` 를 띄우도록** 이관해 해결. 좌표·툴팁 위치는 **실기기 튜닝 전제**. (d) 새 네이티브 없음 — D 는 재빌드 불필요.
  - **실기기 검증(사람 체크리스트 — "검증 완료" 단정 아님)**: 아래 "Batch D — 실기기 검증(체크리스트)" 참조.

### Batch D — 실기기 검증(체크리스트, 사람)
- [ ] 새 설치(또는 설정 > "온보딩 다시 보기" 후 재시작)에서 온보딩 카드가 1회 노출되고, 이후 실행에선 안 뜬다.
- [ ] "건너뛰기"가 상단 노치/헤더에 **가리지 않는다**(safe-area 인셋 반영).
- [ ] 첫 카드 **캡처 흐름 모션 그래픽**이 하나의 연결된 흐름(스크린샷이 화면→좌하단 축소→탭해서 다시 확대되어 편집→공유 시트 올라옴→위시 담기 폼 올라옴)으로 자연스럽게 반복되고, 각 탭 대상 도형이 밝아지는 펄스로 딱 맞게 강조된다(하단 점·스크롤바 없음. 실제 스크린샷 PNG 교체 여부는 여기서 판단).
- [ ] 카드 좌우 스와이프·도트 전환·"다음"/"시작하기" 버튼이 정상 동작한다.
- [ ] "시작하기" 후 **카테고리 코치마크** 구멍이 홈 "카테고리 추가" 알약에 맞는다(좌표 미세조정 필요 시 기록).
- [ ] "다음" → **등록 폼이 자동으로 열리고**, 코치마크가 **등록 폼 위에 정상적으로 겹쳐** 이미지 박스 → "방금 캡처한 사진" 순으로 뜬다(사진 선택창·권한창은 뜨지 않음). ※ 이전에 코치마크가 폼에 가리던 문제를 등록 화면 자체 렌더로 수정 — 재확인.
- [ ] 구멍/툴팁 좌표가 등록 폼 요소에 대체로 맞는다(미세조정 필요 시 기록).
- [ ] "시작하기"로 종료하면 등록 폼이 닫히고 홈으로 돌아온다. 중간 "건너뛰기"도 동일하게 안전 종료.
- [ ] **공유 시트로 앱을 열면 온보딩이 인텐트 처리를 막지 않는다**(온보딩 미노출, 공유 흐름 우선). 그 다음 일반 실행에서 온보딩이 노출된다.
- [ ] 대상 측정 실패(예: 대상 미마운트) 시 크래시 없이 온보딩이 조용히 완료된다.
- [ ] 손쉬운 사용 > 동작 줄이기(reduce-motion) ON 이면 전환/도트 애니메이션 없이 정적으로 표시된다.
