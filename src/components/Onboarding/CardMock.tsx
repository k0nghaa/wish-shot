import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { colors, radius, shadow, spacing, type } from '@/constants/theme';

// 첫 카드 데모: "캡처(좌하단 스크린샷 썸네일) → 썸네일 탭 → 편집 화면이 올라옴 → 공유 아이콘 탭 →
// 공유 시트가 올라옴 → WishShot 탭 → 위시 담기 폼이 올라옴"을 하나의 연결된 흐름으로 반복.
// 레이어를 쌓고 위 레이어가 아래서 위로 슬라이드업하며, 탭 대상은 도형 자체가 밝아지는 펄스로 강조한다.
// 실제 스크린샷(인물·브랜드 포함)을 싣지 않고 흐름만 재현 — 에셋 불필요·토큰 기반.
const STEP_MS = 1700;
const STEPS = 4; // 0: 캡처 / 1: 편집(공유 탭) / 2: 공유 시트(WishShot 탭) / 3: 위시 담기 폼
const FRAME_W = 200;
const FRAME_H = 316;

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
    if (reduceMotion) return; // 정적: 아래 activeStep 이 위시 담기 폼으로 고정
    const id = setInterval(() => setStep((s) => (s + 1) % STEPS), STEP_MS);
    return () => clearInterval(id);
  }, [reduceMotion]);

  const activeStep = reduceMotion ? 3 : step;

  const feedOpacity = useSharedValue(1);
  const thumbUp = useSharedValue(0);
  const editUp = useSharedValue(0);
  const shareUp = useSharedValue(0);
  const formUp = useSharedValue(0);
  const flash = useSharedValue(0);
  const pulse = useSharedValue(0); // 밝아짐 펄스(0↔1 breathing)

  useEffect(() => {
    const d = reduceMotion ? 0 : 450;
    feedOpacity.value = withTiming(activeStep >= 1 ? 0 : 1, { duration: d });
    thumbUp.value = withTiming(activeStep === 0 ? 1 : 0, { duration: d });
    editUp.value = withTiming(activeStep >= 1 ? 1 : 0, { duration: d });
    shareUp.value = withTiming(activeStep >= 2 ? 1 : 0, { duration: d });
    formUp.value = withTiming(activeStep >= 3 ? 1 : 0, { duration: d });
  }, [activeStep, reduceMotion, feedOpacity, thumbUp, editUp, shareUp, formUp]);

  // 캡처 순간의 화면 플래시(스텝 0 진입마다).
  useEffect(() => {
    if (reduceMotion || activeStep !== 0) return;
    flash.value = withSequence(withTiming(0.9, { duration: 120 }), withTiming(0, { duration: 320 }));
  }, [activeStep, reduceMotion, flash]);

  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [reduceMotion, pulse]);

  const feedStyle = useAnimatedStyle(() => ({ opacity: feedOpacity.value }));
  const thumbStyle = useAnimatedStyle(() => ({ opacity: thumbUp.value, transform: [{ translateY: (1 - thumbUp.value) * 40 }] }));
  const editStyle = useAnimatedStyle(() => ({ opacity: editUp.value, transform: [{ translateY: (1 - editUp.value) * FRAME_H }] }));
  const shareStyle = useAnimatedStyle(() => ({ opacity: shareUp.value, transform: [{ translateY: (1 - shareUp.value) * FRAME_H }] }));
  const formStyle = useAnimatedStyle(() => ({ opacity: formUp.value, transform: [{ translateY: (1 - formUp.value) * FRAME_H }] }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

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
          <Glow active={activeStep === 0} pulse={pulse} r={radius.sm} />
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
            <Glow active={activeStep === 1} pulse={pulse} r={radius.pill} />
          </View>
          <SymbolView name="checkmark.circle.fill" size={22} tintColor={colors.textMain} />
        </View>
        <View style={styles.editImage}>
          <SymbolView name="photo" size={34} tintColor={colors.silverDark} />
        </View>
        <Text style={styles.editCaption}>자르기 및 크기 조절</Text>
      </Animated.View>

      {/* 공유 시트 레이어(아래서 위로, 뒤 딤) — WishShot 타일 강조 */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.shareLayer, shareStyle]} pointerEvents="none">
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
            <View style={styles.app}>
              <View style={styles.appIconActive}>
                <SymbolView name="heart.fill" size={20} tintColor={colors.bg} />
                <Glow active={activeStep === 2} pulse={pulse} r={radius.md} />
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
      </Animated.View>

      {/* 위시 담기 폼 레이어(WishShot 탭 결과, 아래서 위로) */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.formLayer, formStyle]} pointerEvents="none">
        <View style={styles.formHeader}>
          <Text style={styles.formCancel}>취소</Text>
          <Text style={styles.formTitle}>위시 담기</Text>
          <Text style={styles.formSave}>저장</Text>
        </View>
        <View style={styles.formImageBox}>
          <SymbolView name="photo" size={26} tintColor={colors.silverDark} />
        </View>
        <View style={styles.formCard}>
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>제품명</Text>
            <View style={styles.aiBadge}>
              <Text style={styles.aiBadgeText}>AI</Text>
            </View>
            <View style={[styles.formValueLine, { flex: 1 }]} />
          </View>
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>가격</Text>
            <View style={[styles.formValueLine, { width: '40%' }]} />
          </View>
        </View>
      </Animated.View>

      {/* 캡처 플래시(최상단) */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.flash, flashStyle]} pointerEvents="none" />
    </View>
  );
}

// 대상 도형 자체가 밝아지는 펄스(탭 지점 강조). 요소 위에 흰색 오버레이를 얹어 밝게 한다.
function Glow({ active, pulse, r }: { active: boolean; pulse: SharedValue<number>; r: number }) {
  const style = useAnimatedStyle(() => ({ opacity: active ? pulse.value * 0.55 : 0 }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: r, backgroundColor: colors.bg }, style]} />;
}

const APPS: { icon: SymbolViewProps['name']; label: string }[] = [
  { icon: 'doc.on.doc', label: '복사' },
  { icon: 'person.crop.circle', label: '연락처' },
  { icon: 'printer', label: '프린트' },
];

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
  flash: { backgroundColor: colors.bg },

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
    overflow: 'hidden',
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
    overflow: 'hidden',
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
    overflow: 'hidden',
  },
  appLabel: { ...type.caption, color: colors.textSub },
  appLabelActive: { color: colors.textMain, fontWeight: '700' },

  // 위시 담기 폼
  formLayer: { backgroundColor: colors.bg, padding: spacing.two, gap: spacing.two },
  formHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  formCancel: { fontSize: 12, color: colors.primary },
  formTitle: { fontSize: 13, fontWeight: '700', color: colors.textMain },
  formSave: { fontSize: 12, fontWeight: '700', color: colors.primary },
  formImageBox: {
    alignSelf: 'center',
    width: 96,
    height: 96,
    borderRadius: radius.md,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.silver,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.one,
  },
  formCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    padding: spacing.two,
    gap: spacing.two,
  },
  formRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.two },
  formLabel: { fontSize: 11, color: colors.textSub, width: 44 },
  formValueLine: { height: 8, borderRadius: radius.pill, backgroundColor: colors.silver },
  aiBadge: { paddingHorizontal: spacing.one, paddingVertical: 1, borderRadius: radius.sm, backgroundColor: colors.primary },
  aiBadgeText: { fontSize: 8, fontWeight: '700', color: colors.bg },
});
