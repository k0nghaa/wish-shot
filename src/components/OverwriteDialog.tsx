import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';
import { formatSavedDate } from '@/lib/formatDate';
import type { Item } from '@/lib/queries';

import { Thumbnail } from './Thumbnail';

/**
 * 중복(같은 brand+제품명) 발견 시 뜨는 모달.
 * 덮어쓰기 = 기존 아이템을 새 입력으로 UPDATE(새 행 아님) / 기존 보기 = 상세로 이동 / 취소 = 중단.
 */
export function OverwriteDialog({
  visible,
  item,
  thumbnailUrl,
  busy,
  onOverwrite,
  onView,
  onCancel,
}: {
  visible: boolean;
  item: Item | null;
  thumbnailUrl: string | null;
  busy: boolean;
  onOverwrite: () => void;
  onView: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>이미 담은 위시예요</Text>
          <Text style={styles.desc}>같은 브랜드·제품명이 있어요. 어떻게 할까요?</Text>

          {item ? (
            <View style={styles.existing}>
              <Thumbnail url={thumbnailUrl} style={styles.thumb} />
              <View style={styles.existingBody}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.product_name}
                </Text>
                {item.brand ? (
                  <Text style={styles.brand} numberOfLines={1}>
                    {item.brand}
                  </Text>
                ) : null}
                <Text style={styles.date}>{formatSavedDate(item.created_at)}</Text>
              </View>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.button, styles.primary, busy && styles.disabled]}
            onPress={onOverwrite}
            disabled={busy}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={colors.bgCard} />
            ) : (
              <Text style={styles.primaryText}>덮어쓰기</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.secondary]}
            onPress={onView}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>기존 보기</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.ghost]}
            onPress={onCancel}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.ghostText}>취소</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.four,
  },
  card: {
    width: '100%',
    backgroundColor: colors.bgCard,
    borderRadius: 16,
    padding: spacing.four,
    gap: spacing.two,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textMain,
  },
  desc: {
    fontSize: 14,
    color: colors.textSub,
  },
  existing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.three,
    padding: spacing.two,
    marginVertical: spacing.two,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.silver,
    backgroundColor: colors.bg,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
  },
  existingBody: {
    flex: 1,
    gap: spacing.half,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textMain,
  },
  brand: {
    fontSize: 13,
    color: colors.textSub,
  },
  date: {
    fontSize: 12,
    color: colors.textDisabled,
  },
  button: {
    borderRadius: 10,
    paddingVertical: spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: colors.primary,
  },
  primaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.bgCard,
  },
  secondary: {
    borderWidth: 1,
    borderColor: colors.silver,
    backgroundColor: colors.bgCard,
  },
  secondaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textMain,
  },
  ghost: {},
  ghostText: {
    fontSize: 15,
    color: colors.textSub,
  },
  disabled: {
    opacity: 0.6,
  },
});
