import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { ItemSelectionControls } from '@/components/ItemSelectionControls';
import { ListRefreshControl, LoadFailed, useListLoad } from '@/components/listLoad';
import { PhotoTile } from '@/components/PhotoTile';
import { colors, spacing } from '@/constants/theme';
import { useItemSelection } from '@/hooks/useItemSelection';
import { useNotifications } from '@/hooks/useNotifications';
import {
  getItemImageSignedUrls,
  getItemThumbSignedUrls,
  listCategories,
  listItemsByCategory,
  type Category,
  type Item,
} from '@/lib/queries';

const COLUMNS = 3;

export default function CategoryItemsScreen() {
  const router = useRouter();
  const linkState = useNotifications(); // 저장 뒤 링크 찾기 상태(타일 흐림·새 링크 점)
  const { width } = useWindowDimensions();
  const tileSize = width / COLUMNS; // 여백 없이 화면 폭 3등분(전체 탭과 동일)
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const id = params.id;
  const isUncat = id === 'uncategorized';
  const title = params.name ?? (isUncat ? '미분류' : '카테고리');

  const [items, setItems] = useState<Item[] | null>(null); // null = 로딩 중
  const [urls, setUrls] = useState<Record<string, string>>({}); // 썸네일(우선)
  const [fallbackUrls, setFallbackUrls] = useState<Record<string, string>>({}); // 원본(폴백)
  const [categories, setCategories] = useState<Category[]>([]);

  // 실패하면 throw 한다 — 처음부터 못 불러오면 목록 자리에 실패 안내, 이미 불러온 목록이 있으면 스낵바(useListLoad).
  const load = useCallback(async () => {
    // 이 카테고리가 (다른 화면에서) 삭제됐으면 빈 화면 대신 카테고리 탭으로 돌아간다.
    // dismissTo: 아래에 있는 탭 그룹까지 닫고 카테고리 탭으로(replace 는 탭 그룹을 하나 더 쌓는다).
    // 카테고리 목록을 못 불러온 것(통신 실패)은 삭제된 것이 아니다 — 돌아가지 않고 위시 목록만 불러온다.
    const cats: Category[] | null = await listCategories().catch(() => null);
    if (cats && !isUncat && !cats.some((c) => c.id === id)) {
      router.dismissTo('/categories');
      return;
    }
    const list = await listItemsByCategory(isUncat ? null : id);
    const keys = list.map((it) => it.image_key);
    const [thumbMap, origMap] = await Promise.all([getItemThumbSignedUrls(keys), getItemImageSignedUrls(keys)]);
    setItems(list);
    setUrls(thumbMap);
    setFallbackUrls(origMap);
    setCategories(cats ?? []);
  }, [id, isUncat, router]);

  const { status, run, retry, refreshing, refresh } = useListLoad(load);

  const selection = useItemSelection({ items, categories, setCategories, reload: run });
  // 선택·링크 찾기 상태가 바뀔 때만 그리드를 다시 그린다(매 렌더 새 배열이면 FlatList 비교가 깨짐).
  const gridExtra = useMemo(() => [selection.selected, linkState], [selection.selected, linkState]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        {selection.selectMode ? (
          <View style={styles.headerSpacer} />
        ) : (
          <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="뒤로">
            <Text style={styles.back}>‹ 뒤로</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title} numberOfLines={1}>
          {selection.selectMode ? `${selection.selected.size}개 선택` : title}
        </Text>
        {items && items.length > 0 ? (
          <TouchableOpacity
            onPress={() => (selection.selectMode ? selection.exitSelect() : selection.enterSelect())}
            hitSlop={8}
            style={styles.headerRight}
            accessibilityRole="button"
            accessibilityLabel={selection.selectMode ? '선택 취소' : '선택'}
          >
            <Text style={styles.action}>{selection.selectMode ? '취소' : '선택'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {items === null ? (
        status === 'failed' ? (
          <LoadFailed onRetry={() => void retry()} refreshing={refreshing} onRefresh={refresh} />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )
      ) : items.length === 0 ? (
        <EmptyState title="담은 위시가 없습니다" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          numColumns={COLUMNS}
          contentContainerStyle={styles.list}
          extraData={gridExtra}
          refreshControl={<ListRefreshControl refreshing={refreshing} onRefresh={refresh} />}
          renderItem={({ item }) => (
            <PhotoTile
              url={urls[item.image_key] ?? null}
              fallbackUrl={fallbackUrls[item.image_key] ?? null}
              size={tileSize}
              accessibilityLabel={item.product_name}
              linkPending={linkState.pendingItemIds.has(item.id)}
              unseen={linkState.unseenItemIds.has(item.id)}
              selectionMode={selection.selectMode}
              selected={selection.selected.has(item.id)}
              onPress={() =>
                selection.selectMode
                  ? selection.toggle(item.id)
                  : router.push({
                      pathname: '/item/[id]',
                      params: { id: item.id, ctx: isUncat ? 'uncat' : 'cat', ctxKey: id },
                    })
              }
              onLongPress={() => selection.enterSelect(item.id)}
            />
          )}
        />
      )}

      <ItemSelectionControls selection={selection} categories={categories} />
    </SafeAreaView>
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
  back: {
    fontSize: 16,
    color: colors.primary,
    width: 72,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textMain,
    textAlign: 'center',
  },
  action: { fontSize: 16, fontWeight: '600', color: colors.primary, textAlign: 'right' },
  headerRight: { width: 72 },
  headerSpacer: {
    width: 72,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingBottom: spacing.six, // 하단 선택 액션바 여백 확보(그리드는 가장자리까지)
  },
});
