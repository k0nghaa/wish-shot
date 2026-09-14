import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryPicker } from '@/components/CategoryPicker';
import { formInput } from '@/components/FormField';
import { colors, spacing } from '@/constants/theme';
import { promptDeleteIfCategoryEmpty } from '@/lib/emptyCategory';
import { formatSavedDate } from '@/lib/formatDate';
import { formatPriceKRW } from '@/lib/formatPrice';
import {
  createCategory,
  deleteItem,
  deleteItemImage,
  getItem,
  getItemImageSignedUrl,
  listCategories,
  moveItemCategory,
  type Category,
  type Item,
} from '@/lib/queries';

export default function ItemDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [item, setItem] = useState<Item | null>(null); // null = 로딩 중
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryName, setCategoryName] = useState<string>('미분류');
  const [deleting, setDeleting] = useState(false);

  // 카테고리 이동 시트(FR-15)
  const [moveVisible, setMoveVisible] = useState(false);
  const [moving, setMoving] = useState(false);
  const [newCatName, setNewCatName] = useState(''); // 시트 안 인라인 새 카테고리 입력
  // 이 화면에서의 동작(이동)으로 원래 카테고리가 비었으면 true → '뒤로'는 카테고리가 아닌 홈으로.
  const [emptiedSource, setEmptiedSource] = useState(false);

  // 위시리스트 목록(홈)으로 돌아간다. 스택에 카테고리 화면이 있으면 건너뛴다(깜빡임 방지).
  function goHome() {
    if (router.canDismiss()) router.dismissAll();
    else router.replace('/');
  }

  // 상세 '뒤로': 이 화면에서 원래 카테고리를 비웠으면 홈으로, 아니면 이전 화면으로.
  function goBack() {
    if (emptiedSource) goHome();
    else router.back();
  }

  const load = useCallback(async () => {
    try {
      const found = await getItem(id);
      setItem(found);
      const [url, cats] = await Promise.all([
        getItemImageSignedUrl(found.image_key).catch(() => null),
        listCategories().catch(() => [] as Category[]),
      ]);
      setImageUrl(url);
      setCategories(cats);
      setCategoryName(
        found.category_id ? (cats.find((c) => c.id === found.category_id)?.name ?? '미분류') : '미분류',
      );
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : '아이템을 불러오지 못했어요.', [
        { text: '확인', onPress: () => router.back() },
      ]);
    }
  }, [id, router]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function confirmDelete() {
    Alert.alert('삭제할까요?', '이 위시를 삭제해요. 복구할 수 없어요.', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: doDelete },
    ]);
  }

  async function doDelete() {
    if (!item) return;
    setDeleting(true);
    const from = item.category_id;
    const fromName = categories.find((c) => c.id === from)?.name;
    try {
      await deleteItem(item.id);
      // 행이 지워졌으면 목적은 달성. 이미지 삭제 실패는 치명적이지 않다(고아 객체만 남음).
      await deleteItemImage(item.image_key).catch(() => undefined);
      // 이 아이템이 카테고리의 마지막이었으면 카테고리 삭제 안내(응답까지 대기). 비었으면 목록(홈)으로, 아니면 이전 화면으로.
      const { wasEmpty } = await promptDeleteIfCategoryEmpty(from, fromName);
      if (wasEmpty) goHome();
      else router.back();
    } catch (e) {
      setDeleting(false);
      Alert.alert('오류', e instanceof Error ? e.message : '삭제하지 못했어요.');
    }
  }

  function openLink(url: string) {
    Linking.openURL(url).catch(() => Alert.alert('열 수 없어요', '링크를 열지 못했어요.'));
  }

  // 이동으로 원래 카테고리가 비었으면 안내를 띄우고, '뒤로 → 홈' 플래그를 세운다.
  async function checkSourceEmptied(fromCategoryId: string | null) {
    const fromName = categories.find((c) => c.id === fromCategoryId)?.name;
    const { wasEmpty } = await promptDeleteIfCategoryEmpty(fromCategoryId, fromName, () =>
      setCategories((prev) => prev.filter((c) => c.id !== fromCategoryId)),
    );
    if (wasEmpty) setEmptiedSource(true);
  }

  // 카테고리만 바꾼다(편집 화면을 거치지 않는 빠른 이동). null = 미분류. 같은 카테고리면 닫기만.
  async function moveTo(categoryId: string | null) {
    if (!item) return;
    const from = item.category_id;
    if (categoryId === from) {
      setMoveVisible(false);
      return;
    }
    setMoving(true);
    try {
      await moveItemCategory(item.id, categoryId);
      setMoveVisible(false);
      setMoving(false);
      await load(); // 상세의 카테고리명 즉시 갱신(홈·목록은 포커스 재조회로 갱신)
      await checkSourceEmptied(from);
    } catch (e) {
      setMoving(false);
      Alert.alert('오류', e instanceof Error ? e.message : '카테고리를 옮기지 못했어요.');
    }
  }

  // 시트 안 인라인 입력으로 새 카테고리를 만들고 바로 그 카테고리로 이동한다.
  // (모달 위에 Alert.prompt 를 띄우면 iOS 에서 콜백이 완료되지 못해 이동이 실패하므로 인라인 입력을 쓴다.)
  async function createAndMove() {
    const name = newCatName.trim();
    if (!name || moving || !item) return;
    const from = item.category_id;
    setMoving(true);
    try {
      const created = await createCategory(name);
      setCategories((prev) => [...prev, created]);
      setNewCatName('');
      await moveItemCategory(item.id, created.id);
      setMoveVisible(false);
      setMoving(false);
      await load();
      await checkSourceEmptied(from);
    } catch (e) {
      setMoving(false);
      Alert.alert('오류', e instanceof Error ? e.message : '카테고리를 만들지 못했어요.');
    }
  }

  const price = item ? formatPriceKRW(item.price) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="뒤로">
          <Text style={styles.back}>‹ 뒤로</Text>
        </TouchableOpacity>
        <View style={styles.headerSpacer} />
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/item/[id]/edit', params: { id } })}
            hitSlop={8}
            disabled={!item || deleting}
            accessibilityRole="button"
            accessibilityLabel="편집"
          >
            <Text style={styles.edit}>편집</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={confirmDelete}
            hitSlop={8}
            disabled={!item || deleting}
            accessibilityRole="button"
            accessibilityLabel="삭제"
          >
            {deleting ? <ActivityIndicator color={colors.error} /> : <Text style={styles.delete}>삭제</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {item === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.imageBox}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={styles.image} contentFit="cover" transition={150} />
            ) : (
              <View style={styles.imagePlaceholder} />
            )}
          </View>

          <Text style={styles.name}>{item.product_name}</Text>
          {item.brand ? <Text style={styles.brand}>{item.brand}</Text> : null}

          <View style={styles.rows}>
            {price ? <InfoRow label="가격" value={price} /> : null}
            <InfoRow label="카테고리" value={categoryName} />
            <InfoRow label="저장일" value={formatSavedDate(item.created_at)} />
            {item.source_link ? (
              <InfoRow
                label="링크"
                value={item.source_link}
                onPress={() => openLink(item.source_link!)}
              />
            ) : null}
          </View>

          <TouchableOpacity
            style={styles.moveBtn}
            onPress={() => setMoveVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="카테고리 이동"
          >
            <Text style={styles.moveBtnText}>카테고리 이동</Text>
          </TouchableOpacity>

          {item.memo ? (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>메모</Text>
              <Text style={styles.memo}>{item.memo}</Text>
            </View>
          ) : null}

          {item.tags && item.tags.length > 0 ? (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>태그</Text>
              <View style={styles.tags}>
                {item.tags.map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    style={styles.tag}
                    onPress={() => router.push({ pathname: '/tag/[name]', params: { name: tag } })}
                    accessibilityRole="button"
                    accessibilityLabel={`태그로 모아보기: ${tag}`}
                  >
                    <Text style={styles.tagText}>{tag}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}

      <Modal visible={moveVisible} transparent animationType="slide" onRequestClose={() => setMoveVisible(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>카테고리 이동</Text>
              {moving ? <ActivityIndicator color={colors.primary} /> : null}
            </View>
            <CategoryPicker categories={categories} selectedId={item?.category_id ?? null} onSelect={moveTo} />
            <View style={styles.newCatRow}>
              <TextInput
                style={[formInput.input, styles.newCatInput]}
                placeholder="새 카테고리 이름"
                placeholderTextColor={colors.textDisabled}
                value={newCatName}
                onChangeText={setNewCatName}
                onSubmitEditing={createAndMove}
                returnKeyType="done"
                editable={!moving}
              />
              <TouchableOpacity
                style={[styles.newCatBtn, (!newCatName.trim() || moving) && styles.newCatBtnDisabled]}
                onPress={createAndMove}
                disabled={!newCatName.trim() || moving}
                accessibilityRole="button"
              >
                <Text style={styles.newCatBtnText}>만들고 이동</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.sheetClose}
              onPress={() => {
                setMoveVisible(false);
                setNewCatName('');
              }}
              accessibilityRole="button"
            >
              <Text style={styles.sheetCloseText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function InfoRow({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {onPress ? (
        <Text style={[styles.rowValue, styles.link]} numberOfLines={1} onPress={onPress}>
          {value}
        </Text>
      ) : (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.three,
    paddingTop: spacing.two,
    paddingBottom: spacing.two,
  },
  back: { fontSize: 16, color: colors.primary },
  headerSpacer: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.four },
  edit: { fontSize: 16, color: colors.primary, fontWeight: '600' },
  delete: { fontSize: 16, color: colors.error, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  name: { fontSize: 22, fontWeight: '700', color: colors.textMain },
  brand: { fontSize: 16, color: colors.textSub, marginTop: -spacing.two },
  rows: {
    backgroundColor: colors.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.silver,
    paddingHorizontal: spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.three,
    paddingVertical: spacing.three,
  },
  rowLabel: { fontSize: 14, color: colors.textSub },
  rowValue: { flex: 1, fontSize: 15, color: colors.textMain, textAlign: 'right' },
  link: { color: colors.primary },
  moveBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveBtnText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  sheetBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.four,
    gap: spacing.three,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: colors.textMain },
  newCatRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.two },
  newCatInput: { flex: 1 },
  newCatBtn: {
    borderRadius: 10,
    backgroundColor: colors.primary,
    paddingVertical: spacing.three,
    paddingHorizontal: spacing.three,
    justifyContent: 'center',
  },
  newCatBtnDisabled: { opacity: 0.5 },
  newCatBtnText: { fontSize: 14, fontWeight: '600', color: colors.bgCard },
  sheetClose: { alignItems: 'center', paddingVertical: spacing.three },
  sheetCloseText: { fontSize: 15, fontWeight: '600', color: colors.textSub },
  block: { gap: spacing.two },
  blockLabel: { fontSize: 14, fontWeight: '600', color: colors.textMain },
  memo: { fontSize: 15, color: colors.textMain, lineHeight: 22 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.two },
  tag: {
    borderRadius: 999,
    backgroundColor: colors.primaryLight,
    paddingVertical: spacing.one,
    paddingHorizontal: spacing.three,
  },
  tagText: { fontSize: 13, color: colors.primaryHover },
});
