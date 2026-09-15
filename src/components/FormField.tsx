import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';

/**
 * 폼 필드 라벨 + (선택) 필수 표시 + (선택) "AI가 채움" 배지 + 입력 children.
 * 등록 화면과 편집 화면이 공유한다. `ai` 를 넘기지 않으면 배지는 표시되지 않는다
 * (편집 화면은 분석이 없으므로 `ai` 를 넘기지 않는다).
 */
export function FormField({
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
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
        {ai ? (
          <View style={styles.aiBadge} accessibilityLabel="AI가 채운 값이에요">
            <Text style={styles.aiBadgeText}>AI가 채움</Text>
          </View>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** 폼 입력(TextInput)에 쓰는 공용 스타일. 등록·편집 화면이 동일한 입력 모양을 공유한다. */
export const formInput = StyleSheet.create({
  input: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.silver,
    borderRadius: 10,
    paddingVertical: spacing.three,
    paddingHorizontal: spacing.three,
    fontSize: 16,
    color: colors.textMain,
  },
  memo: { minHeight: 80, textAlignVertical: 'top' },
});

const styles = StyleSheet.create({
  field: { gap: spacing.one },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.two },
  label: { fontSize: 14, fontWeight: '600', color: colors.textMain },
  required: { color: colors.error },
  aiBadge: {
    borderRadius: 999,
    backgroundColor: colors.primary, // 검정 채움(모노톤 강조)
    paddingVertical: 2,
    paddingHorizontal: spacing.two,
  },
  aiBadgeText: { fontSize: 11, fontWeight: '600', color: colors.bg },
});
