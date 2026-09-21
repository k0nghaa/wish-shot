import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { colors, radius, shadow, spacing, type } from '@/constants/theme';

// 첫 카드 데모: "피드에서 캡처 → 좌하단 썸네일 탭 → 편집 화면이 올라옴 → 공유 아이콘 탭 → 공유 시트가 올라옴"
// 을 하나의 연결된 흐름으로 반복하는 코드 모션 그래픽. 레이어를 쌓고 단계마다 탭 링 힌트 + 슬라이드업으로
// 인과를 잇는다. 실제 스크린샷(인물·브랜드 포함)을 싣지 않고 흐름만 재현 — 에셋 불필요·토큰 기반.
const STEP_MS = 1700;
const STEPS = 4; // 0: 피드 캡처 / 1: 썸네일 탭 / 2: 편집→공유 탭 / 3: 공유 시트
const FRAME_W = 200;
const FRAME_H = 316;

// 탭 링을 각 단계의 상호작용 지점에 놓는다(프레임 좌표, 실기기 미세조정 전제).
const RING = 44;
const RING_POS: Record<number, { left: number; top: number }> = {
  1: { left: 12, top: 236 }, // 좌하단 캡처 썸네일
  2: { left: 126, top: 6 }, // 편집 상단바 공유 아이콘
  3: { left: 20, top: 244 }, // 공유 시트 WishShot 타일
};

export function CaptureFlowMock() {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (!cancelled) setReduceMotion(v);
      })
      .catch(() => {
        /* 조회 실패는 기본값(애니메이션 유지) */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) return; // 정적: 아래 activeStep 이 공유 시트로 고정
    const id = setInterval(() => setStep((s) => (s + 1) % STEPS), STEP_MS);
    return () => clearInterval(id);
  }, [reduceMotion]);

  const activeStep = reduceMotion ? 3 : step;

  // 레이어 상태(0~1)를 단계에 맞춰 부드럽게 전환. 편집·공유는 아래에서 위로 슬라이드업.
  const feedOpacity = useSharedValue(1);
  const thumbUp = useSharedValue(0);
  const editUp = useSharedValue(0);
  const shareUp = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    const d = reduceMotion ? 0 : 450;
    feedOpacity.value = withTiming(activeStep >= 2 ? 0 : 1, { duration: d });
    thumbUp.value = withTiming(activeStep >= 1 ? 1 : 0, { duration: d });
    editUp.value = withTiming(activeStep >= 2 ? 1 : 0, { duration: d });
    shareUp.value = withTiming(activeStep >= 3 ? 1 : 0, { duration: d });
  }, [activeStep, reduceMotion, feedOpacity, thumbUp, editUp, shareUp]);

  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, false);
  }, [reduceMotion, pulse]);

  const feedStyle = useAnimatedStyle(() => ({ opacity: feedOpacity.value }));
  const thumbStyle = useAnimatedStyle(() => ({ opacity: thumbUp.value, transform: [{ translateY: (1 - thumbUp.value) * 40 }] }));
  const editStyle = useAnimatedStyle(() => ({ opacity: editUp.value, transform: [{ translateY: (1 - editUp.value) * FRAME_H }] }));
  const shareStyle = useAnimatedStyle(() => ({ opacity: shareUp.value, transform: [{ translateY: (1 - shareUp.value) * FRAME_H }] }));
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ scale: 0.7 + pulse.value * 0.6 }], opacity: 0.7 * (1 - pulse.value) }));

  const ringPos = RING_POS[activeStep];

  return (
    <View style={styles.frame}>
      {/* 피드 레이어(캡처 썸네일 포함) */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.layer, feedStyle]} pointerEvents="none">
        <View style={styles.statusRow}>
          <Text style={styles.statusTime}>9:41</Text>
          <SymbolView name="wifi" size={11} tintColor={colors.textSub} />
        </View>
        <View style={styles.feedHeader}>
          <View style={styles.avatar} />
          <View style={styles.line60} />
        </View>
        <View style={styles.feedImage}>
          <SymbolView name="photo" size={30} tintColor={colors.silverDark} />
        </View>
        <View style={styles.feedActions}>
          <SymbolView name="heart" size={16} tintColor={colors.textMain} />
          <SymbolView name="bubble.right" size={16} tintColor={colors.textMain} />
          <SymbolView name="paperplane" size={16} tintColor={colors.textMain} />
          <View style={styles.flex} />
          <SymbolView name="bookmark" size={16} tintColor={colors.textMain} />
        </View>
        <View style={styles.line80} />
        <Animated.View style={[styles.capturedThumb, thumbStyle]}>
          <SymbolView name="photo" size={16} tintColor={colors.silverDark} />
        </Animated.View>
      </Animated.View>

      {/* 편집 레이어(아래서 위로) */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.layer, editStyle]} pointerEvents="none">
        <View style={styles.editBar}>
          <SymbolView name="xmark.circle.fill" size={22} tintColor={colors.silverDark} />
          <View style={styles.flex} />
          <SymbolView name="pencil.tip.crop.circle" size={20} tintColor={colors.textMain} />
          <View style={styles.editShare}>
            <SymbolView name="square.and.arrow.up" size={16} tintColor={colors.bg} />
          </View>
          <SymbolView name="checkmark.circle.fill" size={22} tintColor={colors.textMain} />
        </View>
        <View style={styles.editImage}>
          <SymbolView name="photo" size={34} tintColor={colors.silverDark} />
        </View>
        <Text style={styles.editCaption}>자르기 및 크기 조절</Text>
      </Animated.View>

      {/* 공유 시트 레이어(아래서 위로, 뒤 딤) */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.shareLayer, shareStyle]} pointerEvents="none">
        <ShareSheetMock />
      </Animated.View>

      {/* 탭 링 힌트(상호작용 지점) */}
      {ringPos ? <Animated.View style={[styles.ring, ringPos, ringStyle]} pointerEvents="none" /> : null}

      {/* 단계 진행 힌트 */}
      <View style={styles.progress}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.progressDot, activeStep === i && styles.progressDotOn]} />
        ))}
      </View>
    </View>
  );
}

