import { useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

/**
 * Velog 식 태그 입력: 하나의 필드 안에 선택된 칩과 텍스트 입력이 함께 있다.
 * - 입력 후 완료(Enter) → 칩으로 추가되고 계속 입력 가능.
 * - 칩 탭 → 제거. 빈 입력에서 Backspace → 마지막 칩 제거.
 * - `suggestions`(이미 쓴 태그) 를 넘기면 필드 아래 후보 칩으로 보여주고, 탭하면 필드 안으로 들어간다.
 * 값은 `string[]`. 중복·공백은 무시한다.
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
  const inputRef = useRef<TextInput>(null);

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

  // 빈 입력에서 Backspace 를 누르면 마지막 칩을 지운다(Velog 동작).
  function onKeyPress(e: NativeSyntheticEvent<TextInputKeyPressEventData>) {
    if (e.nativeEvent.key === 'Backspace' && text === '' && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  // 아직 안 단 기존 태그만 후보로 보여준다.
  const pickable = suggestions.filter((s) => !tags.includes(s));

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>

      {/* 칩 + 입력이 함께 들어가는 하나의 필드 */}
      <TouchableOpacity activeOpacity={1} style={styles.field} onPress={() => inputRef.current?.focus()}>
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
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder={tags.length ? '' : '입력 후 Enter'}
          placeholderTextColor={colors.textDisabled}
          value={text}
          onChangeText={setText}
          onSubmitEditing={submitInput}
          onKeyPress={onKeyPress}
          returnKeyType="done"
          blurOnSubmit={false}
          autoCapitalize="none"
        />
      </TouchableOpacity>

      {/* 이미 쓴 태그(후보) — 탭하면 위 필드로 들어간다 */}
      {pickable.length > 0 ? (
        <View style={styles.picks}>
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
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.two },
  label: { fontSize: 14, fontWeight: '600', color: colors.textMain },
  field: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.two,
    minHeight: 48,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    paddingVertical: spacing.two,
    paddingHorizontal: spacing.three,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.one,
    borderRadius: radius.pill,
    backgroundColor: colors.primary, // 선택 태그 = 검정 채움
    paddingVertical: spacing.two,
    paddingHorizontal: spacing.three,
  },
  tagText: { fontSize: 13, color: colors.bg },
  tagRemove: { fontSize: 12, color: colors.bg, fontWeight: '700' },
  input: {
    flex: 1,
    minWidth: 80,
    fontSize: 16,
    color: colors.textMain,
    paddingVertical: spacing.one,
  },
  picks: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.two },
  pick: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.silver,
    backgroundColor: colors.bgCard,
    paddingVertical: spacing.one,
    paddingHorizontal: spacing.three,
  },
  pickText: { fontSize: 13, color: colors.textSub },
});
