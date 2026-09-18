import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { PhotoTile } from '@/components/PhotoTile';
import { TabHeaderLogo } from '@/components/TabHeaderLogo';
import { colors, radius, spacing, type } from '@/constants/theme';
import { getItemImageSignedUrls, listItems, type Item } from '@/lib/queries';

// 하단 플로팅 탭바에 가리지 않도록 목록 하단 여백 확보.
const TABBAR_SPACE = 96;
const COLUMNS = 3;

// 대소문자·공백 무시 정규화(검색 매칭용).
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/**
 * 검색 탭(Phase 6): 상단 입력 + 기존 items 쿼리 재사용 클라이언트 필터(제품명·브랜드·태그·메모).
 * 서버 쿼리·인덱스 없음. 300ms 디바운스. 결과는 3열 그리드 → 상세(단일).
 */
export default function SearchScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const tileSize = width / COLUMNS;
  const [items, setItems] = useState<Item[] | null>(null); // null = 로딩 중
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await listItems();
      const urlMap = await getItemImageSignedUrls(list.map((it) => it.image_key));
      setItems(list);
      setUrls(urlMap);
    } catch {
      // 검색은 조회 실패 시 빈 목록으로(치명적이지 않음). 사용자는 재진입으로 재시도.
      setItems([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // 300ms 디바운스: 입력이 멈춘 뒤에만 필터링한다.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const q = norm(debounced);
  const results =
    q && items
      ? items.filter((it) => {
          const hay = norm([it.product_name, it.brand ?? '', it.memo ?? '', (it.tags ?? []).join(' ')].join(' '));
          return hay.includes(q);
        })
      : [];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <TabHeaderLogo />
      <View style={styles.titleRow}>
        <Text style={styles.title}>검색</Text>
      </View>

      <View style={styles.searchRow}>
        <SymbolView name="magnifyingglass" size={18} tintColor={colors.textSub} />
        <TextInput
          style={styles.input}
          placeholder="제품명·브랜드·태그·메모"
          placeholderTextColor={colors.textDisabled}
          value={query}
          onChangeText={setQuery}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query.length > 0 ? (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="지우기">
            <SymbolView name="xmark.circle.fill" size={18} tintColor={colors.silverDark} />
          </TouchableOpacity>
        ) : null}
      </View>

      {items === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : debounced.trim().length === 0 ? (
        <EmptyState title="검색어를 입력하세요" description="제품명·브랜드·태그·메모로 찾습니다." />
      ) : results.length === 0 ? (
        <EmptyState title="검색 결과가 없습니다" description="다른 검색어로 시도하세요." />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(it) => it.id}
          numColumns={COLUMNS}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <PhotoTile
              url={urls[item.image_key] ?? null}
              size={tileSize}
              accessibilityLabel={item.product_name}
              onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  titleRow: {
    paddingHorizontal: spacing.three,
    paddingTop: spacing.one,
    paddingBottom: spacing.two,
  },
  title: { ...type.largeTitle, color: colors.textMain },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.two,
    marginHorizontal: spacing.three,
    marginBottom: spacing.two,
    paddingHorizontal: spacing.three,
    height: 40,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
  },
  input: { flex: 1, fontSize: 16, color: colors.textMain },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: TABBAR_SPACE },
});
