import { useFocusEffect, useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryCard } from '@/components/CategoryCard';
import { EmptyState } from '@/components/EmptyState';
import { TabHeaderLogo } from '@/components/TabHeaderLogo';
import { colors, radius, spacing, type } from '@/constants/theme';
import { logImageDiag, toFileUri } from '@/lib/imageBytes';
import {
  createCategory,
  deleteCategory,
  getItemImageSignedUrls,
  listCategories,
  listItems,
  renameCategory,
} from '@/lib/queries';

// 하단 플로팅 탭바에 가리지 않도록 목록 하단 여백 확보.
const TABBAR_SPACE = 96;
// 카테고리 카드 모자이크에 채울 대표 썸네일 수(최신순).
const MOSAIC_TILES = 4;
// 폴더 카드 그리드: 2열 + 좌우 패딩/열 간격(고정 크기 계산용).
const GRID_PAD = spacing.three;
const GRID_GAP = spacing.two;

type Row = {
  id: string; // 카테고리 id, 또는 미분류는 'uncategorized'
  name: string;
  count: number;
  thumbUrls: (string | null)[];
  isUncat: boolean;
};

export default function HomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const cardSize = (width - GRID_PAD * 2 - GRID_GAP) / 2; // 2열 고정 크기(부분 행에서도 안 늘어남)
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const shareHandled = useRef(false);
  const [rows, setRows] = useState<Row[] | null>(null); // null = 로딩 중
  const [deleteMode, setDeleteMode] = useState(false); // iOS 앨범 톤 폴더 삭제 모드

  // 공유 시트로 이미지가 들어오면 등록 화면으로 넘긴다(FR-1b).
  useEffect(() => {
    if (!hasShareIntent) {
      shareHandled.current = false;
      return;
    }
    const file = shareIntent?.files?.[0];
    if (!file?.path || shareHandled.current) return;
    shareHandled.current = true;
    const imageUri = toFileUri(file.path);
    const imageMime = file.mimeType ?? 'image/jpeg';
    logImageDiag('shareIntent', file.path, { mimeType: file.mimeType });
    resetShareIntent();
    router.push({ pathname: '/register', params: { imageUri, imageMime } });
  }, [hasShareIntent, shareIntent, resetShareIntent, router]);

  const load = useCallback(async () => {
    try {
      const [cats, items] = await Promise.all([listCategories(), listItems()]);

      // items 는 최신순. 카테고리별 개수와 대표 이미지 키(최신 MOSAIC_TILES개)를 모은다.
      const countByCat = new Map<string | null, number>();
      const keysByCat = new Map<string | null, string[]>();
      for (const it of items) {
        const key = it.category_id;
        countByCat.set(key, (countByCat.get(key) ?? 0) + 1);
        const arr = keysByCat.get(key) ?? [];
        if (arr.length < MOSAIC_TILES) {
          arr.push(it.image_key);
          keysByCat.set(key, arr);
        }
      }

      // 카테고리는 비어 있어도(개수 0) 노출한다(UX 결정). 이름 카테고리 → 미분류 순.
      const built: Row[] = [];
      for (const c of cats) {
        built.push({
          id: c.id,
          name: c.name,
          count: countByCat.get(c.id) ?? 0,
          thumbUrls: [],
          isUncat: false,
        });
      }
      const uncatCount = countByCat.get(null) ?? 0;
      if (uncatCount > 0) {
        built.push({ id: 'uncategorized', name: '미분류', count: uncatCount, thumbUrls: [], isUncat: true });
      }

      // 대표 썸네일 signed URL 배치 발급(전 카테고리 키를 한 번에).
      const allKeys = built.flatMap((r) => keysByCat.get(r.isUncat ? null : r.id) ?? []);
      const urlMap = await getItemImageSignedUrls(allKeys);
      for (const r of built) {
        const keys = keysByCat.get(r.isUncat ? null : r.id) ?? [];
        r.thumbUrls = keys.map((k) => urlMap[k] ?? null);
      }

      setRows(built);
    } catch (e) {
      setRows([]);
      Alert.alert('오류', e instanceof Error ? e.message : '불러오지 못했습니다.');
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
    router.push('/register');
  }

  // 상단 ··· = 폴더 삭제 모드 진입(각 폴더 좌상단 − 배지 노출).
  function enterDeleteMode() {
    const deletable = (rows ?? []).filter((r) => !r.isUncat);
    if (deletable.length === 0) {
      Alert.alert('폴더 없음', '삭제할 폴더가 없습니다.');
      return;
    }
    setDeleteMode(true);
  }

  function handleCreateCategory() {
    Alert.prompt('새 카테고리', '카테고리 이름을 입력하세요.', async (input) => {
      const name = input?.trim();
      if (!name) return;
      try {
        await createCategory(name);
        load();
      } catch (e) {
        Alert.alert('오류', e instanceof Error ? e.message : '카테고리를 만들지 못했습니다.');
      }
    });
  }

  // 카드 롱프레스 = 이름 변경 / 삭제.
  function handleCardManage(row: Row) {
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
          Alert.alert('오류', e instanceof Error ? e.message : '이름을 바꾸지 못했습니다.');
        }
      },
      'plain-text',
      row.name,
    );
  }

  function handleDelete(row: Row) {
    // 이 폴더가 마지막 삭제 대상이면 삭제 후 삭제 모드를 종료한다.
    const wasLast = (rows ?? []).filter((r) => !r.isUncat).length <= 1;
    Alert.alert('삭제할까요?', `'${row.name}' 안의 아이템은 미분류로 이동합니다.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCategory(row.id);
            if (wasLast) setDeleteMode(false);
            load();
          } catch (e) {
            Alert.alert('오류', e instanceof Error ? e.message : '삭제하지 못했습니다.');
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <TabHeaderLogo
        right={
          <TouchableOpacity
            onPress={() => router.push('/settings')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="설정"
          >
            <SymbolView name="gearshape" size={24} tintColor={colors.textMain} />
          </TouchableOpacity>
        }
      />

      <View style={styles.titleRow}>
        <Text style={styles.title}>폴더</Text>
        {deleteMode ? (
          <TouchableOpacity
            onPress={() => setDeleteMode(false)}
            style={[styles.pill, styles.donePill]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="완료"
          >
            <Text style={styles.doneText}>완료</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.pill}>
            <TouchableOpacity
              onPress={handleCreateCategory}
              style={styles.pillBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="새 폴더"
            >
              <SymbolView name="plus" size={22} tintColor={colors.textMain} />
            </TouchableOpacity>
            <View style={styles.pillDivider} />
            <TouchableOpacity
              onPress={enterDeleteMode}
              style={styles.pillBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="폴더 삭제"
            >
              <SymbolView name="ellipsis" size={22} tintColor={colors.textMain} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {rows === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : rows.length === 0 ? (
        <EmptyState
          title="아직 담은 위시가 없습니다"
          description="마음에 든 스크린샷을 담아 위시리스트를 시작하세요."
          ctaLabel="위시 담기"
          onCta={handleUpload}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          numColumns={2}
          columnWrapperStyle={styles.column}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={{ width: cardSize }}>
              <CategoryCard
                name={item.name}
                count={item.count}
                thumbnailUrls={item.thumbUrls}
                onPress={deleteMode ? undefined : () => openCategory(item)}
                onLongPress={item.isUncat || deleteMode ? undefined : () => handleCardManage(item)}
                deleteMode={deleteMode}
                onDelete={item.isUncat ? undefined : () => handleDelete(item)}
              />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.three,
    paddingTop: spacing.one,
    paddingBottom: spacing.two,
  },
  title: { ...type.largeTitle, color: colors.textMain },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40, // + | ··· 와 완료 상태의 알약 높이를 고정 → 토글 시 아래 그리드가 안 밀림
    backgroundColor: colors.bgCard,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.one,
  },
  pillBtn: { paddingHorizontal: spacing.three, paddingVertical: spacing.two },
  donePill: { paddingHorizontal: spacing.four },
  doneText: { fontSize: 15, fontWeight: '700', color: colors.textMain },
  pillDivider: {
    width: StyleSheet.hairlineWidth,
    height: 20,
    backgroundColor: colors.silver,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: {
    paddingHorizontal: spacing.three,
    paddingBottom: TABBAR_SPACE,
    gap: spacing.two,
  },
  column: { gap: spacing.two },
});
