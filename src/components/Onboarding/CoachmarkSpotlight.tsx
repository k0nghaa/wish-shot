import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';

import { colors, radius, shadow, spacing, type } from '@/constants/theme';
import type { TargetRect } from './onboardingTarget';

// 툴팁 카드 최대 폭(양쪽 여백 확보).
const TOOLTIP_MAX_WIDTH = 300;

type Props = {
  /** 강조 대상 사각형(스포트라이트가 그려지는 컨테이너 로컬 좌표). */
  target: TargetRect;
  text: string;
  /** 다음/시작하기 등 주 버튼 라벨. */
  primaryLabel: string;
  /** 주 버튼·배경 탭 시 다음 단계로. */
  onPrimary: () => void;
  /** 있으면 툴팁에 "건너뛰기"를 노출하고 전체 투어를 종료한다. */
  onSkip?: () => void;
  /** 스포트라이트가 그려지는 컨테이너 크기. 없으면 화면 전체 기준. */
  containerSize?: { width: number; height: number };
  /** 구멍 모양 — 알약(스타디움) 또는 둥근 정사각/사각. 기본 pill. */
  shape?: 'pill' | 'square';
  /** square 일 때 모서리 반경. */
  holeRadius?: number;
  /** 대상보다 구멍을 얼마나 크게 할지(여백). */
  holePad?: number;
};

/**
 * 코치마크 스포트라이트. 컨테이너 딤(overlay) 위에 react-native-svg <Mask> 로 대상 자리에 구멍을 뚫고,
 * 구멍 테두리(흰 프레임)와 안내 툴팁을 얹는다. 배경/버튼 탭 = 다음 단계, "건너뛰기" = 전체 종료.
 * 좌표는 target(컨테이너 로컬) 기준이라, 호출부가 시트 오프셋을 보정해 넘기면 정확히 맞는다.
 */
export function CoachmarkSpotlight({
  target,
  text,
  primaryLabel,
  onPrimary,
  onSkip,
  containerSize,
  shape = 'pill',
  holeRadius,
  holePad = 8,
}: Props) {
  const win = useWindowDimensions();
  const width = containerSize?.width ?? win.width;
  const height = containerSize?.height ?? win.height;

  // 구멍(패딩 포함). 컨테이너 밖으로 나가지 않게 클램프.
  const holeX = Math.max(0, target.x - holePad);
  const holeY = Math.max(0, target.y - holePad);
  const holeW = Math.min(width - holeX, target.width + holePad * 2);
  const holeH = Math.min(height - holeY, target.height + holePad * 2);
  const rx = shape === 'square' ? (holeRadius ?? radius.lg) : holeH / 2;

  // 구멍이 컨테이너 위쪽에 있으면 툴팁을 아래에, 아래쪽이면 위에 놓는다.
  const holeCenterY = holeY + holeH / 2;
  const below = holeCenterY < height / 2;

  return (
    <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onPrimary} accessibilityRole="button" accessibilityLabel={primaryLabel}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <Mask id="spotlight-hole">
            {/* 흰 = 보임(딤), 검정 = 가려짐(구멍) */}
            <Rect x={0} y={0} width={width} height={height} fill="white" />
            <Rect x={holeX} y={holeY} width={holeW} height={holeH} rx={rx} ry={rx} fill="black" />
          </Mask>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={colors.overlay} mask="url(#spotlight-hole)" />
      </Svg>

      {/* 구멍 테두리(흰 프레임) — 대상 모양에 맞춰 강조 */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: holeX, top: holeY, width: holeW, height: holeH, borderRadius: rx, borderWidth: 2, borderColor: colors.bg }}
      />

      {/* 툴팁 + 버튼. 구멍 위치에 따라 위/아래로 붙인다. */}
      <View
        style={[styles.tooltipWrap, below ? { top: holeY + holeH + spacing.three } : { bottom: height - holeY + spacing.three }]}
        pointerEvents="box-none"
      >
        <View style={styles.tooltip}>
          <Text style={styles.tooltipText}>{text}</Text>
          <View style={styles.tooltipActions}>
            {onSkip ? (
              <TouchableOpacity onPress={onSkip} hitSlop={8} accessibilityRole="button" accessibilityLabel="건너뛰기">
                <Text style={styles.skip}>건너뛰기</Text>
              </TouchableOpacity>
            ) : (
              <View />
            )}
            <TouchableOpacity style={styles.tooltipBtn} onPress={onPrimary} accessibilityRole="button" accessibilityLabel={primaryLabel}>
              <Text style={styles.tooltipBtnText}>{primaryLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tooltipWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.three,
  },
  tooltip: {
    maxWidth: TOOLTIP_MAX_WIDTH,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: spacing.three,
    gap: spacing.three,
    ...shadow.floating,
  },
  tooltipText: { ...type.subhead, color: colors.textMain },
  tooltipActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  skip: { fontSize: 14, color: colors.textSub },
  tooltipBtn: {
    minHeight: 40,
    paddingVertical: spacing.two,
    paddingHorizontal: spacing.four,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tooltipBtnText: { fontSize: 15, fontWeight: '700', color: colors.bg },
});
