import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { colors, radius, spacing, type } from '@/constants/theme';
import type { Category } from '@/lib/queries';

import { CategoryPicker } from './CategoryPicker';

/**
 * 폴더(카테고리) 선택 하프시트. 등록·편집의 "폴더 ›" 행에서 연다.
 * 칩으로 고르면 즉시 닫히고, 하단 인라인 입력으로 새 폴더를 만든다.
 * (모달 위 Alert.prompt 는 iOS 에서 콜백이 끊기므로 인라인 입력을 쓴다.)
 */
export function FolderPickerSheet({
  visible,
  onClose,
  categories,
  selectedId,
  onSelect,
  onCreateCategory,
}: {
  visible: boolean;
  onClose: () => void;
  categories: Category[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreateCategory: (name: string) => Promise<Category | null>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const created = await onCreateCategory(n);
      setName('');
      setBusy(false);
      if (created) {
        onSelect(created.id);
        onClose();
      }
    } catch (e) {
      setBusy(false);
      Alert.alert('오류', e instanceof Error ? e.message : '폴더를 만들지 못했습니다.');
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>폴더 선택</Text>
            {busy ? <ActivityIndicator color={colors.primary} /> : null}
          </View>
          <CategoryPicker
            categories={categories}
            selectedId={selectedId}
            onSelect={(id) => {
              onSelect(id);
              onClose();
            }}
          />
          <View style={styles.newRow}>
            <TextInput
              style={styles.input}
              placeholder="새 폴더 이름"
              placeholderTextColor={colors.textDisabled}
              value={name}
              onChangeText={setName}
              onSubmitEditing={create}
              returnKeyType="done"
              editable={!busy}
            />
            <TouchableOpacity
              style={[styles.createBtn, (!name.trim() || busy) && styles.createBtnDisabled]}
              onPress={create}
              disabled={!name.trim() || busy}
              accessibilityRole="button"
            >
              <Text style={styles.createBtnText}>만들기</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.close} onPress={onClose} accessibilityRole="button">
            <Text style={styles.closeText}>닫기</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.four,
    gap: spacing.three,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...type.headline, color: colors.textMain },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.two },
  input: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    paddingVertical: spacing.three,
    paddingHorizontal: spacing.three,
    fontSize: 16,
    color: colors.textMain,
  },
  createBtn: {
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing.three,
    paddingHorizontal: spacing.three,
    justifyContent: 'center',
  },
  createBtnDisabled: { opacity: 0.5 },
  createBtnText: { fontSize: 14, fontWeight: '600', color: colors.bg },
  close: { alignItems: 'center', paddingVertical: spacing.two },
  closeText: { fontSize: 15, fontWeight: '600', color: colors.textSub },
});
