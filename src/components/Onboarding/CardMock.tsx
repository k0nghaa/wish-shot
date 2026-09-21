import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors, radius, shadow, spacing, type } from '@/constants/theme';

// 첫 카드 데모: "캡처 순간 → 편집 화면 → 공유 시트 속 WishShot" 3장면을 크로스페이드로 반복하는
// 코드 모션 그래픽. 실제 스크린샷(인물·브랜드 포함)을 싣지 않고 흐름만 재현 — 에셋 불필요·토큰 기반.
const SCENE_MS = 2200;

const FRAME_W = 200;
const FRAME_H = 316;

export function CaptureFlowMock() {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [scene, setScene] = useState(0);

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
    // reduce-motion 이면 순환하지 않는다(아래 shown 이 공유 시트 장면으로 고정).
    if (reduceMotion) return;
    const id = setInterval(() => setScene((s) => (s + 1) % 3), SCENE_MS);
    return () => clearInterval(id);
  }, [reduceMotion]);

  // reduce-motion 이면 마지막 장면(공유 시트)만 정적 표시.
  const shown = reduceMotion ? 2 : scene;

  return (
    <View style={styles.frame}>
      <Scene active={shown === 0} reduceMotion={reduceMotion}>
        <FeedScene />
      </Scene>
      <Scene active={shown === 1} reduceMotion={reduceMotion}>
        <EditScene />
      </Scene>
      <Scene active={shown === 2} reduceMotion={reduceMotion}>
        <ShareScene />
      </Scene>
      {/* 3단계 진행 힌트 */}
      <View style={styles.progress}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.progressDot, shown === i && styles.progressDotOn]} />
        ))}
      </View>
    </View>
  );
}

// 장면 크로스페이드 래퍼. reduce-motion 이면 즉시 전환(모션 없음).
function Scene({ active, reduceMotion, children }: { active: boolean; reduceMotion: boolean; children: ReactNode }) {
  const opacity = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    opacity.value = withTiming(active ? 1 : 0, { duration: reduceMotion ? 0 : 350 });
  }, [active, reduceMotion, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      {children}
    </Animated.View>
  );
}

// 장면 1: 피드 보는 중 스크린샷 캡처(좌하단 캡처 썸네일이 뜬 순간).
function FeedScene() {
  return (
    <View style={styles.sceneFill}>
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
      {/* 방금 캡처된 스크린샷 썸네일(iOS) */}
      <View style={styles.capturedThumb}>
        <SymbolView name="photo" size={16} tintColor={colors.silverDark} />
      </View>
    </View>
  );
}

// 장면 2: 캡처 썸네일을 탭한 편집 화면(마크업·공유·완료 상단바).
function EditScene() {
  return (
    <View style={styles.sceneFill}>
      <View style={styles.editBar}>
        <SymbolView name="xmark.circle.fill" size={22} tintColor={colors.silverDark} />
        <View style={styles.flex} />
        <SymbolView name="pencil.tip.crop.circle" size={20} tintColor={colors.textMain} />
        {/* 공유 아이콘(다음 장면으로 이어지는 지점) */}
        <View style={styles.editShare}>
          <SymbolView name="square.and.arrow.up" size={16} tintColor={colors.bg} />
        </View>
        <SymbolView name="checkmark.circle.fill" size={22} tintColor={colors.textMain} />
      </View>
      <View style={styles.editImage}>
        <SymbolView name="photo" size={34} tintColor={colors.silverDark} />
      </View>
      <Text style={styles.editCaption}>자르기 및 크기 조절</Text>
    </View>
  );
}

// 장면 3: 공유 시트 속 WishShot 강조.
function ShareScene() {
  return (
    <View style={styles.shareFill}>
      <ShareSheetMock />
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

  // 모션 그래픽 프레임(폰 화면 축소본)
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
  sceneFill: { flex: 1, backgroundColor: colors.bg, padding: spacing.two, gap: spacing.two },
  progress: {
    position: 'absolute',
    bottom: spacing.two,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.one,
  },
  progressDot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.silver },
  progressDotOn: { backgroundColor: colors.primary },

  // 장면 1: 피드
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

  // 장면 2: 편집
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

  // 장면 3: 공유 시트
  shareFill: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end', padding: spacing.two },
  sheet: {
    width: '100%',
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: spacing.two,
    gap: spacing.two,
    ...shadow.card,
  },
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
