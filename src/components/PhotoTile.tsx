import { StyleSheet, TouchableOpacity } from 'react-native';

import { Thumbnail } from './Thumbnail';

/**
 * 사진 앱 톤의 정사각 썸네일 타일. 크기 고정(size)·여백 없음·테두리 없음.
 * 부분 행에서도 늘어나지 않도록 flex 대신 고정 크기를 쓴다.
 */
export function PhotoTile({
  url,
  size,
  onPress,
  accessibilityLabel,
}: {
  url: string | null;
  size: number;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.tile, { width: size, height: size }]}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Thumbnail url={url} style={{ width: size, height: size }} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: {
    overflow: 'hidden',
  },
});
