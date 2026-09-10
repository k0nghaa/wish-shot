import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';

import { Thumbnail } from './Thumbnail';

/**
 * 목록 그리드의 아이템 카드: 썸네일 + 제품명 + 브랜드 + 저장일.
 * Step 3 에서는 표시 전용(탭 → 상세는 Step 5 에서 연결).
 */
export function ItemCard({
  productName,
  brand,
  savedDate,
  thumbnailUrl,
}: {
  productName: string;
  brand: string | null;
  savedDate: string;
  thumbnailUrl: string | null;
}) {
  return (
    <View style={styles.card}>
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
    </View>
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
