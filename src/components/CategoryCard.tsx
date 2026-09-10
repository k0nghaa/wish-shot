import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';

import { Thumbnail } from './Thumbnail';

/**
 * 홈의 카테고리 카드: 대표 썸네일 + 이름 + 개수.
 * onMore 가 있으면 우상단 ⋯(이름변경/삭제) 버튼을 노출한다. 미분류 카드는 onMore 없이 쓴다.
 */
export function CategoryCard({
  name,
  count,
  thumbnailUrl,
  onPress,
  onMore,
}: {
  name: string;
  count: number;
  thumbnailUrl: string | null;
  onPress: () => void;
  onMore?: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${count}개`}
    >
      <Thumbnail url={thumbnailUrl} style={styles.thumb} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.count}>{count}개</Text>
      </View>
      {onMore ? (
        <TouchableOpacity
          style={styles.more}
          onPress={onMore}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${name} 옵션`}
        >
          <Text style={styles.moreText}>⋯</Text>
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.three,
    padding: spacing.two,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.silver,
    backgroundColor: colors.bgCard,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
  },
  body: {
    flex: 1,
    gap: spacing.half,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textMain,
  },
  count: {
    fontSize: 13,
    color: colors.textSub,
  },
  more: {
    paddingHorizontal: spacing.two,
    paddingVertical: spacing.one,
  },
  moreText: {
    fontSize: 20,
    color: colors.textSub,
    fontWeight: '700',
  },
});