// 공유 시트 앱 행 목업(위시샷 타일 강조). 장면 3 및 단독 사용 가능.
const APPS: { icon: SymbolViewProps['name']; label: string }[] = [
  { icon: 'doc.on.doc', label: '복사' },
  { icon: 'person.crop.circle', label: '연락처' },
  { icon: 'printer', label: '프린트' },
];

export function ShareSheetMock() {
  return (
    <View style={styles.sheet}>
      <View style={styles.grabber} />
      <View style={styles.previewRow}>
        <View style={styles.previewThumb}>
          <SymbolView name="photo" size={18} tintColor={colors.silverDark} />
        </View>
        <View style={styles.previewMeta}>
          <View style={[styles.metaLine, { width: '70%' }]} />
          <View style={[styles.metaLine, { width: '45%' }]} />
        </View>
      </View>
      <View style={styles.appsRow}>
        {/* 위시샷 타일 — 강조(검정 배경 + 링) */}
        <View style={styles.app}>
          <View style={styles.appIconActive}>
            <SymbolView name="heart.fill" size={20} tintColor={colors.bg} />
          </View>
          <Text style={[styles.appLabel, styles.appLabelActive]} numberOfLines={1}>
            WishShot
          </Text>
        </View>
        {APPS.map((a) => (
          <View key={a.label} style={styles.app}>
            <View style={styles.appIcon}>
              <SymbolView name={a.icon} size={18} tintColor={colors.silverDark} />
            </View>
            <Text style={styles.appLabel} numberOfLines={1}>
              {a.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  frame: {
    width: FRAME_W,
    height: FRAME_H,
    borderRadius: radius.lg,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.silver,
    overflow: 'hidden',
    ...shadow.card,
  },
  layer: { backgroundColor: colors.bg, padding: spacing.two, gap: spacing.two },
  progress: {
    position: 'absolute',
    bottom: spacing.one,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.one,
  },
  progressDot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.silver },
  progressDotOn: { backgroundColor: colors.primary },
  ring: {
    position: 'absolute',
    width: RING,
    height: RING,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.primary,
  },

  // 피드
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusTime: { fontSize: 11, fontWeight: '600', color: colors.textSub },
  feedHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.two },
  avatar: { width: 22, height: 22, borderRadius: radius.pill, backgroundColor: colors.placeholder },
  line60: { height: 8, width: '60%', borderRadius: radius.pill, backgroundColor: colors.silver },
  line80: { height: 8, width: '80%', borderRadius: radius.pill, backgroundColor: colors.silver },
  feedImage: { flex: 1, borderRadius: radius.sm, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
  feedActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.three },
  capturedThumb: {
    position: 'absolute',
    left: spacing.two,
    bottom: spacing.four,
    width: 46,
    height: 68,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.floating,
  },

  // 편집
  editBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.two },
  editShare: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editImage: { flex: 1, borderRadius: radius.md, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
  editCaption: { ...type.caption, color: colors.textSub, textAlign: 'center' },

  // 공유 시트
  shareLayer: { backgroundColor: colors.overlay, justifyContent: 'flex-end', padding: spacing.two },
  sheet: { width: '100%', backgroundColor: colors.bg, borderRadius: radius.lg, padding: spacing.two, gap: spacing.two, ...shadow.card },
  grabber: { alignSelf: 'center', width: 32, height: 4, borderRadius: radius.pill, backgroundColor: colors.silver },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.two },
  previewThumb: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.placeholder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewMeta: { flex: 1, gap: spacing.one },
  metaLine: { height: 7, borderRadius: radius.pill, backgroundColor: colors.silver },
  appsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  app: { alignItems: 'center', gap: spacing.one, width: 52 },
  appIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.silver,
  },
  appIconActive: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  appLabel: { ...type.caption, color: colors.textSub },
  appLabelActive: { color: colors.textMain, fontWeight: '700' },
});
