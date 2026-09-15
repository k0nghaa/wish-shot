import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, radius, shadow, spacing } from '@/constants/theme';

import { Thumbnail } from './Thumbnail';

/**
 * 홈(폴더 탭)의 카테고리 카드: 대표 썸네일 2×2 모자이크 + 이름 라벨(좌하단 오버레이).
 * thumbnailUrls 는 최대 4개(최신순). 빈 칸은 placeholder 타일로 채운다.
 * - onLongPress: 관리(이름변경/삭제) 진입 — 미분류 카드는 넘기지 않는다.
 * - deleteMode + onDelete: iOS 앨범 톤 삭제 모드. 좌상단 − 배지 노출, 탭 시 onDelete.
 */
export function CategoryCard({
  name,
  count,
  thumbnailUrls,
  onPress,
  onLongPress,
  deleteMode,
  onDelete,
}: {
  name: string;
  count: number;
  thumbnailUrls: (string | null)[];
  onPress?: () => void;
  onLongPress?: () => void;
  deleteMode?: boolean;
  onDelete?: () => void;
}) {
  const tiles = [0, 1, 2, 3].map((i) => thumbnailUrls[i] ?? null);

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.card}
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={!onPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${count}개`}
      >
        <View style={styles.mosaic}>
          {tiles.map((url, i) => (
            <View key={i} style={styles.tileWrap}>
              {url ? <Thumbnail url={url} style={styles.tile} /> : <View style={styles.tileEmpty} />}
            </View>
          ))}
        </View>
        <View style={styles.labelWrap} pointerEvents="none">
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
        </View>
      </TouchableOpacity>
      {deleteMode && onDelete ? (
        <TouchableOpacity
          style={styles.deleteBadge}
          onPress={onDelete}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${name} 삭제`}
        >
          <SymbolView name="minus" size={14} tintColor={colors.bg} weight="bold" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    // overflow 를 자르지 않음 — 배지가 카드(둥근 모서리) 위 모서리에 붙게 한다.
  },
  card: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.placeholder,
  },
  mosaic: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tileWrap: {
    width: '50%',
    height: '50%',
    padding: StyleSheet.hairlineWidth,
  },
  tile: {
    width: '100%',
    height: '100%',
  },
  tileEmpty: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.placeholder,
  },
  labelWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.two,
    paddingBottom: spacing.two,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.bg, // 흰색 라벨(이미지 위)
    // 오버레이 없이 이미지 위에서도 읽히도록 텍스트 그림자(순수 JS, 라이브러리 불필요).
    // TODO(Step 8 재빌드): expo-linear-gradient 추가 후 이 그림자를 하단 그라데이션 오버레이로 교체.
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  deleteBadge: {
    position: 'absolute',
    top: 0,
    left: 0, // 좌상단 모서리에 완전히 붙임(오버행 없음 → 옆 폴더에 안 닿음)
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary, // 검정 원 + 흰 −
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    ...shadow.card,
  },
});
