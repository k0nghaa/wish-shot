import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { ItemCard } from '@/components/ItemCard';
import { colors, spacing } from '@/constants/theme';
import { formatSavedDate } from '@/lib/formatDate';
import { getItemImageSignedUrls, listItemsByCategory, type Item } from '@/lib/queries';

export default function CategoryItemsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const id = params.id;
  const isUncat = id === 'uncategorized';
  const title = params.name ?? (isUncat ? '미분류' : '카테고리');

  const [items, setItems] = useState<Item[] | null>(null); // null = 로딩 중
  const [urls, setUrls] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const list = await listItemsByCategory(isUncat ? null : id);
      const urlMap = await getItemImageSignedUrls(list.map((it) => it.image_key));
      setItems(list);
      setUrls(urlMap);
    } catch (e) {
      setItems([]);
      Alert.alert('오류', e instanceof Error ? e.message : '아이템을 불러오지 못했어요.');
    }
  }, [id, isUncat]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="뒤로">
          <Text style={styles.back}>‹ 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {items === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <EmptyState title="이 카테고리에 아직 아이템이 없어요" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          numColumns={2}
          columnWrapperStyle={styles.column}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ItemCard
              productName={item.product_name}
              brand={item.brand}
              savedDate={formatSavedDate(item.created_at)}
              thumbnailUrl={urls[item.image_key] ?? null}
            />
          )}
        />
      )}
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
  headerSpacer: {
    width: 72,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    padding: spacing.three,
    gap: spacing.two,
  },
  column: {
    gap: spacing.two,
  },
});
