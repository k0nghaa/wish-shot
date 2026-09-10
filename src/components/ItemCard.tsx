import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';

import { Thumbnail } from './Thumbnail';

/**
 * 목록 그리드의 아이템 카드: 썸네일 + 제품명 + 브랜드 + 저장일.
 * onPress 가 있으면 눌러서 상세로 이동한다.
 */
export function ItemCard({
  productName,
  brand,
  savedDate,
  thumbnailUrl,
  onPress,
}: {
  productName: string;
  brand: string | null;
  savedDate: string;
  thumbnailUrl: string | null;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.8}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={productName}
    >
      <Thumbnail url={thumbnailUrl} style={styles.thumb} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {productName}
        </Text>
        {brand ? (
          <Text style={styles.brand} numberOfLines={1}>
            {brand}
          </Text>
        ) : null}
        <Text style={styles.date}>{savedDate}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.silver,
    backgroundColor: colors.bgCard,
    overflow: 'hidden',
  },
  thumb: {
    width: '100%',
    aspectRatio: 1,
  },
  body: {
    padding: spacing.two,
    gap: spacing.half,
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMain,
  },
  brand: {
    fontSize: 12,
    color: colors.textSub,
  },
  date: {
    fontSize: 11,
    color: colors.textDisabled,
    marginTop: spacing.half,
  },
});
