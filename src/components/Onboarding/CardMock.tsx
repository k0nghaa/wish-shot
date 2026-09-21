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

// 첫 카드 데모: "캡처(스크린샷이 화면 크기에서 좌하단으로 축소) → 좌하단 캡처 탭(다시 커지며 편집 화면)
// → 공유 아이콘 탭(공유 시트 올라옴) → WishShot 탭(위시 담기 폼 올라옴)"을 하나의 연결된 흐름으로 반복.
// 캡처 사진은 하나의 모핑 요소(레이아웃 애니메이션: 전체 → 좌하단 썸네일 → 편집 이미지)로 이어진다.
// 실제 스크린샷(인물·브랜드 포함)을 싣지 않고 흐름만 재현 — 에셋 불필요·토큰 기반.
const STEP_MS = 1700;
const STEPS = 4; // 0: 캡처→썸네일 / 1: 편집 / 2: 공유 시트 / 3: 위시 담기 폼
const FRAME_W = 200;
const FRAME_H = 316;

// 캡처 사진 모핑 키프레임(프레임 좌표). 전체(캡처 순간) → 좌하단 썸네일 → 편집 이미지.
const CAP = { L: 0, T: 0, W: FRAME_W, H: FRAME_H, R: radius.lg };
const THUMB = { L: spacing.two, T: 224, W: 46, H: 68, R: radius.sm };
const EDIT = { L: spacing.two, T: 40, W: FRAME_W - spacing.two * 2, H: 216, R: radius.md };

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
  const editUp = useSharedValue(0);
  const shareUp = useSharedValue(0);
  const formUp = useSharedValue(0);
  const flash = useSharedValue(0);
  const pulse = useSharedValue(0);
  // 캡처 사진 모핑(레이아웃). 초기값 = 캡처 순간(전체 화면).
  const capL = useSharedValue(CAP.L);
  const capT = useSharedValue(CAP.T);
  const capW = useSharedValue(CAP.W);
  const capH = useSharedValue(CAP.H);
  const capR = useSharedValue<number>(CAP.R);

  useEffect(() => {
    const d = reduceMotion ? 0 : 500;
    editUp.value = withTiming(activeStep >= 1 ? 1 : 0, { duration: d });
    shareUp.value = withTiming(activeStep >= 2 ? 1 : 0, { duration: d });
    formUp.value = withTiming(activeStep >= 3 ? 1 : 0, { duration: d });
    feedOpacity.value = withTiming(activeStep >= 1 ? 0 : 1, { duration: d });

    if (reduceMotion) {
      capL.value = EDIT.L;
      capT.value = EDIT.T;
      capW.value = EDIT.W;
      capH.value = EDIT.H;
      capR.value = EDIT.R;
      return;
    }
    if (activeStep === 0) {
      // 캡처: 전체 화면으로 스냅 후 좌하단 썸네일로 축소.
      const shrink = (from: number, to: number) => withSequence(withTiming(from, { duration: 0 }), withTiming(to, { duration: 600 }));
      capL.value = shrink(CAP.L, THUMB.L);
      capT.value = shrink(CAP.T, THUMB.T);
      capW.value = shrink(CAP.W, THUMB.W);
      capH.value = shrink(CAP.H, THUMB.H);
      capR.value = shrink(CAP.R, THUMB.R);
    } else {
      // 탭 → 다시 커지며 편집 이미지로(그 뒤 단계는 편집 이미지 유지).
      capL.value = withTiming(EDIT.L, { duration: 550 });
      capT.value = withTiming(EDIT.T, { duration: 550 });
      capW.value = withTiming(EDIT.W, { duration: 550 });
      capH.value = withTiming(EDIT.H, { duration: 550 });
      capR.value = withTiming(EDIT.R, { duration: 550 });
    }
  }, [activeStep, reduceMotion, editUp, shareUp, formUp, feedOpacity, capL, capT, capW, capH, capR]);

  // 캡처 순간 화면 플래시(스텝 0 진입마다).
  useEffect(() => {
    if (reduceMotion || activeStep !== 0) return;
    flash.value = withSequence(withTiming(0.9, { duration: 120 }), withTiming(0, { duration: 320 }));
  }, [activeStep, reduceMotion, flash]);

  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [reduceMotion, pulse]);

  const feedStyle = useAnimatedStyle(() => ({ opacity: feedOpacity.value }));
  const editStyle = useAnimatedStyle(() => ({ opacity: editUp.value }));
  const shareStyle = useAnimatedStyle(() => ({ opacity: shareUp.value, transform: [{ translateY: (1 - shareUp.value) * FRAME_H }] }));
  const formStyle = useAnimatedStyle(() => ({ opacity: formUp.value, transform: [{ translateY: (1 - formUp.value) * FRAME_H }] }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const capStyle = useAnimatedStyle(() => ({
    left: capL.value,
    top: capT.value,
    width: capW.value,
    height: capH.value,
    borderRadius: capR.value,
  }));
  // 공유 아이콘·WishShot 타일: 활성 단계에서 살짝 커졌다 작아졌다(pulse 0↔1) + Glow.
  const shareIconPulse = useAnimatedStyle(() => ({ transform: [{ scale: activeStep === 1 ? 1 + pulse.value * 0.14 : 1 }] }));
  const wishPulse = useAnimatedStyle(() => ({ transform: [{ scale: activeStep === 2 ? 1 + pulse.value * 0.14 : 1 }] }));

  return (
    <View style={styles.frame}>
      {/* 피드 레이어(캡처 대상 콘텐츠) */}
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
      </Animated.View>

      {/* 편집 배경(피드 위로 흰 배경 페이드) */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.editBg, editStyle]} pointerEvents="none" />

      {/* 캡처 사진(모핑 요소): 전체 → 좌하단 썸네일 → 편집 이미지 */}
      <Animated.View style={[styles.capturedEl, capStyle]} pointerEvents="none">
        <SymbolView name="photo" size={26} tintColor={colors.silverDark} />
        <Glow active={activeStep === 0} pulse={pulse} />
      </Animated.View>

      {/* 편집 크롬(상단바 + 캡션) */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.editChrome, editStyle]} pointerEvents="none">
        <View style={styles.editBar}>
          <SymbolView name="xmark.circle.fill" size={22} tintColor={colors.silverDark} />
          <View style={styles.flex} />
          <SymbolView name="pencil.tip.crop.circle" size={20} tintColor={colors.textMain} />
          <Animated.View style={[styles.editShare, shareIconPulse]}>
            <SymbolView name="square.and.arrow.up" size={16} tintColor={colors.bg} />
            <Glow active={activeStep === 1} pulse={pulse} />
          </Animated.View>
          <SymbolView name="checkmark.circle.fill" size={22} tintColor={colors.textMain} />
        </View>
        <View style={styles.flex} />
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
              <Animated.View style={[styles.appIconActive, wishPulse]}>
                <SymbolView name="heart.fill" size={20} tintColor={colors.bg} />
                <Glow active={activeStep === 2} pulse={pulse} />
              </Animated.View>
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

// 대상 도형 자체가 밝아지는 펄스(탭 지점 강조). 부모의 테두리까지 덮도록 -2 확장 + 부모 overflow 클리핑.
function Glow({ active, pulse }: { active: boolean; pulse: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ opacity: active ? pulse.value * 0.55 : 0 }));
  return <Animated.View pointerEvents="none" style={[styles.glow, style]} />;
}

