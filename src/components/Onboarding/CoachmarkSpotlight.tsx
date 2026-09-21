import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';

import { colors, radius, shadow, spacing, type } from '@/constants/theme';
import type { TargetRect } from './onboardingTarget';

// 구멍이 대상보다 살짝 넉넉하도록 여백을 준다.
const HOLE_PAD = 8;
// 툴팁 카드 최대 폭(양쪽 여백 확보).
const TOOLTIP_MAX_WIDTH = 300;

type Props = {
  target: TargetRect;
  text: string;
  /** 다음/시작하기 등 주 버튼 라벨. */
  primaryLabel: string;
  /** 주 버튼·배경 탭 시 다음 단계로. */
  onPrimary: () => void;
  /** 있으면 툴팁에 "건너뛰기"를 노출하고 전체 투어를 종료한다. */
  onSkip?: () => void;
};

/**
 * 둥근 마스크 코치마크 스포트라이트.
 * 전체 화면 딤(overlay) 위에 react-native-svg <Mask> 로 대상 요소 자리에 둥근(스타디움) 구멍을 뚫고,
 * 그 근처에 안내 툴팁을 띄운다. 배경/버튼 탭 = 다음 단계, "건너뛰기" = 전체 종료.
 */
export function CoachmarkSpotlight({ target, text, primaryLabel, onPrimary, onSkip }: Props) {
  const { width, height } = useWindowDimensions();

  // 구멍(패딩 포함). 화면 밖으로 나가지 않게 클램프.
  const holeX = Math.max(0, target.x - HOLE_PAD);
  const holeY = Math.max(0, target.y - HOLE_PAD);
  const holeW = Math.min(width - holeX, target.width + HOLE_PAD * 2);
  const holeH = Math.min(height - holeY, target.height + HOLE_PAD * 2);
  const rx = holeH / 2; // 알약 대상에 맞춘 스타디움 구멍

  // 구멍이 화면 위쪽에 있으면 툴팁을 아래에, 아래쪽이면 위에 놓는다.
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
    paddingVertical: spacing.one,
    paddingHorizontal: spacing.three,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  tooltipBtnText: { fontSize: 14, fontWeight: '700', color: colors.bg },
});
