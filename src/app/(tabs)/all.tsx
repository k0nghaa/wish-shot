import { useRouter, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { PhotoTile } from '@/components/PhotoTile';
import { TabHeaderLogo } from '@/components/TabHeaderLogo';
import { colors, radius, shadow, spacing, type } from '@/constants/theme';
import { getItemImageSignedUrls, listItems, type Item } from '@/lib/queries';

// 하단 플로팅 탭바에 가리지 않도록 목록 하단 여백 확보.
const TABBAR_SPACE = 96;
const COLUMNS = 3;

/**
 * 전체 탭: 모든 위시를 최신순 3열 정사각 썸네일 그리드로(사진 앱 톤, 여백 없음·썸네일만).
 * 찜 필터·New 배지는 Phase 6(제외).
 */
export default function AllScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tileSize = width / COLUMNS; // 여백 없이 화면 폭을 3등분
  const [items, setItems] = useState<Item[] | null>(null); // null = 로딩 중
  const [urls, setUrls] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const list = await listItems();
      const urlMap = await getItemImageSignedUrls(list.map((it) => it.image_key));
      setItems(list);
      setUrls(urlMap);
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

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <TabHeaderLogo />
      <View style={styles.titleRow}>
        <Text style={styles.title}>전체</Text>
        {items ? <Text style={styles.count}>{items.length}개</Text> : null}
      </View>

      {items === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          title="아직 담은 위시가 없습니다"
          description="마음에 든 스크린샷을 담아 위시리스트를 시작하세요."
          ctaLabel="위시 담기"
          onCta={() => router.push('/register')}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          numColumns={COLUMNS}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <PhotoTile
              url={urls[item.image_key] ?? null}
              size={tileSize}
              accessibilityLabel={item.product_name}
              onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id, ctx: 'all' } })}
            />
          )}
        />
      )}

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 72 }]}
        onPress={() => router.push('/register')}
        accessibilityRole="button"
        accessibilityLabel="위시 담기"
      >
        <SymbolView name="plus" size={28} tintColor={colors.bg} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.two,
    paddingHorizontal: spacing.three,
    paddingTop: spacing.one,
    paddingBottom: spacing.two,
  },
  title: { ...type.largeTitle, color: colors.textMain },
  count: { ...type.subhead, color: colors.textSub },
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
