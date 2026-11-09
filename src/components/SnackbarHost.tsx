import { useEffect, useSyncExternalStore } from 'react';
import { AccessibilityInfo, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';

import { colorsDark, radius, shadow, spacing } from '@/constants/theme';
import { dismissSnackbar, getCurrentSnackbar, subscribeSnackbar } from '@/lib/snackbar';

// 보이는 시간. VoiceOver 를 쓰면 [보기]까지 옮겨 갈 시간을 더 준다(놓쳐도 알림 탭에 남는다).
const SHOW_MS = 3000;
const SHOW_MS_SCREEN_READER = 6000;
const ANIM_MS = 180;
// 떠 있는 탭 바 위(탭 바 알약 높이 약 63pt + 간격) — 전체 탭의 + 버튼과 같은 높이.
const ABOVE_TAB_BAR = 72;

/**
 * 앱 전체 스낵바(루트 레이아웃에 1개). 대기열(@/lib/snackbar)의 맨 앞을 하나씩 보인다.
 * react-native-screens 의 FullWindowOverlay 에 그려 네이티브 모달(등록·편집·상세·정보 시트) 위에도 보인다.
 * 스낵바 밖의 터치는 아래 화면으로 넘어간다. 보일 것이 없으면 오버레이 자체를 그리지 않는다.
 * 모션 줄이기 설정이면 미끄러지지 않고 바로 나타나고 사라진다.
 */
export function SnackbarHost() {
  const current = useSyncExternalStore(subscribeSnackbar, getCurrentSnackbar);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  const id = current?.id;
  const announcement = current ? (current.announcement ?? [current.title, current.subtitle].filter(Boolean).join(' ')) : '';

  // 새 스낵바: 나타나고, 정해진 시간 뒤 사라진다(사라지는 움직임이 끝난 뒤 대기열에서 뺀다).
  useEffect(() => {
    if (!id) return;
    progress.set(reduceMotion ? 1 : 0);
    if (!reduceMotion) progress.set(withTiming(1, { duration: ANIM_MS }));
    AccessibilityInfo.announceForAccessibility(announcement);

    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let removeTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const hide = () => {
      if (reduceMotion) {
        dismissSnackbar(id);
        return;
      }
      progress.set(withTiming(0, { duration: ANIM_MS }));
      removeTimer = setTimeout(() => dismissSnackbar(id), ANIM_MS);
    };
    AccessibilityInfo.isScreenReaderEnabled()
      .catch(() => false)
      .then((screenReader) => {
        if (cancelled) return;
        hideTimer = setTimeout(hide, screenReader ? SHOW_MS_SCREEN_READER : SHOW_MS);
      });
    return () => {
      cancelled = true;
      if (hideTimer) clearTimeout(hideTimer);
      if (removeTimer) clearTimeout(removeTimer);
    };
  }, [id, announcement, reduceMotion, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: (1 - progress.get()) * 16 }],
  }));

  if (!current) return null;

  const onAction = current.onAction;
  return (
    <FullWindowOverlay>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Animated.View
          style={[styles.bar, { bottom: Math.max(insets.bottom, spacing.two) + ABOVE_TAB_BAR }, animatedStyle]}
          accessibilityRole="alert"
        >
          <View style={styles.texts}>
            <Text style={styles.title} numberOfLines={1}>
              {current.title}
            </Text>
            {current.subtitle ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {current.subtitle}
              </Text>
            ) : null}
          </View>
          {current.actionLabel && onAction ? (
            <TouchableOpacity
              onPress={() => {
                progress.set(0); // 다음 스낵바가 첫 프레임에 다 보인 채로 번쩍이지 않게
                dismissSnackbar(current.id);
                onAction();
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={current.actionLabel}
            >
              <Text style={styles.action}>{current.actionLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </Animated.View>
      </View>
    </FullWindowOverlay>
  );
}

// 흰 화면 위에서 눈에 띄도록 어두운 바(상세 뷰어와 같은 다크 토큰).
const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: spacing.three,
    right: spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.three,
    paddingVertical: spacing.three - spacing.one,
    paddingHorizontal: spacing.three,
    borderRadius: radius.lg,
    backgroundColor: colorsDark.bgCard,
    ...shadow.floating,
  },
  texts: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '600', color: colorsDark.textMain },
  subtitle: { fontSize: 13, color: colorsDark.textSub },
  action: { fontSize: 15, fontWeight: '700', color: colorsDark.textMain },
});
