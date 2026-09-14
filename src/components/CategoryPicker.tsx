import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';
import type { Category } from '@/lib/queries';

/**
 * 카테고리 선택 칩 목록: 미분류 + 기존 카테고리 + (선택) 새 카테고리 생성.
 * 등록 화면과 편집 화면이 공유한다. `selectedId === null` 은 미분류.
 * `onCreate` 를 넘기면 "+ 새 카테고리" 칩이 붙는다.
 */
export function CategoryPicker({
  categories,
  selectedId,
  onSelect,
  onCreate,
  label = '카테고리',
}: {
  categories: Category[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate?: () => void;
  label?: string;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="미분류" selected={selectedId === null} onPress={() => onSelect(null)} />
        {categories.map((c) => (
          <Chip key={c.id} label={c.name} selected={selectedId === c.id} onPress={() => onSelect(c.id)} />
        ))}
        {onCreate ? <Chip label="+ 새 카테고리" selected={false} onPress={onCreate} /> : null}
      </ScrollView>
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.one },
  label: { fontSize: 14, fontWeight: '600', color: colors.textMain },
  chips: { gap: spacing.two, paddingVertical: spacing.one },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.silver,
    backgroundColor: colors.bgCard,
    paddingVertical: spacing.two,
    paddingHorizontal: spacing.three,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, color: colors.textSub },
  chipTextSelected: { color: colors.bgCard, fontWeight: '600' },
});
