import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { uuid } from 'expo-modules-core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OverwriteDialog } from '@/components/OverwriteDialog';
import { colors, spacing } from '@/constants/theme';
import { readImageBytes } from '@/lib/imageBytes';
import {
  createCategory,
  createItem,
  DuplicateItemError,
  findDuplicateItem,
  getCurrentUserId,
  getItemImageSignedUrl,
  listCategories,
  updateItem,
  uploadItemImage,
  type Category,
  type Item,
} from '@/lib/queries';

const emptyToNull = (s: string): string | null => (s.trim() ? s.trim() : null);

function parsePrice(text: string): number | null {
  const digits = text.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

export default function RegisterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ imageUri?: string; imageMime?: string }>();

  const [imageUri, setImageUri] = useState<string | null>(params.imageUri ?? null);
  const [contentType, setContentType] = useState<string>(params.imageMime ?? 'image/jpeg');

  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [price, setPrice] = useState('');
  const [sourceLink, setSourceLink] = useState('');
  const [memo, setMemo] = useState('');

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null); // null = 미분류

  const [saving, setSaving] = useState(false);

  // 중복 덮어쓰기 모달 상태
  const [dupItem, setDupItem] = useState<Item | null>(null);
  const [dupThumb, setDupThumb] = useState<string | null>(null);
  const [dupVisible, setDupVisible] = useState(false);
  const [overwriteBusy, setOverwriteBusy] = useState(false);

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch(() => {
        /* 카테고리 로드 실패는 저장을 막지 않는다(미분류로 저장 가능) */
      });
  }, []);

  const canSave = Boolean(imageUri) && productName.trim().length > 0 && !saving;

  async function pickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('사진 접근이 필요해요', '설정에서 사진 접근을 허용하면 이미지를 담을 수 있어요.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1 });
    if (result.canceled) return;
    const asset = result.assets[0];
    setImageUri(asset.uri);
    if (asset.mimeType) setContentType(asset.mimeType);
  }

  function handleCreateCategory() {
    Alert.prompt('새 카테고리', '카테고리 이름을 입력해요.', async (input) => {
      const name = input?.trim();
      if (!name) return;
      try {
        const created = await createCategory(name);
        setCategories((prev) => [...prev, created]);
        setCategoryId(created.id);
      } catch (e) {
        Alert.alert('오류', e instanceof Error ? e.message : '카테고리를 만들지 못했어요.');
      }
    });
  }

  async function openDuplicate(existing: Item) {
    const url = await getItemImageSignedUrl(existing.image_key).catch(() => null);
    setDupItem(existing);
    setDupThumb(url);
    setDupVisible(true);
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const existing = await findDuplicateItem(brand, productName.trim());
      if (existing) {
        setSaving(false);
        await openDuplicate(existing);
        return;
      }
      await performNewSave();
    } catch (e) {
      setSaving(false);
      Alert.alert('오류', e instanceof Error ? e.message : '저장에 실패했어요.');
    }
  }

  async function performNewSave() {
    const userId = await getCurrentUserId();
    const id = uuid.v4();
    const bytes = await readImageBytes(imageUri!);
    // Storage 업로드 실패 시 여기서 throw → 아이템 행을 만들지 않는다(E-5: 이미지 없는 아이템 금지).
    const imageKey = await uploadItemImage(userId, id, bytes, contentType);
    try {
      await createItem({
        id,
        categoryId,
        imageKey,
        productName: productName.trim(),
        brand: emptyToNull(brand),
        price: parsePrice(price),
        sourceLink: emptyToNull(sourceLink),
        memo: emptyToNull(memo),
      });
    } catch (e) {
      // 사전조회를 놓친 경합(23505) → 덮어쓰기 모달로 폴백
      if (e instanceof DuplicateItemError) {
        const existing = await findDuplicateItem(brand, productName.trim());
        setSaving(false);
        if (existing) await openDuplicate(existing);
        return;
      }
      throw e;
    }
    setSaving(false);
    router.replace('/');
  }

  async function handleOverwrite() {
    const existing = dupItem;
    if (!existing) return;
    setOverwriteBusy(true);
    try {
      const userId = await getCurrentUserId();
      const bytes = await readImageBytes(imageUri!);
      // 같은 Storage 키에 새 스크린샷 덮어쓰기(upsert) + 필드 갱신. 새 행 추가 아님.
      await uploadItemImage(userId, existing.id, bytes, contentType);
      await updateItem(existing.id, {
        categoryId,
        productName: productName.trim(),
        brand: emptyToNull(brand),
        price: parsePrice(price),
        sourceLink: emptyToNull(sourceLink),
        memo: emptyToNull(memo),
      });
      setDupVisible(false);
      setOverwriteBusy(false);
      router.replace('/');
    } catch (e) {
      setOverwriteBusy(false);
      Alert.alert('오류', e instanceof Error ? e.message : '덮어쓰기에 실패했어요.');
    }
  }

  function handleViewExisting() {
    const existing = dupItem;
    setDupVisible(false);
    if (existing) {
      router.replace({ pathname: '/item/[id]', params: { id: existing.id } });
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="뒤로">
          <Text style={styles.back}>‹ 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.title}>위시 담기</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* 이미지 미리보기 / 선택 */}
          <TouchableOpacity style={styles.imageBox} onPress={pickImage} accessibilityRole="button">
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.image} contentFit="cover" />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Text style={styles.imagePlaceholderText}>사진 선택</Text>
                <Text style={styles.imageHint}>스크린샷을 골라 담아요</Text>
              </View>
            )}
          </TouchableOpacity>
          {imageUri ? (
            <TouchableOpacity onPress={pickImage} accessibilityRole="button">
              <Text style={styles.changeImage}>다른 사진 선택</Text>
            </TouchableOpacity>
          ) : null}

          {/* Phase 3 자리: OCR 자동 채움 */}
          <View style={styles.ocrHint}>
            <Text style={styles.ocrHintText}>AI 자동 채움은 다음 업데이트에서 붙어요(Phase 3).</Text>
          </View>

          {/* 폼 */}
          <Field label="제품명" required>
            <TextInput
              style={styles.input}
              placeholder="예: 무선 이어폰"
              placeholderTextColor={colors.textDisabled}
              value={productName}
              onChangeText={setProductName}
            />
          </Field>
          <Field label="브랜드">
            <TextInput
              style={styles.input}
              placeholder="예: 소니"
              placeholderTextColor={colors.textDisabled}
              value={brand}
              onChangeText={setBrand}
            />
          </Field>
          <Field label="가격 (원)">
            <TextInput
              style={styles.input}
              placeholder="예: 189000"
              placeholderTextColor={colors.textDisabled}
              keyboardType="number-pad"
              value={price}
              onChangeText={setPrice}
            />
          </Field>
          <Field label="링크">
            <TextInput
              style={styles.input}
              placeholder="https://"
              placeholderTextColor={colors.textDisabled}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={sourceLink}
              onChangeText={setSourceLink}
            />
          </Field>
          <Field label="메모">
            <TextInput
              style={[styles.input, styles.memo]}
              placeholder="메모를 남겨요"
              placeholderTextColor={colors.textDisabled}
              multiline
              value={memo}
              onChangeText={setMemo}
            />
          </Field>

          {/* 카테고리 선택 */}
          <Text style={styles.fieldLabel}>카테고리</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="미분류" selected={categoryId === null} onPress={() => setCategoryId(null)} />
            {categories.map((c) => (
              <Chip key={c.id} label={c.name} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
            ))}
            <Chip label="+ 새 카테고리" selected={false} onPress={handleCreateCategory} />
          </ScrollView>

          <TouchableOpacity
            style={[styles.save, !canSave && styles.saveDisabled]}
            onPress={handleSave}
            disabled={!canSave}
            accessibilityRole="button"
          >
            {saving ? (
              <ActivityIndicator color={colors.bgCard} />
            ) : (
              <Text style={styles.saveText}>저장</Text>
            )}
          </TouchableOpacity>
          {!imageUri ? <Text style={styles.saveNote}>사진을 선택해야 저장할 수 있어요.</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <OverwriteDialog
        visible={dupVisible}
        item={dupItem}
        thumbnailUrl={dupThumb}
        busy={overwriteBusy}
        onOverwrite={handleOverwrite}
        onView={handleViewExisting}
        onCancel={() => setDupVisible(false)}
      />
    </SafeAreaView>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      {children}
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.three,
    paddingTop: spacing.two,
    paddingBottom: spacing.two,
  },
  back: { fontSize: 16, color: colors.primary, width: 72 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.textMain, textAlign: 'center' },
  headerSpacer: { width: 72 },
  content: {
    padding: spacing.three,
    gap: spacing.three,
    paddingBottom: spacing.six,
  },
  imageBox: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.silver,
  },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.one,
  },
  imagePlaceholderText: { fontSize: 16, fontWeight: '600', color: colors.primary },
  imageHint: { fontSize: 13, color: colors.textSub },
  changeImage: { fontSize: 14, color: colors.primary, textAlign: 'center' },
  ocrHint: {
    borderRadius: 10,
    backgroundColor: colors.primaryLight,
    paddingVertical: spacing.two,
    paddingHorizontal: spacing.three,
  },
  ocrHintText: { fontSize: 12, color: colors.textSub },
  field: { gap: spacing.one },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: colors.textMain },
  required: { color: colors.error },
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
  save: {
    marginTop: spacing.two,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveDisabled: { opacity: 0.5 },
  saveText: { fontSize: 16, fontWeight: '600', color: colors.bgCard },
  saveNote: { fontSize: 12, color: colors.textSub, textAlign: 'center' },
});
