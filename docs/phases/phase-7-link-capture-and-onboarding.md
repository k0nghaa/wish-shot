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
    - **재진입 가드**: 홈 처리 effect를 `useIsFocused()`(expo-router export)로 게이팅(등록/링크붙이기 화면이 위에 떠 있으면 대기) + `shareHandled` ref 로 같은 인텐트 중복 push 잠금. 처리 직전 `resetShareIntent()` → `hasShareIntent` 내려가면 ref 해제. **push 사용**(연속 공유 시 replace/스택리셋 필요 여부는 실기기 관찰 후 결정 — 미결).
  - **링크붙이기 모드(`(tabs)/all.tsx`)**: `useLocalSearchParams`의 `attachLink`를 **단일 소스**로 삼음(별도 상태 없음 — 재진입 시 새 URL 그대로 반영, setState-in-effect 회피). 모드 진입 시 헤더 `링크 저장`+`취소`, 상단 배너("링크를 저장할 스크린샷을 선택하세요.")+**[새로 담기]**. 타일 탭 → `/item/[id]/edit`(`linkPrefill`), [새로 담기] → `/register`(`sourceLink`). 두 동선 모두 진입 전 `router.setParams({ attachLink: '' })`로 모드 종료(돌아오면 일반 탭). 빈 그리드면 링크붙이기용 EmptyState(“새로 담기”만). **A-2 선택 모드와 상호 배타**: attachMode가 렌더를 지배(선택 UI·FAB 숨김), 진입 시 잔여 선택 모드는 effect로 접음.
  - **편집 프리필(`item/[id]/edit.tsx`)**: `linkPrefill` 파라미터 추가. 아이템 로드 후 기존 `source_link`가 **비어 있으면 프리필**, **이미 있고 다르면** Alert `링크 교체`(유지/교체)로 확인 후에만 반영(무단 덮어쓰기 없음).
  - **등록 프리필 + 최근사진 제안(`register.tsx`)**: `sourceLink` 파라미터로 링크 필드 초기값. 이미지가 없을 때 **"방금 캡처한 사진 담기"** 버튼 노출 → 탭 시 `getRecentPhotoAsset()`로 최근 1장을 `imageUri`로 설정(기존 OCR/AI 파이프라인 자동 실행). **결정(미결 해소)**: 무단 권한창을 피하려 **자동 프리로드 대신 탭-투-로드**로 구현 — 제안을 처음 **탭할 때만** 사진 권한을 요청(HIG 적시요청). 거부·제한이거나 사진 없음이면 제안을 숨기고 안내 후 일반 "사진 선택"만 남김. 콘텐츠 타입은 uri 확장자로 추정(iOS 스크린샷=png).
  - **신규 `src/lib/photoLibrary.ts`**: `getRecentPhotoAsset(): Promise<{uri, assetId} | null>`만 추가(**`deletePhotoAsset`은 Batch C — 만들지 않음**). `getPermissionsAsync`(무프롬프트) → 미허용 시 `requestPermissionsAsync` → `getAssetsAsync({ first:1, mediaType:'photo', sortBy:[['creationTime', false]] })`로 **최신순 1장**. **iOS `ph://` uri 는 expo-file-system 으로 못 읽으므로 `getAssetInfoAsync().localUri`(file://)를 확보해 반환**(없으면 원 uri 폴백). 권한 거부·사진 없음·조회 실패는 모두 null. (top-level 에서 legacy `MediaType`/`SortBy` 상수가 Next 버전에 가려져 안 보여, `getAssetsAsync`의 파라미터 타입을 문맥 타입으로 뽑아 문자열 리터럴로 넘김.)
  - **회귀**: 이미지 공유 경로는 URL 분기 뒤에 그대로 유지(`type==='media'` → webUrl null → 이미지 branch). 문서: `CLAUDE.md` 데이터 흐름·라우트·`src/lib` 갱신.
  - **실기기 검증(사람 체크리스트 — "검증 완료" 단정 아님)**: 아래 "실기기 검증(체크리스트)" 참조.
- **Batch C**: (완료일 / assetId 취득·삭제·권한 흐름 / 전체접근 assetId non-null 확인 / 폴백 / 이슈)
- **Batch D**: (완료일 / 카드·스포트라이트 구현 / 대상·문구 / 접근성 / 이슈)
