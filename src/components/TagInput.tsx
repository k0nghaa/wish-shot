import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';

import { formInput } from './FormField';

/**
 * 자유 입력 태그 칩. 입력 후 완료(Enter)를 누르면 칩으로 추가되고, 칩을 탭하면 제거된다.
 * `suggestions`(내가 이미 쓴 태그)를 넘기면 입력 밑에 선택 칩으로 보여주고, 탭하면 추가된다(FR-15a).
 * 값은 `string[]` 이며 `items.tags` 에 그대로 저장된다(빈 배열은 호출부가 null 로 변환).
 * 중복 태그·공백은 무시한다.
 */
export function TagInput({
  tags,
  onChange,
  suggestions = [],
  label = '태그',
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  label?: string;
}) {
  const [text, setText] = useState('');

  function addTag(tag: string) {
    const t = tag.trim();
    if (!t) return;
    if (!tags.includes(t)) onChange([...tags, t]);
  }

  function submitInput() {
    addTag(text);
    setText('');
  }

  function removeTag(tag: string) {
    onChange(tags.filter((x) => x !== tag));
  }

  // 아직 안 단 기존 태그만 선택지로 보여준다.
  const pickable = suggestions.filter((s) => !tags.includes(s));

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={formInput.input}
        placeholder="태그를 입력하고 완료를 눌러요"
        placeholderTextColor={colors.textDisabled}
        value={text}
        onChangeText={setText}
        onSubmitEditing={submitInput}
        returnKeyType="done"
        blurOnSubmit={false}
        autoCapitalize="none"
      />
      {tags.length > 0 ? (
        <View style={styles.tags}>
          {tags.map((tag) => (
            <TouchableOpacity
              key={tag}
              style={styles.tag}
              onPress={() => removeTag(tag)}
              accessibilityRole="button"
              accessibilityLabel={`태그 삭제: ${tag}`}
            >
              <Text style={styles.tagText}>{tag}</Text>
              <Text style={styles.tagRemove}>✕</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {pickable.length > 0 ? (
        <>
          <Text style={styles.pickHint}>이전에 쓴 태그</Text>
          <View style={styles.tags}>
            {pickable.map((tag) => (
              <TouchableOpacity
                key={tag}
                style={styles.pick}
                onPress={() => addTag(tag)}
                accessibilityRole="button"
                accessibilityLabel={`태그 추가: ${tag}`}
              >
                <Text style={styles.pickText}>{tag}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.two },
  label: { fontSize: 14, fontWeight: '600', color: colors.textMain },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.two },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.one,
    borderRadius: 999,
    backgroundColor: colors.primary, // 선택 태그 = 검정 채움 (M3)
    paddingVertical: spacing.one,
    paddingHorizontal: spacing.three,
  },
  tagText: { fontSize: 13, color: colors.bg },
  tagRemove: { fontSize: 12, color: colors.bg, fontWeight: '700' },
  pickHint: { fontSize: 12, color: colors.textSub },
  pick: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.silver,
    backgroundColor: colors.bgCard,
    paddingVertical: spacing.one,
    paddingHorizontal: spacing.three,
  },
  pickText: { fontSize: 13, color: colors.textSub },
});
