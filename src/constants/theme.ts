/**
 * WishShot 디자인 토큰 (v1 팔레트 승계)
 *
 * 세이지 그린 primary / 테라코타 accent / 실버 그레이 뉴트럴.
 * 원본: web-v0 태그 `src/index.css`의 @theme (백업: docs/archive/theme-tokens-v1.css)
 *
 * 컴포넌트에는 원시 hex를 직접 쓰지 말고 이 시맨틱 토큰만 사용한다. (CLAUDE.md 규칙 5)
 */

import { Platform } from 'react-native';

export const colors = {
  // 브랜드 포인트
  primary: '#6b8f71', // Sage Green - 주요 버튼, 활성 상태
  primaryHover: '#567260', // 눌림/호버 상태
  primaryLight: '#ebf2ec', // 배경 틴트 - 활성 탭 배경 등
  accent: '#c4714a', // Terracotta - 포인트 컬러

  // 실버 그레이 베이스
  bg: '#f4f5f7', // 전체 배경
  bgCard: '#ffffff', // 카드 배경
  silver: '#e8eaed', // 카드 테두리, 구분선
  silverDark: '#c4c8cf', // 비활성 아이콘, 보조 요소

  // 텍스트
  textMain: '#1c1c1e', // 제목, 주요 텍스트
  textSub: '#6b7280', // 부제목, 설명
  textDisabled: '#9ca3af', // 비활성 텍스트, placeholder

  // 기능성
  success: '#22c55e', // 저장 완료, 분석 성공
  error: '#ef4444', // 에러 인풋 테두리, 에러 메시지
  warning: '#f59e0b', // 로딩 중, 주의 상태

  // 오버레이 (모달 배경 딤) — textMain(#1c1c1e) 기반
  overlay: 'rgba(28,28,30,0.45)',
} as const;

export type ColorToken = keyof typeof colors;

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
