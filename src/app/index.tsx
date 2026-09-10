import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryCard } from '@/components/CategoryCard';
import { EmptyState } from '@/components/EmptyState';
import { colors, spacing } from '@/constants/theme';
import {
  createCategory,
  deleteCategory,
  getItemImageSignedUrls,
  listCategories,
  listItems,
  renameCategory,
} from '@/lib/queries';
import { supabase } from '@/lib/supabase';

type Row = {
  id: string; // 카테고리 id, 또는 미분류는 'uncategorized'
  name: string;
  count: number;
  thumbUrl: string | null;
  isUncat: boolean;
};

export default function HomeScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null); // null = 로딩 중
  const [hasAnyItem, setHasAnyItem] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cats, items] = await Promise.all([listCategories(), listItems()]);

      // items 는 최신순. 카테고리별 개수와 대표(가장 최신) 이미지 키를 모은다.
      const countByCat = new Map<string | null, number>();
      const repKeyByCat = new Map<string | null, string>();
      for (const it of items) {
        const key = it.category_id;
        countByCat.set(key, (countByCat.get(key) ?? 0) + 1);
        if (!repKeyByCat.has(key)) repKeyByCat.set(key, it.image_key);
      }

      // 빈 카테고리는 비노출. 이름 카테고리 → 미분류 순.
      const built: Row[] = [];
      for (const c of cats) {
        const count = countByCat.get(c.id) ?? 0;
        if (count === 0) continue;
        built.push({ id: c.id, name: c.name, count, thumbUrl: null, isUncat: false });
      }
      const uncatCount = countByCat.get(null) ?? 0;
      if (uncatCount > 0) {
        built.push({ id: 'uncategorized', name: '미분류', count: uncatCount, thumbUrl: null, isUncat: true });
      }

      // 대표 썸네일 signed URL 배치 발급.
      const repKeys = built
        .map((r) => repKeyByCat.get(r.isUncat ? null : r.id))
        .filter((k): k is string => Boolean(k));
      const urlMap = await getItemImageSignedUrls(repKeys);
      for (const r of built) {
        const k = repKeyByCat.get(r.isUncat ? null : r.id);
        r.thumbUrl = k ? (urlMap[k] ?? null) : null;
      }

      setRows(built);
      setHasAnyItem(items.length > 0);
    } catch (e) {
      setRows([]);
      setHasAnyItem(false);
      Alert.alert('오류', e instanceof Error ? e.message : '불러오지 못했어요.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function openCategory(row: Row) {
    router.push({ pathname: '/category/[id]', params: { id: row.id, name: row.name } });
  }

  function handleUpload() {
    // 등록(저장) 화면은 Step 4 에서 붙는다. 지금은 안내만.
    Alert.alert('준비 중', '등록 화면은 다음 단계에서 연결돼요.');
  }

  function handleCreateCategory() {
    Alert.prompt('새 카테고리', '카테고리 이름을 입력해요.', async (input) => {
      const name = input?.trim();
      if (!name) return;
      try {
        await createCategory(name);
        Alert.alert('만들었어요', '아이템을 추가하면 여기에 나타나요.');
        load();
      } catch (e) {
        Alert.alert('오류', e instanceof Error ? e.message : '카테고리를 만들지 못했어요.');
      }
    });
  }

  function handleMore(row: Row) {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: row.name,
        options: ['이름 변경', '삭제', '취소'],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) handleRename(row);
        else if (index === 1) handleDelete(row);
      },
    );
  }

  function handleRename(row: Row) {
    Alert.prompt(
      '이름 변경',
      undefined,
      async (input) => {
        const name = input?.trim();
        if (!name || name === row.name) return;
        try {
          await renameCategory(row.id, name);
          load();
        } catch (e) {
          Alert.alert('오류', e instanceof Error ? e.message : '이름을 바꾸지 못했어요.');
        }
      },
      'plain-text',
      row.name,
    );
  }

  function handleDelete(row: Row) {
    Alert.alert('카테고리 삭제', `'${row.name}'을(를) 삭제할까요? 안의 아이템은 미분류로 이동해요.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCategory(row.id);
            load();
          } catch (e) {
            Alert.alert('오류', e instanceof Error ? e.message : '삭제하지 못했어요.');
          }
        },
      },
    ]);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>WishShot</Text>
        <TouchableOpacity onPress={handleLogout} hitSlop={8} accessibilityRole="button">
          <Text style={styles.logout}>로그아웃</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>내 위시리스트</Text>
        <TouchableOpacity onPress={handleCreateCategory} hitSlop={8} accessibilityRole="button">
          <Text style={styles.addCategory}>+ 카테고리</Text>
        </TouchableOpacity>
      </View>

      {rows === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !hasAnyItem ? (
        <EmptyState
          title="아직 담은 위시가 없어요"
          description="마음에 든 스크린샷을 담아 위시리스트를 시작해요."
          ctaLabel="첫 위시 담기"
          onCta={handleUpload}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <CategoryCard
              name={item.name}
              count={item.count}
              thumbnailUrl={item.thumbUrl}
              onPress={() => openCategory(item)}
              onMore={item.isUncat ? undefined : () => handleMore(item)}
            />
          )}
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={handleUpload}
        accessibilityRole="button"
        accessibilityLabel="위시 담기"
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
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
    paddingBottom: spacing.one,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textMain,
  },
  logout: {
    fontSize: 14,
    color: colors.textSub,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.three,
    paddingTop: spacing.two,
    paddingBottom: spacing.two,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSub,
  },
  addCategory: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingHorizontal: spacing.three,
    paddingBottom: spacing.six,
    gap: spacing.two,
  },
  fab: {
    position: 'absolute',
    right: spacing.four,
    bottom: spacing.four,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    shadowColor: colors.textMain,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  fabText: {
    fontSize: 28,
    color: colors.bgCard,
    fontWeight: '600',
    lineHeight: 32,
  },
});
