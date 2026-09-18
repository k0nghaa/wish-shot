import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FolderPickerSheet } from '@/components/FolderPickerSheet';
import { ImageZoomModal } from '@/components/ImageZoomModal';
import { DisclosureRow, FormBlock, FormCard, FormRow, formInput } from '@/components/FormField';
import { TagInput } from '@/components/TagInput';
import { colors, radius, spacing, type } from '@/constants/theme';
import { promptDeleteIfCategoryEmpty } from '@/lib/emptyCategory';
import { ImageNotReadyError, logImageDiag, readImageBytes } from '@/lib/imageBytes';
import {
  createCategory,
  DuplicateItemError,
  getCurrentUserId,
  getItem,
  getItemImageSignedUrl,
  listAllTags,
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
  const [zoomVisible, setZoomVisible] = useState(false); // 원본 확대 보기(롱프레스)
  const [imageUrl, setImageUrl] = useState<string | null>(null); // 기존 이미지(signed URL)
  // 새로 고른 교체 이미지(로컬 uri). null 이면 기존 이미지 유지.
  const [newImage, setNewImage] = useState<{ uri: string; contentType: string } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]); // 기존 태그(선택 칩용)

  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [price, setPrice] = useState('');
  const [sourceLink, setSourceLink] = useState('');
  const [memo, setMemo] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null); // null = 미분류
  const [initialCategoryId, setInitialCategoryId] = useState<string | null>(null); // 편집 전 카테고리(비움 판정용)
  const [folderSheet, setFolderSheet] = useState(false);

  const [saving, setSaving] = useState(false);

  // 저장된 아이템 값으로 폼을 프리필한다. 편집 화면은 OCR/분석을 실행하지 않는다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [item, cats, allTagList] = await Promise.all([
          getItem(id),
          listCategories().catch(() => []),
          listAllTags().catch(() => [] as string[]),
        ]);
        if (cancelled) return;
        setProductName(item.product_name);
        setBrand(item.brand ?? '');
        setPrice(item.price != null ? String(item.price) : '');
        setSourceLink(item.source_link ?? '');
        setMemo(item.memo ?? '');
        setTags(item.tags ?? []);
        setCategoryId(item.category_id);
        setInitialCategoryId(item.category_id);
        setCategories(cats);
        setAllTags(allTagList);
        setLoading(false);
        getItemImageSignedUrl(item.image_key)
          .then((url) => {
            if (!cancelled) setImageUrl(url);
          })
          .catch(() => {
            /* 이미지 미리보기 실패는 편집을 막지 않는다 */
          });
      } catch (e) {
        Alert.alert('오류', e instanceof Error ? e.message : '불러오지 못했습니다.', [
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
      Alert.alert('사진 접근 필요', '설정에서 사진 접근을 허용하세요.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1, exif: false });
    if (result.canceled) return;
    const asset = result.assets[0];
    logImageDiag('edit.pickImage', asset.uri, { fileSize: asset.fileSize, mimeType: asset.mimeType });
    setNewImage({ uri: asset.uri, contentType: asset.mimeType ?? 'image/jpeg' });
  }

  // 폴더 시트의 인라인 생성 — 만든 폴더를 목록에 추가하고 반환한다(시트가 선택·닫기 처리).
  async function createCategoryInline(name: string): Promise<Category> {
    const created = await createCategory(name);
    setCategories((prev) => [...prev, created]);
    return created;
  }

  const folderName = categoryId ? (categories.find((c) => c.id === categoryId)?.name ?? '미분류') : '미분류';
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
      // 편집으로 카테고리를 옮겨 원래 카테고리가 비었으면 삭제 안내. 비었으면 목록(홈)으로, 아니면 상세로.
      if (categoryId !== initialCategoryId) {
        const fromName = categories.find((c) => c.id === initialCategoryId)?.name;
        const { wasEmpty } = await promptDeleteIfCategoryEmpty(initialCategoryId, fromName);
        if (wasEmpty) {
          if (router.canDismiss()) router.dismissAll();
          else router.replace('/');
          return;
        }
      }
      router.back();
    } catch (e) {
      setSaving(false);
      // 다른 아이템과 정규화명이 겹치면 덮어쓰기 없이 안내·차단한다(제약 3).
      if (e instanceof DuplicateItemError) {
        Alert.alert('이미 있는 위시', '같은 브랜드·제품명의 위시가 있습니다. 브랜드나 제품명을 다르게 바꾸세요.');
        return;
      }
      // 필드는 저장됐으나 새 사진이 아직 로컬에 없음(iCloud 최적화) → 사진만 교체 실패 안내.
      if (e instanceof ImageNotReadyError) {
        Alert.alert('사진 준비 중', e.message);
        return;
      }
      Alert.alert('오류', e instanceof Error ? e.message : '수정하지 못했습니다.');
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="취소">
          <Text style={styles.cancel}>취소</Text>
        </TouchableOpacity>
        <Text style={styles.title}>위시 편집</Text>
        <TouchableOpacity onPress={handleSave} disabled={!canSave} hitSlop={8} accessibilityRole="button" accessibilityLabel="저장">
          {saving ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}>저장</Text>
          )}
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
            {/* 이미지 미리보기 / 교체 (중앙 정사각) */}
            <TouchableOpacity
              style={styles.imageBox}
              onPress={pickImage}
              onLongPress={() => (newImage?.uri ?? imageUrl) && setZoomVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="사진 바꾸기"
              accessibilityHint="길게 누르면 원본을 확대해 봅니다"
            >
              {newImage || imageUrl ? (
                <Image source={{ uri: newImage?.uri ?? imageUrl! }} style={styles.image} contentFit="cover" transition={150} />
              ) : (
                <View style={styles.imagePlaceholder}>
                  <SymbolView name="photo" size={32} tintColor={colors.silverDark} />
                </View>
              )}
            </TouchableOpacity>

            {/* 그룹 카드 1: 제품명·브랜드·가격·링크 */}
            <FormCard>
              <FormRow label="제품명" required>
                <TextInput
                  style={formInput.rowInput}
                  placeholder="예: 무선 이어폰"
                  placeholderTextColor={colors.textDisabled}
                  value={productName}
                  onChangeText={setProductName}
                />
              </FormRow>
              <FormRow label="브랜드">
                <TextInput
                  style={formInput.rowInput}
                  placeholder="예: 소니"
                  placeholderTextColor={colors.textDisabled}
                  value={brand}
                  onChangeText={setBrand}
                />
              </FormRow>
              <FormRow label="가격">
                <TextInput
                  style={formInput.rowInput}
                  placeholder="₩ 0"
                  placeholderTextColor={colors.textDisabled}
                  keyboardType="number-pad"
                  value={price}
                  onChangeText={setPrice}
                />
              </FormRow>
              <FormRow label="링크">
                <TextInput
                  style={formInput.rowInput}
                  placeholder="https://"
                  placeholderTextColor={colors.textDisabled}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  value={sourceLink}
                  onChangeText={setSourceLink}
                />
              </FormRow>
            </FormCard>

            {/* 그룹 카드 2: 폴더·메모 */}
            <FormCard>
              <DisclosureRow label="폴더" value={folderName} onPress={() => setFolderSheet(true)} />
              <FormBlock label="메모">
                <TextInput
                  style={formInput.memo}
                  placeholder="메모"
                  placeholderTextColor={colors.textDisabled}
                  multiline
                  value={memo}
                  onChangeText={setMemo}
                />
              </FormBlock>
            </FormCard>

            <TagInput tags={tags} onChange={setTags} suggestions={allTags} />

            {productName.trim().length === 0 ? (
              <Text style={styles.saveNote}>제품명을 입력하세요.</Text>
            ) : null}
        </ScrollView>
      )}

      {/* 원본 확대 보기(롱프레스) */}
      <ImageZoomModal visible={zoomVisible} uri={newImage?.uri ?? imageUrl} onClose={() => setZoomVisible(false)} />

      <FolderPickerSheet
        visible={folderSheet}
        onClose={() => setFolderSheet(false)}
        categories={categories}
        selectedId={categoryId}
        onSelect={setCategoryId}
        onCreateCategory={createCategoryInline}
      />
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
    paddingTop: spacing.three,
    paddingBottom: spacing.two,
  },
  cancel: { fontSize: 16, color: colors.primary },
  title: { ...type.headline, color: colors.textMain },
  saveBtn: { fontSize: 16, fontWeight: '700', color: colors.primary },
  saveBtnDisabled: { color: colors.textDisabled },
  content: { padding: spacing.three, gap: spacing.three, paddingBottom: spacing.six },
  imageBox: {
    alignSelf: 'center',
    width: '52%',
    aspectRatio: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.silver,
  },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  changeImage: { fontSize: 14, color: colors.primary, textAlign: 'center' },
  saveNote: { fontSize: 12, color: colors.textSub, textAlign: 'center' },
});
