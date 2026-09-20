import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { ItemSelectionControls } from '@/components/ItemSelectionControls';
import { PhotoTile } from '@/components/PhotoTile';
import { TabHeaderLogo } from '@/components/TabHeaderLogo';
import { useTabBarVisibility } from '@/components/tabBarVisibility';
import { colors, radius, shadow, spacing, type } from '@/constants/theme';
import { useItemSelection } from '@/hooks/useItemSelection';
import { getItemImageSignedUrls, listCategories, listItems, type Category, type Item } from '@/lib/queries';

// 하단 플로팅 탭바에 가리지 않도록 목록 하단 여백 확보.
const TABBAR_SPACE = 96;
const COLUMNS = 3;

/**
 * 전체 탭: 모든 위시를 최신순 3열 정사각 썸네일 그리드로(사진 앱 톤, 여백 없음·썸네일만).
 * "선택" 버튼(우상단) 또는 타일 롱프레스로 다중 선택 모드(카테고리 이동 / 일괄 삭제).
 * 찜 필터·New 배지는 Phase 6(제외).
 */
export default function AllScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { setHidden } = useTabBarVisibility();
  const tileSize = width / COLUMNS; // 여백 없이 화면 폭을 3등분
  const [items, setItems] = useState<Item[] | null>(null); // null = 로딩 중
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<Category[]>([]);

  // 링크붙이기 모드(기능 1): 공유 URL 을 기존 위시에 달거나 "새로 담기". 선택 모드와 상호 배타.
  // 별도 상태 없이 라우트 파라미터를 단일 소스로 삼는다(재진입 시 새 URL 이 그대로 반영됨).
  const params = useLocalSearchParams<{ attachLink?: string }>();
  const attachLink = params.attachLink || null;
  const attachMode = !!attachLink;

  function exitAttach() {
    router.setParams({ attachLink: '' });
  }

  const load = useCallback(async () => {
    try {
      const [list, cats] = await Promise.all([listItems(), listCategories().catch(() => [] as Category[])]);
      const urlMap = await getItemImageSignedUrls(list.map((it) => it.image_key));
      setItems(list);
      setUrls(urlMap);
      setCategories(cats);
    } catch (e) {
      setItems([]);
      Alert.alert('오류', e instanceof Error ? e.message : '불러오지 못했습니다.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const selection = useItemSelection({ items, categories, setCategories, reload: load });

  // 링크붙이기 모드로 들어오면 진행 중이던 선택 모드는 접는다(두 모드 상호 배타).
  const { selectMode, exitSelect } = selection;
  useEffect(() => {
    if (attachMode && selectMode) exitSelect();
  }, [attachMode, selectMode, exitSelect]);

  // 링크붙이기: 기존 위시 탭 → 편집 폼(링크 프리필). 선택 후 모드 종료(돌아오면 일반 탭).
  function attachToItem(id: string) {
    const link = attachLink;
    exitAttach();
    router.push({ pathname: '/item/[id]/edit', params: { id, linkPrefill: link ?? '' } });
  }

  // 링크붙이기: "새로 담기" → 등록 폼(링크 프리필 + 최근사진 제안).
  function startNewWithLink() {
    const link = attachLink;
    exitAttach();
    router.push({ pathname: '/register', params: { sourceLink: link ?? '' } });
  }

  // 선택 모드에선 플로팅 탭바를 숨겨 선택 액션바에 자리를 내준다. 탭을 떠나면 복구.
  useEffect(() => {
    setHidden(selection.selectMode);
  }, [selection.selectMode, setHidden]);
  useFocusEffect(
    useCallback(() => {
      return () => setHidden(false);
    }, [setHidden]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <TabHeaderLogo />
      <View style={styles.titleRow}>
        <View style={styles.titleLeft}>
          <Text style={styles.title}>
            {attachMode ? '링크 저장' : selection.selectMode ? `${selection.selected.size}개 선택` : '전체'}
          </Text>
          {!attachMode && !selection.selectMode && items ? <Text style={styles.count}>{items.length}개</Text> : null}
        </View>
        {attachMode ? (
          <TouchableOpacity onPress={exitAttach} hitSlop={8} accessibilityRole="button" accessibilityLabel="링크 저장 취소">
            <Text style={styles.action}>취소</Text>
          </TouchableOpacity>
        ) : items && items.length > 0 ? (
          <TouchableOpacity
            onPress={() => (selection.selectMode ? selection.exitSelect() : selection.enterSelect())}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={selection.selectMode ? '선택 취소' : '선택'}
          >
            <Text style={styles.action}>{selection.selectMode ? '취소' : '선택'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* 링크붙이기 안내 배너 + 새로 담기(기능 1) */}
      {attachMode ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText} numberOfLines={2}>
            링크를 저장할 스크린샷을 선택하세요.
          </Text>
          <TouchableOpacity
            onPress={startNewWithLink}
            style={styles.bannerBtn}
            accessibilityRole="button"
            accessibilityLabel="새로 담기"
          >
            <Text style={styles.bannerBtnText}>새로 담기</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {items === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        attachMode ? (
          <EmptyState
            title="저장할 스크린샷이 없습니다"
            description="'새로 담기'로 링크와 사진을 함께 저장하세요."
            ctaLabel="새로 담기"
            onCta={startNewWithLink}
          />
        ) : (
          <EmptyState
            title="아직 담은 위시가 없습니다"
            description="마음에 든 스크린샷을 담아 위시리스트를 시작하세요."
            ctaLabel="위시 담기"
            onCta={() => router.push('/register')}
          />
        )
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          numColumns={COLUMNS}
          contentContainerStyle={styles.list}
          extraData={selection.selected}
          renderItem={({ item }) => (
            <PhotoTile
              url={urls[item.image_key] ?? null}
              size={tileSize}
              accessibilityLabel={item.product_name}
              selectionMode={!attachMode && selection.selectMode}
              selected={selection.selected.has(item.id)}
              onPress={() =>
                attachMode
                  ? attachToItem(item.id)
                  : selection.selectMode
                    ? selection.toggle(item.id)
                    : router.push({ pathname: '/item/[id]', params: { id: item.id, ctx: 'all' } })
              }
              onLongPress={attachMode ? undefined : () => selection.enterSelect(item.id)}
            />
          )}
        />
      )}

      {/* 링크붙이기 모드에선 선택 액션바·FAB 를 숨긴다(배너의 "새로 담기"만 노출). */}
      {attachMode ? null : selection.selectMode ? (
        <ItemSelectionControls selection={selection} categories={categories} />
      ) : (
        <TouchableOpacity
          style={[styles.fab, { bottom: insets.bottom + 72 }]}
          onPress={() => router.push('/register')}
          accessibilityRole="button"
          accessibilityLabel="위시 담기"
        >
          <SymbolView name="plus" size={28} tintColor={colors.bg} />
        </TouchableOpacity>
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
  titleLeft: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.two },
  title: { ...type.largeTitle, color: colors.textMain },
  count: { ...type.subhead, color: colors.textSub },
  action: { fontSize: 16, fontWeight: '600', color: colors.primary },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.two,
    marginHorizontal: spacing.three,
    marginBottom: spacing.two,
    paddingVertical: spacing.two,
    paddingHorizontal: spacing.three,
    borderRadius: radius.md,
    backgroundColor: colors.bgCard,
  },
  bannerText: { flex: 1, ...type.subhead, color: colors.textMain },
  bannerBtn: {
    paddingVertical: spacing.one,
    paddingHorizontal: spacing.three,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  bannerBtnText: { fontSize: 14, fontWeight: '700', color: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: TABBAR_SPACE }, // 그리드는 가장자리까지(여백 없음)
  fab: {
    position: 'absolute',
    right: spacing.four,
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    ...shadow.floating,
  },
});
