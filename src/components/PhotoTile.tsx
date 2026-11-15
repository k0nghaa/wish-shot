import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors, shadow } from '@/constants/theme';

import { Thumbnail } from './Thumbnail';

// 저장 뒤 링크를 찾는 중인 타일의 불투명도 — 아직 진행 중이라는 느낌만(썸네일 로딩처럼 보이지 않게).
const PENDING_OPACITY = 0.5;
const FADE_MS = 200;

/**
 * 사진 앱 톤의 정사각 썸네일 타일. 크기 고정(size)·여백 없음·테두리 없음.
 * 부분 행에서도 늘어나지 않도록 flex 대신 고정 크기를 쓴다.
 *
 * 다중 선택(전체 탭): selectionMode 면 우하단에 선택 체크를 겹쳐 그리고, selected 면 딤 처리한다.
 * 링크 찾기 상태: linkPending(저장 뒤 링크를 찾는 중) → 약간 흐리게, unseen(링크가 붙었고 아직 안 봄) → 좌상단 와인색 점(NewDot).
 * 못 찾으면 둘 다 꺼져 평소 타일로 돌아간다.
 */
export function PhotoTile({
  url,
  fallbackUrl,
  size,
  onPress,
  onLongPress,
  accessibilityLabel,
  selectionMode,
  selected,
  linkPending,
  unseen,
}: {
  url: string | null;
  fallbackUrl?: string | null;
  size: number;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  selectionMode?: boolean;
  selected?: boolean;
  linkPending?: boolean;
  unseen?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(linkPending ? PENDING_OPACITY : 1);
  useEffect(() => {
    const target = linkPending ? PENDING_OPACITY : 1;
    opacity.set(reduceMotion ? target : withTiming(target, { duration: FADE_MS }));
  }, [linkPending, reduceMotion, opacity]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  const showDot = !!unseen && !linkPending;
  const label = accessibilityLabel
    ? `${accessibilityLabel}${linkPending ? ', 링크 찾는 중' : showDot ? ', 새 링크' : ''}`
    : undefined;

  return (
    <TouchableOpacity
      style={[styles.tile, { width: size, height: size }]}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selectionMode ? { selected: !!selected } : undefined}
    >
      <Animated.View style={fadeStyle}>
        <Thumbnail url={url} fallbackUrl={fallbackUrl} style={{ width: size, height: size }} />
      </Animated.View>
      {selected ? <View style={styles.dim} pointerEvents="none" /> : null}
      {showDot ? <NewDot style={styles.newDotPos} /> : null}
      {selectionMode ? (
        <View style={styles.badge} pointerEvents="none">
          <SymbolView
            name={selected ? 'checkmark.circle.fill' : 'circle'}
            size={26}
            tintColor={selected ? colors.primary : colors.bg}
          />
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

// 새 링크 점: 와인색 8pt + 흰 0.5pt 테두리 + 옅은 그림자(정본 color_tokens 규칙 4 — 사진 위 표시). 테두리는 상자 안쪽에 그려지므로 상자는 8 + 0.5×2.
const NEW_DOT_FILL = 8;
const NEW_DOT_RING = 0.5;

/** 새 링크 점(타일·알림 목록 썸네일 공용). 위치는 호출부가 style 로 준다(position absolute). */
export function NewDot({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.newDot, style]} pointerEvents="none" />;
}

const styles = StyleSheet.create({
  tile: {
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  // 선택된 타일은 살짝 어둡게 덮어 상태를 강조.
  dim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
  },
  newDot: {
    position: 'absolute',
    width: NEW_DOT_FILL + NEW_DOT_RING * 2,
    height: NEW_DOT_FILL + NEW_DOT_RING * 2,
    borderRadius: (NEW_DOT_FILL + NEW_DOT_RING * 2) / 2,
    borderWidth: NEW_DOT_RING,
    borderColor: colors.bg,
    backgroundColor: colors.accent,
    ...shadow.onPhoto,
  },
  newDotPos: { top: 6, left: 6 },
  // 선택 체크는 우하단에 겹친다. 흰 링이 밝은 사진 위에서도 보이도록 옅은 그림자.
  badge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
});
