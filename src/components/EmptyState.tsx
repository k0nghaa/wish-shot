import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';

/** 빈 상태 안내 + (선택) CTA 버튼. 목록/홈이 비었을 때 공통으로 쓴다. */
export function EmptyState({
  title,
  description,
  ctaLabel,
  onCta,
}: {
  title: string;
  description?: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {ctaLabel && onCta ? (
        <TouchableOpacity style={styles.cta} onPress={onCta} accessibilityRole="button">
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.four,
    gap: spacing.two,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textMain,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    color: colors.textSub,
    textAlign: 'center',
  },
  cta: {
    marginTop: spacing.three,
    paddingVertical: spacing.two,
    paddingHorizontal: spacing.four,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  ctaText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.bgCard,
  },
});
