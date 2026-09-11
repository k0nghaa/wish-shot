import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/constants/theme';
import { formatSavedDate } from '@/lib/formatDate';
import { formatPriceKRW } from '@/lib/formatPrice';
import {
  deleteItem,
  deleteItemImage,
  getItem,
  getItemImageSignedUrl,
  listCategories,
  type Item,
} from '@/lib/queries';

export default function ItemDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [item, setItem] = useState<Item | null>(null); // null = 로딩 중
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState<string>('미분류');
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = await getItem(id);
      setItem(found);
      const [url, cats] = await Promise.all([
        getItemImageSignedUrl(found.image_key).catch(() => null),
        found.category_id ? listCategories() : Promise.resolve([]),
      ]);
      setImageUrl(url);
      if (found.category_id) {
        setCategoryName(cats.find((c) => c.id === found.category_id)?.name ?? '미분류');
      } else {
        setCategoryName('미분류');
      }
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
    try {
      await deleteItem(item.id);
      // 행이 지워졌으면 목적은 달성. 이미지 삭제 실패는 치명적이지 않다(고아 객체만 남음).
      await deleteItemImage(item.image_key).catch(() => undefined);
      router.back();
    } catch (e) {
      setDeleting(false);
      Alert.alert('오류', e instanceof Error ? e.message : '삭제하지 못했어요.');
    }
  }

  function openLink(url: string) {
    Linking.openURL(url).catch(() => Alert.alert('열 수 없어요', '링크를 열지 못했어요.'));
  }

  const price = item ? formatPriceKRW(item.price) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="뒤로">
          <Text style={styles.back}>‹ 뒤로</Text>
        </TouchableOpacity>
        <View style={styles.headerSpacer} />
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
                  <View key={tag} style={styles.tag}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}
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
