/**
 * WishShot 디자인 토큰 (Phase 5 — 목업 팔레트)
 *
 * 흰 배경(#FFFFFF) + iOS 시스템 그레이 모노톤. 버튼·활성 = 검정(label).
 * 색 정본: docs/design/color_tokens.md, 매핑: docs/design/phase-5-visual-spec.md
 *
 * ⚠️ 토큰 "이름"은 현행을 유지하고 "값"만 교체했다(전 화면 자동 전파, 소비부 무변경 원칙).
 *    - primary = 검정(주요 버튼·활성·선택)
 *    - accent  = wine(#7A2231) — 찜·New·탭바 배지 전용(Phase 6). Phase 5 화면엔 거의 미노출.
 *    - primaryHover·primaryLight 는 제거됨(세이지 전용이었음).
 *
 * 컴포넌트에는 원시 hex를 직접 쓰지 말고 이 시맨틱 토큰만 사용한다. (CLAUDE.md 규칙 5)
 */

import { Platform, StyleSheet } from 'react-native';

export const colors = {
  // 브랜드 포인트
  primary: '#000000', // label — 주요 버튼·활성·선택 (검정)
  accent: '#7A2231', // wine — 찜·New·탭바 배지 전용(Phase 6). 강조가 꼭 필요할 때만.

  // 배경
  bg: '#FFFFFF', // background — 화면 배경(흰색)
  bgCard: '#F2F2F7', // backgroundGrouped — 카드·그룹 배경
  placeholder: '#D1D1D6', // 이미지 로딩 전 타일

  // 그레이 뉴트럴
  silver: '#C6C6C8', // separator — 구분선·비활성 칩 테두리
  silverDark: '#AEAEB2', // inactive — 비활성 탭·아이콘·placeholder 텍스트

  // 텍스트
  textMain: '#000000', // label — 제목·본문·링크
  textSub: '#8E8E93', // labelSecondary — 개수·날짜·보조
  textDisabled: '#AEAEB2', // inactive — 비활성 텍스트

  // 기능성
  success: '#34C759', // systemGreen — 저장 완료 등(현재 미소비)
  warning: '#FF9500', // systemOrange — 주의 상태(현재 미소비)
  error: '#FF3B30', // destructive(systemRed) — 삭제·에러

  // 오버레이 (모달 배경 딤)
  overlay: 'rgba(0,0,0,0.4)',
} as const;

export type ColorToken = keyof typeof colors;

/**
 * 다크 토큰 — 준비만 하고 Phase 5는 소비하지 않는다(스위칭은 Phase 6).
 * 현행 이름을 그대로 미러링해 나중에 드롭인 교체가 되게 한다.
 */
export const colorsDark: Record<ColorToken, string> = {
  primary: '#FFFFFF',
  accent: '#A83A4E', // wine (Dark)
  bg: '#000000',
  bgCard: '#1C1C1E',
  placeholder: '#3A3A3C',
  silver: '#38383A', // separator (Dark)
  silverDark: '#636366', // inactive (Dark)
  textMain: '#FFFFFF',
  textSub: '#8E8E93',
  textDisabled: '#636366',
  success: '#30D158',
  warning: '#FF9F0A',
  error: '#FF453A',
  overlay: 'rgba(0,0,0,0.6)',
};

/** 간격 스케일 (4pt 기반) */
export const spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** 모서리 반경 스케일 (iOS 톤) */
export const radius = {
  sm: 8,
  md: 10,
  lg: 14, // 카드·이미지 슬롯
  pill: 999, // 알약(탭바·칩·버튼)
} as const;

/** 헤어라인 두께 (기기 픽셀 밀도에 맞춘 최소 선) */
export const hairlineWidth = StyleSheet.hairlineWidth;

/**
 * 타이포 스케일 (iOS 시스템 폰트 기준). 색은 별도 지정(여기선 크기/두께만).
 * 컴포넌트에서 `...type.body` 처럼 펼쳐 쓴다.
 */
export const type = {
  largeTitle: { fontSize: 34, fontWeight: '700' as const, letterSpacing: 0.37 },
  title: { fontSize: 22, fontWeight: '700' as const },
  title3: { fontSize: 20, fontWeight: '600' as const },
  headline: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 17, fontWeight: '400' as const },
  subhead: { fontSize: 15, fontWeight: '400' as const },
  footnote: { fontSize: 13, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
} as const;

/** 얕은 그림자 (카드·플로팅 알약). iOS 기준. */
export const shadow = {
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  floating: {
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
} as const;

export const fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
});
