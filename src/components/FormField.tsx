import { SymbolView } from 'expo-symbols';
import { Children, type ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, hairlineWidth, radius, spacing, type } from '@/constants/theme';

/**
 * iOS 설정 톤의 그룹 카드 폼 프리미티브(M3). 등록·편집 화면이 공유한다.
 * - FormCard: 그룹 카드 컨테이너. 직계 자식 사이에 헤어라인 구분선을 자동 삽입.
 * - FormRow: 라벨 좌 / 값 우(children) 한 줄. required(*) · ai("AI가 채움") 배지 지원.
 * - FormBlock: 라벨 위 / 전체폭 children 아래(메모·태그 등).
 * - DisclosureRow: 라벨 좌 / 값 + › 우, 탭 가능(폴더 선택 등).
 */

export function FormCard({ children }: { children: ReactNode }) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.card}>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <View style={styles.sep} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

export function FormRow({
  label,
  required,
  ai,
  children,
}: {
  label: string;
  required?: boolean;
  ai?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.labelWrap}>
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
        {ai ? (
          <View style={styles.aiBadge} accessibilityLabel="AI가 채운 값">
            <Text style={styles.aiBadgeText}>AI가 채움</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.value}>{children}</View>
    </View>
  );
}

export function FormBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

export function DisclosureRow({
  label,
  value,
  onPress,
  aiLabel,
}: {
  label: string;
  value: string;
  onPress: () => void;
  aiLabel?: string;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}>
      <View style={styles.labelWrap}>
        <Text style={styles.label}>{label}</Text>
        {aiLabel ? (
          <View style={styles.aiBadge}>
            <Text style={styles.aiBadgeText}>{aiLabel}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.discValueWrap}>
        <Text style={styles.discValue} numberOfLines={1}>
          {value}
        </Text>
        <SymbolView name="chevron.right" size={14} tintColor={colors.silverDark} weight="semibold" />
      </View>
    </TouchableOpacity>
  );
}

/** 폼 입력(TextInput) 공용 스타일. 등록·편집이 공유한다. */
export const formInput = StyleSheet.create({
  // 그룹 카드 행 안의 단일 라인 입력: 테두리 없이 값은 우측 정렬.
  rowInput: {
    flex: 1,
    fontSize: 16,
    color: colors.textMain,
    textAlign: 'right',
    paddingVertical: 0,
  },
  // 메모 등 전체폭 여러 줄 입력.
  memo: {
    minHeight: 72,
    fontSize: 16,
    color: colors.textMain,
    textAlignVertical: 'top',
  },
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    paddingHorizontal: spacing.three,
    overflow: 'hidden',
  },
  sep: {
    height: hairlineWidth,
    backgroundColor: colors.silver,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.three,
    minHeight: 48,
    paddingVertical: spacing.two,
  },
  labelWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.two },
  label: { ...type.body, color: colors.textMain },
  required: { color: colors.accent },
  value: { flex: 1 },
  aiBadge: {
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    paddingVertical: 2,
    paddingHorizontal: spacing.two,
  },
  aiBadgeText: { fontSize: 11, fontWeight: '600', color: colors.bg },
  block: { paddingVertical: spacing.three, gap: spacing.two },
  discValueWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.one, flexShrink: 1 },
  discValue: { ...type.body, color: colors.textSub, flexShrink: 1, textAlign: 'right' },
});
