import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, hairlineWidth, radius, spacing, type } from '@/constants/theme';
import { formatSavedDate } from '@/lib/formatDate';
import { formatPriceKRW } from '@/lib/formatPrice';
import { getItem, listCategories, type Category, type Item } from '@/lib/queries';

/**
 * M7 정보 하프시트: 상세(뷰어)의 (i) 로 열리는 formSheet 라우트.
 * 카드1(제품명·브랜드·가격·링크) + 카드2(폴더·메모·태그) + 푸터(담은 시각).
 */
export default function ItemInfoScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<Item | null>(null);
  const [folderName, setFolderName] = useState('미분류');

  const load = useCallback(async () => {
    try {
      const found = await getItem(id);
      setItem(found);
      const cats = await listCategories().catch(() => [] as Category[]);
      setFolderName(found.category_id ? (cats.find((c) => c.id === found.category_id)?.name ?? '미분류') : '미분류');
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : '불러오지 못했습니다.', [
        { text: '확인', onPress: () => router.back() },
      ]);
    }
  }, [id, router]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function openLink() {
    if (!item?.source_link) return;
    Linking.openURL(item.source_link).catch(() => Alert.alert('링크 열기 실패', '링크를 열지 못했습니다.'));
  }

  const price = item ? formatPriceKRW(item.price) : null;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>정보</Text>
        <TouchableOpacity
          onPress={() => router.push({ pathname: '/item/[id]/edit', params: { id } })}
          hitSlop={8}
          disabled={!item}
          accessibilityRole="button"
          accessibilityLabel="편집"
        >
          <Text style={styles.edit}>편집</Text>
        </TouchableOpacity>
      </View>

      {item === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <InfoRow label="제품명" value={item.product_name} />
            {item.brand ? <InfoRow label="브랜드" value={item.brand} /> : null}
            {price ? <InfoRow label="가격" value={price} /> : null}
            {item.source_link ? <InfoRow label="링크" value={item.source_link} onPress={openLink} last /> : null}
          </View>

          <View style={styles.card}>
            <InfoRow label="폴더" value={folderName} last={!item.memo && !(item.tags && item.tags.length > 0)} />
            {item.memo ? (
              <View style={[styles.block, (item.tags && item.tags.length > 0) ? styles.blockDivider : null]}>
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
          </View>

          <Text style={styles.footer}>{formatSavedDate(item.created_at)}에 담음</Text>
        </ScrollView>
      )}
    </View>
  );
}

function InfoRow({ label, value, onPress, last }: { label: string; value: string; onPress?: () => void; last?: boolean }) {
  return (
    <View style={[styles.row, last ? null : styles.rowDivider]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[styles.rowValue, onPress ? styles.link : null]}
        numberOfLines={1}
        onPress={onPress}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.four,
    paddingTop: spacing.three,
    paddingBottom: spacing.two,
  },
  title: { ...type.title, color: colors.textMain },
  edit: { ...type.body, color: colors.primary, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.four, paddingBottom: spacing.six, gap: spacing.three },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    paddingHorizontal: spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.three,
    paddingVertical: spacing.three,
  },
  rowDivider: { borderBottomWidth: hairlineWidth, borderBottomColor: colors.silver },
  rowLabel: { ...type.subhead, color: colors.textSub },
  rowValue: { flex: 1, ...type.subhead, color: colors.textMain, textAlign: 'right' },
  link: { color: colors.primary, textDecorationLine: 'underline' },
  block: { paddingVertical: spacing.three, gap: spacing.two },
  blockDivider: { borderBottomWidth: hairlineWidth, borderBottomColor: colors.silver },
  blockLabel: { ...type.subhead, color: colors.textSub },
  memo: { ...type.subhead, color: colors.textMain, lineHeight: 22 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.two },
  tag: {
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
    borderColor: colors.silver,
    paddingVertical: spacing.one,
    paddingHorizontal: spacing.three,
  },
  tagText: { ...type.footnote, color: colors.textMain },
  footer: { ...type.footnote, color: colors.textSub, textAlign: 'center', paddingTop: spacing.two },
});
