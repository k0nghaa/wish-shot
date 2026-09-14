import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
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

import { CategoryPicker } from '@/components/CategoryPicker';
import { FormField, formInput } from '@/components/FormField';
import { TagInput } from '@/components/TagInput';
import { colors, spacing } from '@/constants/theme';
import { readImageBytes } from '@/lib/imageBytes';
import {
  createCategory,
  DuplicateItemError,
  getCurrentUserId,
  getItem,
  getItemImageSignedUrl,
  listCategories,
  updateItem,
  uploadItemImage,
  type Category,
} from '@/lib/queries';

const emptyToNull = (s: string): string | null => (s.trim() ? s.trim() : null);

function parsePrice(text: string): number | null {
  const digits = text.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

export default function ItemEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [imageUrl, setImageUrl] = useState<string | null>(null); // 기존 이미지(signed URL)
  // 새로 고른 교체 이미지(로컬 uri). null 이면 기존 이미지 유지.
  const [newImage, setNewImage] = useState<{ uri: string; contentType: string } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [price, setPrice] = useState('');
  const [sourceLink, setSourceLink] = useState('');
  const [memo, setMemo] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null); // null = 미분류

  const [saving, setSaving] = useState(false);

  // 저장된 아이템 값으로 폼을 프리필한다. 편집 화면은 OCR/분석을 실행하지 않는다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [item, cats] = await Promise.all([getItem(id), listCategories().catch(() => [])]);
        if (cancelled) return;
        setProductName(item.product_name);
        setBrand(item.brand ?? '');
        setPrice(item.price != null ? String(item.price) : '');
        setSourceLink(item.source_link ?? '');
        setMemo(item.memo ?? '');
        setTags(item.tags ?? []);
        setCategoryId(item.category_id);
        setCategories(cats);
        setLoading(false);
        getItemImageSignedUrl(item.image_key)
          .then((url) => {
            if (!cancelled) setImageUrl(url);
          })
          .catch(() => {
            /* 이미지 미리보기 실패는 편집을 막지 않는다 */
          });
      } catch (e) {
        Alert.alert('오류', e instanceof Error ? e.message : '아이템을 불러오지 못했어요.', [
          { text: '확인', onPress: () => router.back() },
        ]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  async function pickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('사진 접근이 필요해요', '설정에서 사진 접근을 허용하면 이미지를 바꿀 수 있어요.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1 });
    if (result.canceled) return;
    const asset = result.assets[0];
    setNewImage({ uri: asset.uri, contentType: asset.mimeType ?? 'image/jpeg' });
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

  const canSave = !loading && !saving && productName.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      // brand/product_name 이 바뀌면 normalizeName 이 재계산된다(updateItem 내부, 단일 소스).
      // 필드를 먼저 저장한다 — 중복(23505)이면 여기서 막혀 이미지를 건드리지 않는다.
      await updateItem(id, {
        categoryId,
        productName: productName.trim(),
        brand: emptyToNull(brand),
        price: parsePrice(price),
        sourceLink: emptyToNull(sourceLink),
        memo: emptyToNull(memo),
        tags: tags.length ? tags : null,
      });
      // 필드 저장이 통과한 뒤에만 이미지를 같은 Storage 키에 덮어쓴다(image_key 불변).
      if (newImage) {
        const userId = await getCurrentUserId();
        const bytes = await readImageBytes(newImage.uri);
        await uploadItemImage(userId, id, bytes, newImage.contentType);
      }
      // 상세 화면은 포커스 시 재조회(signed URL도 새로 발급)하므로 back 하면 최신값·새 이미지가 반영된다.
      router.back();
    } catch (e) {
      setSaving(false);
      // 다른 아이템과 정규화명이 겹치면 덮어쓰기 없이 안내·차단한다(제약 3).
      if (e instanceof DuplicateItemError) {
        Alert.alert('이미 있는 위시예요', '같은 브랜드·제품명의 위시가 이미 있어요. 브랜드나 제품명을 다르게 바꿔 주세요.');
        return;
      }
      Alert.alert('오류', e instanceof Error ? e.message : '수정하지 못했어요.');
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="뒤로">
          <Text style={styles.back}>‹ 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.title}>위시 편집</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {/* 이미지 미리보기 / 교체 (탭하면 사진 선택) */}
            <TouchableOpacity style={styles.imageBox} onPress={pickImage} accessibilityRole="button" accessibilityLabel="사진 바꾸기">
              {newImage || imageUrl ? (
                <Image
                  source={{ uri: newImage?.uri ?? imageUrl! }}
                  style={styles.image}
                  contentFit="cover"
                  transition={150}
                />
              ) : (
                <View style={styles.imagePlaceholder} />
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={pickImage} accessibilityRole="button">
              <Text style={styles.changeImage}>다른 사진 선택</Text>
            </TouchableOpacity>

            <FormField label="제품명" required>
              <TextInput
                style={formInput.input}
                placeholder="예: 무선 이어폰"
                placeholderTextColor={colors.textDisabled}
                value={productName}
                onChangeText={setProductName}
              />
            </FormField>
            <FormField label="브랜드">
              <TextInput
                style={formInput.input}
                placeholder="예: 소니"
                placeholderTextColor={colors.textDisabled}
                value={brand}
                onChangeText={setBrand}
              />
            </FormField>
            <FormField label="가격 (원)">
              <TextInput
                style={formInput.input}
                placeholder="예: 189000"
                placeholderTextColor={colors.textDisabled}
                keyboardType="number-pad"
                value={price}
                onChangeText={setPrice}
              />
            </FormField>
            <FormField label="링크">
              <TextInput
                style={formInput.input}
                placeholder="https://"
                placeholderTextColor={colors.textDisabled}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={sourceLink}
                onChangeText={setSourceLink}
              />
            </FormField>
            <FormField label="메모">
              <TextInput
                style={[formInput.input, formInput.memo]}
                placeholder="메모를 남겨요"
                placeholderTextColor={colors.textDisabled}
                multiline
                value={memo}
                onChangeText={setMemo}
              />
            </FormField>

            <TagInput tags={tags} onChange={setTags} />

            <CategoryPicker
              categories={categories}
              selectedId={categoryId}
              onSelect={setCategoryId}
              onCreate={handleCreateCategory}
            />

            <TouchableOpacity
              style={[styles.save, !canSave && styles.saveDisabled]}
              onPress={handleSave}
              disabled={!canSave}
              accessibilityRole="button"
            >
              {saving ? <ActivityIndicator color={colors.bgCard} /> : <Text style={styles.saveText}>저장</Text>}
            </TouchableOpacity>
            {productName.trim().length === 0 ? (
              <Text style={styles.saveNote}>제품명을 입력해주세요.</Text>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  content: { padding: spacing.three, gap: spacing.three, paddingBottom: spacing.six },
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
  imagePlaceholder: { flex: 1, backgroundColor: colors.silver },
  changeImage: { fontSize: 14, color: colors.primary, textAlign: 'center', marginTop: -spacing.two },
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
