# Phase 5 비주얼 명세 (목업 리스킨)

> **색 토큰 정본 = [`color_tokens.md`](./color_tokens.md)** (같은 폴더). 이 문서는 그 토큰을 **`theme.ts`에 어떻게 매핑할지** + **화면별 리스킨 지시**만 담는다. 색 값의 단일 출처는 정본 파일이다(중복 정의 금지).
>
> 화면 정본 = `docs/design/`의 스크린샷 `M1_home.png` · `M2_folder.png` · `M3_addWish.png` · `M6_itemDetail.png` · `M7_itemInformation.png`(라이트). 원본 목업 `Wish-Shot-mockup.html`은 자기압축이라 스크린샷을 정본으로 삼는다.
>
> **번역 원칙**: 목업은 HTML/CSS, RN은 캐스케이드·CSS grid 없음·flex 기본값 다름. **값(색·간격·radius·폰트)만 토큰으로 옮기고 레이아웃은 RN(FlatList/flex)로 재구현.** 목업의 "or browse files / 회색 타일 / 점선 테두리"는 **이미지 슬롯 플레이스홀더**이지 실제 UI가 아니다(실제 앱은 signed URL 썸네일 또는 빈 `placeholder` 타일).

## ⚠️ 배경은 흰색이다

목업 캔버스의 웜 그레이지(`#ECEAE5`)는 **디자인 툴 캔버스 색**이지 앱 배경이 아니다. 실제 앱 배경은 정본 토큰 `background` = **`#FFFFFF`(Light) / `#000000`(Dark)**. 스크린샷 모두 흰 배경.

## theme.ts 매핑 (Light 기준, 토큰 값은 정본 파일)

| 현재 theme.ts | → 정본 토큰 | Light 값 | 비고 |
|---|---|---|---|
| `bg` | `background` | `#FFFFFF` | 화면 배경(흰색) |
| `bgCard` | `backgroundGrouped` | `#F2F2F7` | 카드·그룹 배경 |
| (신규) | `placeholder` | `#D1D1D6` | 이미지 로딩 전 타일 |
| `silver` | `separator` | `#C6C6C8` | 구분선·비활성 칩 테두리 |
| `silverDark` | `inactive` | `#AEAEB2` | 비활성 탭·아이콘·placeholder 텍스트 |
| `textMain` | `label` | `#000000` | 제목·본문·링크 + **주요 버튼·활성 칩/탭·선택 테두리** |
| `textSub` | `labelSecondary` | `#8E8E93` | 개수·날짜·보조 |
| `textDisabled` | `inactive` | `#AEAEB2` | |
| `primary`(현 세이지) | **`label`** | `#000000` | ⚠️ 버튼/활성색은 **검정** |
| `accent`(현 테라코타) | **`wine`** | `#7A2231` | ⚠️ **제한 사용**(아래) |
| `error` | `destructive` | `#FF3B30` | 삭제·에러 |
| (신규) | `silver`(정본) | `#AEAEB2` | 쇼핑카트 아이콘 전용 |

- 제거: `primaryHover`·`primaryLight`. 다크 값은 정본 Dark 열로 `colorsDark` 맵 준비만(Phase 5는 Light 소비).

## ⚠️ wine 사용 규칙 (정본 규칙 1·2)

`wine`은 **하트(찜)·찜 카운트·New 점·탭바 배지·앱 아이콘** 에만. 삭제·에러는 항상 `destructive`. → 그 자리는 **전부 Phase 6**(찜·New·탭바 배지). **Phase 5 화면색은 흑/백/회색 모노톤**, 와인은 토큰만 준비.

---

## 화면 명세 — Phase 5 대상

### 하단 탭바 (신규 — `src/app/_layout.tsx` 구조 변경)

- **알약(플로팅 pill) 형태**, `전체 / 폴더 / 검색` 3탭. 활성 = `label`(검정, 굵게/채움), 비활성 = `inactive` `#AEAEB2`.
- **폴더** = 현재 홈(M1). **전체** = 전체 아이템 그리드(M5, 단 **찜 필터·New 배지 제외** — Phase 6). **검색** = **플레이스홀더 화면 "검색 기능 추가 예정"만**(기능 미구현).
- ⚠️ 목업의 **전체 탭 New 카운트 배지(빨강 원 "3", = wine)** 는 **Phase 6**(New 상태 추적 필요).
- RN: Expo Router **Tabs** 그룹 `(tabs)/전체·폴더·검색` + 커스텀 `tabBar`(플로팅 알약, JS 전용). 상세/등록/편집/설정/태그는 탭 위 스택으로 push. **구조 변경이라 순수 리스킨보다 무겁다.**

### M1 — 폴더 홈 (`src/app/index.tsx` → `(tabs)/폴더` + `CategoryCard`) — `M1_home.png`
- 흰 배경. 상단 중앙 `[로고/심볼 추가 예정]`, 우상단 설정 기어(라인).
- **Large Title "폴더"**(~34 Bold) + 우측 **`+ | ···` 알약**(`backgroundGrouped`).
- 카테고리별 **2×2 모자이크 카드**: 대표 썸네일 4칸 + 이름 라벨 좌하단. radius ~14. 없으면 `placeholder` 타일. 빈 카테고리 노출 유지.
- 하단에 위 탭바. RN: `FlatList numColumns={2}`, 카드 내부 2×2 중첩 flex.

