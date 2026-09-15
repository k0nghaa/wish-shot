import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useCallback, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Gallery from 'react-native-awesome-gallery';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryPicker } from '@/components/CategoryPicker';
import { colors, colorsDark, radius, spacing, type } from '@/constants/theme';
import { promptDeleteIfCategoryEmpty } from '@/lib/emptyCategory';
import { formatPriceKRW } from '@/lib/formatPrice';
import {
  createCategory,
  deleteItem,
  deleteItemImage,
  getItem,
  getItemImageSignedUrls,
  listCategories,
  listItems,
  listItemsByCategory,
  listItemsByTag,
  moveItemCategory,
  type Category,
  type Item,
} from '@/lib/queries';

// 좌우 스와이프(이전/다음)의 대상 목록을 상세가 알도록 진입부가 넘기는 컨텍스트.
type Ctx = 'all' | 'cat' | 'uncat' | 'tag';

export default function ItemDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; ctx?: Ctx; ctxKey?: string }>();
  const { id, ctx, ctxKey } = params;

  const [items, setItems] = useState<Item[] | null>(null); // 좌우로 넘길 아이템들(null = 로딩)
  const [index, setIndex] = useState(0); // 현재 보고 있는 위치
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [deleting, setDeleting] = useState(false);

  const [moveVisible, setMoveVisible] = useState(false);
  const [moving, setMoving] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [emptiedSource, setEmptiedSource] = useState(false);
  const insets = useSafeAreaInsets();

  const current = items && items.length > 0 ? (items[index] ?? items[0]) : null;

  function goHome() {
    if (router.canDismiss()) router.dismissAll();
    else router.replace('/');
  }

  function goBack() {
    if (emptiedSource) goHome();
    else if (router.canGoBack()) router.back();
    else goHome();
  }

  const load = useCallback(async () => {
    try {
      // 컨텍스트에 맞는 목록을 불러온다(없으면 단일 아이템만).
      let list: Item[];
      if (ctx === 'all') list = await listItems();
      else if (ctx === 'cat' && ctxKey) list = await listItemsByCategory(ctxKey);
      else if (ctx === 'uncat') list = await listItemsByCategory(null);
      else if (ctx === 'tag' && ctxKey) list = await listItemsByTag(ctxKey);
      else list = [await getItem(id)];

      const idx = Math.max(0, list.findIndex((it) => it.id === id));
      const [urlMap, cats] = await Promise.all([
        getItemImageSignedUrls(list.map((it) => it.image_key)),
        listCategories().catch(() => [] as Category[]),
      ]);
      setItems(list);
      setIndex(idx);
      setUrls(urlMap);
      setCategories(cats);
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : '불러오지 못했습니다.', [
        { text: '확인', onPress: goBack },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ctx, ctxKey]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function confirmDelete() {
    Alert.alert('삭제할까요?', '삭제한 위시는 복구할 수 없습니다.', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: doDelete },
    ]);
  }

  async function doDelete() {
    if (!current) return;
    setDeleting(true);
    const from = current.category_id;
    const fromName = categories.find((c) => c.id === from)?.name;
    try {
      await deleteItem(current.id);
      await deleteItemImage(current.image_key).catch(() => undefined);
      const { wasEmpty } = await promptDeleteIfCategoryEmpty(from, fromName);
      if (wasEmpty) goHome();
      else goBack();
    } catch (e) {
      setDeleting(false);
      Alert.alert('오류', e instanceof Error ? e.message : '삭제하지 못했습니다.');
    }
  }

  function openLink() {
    if (!current?.source_link) return;
    Linking.openURL(current.source_link).catch(() => Alert.alert('링크 열기 실패', '링크를 열지 못했습니다.'));
  }

  function handleMore() {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['카테고리 이동', '취소'], cancelButtonIndex: 1 },
      (i) => {
        if (i === 0) setMoveVisible(true);
      },
    );
  }

  async function checkSourceEmptied(fromCategoryId: string | null) {
    const fromName = categories.find((c) => c.id === fromCategoryId)?.name;
    const { wasEmpty } = await promptDeleteIfCategoryEmpty(fromCategoryId, fromName, () =>
      setCategories((prev) => prev.filter((c) => c.id !== fromCategoryId)),
    );
    if (wasEmpty) setEmptiedSource(true);
  }

  async function moveTo(categoryId: string | null) {
    if (!current) return;
    const from = current.category_id;
    if (categoryId === from) {
      setMoveVisible(false);
      return;
    }
    setMoving(true);
    try {
      await moveItemCategory(current.id, categoryId);
      setMoveVisible(false);
      setMoving(false);
      await load();
      await checkSourceEmptied(from);
    } catch (e) {
      setMoving(false);
      Alert.alert('오류', e instanceof Error ? e.message : '옮기지 못했습니다.');
    }
  }

  async function createAndMove() {
    const name = newCatName.trim();
    if (!name || moving || !current) return;
    const from = current.category_id;
    setMoving(true);
    try {
      const created = await createCategory(name);
      setCategories((prev) => [...prev, created]);
      setNewCatName('');
      await moveItemCategory(current.id, created.id);
      setMoveVisible(false);
      setMoving(false);
      await load();
      await checkSourceEmptied(from);
    } catch (e) {
      setMoving(false);
      Alert.alert('오류', e instanceof Error ? e.message : '만들지 못했습니다.');
    }
  }

  const price = current ? formatPriceKRW(current.price) : null;
  const subtitle = current ? [current.brand, price].filter(Boolean).join(' · ') : '';
  const hasLink = Boolean(current?.source_link);
  const galleryData = items ? items.map((it) => urls[it.image_key] ?? '') : [];

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* 사진을 화면 전체(풀블리드)로 깔고, 헤더·액션바를 그 위에 겹친다(앨범과 동일). */}
      {items === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colorsDark.textMain} />
        </View>
      ) : (
        <GestureHandlerRootView style={StyleSheet.absoluteFill}>
          <Gallery
            data={galleryData}
            initialIndex={index}
            onIndexChange={setIndex}
            onSwipeToClose={goBack}
            keyExtractor={(_, i) => items?.[i]?.id ?? String(i)}
            renderItem={({ item, setImageDimensions }) =>
              item ? (
                <Image
                  source={{ uri: item }}
                  style={StyleSheet.absoluteFill}
                  contentFit="contain"
                  onLoad={(e) => setImageDimensions({ width: e.source.width, height: e.source.height })}
                />
              ) : (
                <View style={StyleSheet.absoluteFill} />
              )
            }
          />
        </GestureHandlerRootView>
      )}

      <View style={[styles.header, { paddingTop: insets.top + spacing.two }]}>
        <TouchableOpacity style={styles.circleBtn} onPress={goBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="뒤로">
          <SymbolView name="chevron.left" size={18} tintColor={colorsDark.textMain} weight="semibold" />
        </TouchableOpacity>

        <View style={styles.titlePill}>
          <Text style={styles.titleName} numberOfLines={1}>
            {current?.product_name ?? ' '}
          </Text>
          {subtitle ? (
            <Text style={styles.titleSub} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        <TouchableOpacity style={styles.circleBtn} onPress={handleMore} hitSlop={8} disabled={!current} accessibilityRole="button" accessibilityLabel="더보기">
          <SymbolView name="ellipsis" size={18} tintColor={colorsDark.textMain} weight="semibold" />
        </TouchableOpacity>
      </View>

      {/* 하단 액션바(알약): 정보 · 링크 · 편집 · 삭제 (현재 보고 있는 아이템 기준) */}
      <View style={[styles.actionBarWrap, { bottom: insets.bottom + spacing.two }]}>
        <View style={styles.actionBar}>
          <ActionButton icon="info.circle" label="정보" onPress={() => current && router.push({ pathname: '/item/[id]/info', params: { id: current.id } })} disabled={!current} />
          <ActionButton icon="link" label="링크" onPress={openLink} disabled={!current || !hasLink} />
          <ActionButton icon="pencil" label="편집" onPress={() => current && router.push({ pathname: '/item/[id]/edit', params: { id: current.id } })} disabled={!current || deleting} />
          <ActionButton icon="trash" label="삭제" tint={colorsDark.error} onPress={confirmDelete} disabled={!current || deleting} loading={deleting} />
        </View>
      </View>

      <Modal visible={moveVisible} transparent animationType="slide" onRequestClose={() => setMoveVisible(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>카테고리 이동</Text>
              {moving ? <ActivityIndicator color={colors.primary} /> : null}
            </View>
            <CategoryPicker categories={categories} selectedId={current?.category_id ?? null} onSelect={moveTo} />
            <View style={styles.newCatRow}>
              <TextInput
                style={styles.newCatInput}
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
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  disabled,
  tint,
  loading,
}: {
  icon: SFSymbol;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tint?: string;
  loading?: boolean;
}) {
  const color = disabled ? colorsDark.textDisabled : (tint ?? colorsDark.textMain);
  return (
    <TouchableOpacity
      style={styles.actionBtn}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {loading ? (
        <ActivityIndicator color={colorsDark.error} />
      ) : (
        <SymbolView name={icon} size={22} tintColor={color} />
      )}
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const CIRCLE = 40;

const styles = StyleSheet.create({
  // 상세 = 사진 뷰어 → 앨범처럼 항상 검정 크롬(준비해둔 다크 토큰 사용).
  root: { flex: 1, backgroundColor: colorsDark.bg },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.two,
    paddingHorizontal: spacing.three,
    paddingBottom: spacing.two,
  },
  circleBtn: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    backgroundColor: colorsDark.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titlePill: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colorsDark.bgCard,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.three,
    paddingVertical: spacing.one,
  },
  titleName: { ...type.headline, color: colorsDark.textMain },
  titleSub: { ...type.footnote, color: colorsDark.textSub },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  actionBarWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    gap: spacing.four,
    backgroundColor: colorsDark.bgCard,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.four,
    paddingVertical: spacing.two,
  },
  actionBtn: { alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 44 },
  actionLabel: { ...type.caption },
  sheetBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.four,
    gap: spacing.three,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...type.headline, color: colors.textMain },
  newCatRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.two },
  newCatInput: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    paddingVertical: spacing.three,
    paddingHorizontal: spacing.three,
    fontSize: 16,
    color: colors.textMain,
  },
  newCatBtn: {
    borderRadius: 10,
    backgroundColor: colors.primary,
    paddingVertical: spacing.three,
    paddingHorizontal: spacing.three,
    justifyContent: 'center',
  },
  newCatBtnDisabled: { opacity: 0.5 },
  newCatBtnText: { fontSize: 14, fontWeight: '600', color: colors.bg },
  sheetClose: { alignItems: 'center', paddingVertical: spacing.three },
  sheetCloseText: { fontSize: 15, fontWeight: '600', color: colors.textSub },
});