// WishShot + 아래 앱들이 시트 폭에 들어가도록 개수를 제한(오른쪽 넘침 방지).
const APPS: { icon: SymbolViewProps['name']; label: string }[] = [
  { icon: 'doc.on.doc', label: '복사' },
  { icon: 'person.crop.circle', label: '연락처' },
];

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Glow: 부모 테두리까지 덮어 도형 전체가 밝아지게(부모 overflow:'hidden' 이 둥근 모서리로 클리핑).
  glow: { position: 'absolute', top: -2, left: -2, right: -2, bottom: -2, backgroundColor: colors.bg },

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

  // 캡처 사진 모핑 요소
  capturedEl: {
    position: 'absolute',
    backgroundColor: colors.bgCard,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...shadow.floating,
  },

  // 편집
  editBg: { backgroundColor: colors.bg },
  editChrome: { padding: spacing.two },
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
  editCaption: { ...type.caption, color: colors.textSub, textAlign: 'center' },

  // 공유 시트
  shareLayer: { backgroundColor: colors.overlay, justifyContent: 'flex-end', padding: spacing.two },
  sheet: { width: '100%', backgroundColor: colors.bg, borderRadius: radius.lg, padding: spacing.two, gap: spacing.two, overflow: 'hidden', ...shadow.card },
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
  formCard: { backgroundColor: colors.bgCard, borderRadius: radius.md, padding: spacing.two, gap: spacing.two },
  formRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.two },
  formLabel: { fontSize: 11, color: colors.textSub, width: 44 },
  formValueLine: { height: 8, borderRadius: radius.pill, backgroundColor: colors.silver },
  aiBadge: { paddingHorizontal: spacing.one, paddingVertical: 1, borderRadius: radius.sm, backgroundColor: colors.primary },
  aiBadgeText: { fontSize: 8, fontWeight: '700', color: colors.bg },
});