### M2 — 폴더 안 (`src/app/category/[id].tsx` + `ItemCard`) — `M2_folder.png`
- 헤더 `‹ 폴더` + 우 `···`. 제목 **"옷" + "12개"**(개수 `labelSecondary`).
- **3열 그리드**(현재 2열 → 3열), 정사각, 최신순. 검정 원형 FAB(+).
- ⚠️ 타일 **하트(우하단)·New 점(좌상단)** 은 **Phase 6**.
- RN: `FlatList numColumns={3}`.

### M3 — 위시 담기(등록) (`src/app/register.tsx` + 공용 폼) — `M3_addWish.png`
- 시트 헤더 **취소 / "위시 담기" / 저장**(텍스트 버튼 `label`).
- 상단 정사각 이미지 슬롯 → 미리보기/선택. **"○ AI가 제품 정보를 읽고 있어요…"** 상태 줄.
- 그룹 카드1: 제품명(필수 `*`)·브랜드·가격(`₩ 0`)·링크(`https://`). 라벨 좌/값 우, 헤어라인.
- 그룹 카드2: 폴더(`옷 ›`)·태그·메모. 태그 **선택=검정 채움(×)**, 후보=아웃라인, "입력 후 Enter".
- 리스킨: `FormField`·`CategoryPicker`·`TagInput`(편집 공용).

### M6 — 위시 상세(뷰어) (`src/app/item/[id]/index.tsx`) — `M6_itemDetail.png`
- 뷰어형으로 **재구성**: 원형 `‹` 백 · **제목 알약**(제품명 굵게 / `Dickies · ₩ 54,400`) · 원형 `···`.
- 큰 이미지(`placeholder` 톤, radius ~14). **탭 → 풀스크린 뷰어**(원본 비율 `contentFit:"contain"`, 원본 온전).
- **하단 액션바(알약)**: Phase 5는 **정보(i) · 링크 열기 · 편집 · 삭제**. (⚠️ **공유·찜은 Phase 6**. 삭제=`destructive`.)
- **정보(i) → M7 정보 하프시트 오픈**(아래). 상세의 상세정보는 이 시트로 이동.
- ⚠️ **폴더 내 필름스트립(하단 썸네일 줄)** 은 **Phase 6**(폴더 내 좌우 이동 필요).

### M7 — 정보 하프시트 (신규, Phase 5 포함) — `M7_itemInformation.png`
- 상세(M6) 위 **반시트**(딤 배경 + 상단 드래그 핸들). 헤더 **"정보"**(Large, `label`) 좌 / **"편집"**(텍스트 버튼) 우 → 편집 화면.
- 그룹 카드1: **제품명 / 브랜드 / 가격 / 링크**(링크는 탭 → `openLink`). 라벨 좌(`labelSecondary`)/값 우(`label`), 헤어라인.
- 그룹 카드2: **폴더**(값 우) / **메모**(라벨 아래 전체폭 텍스트) / **태그**(아웃라인 칩).
- 푸터: **"…에 담음"**(담은 시각 = `created_at`) `labelSecondary`.
  - ⚠️ 목업의 **"· 인스타그램에서 공유"(출처 앱)** 는 **현재 미저장 데이터**. → 데이터 없으면 **담은 시각만** 표시(출처 문구 생략), 또는 Phase 6에서 출처 저장 추가.
- RN: **기본 = expo-router `formSheet` + `sheetAllowedDetents`([0.5, 1.0])**. `react-native-screens`(이미 설치)의 진짜 iOS 네이티브 반시트 — 그래버·detents·드래그 다운 닫기, **새 의존성·재빌드 0**. 커스터마이즈가 더 필요하면 `@gorhom/bottom-sheet`(순수 JS, 설치된 reanimated/gh 위, 재빌드 0). 최후 폴백만 수제 `Modal`.

---

## ⏸ Phase 6 (참고만)

- **찜(하트) · New 점 · 탭바 New 배지(← wine 등장)** · **검색 기능**(Phase 5는 플레이스홀더).
- **전체 탭 찜 필터 칩** · **M4 빠른 담기 팝업**(공유 진입) · **상세 필름스트립** · **상세 공유 액션**.
- 출처 앱("인스타그램에서 공유") 저장 · 다크 모드 실적용 · 이메일 가입/승격.

## RN 구현 주의

- CSS `grid` → `FlatList numColumns`. 하프시트 → `Modal` 기반(네이티브 라이브러리 금지). 그림자 얕게. 헤어라인 `hairlineWidth`+`separator`. Light만 소비.
- 탭바 도입 = `_layout` 구조 변경(가장 무거운 작업). 커스텀 알약 `tabBar`.
- 폴더 2×2 모자이크 대표 4장 규칙 미결(예: 최신 4장).

## 미결 (구현 세션)

- **토큰 네이밍**: 현행 이름 유지+값 교체(저비용, 권장) vs 정본 이름 채택(명확·리네임 비용).
- 카테고리목록 2열 → 3열 / "카테고리 → 폴더" 용어 교체 / 풀스크린 뷰어 핀치 줌 / 설정 로그아웃 처리.
