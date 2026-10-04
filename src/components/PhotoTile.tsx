import { SymbolView } from 'expo-symbols';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { colors } from '@/constants/theme';

import { Thumbnail } from './Thumbnail';

/**
 * 사진 앱 톤의 정사각 썸네일 타일. 크기 고정(size)·여백 없음·테두리 없음.
 * 부분 행에서도 늘어나지 않도록 flex 대신 고정 크기를 쓴다.
 *
 * 다중 선택(전체 탭): selectionMode 면 우하단에 선택 체크를 겹쳐 그리고, selected 면 딤 처리한다.
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
}: {
  url: string | null;
  fallbackUrl?: string | null;
  size: number;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  selectionMode?: boolean;
  selected?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.tile, { width: size, height: size }]}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selectionMode ? { selected: !!selected } : undefined}
    >
      <Thumbnail url={url} fallbackUrl={fallbackUrl} style={{ width: size, height: size }} />
      {selected ? <View style={styles.dim} pointerEvents="none" /> : null}
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

const styles = StyleSheet.create({
  tile: {
    overflow: 'hidden',
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
