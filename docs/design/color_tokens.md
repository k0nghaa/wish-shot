# 위시샷 컬러 토큰

iOS 전용 · 2026-09-14 · v1.1 (wine 용도 확정)

## 토큰


| Token               | Light     | Dark      | 용도                                     | iOS 시스템 색           |
| ------------------- | --------- | --------- | -------------------------------------- | ------------------- |
| `background`        | `#FFFFFF` | `#000000` | 화면 배경                                  | `.systemBackground` |
| `backgroundGrouped` | `#F2F2F7` | `#1C1C1E` | 카드·그룹 배경                               | `.systemGray6`      |
| `placeholder`       | `#D1D1D6` | `#3A3A3C` | 이미지 로딩 전 타일                            | `.systemGray4`      |
| `separator`         | `#C6C6C8` | `#38383A` | 구분선, 비활성 칩 테두리, 탭바 상단선                 | `.separator`        |
| `label`             | `#000000` | `#FFFFFF` | 제목·본문·링크, 주요 버튼 채움, 활성 칩·탭, 선택 테두리     | `.label`            |
| `labelSecondary`    | `#8E8E93` | `#8E8E93` | 개수, 날짜, 보조 텍스트                         | `.secondaryLabel`   |
| `inactive`          | `#AEAEB2` | `#636366` | 비활성 탭·아이콘                              | `.systemGray2`      |
| `silver`            | `#AEAEB2` | `#AEAEB2` | 쇼핑카트 아이콘 전용                            | 직접 등록               |
| `wine`              | `#7A2231` | `#A83A4E` | 하트, 찜 카운트, 찜 칩 하트, New 점, 탭바 배지, 앱 아이콘 | 직접 등록               |
| `destructive`       | `#FF3B30` | `#FF453A` | 삭제, 에러                                 | `.systemRed`        |


Asset Catalog에 직접 등록할 것은 `silver`, `wine` 둘. 나머지는 iOS 시스템 색을 그대로 호출한다.

## 규칙

1. `wine`은 아래 여섯 자리 밖에서는 쓰지 않는다.
  - 앱 안: 하트(찜), 찜 카운트 숫자, 찜 필터 칩의 하트, New 점(새로 담긴 항목 타일 모서리, 6pt), 탭바 배지(새 항목 개수)
  - 앱 밖: 앱 아이콘
  - 탭바 배지는 iOS 기본 빨강 대신 `wine`으로 교체한다 (`UITabBarItem.badgeColor`).
2. `wine`과 `destructive`를 같은 컴포넌트에 함께 쓰지 않는다. 삭제·에러는 항상 `destructive`.
3. `silver`는 쇼핑카트 아이콘에만 쓴다. 라이트에서 `inactive`와 값이 같아도 이름을 분리한 이유는, 카트 색은 다크에서도 바꾸지 않고 브랜드 시그니처로 고정하기 위해서다.
4. 사진 위 하트는 `wine` 채움 + 흰색 1pt 외곽선. 다크 모드는 검정 20% 그림자(y 1pt, blur 2pt) 추가. 통제된 배경(칩·텍스트 옆)에서는 외곽선 없이 `wine` 단독.
5. `wine` 다크 값을 조정할 때는 색상·채도를 고정하고 명도만 움직인다.
6. 회색은 새로 만들지 않는다. 필요하면 systemGray 1~6 중 가장 가까운 것을 쓴다.

## 대비 참고 (WCAG)


| 조합                                   | 대비      | 판정            |
| ------------------------------------ | ------- | ------------- |
| `wine` #7A2231 on white              | 9.8 : 1 | 텍스트 OK        |
| `wine` #A83A4E on black              | 3.4 : 1 | 아이콘·대형 텍스트 OK |
| `wine` #A83A4E on `placeholder` dark | 1.8 : 1 | 외곽선 필수        |
| `labelSecondary` on white            | 3.0 : 1 | 보조 텍스트만       |
| `silver` on white                    | 2.0 : 1 | 아이콘만, 텍스트 금지  |


## 구현

- **Xcode**: Asset Catalog에 `silver`, `wine` Color Set 생성, Appearances = Any + Dark. 코드에서 `Color("wine")`, `Color("silver")`.
- **Figma**: Variables Collection `Color`, Mode Light/Dark. 위 표 10개를 그대로 변수로 등록.

