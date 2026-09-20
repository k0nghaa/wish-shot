import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { colors, radius, spacing, type } from '@/constants/theme';
import type { Category } from '@/lib/queries';

import { CategoryPicker } from './CategoryPicker';

const OPEN_MS = 260;
const CLOSE_MS = 200;

/**
 * 폴더(카테고리) 선택 하프시트. 등록·편집의 "폴더 ›" 행에서 연다.
 * 칩으로 고르면 즉시 닫히고, 하단 인라인 입력으로 새 폴더를 만든다.
 * (모달 위 Alert.prompt 는 iOS 에서 콜백이 끊기므로 인라인 입력을 쓴다.)
 *
 * 애니메이션: 배경 오버레이는 즉시 덮이고(Modal animationType="none"), 시트만 translateY 로
 * 아래에서 올라온다. 닫을 때는 시트가 아래로 슬라이드아웃한 뒤 언마운트한다.
 * 키보드가 뜨면 KeyboardAvoidingView 가 시트를 위로 밀어 입력이 가려지지 않게 한다.
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
  const { height: winH } = useWindowDimensions();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [rendered, setRendered] = useState(visible);
  const [translateY] = useState(() => new Animated.Value(winH)); // 시트를 화면 아래(오프스크린)에서 시작
  const sheetH = useRef(0); // 측정된 시트 높이 = 정확한 슬라이드 거리
  const opened = useRef(false); // 현재 열림 사이클에서 열기 애니메이션을 시작했는지

  function openFrom(distance: number) {
    translateY.setValue(distance);
    Animated.timing(translateY, { toValue: 0, duration: OPEN_MS, useNativeDriver: true }).start();
    opened.current = true;
  }

  useEffect(() => {
    if (visible) {
      // 모달 마운트 게이트 — 닫기 슬라이드 동안 유지하려면 effect 에서 켜야 한다(불가피).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRendered(true);
      // 높이를 이미 알면 즉시 슬라이드업, 모르면 onLayout 에서 시작(첫 열림 깜빡임 방지).
      if (!opened.current && sheetH.current > 0) openFrom(sheetH.current);
    } else {
      if (rendered) {
        Animated.timing(translateY, {
          toValue: sheetH.current || winH,
          duration: CLOSE_MS,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) setRendered(false);
        });
      }
      opened.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, rendered, winH]);

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
      Alert.alert('오류', e instanceof Error ? e.message : '카테고리를 만들지 못했습니다.');
    }
  }

  return (
    <Modal visible={rendered} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY }] }]}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0) {
              sheetH.current = h;
              if (visible && !opened.current) openFrom(h); // 첫 열림: 측정 직후 정확한 높이로 슬라이드업
            }
          }}
        >
          <View style={styles.header}>
            <Text style={styles.title}>카테고리 선택</Text>
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
              placeholder="새 카테고리 이름"
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
        </Animated.View>
      </KeyboardAvoidingView>
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
