import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { NewDot } from '@/components/PhotoTile';
import { TabHeaderLogo } from '@/components/TabHeaderLogo';
import { Thumbnail } from '@/components/Thumbnail';
import { colors, hairlineWidth, radius, spacing, type } from '@/constants/theme';
import { useNotifications } from '@/hooks/useNotifications';
import { capture } from '@/lib/analytics';
import { formatRelativeTime } from '@/lib/formatDate';
import {
  getNotificationsSnapshot,
  NOTIFICATION_TITLE,
  pruneMissingItems,
  subscribeNotifications,
  type AppNotification,
} from '@/lib/notifications';
import { getItemImageSignedUrls, getItemThumbSignedUrls, listItems, type Item } from '@/lib/queries';

// 하단 플로팅 탭바에 가리지 않도록 목록 하단 여백 확보.
const TABBAR_SPACE = 96;
const THUMB = 48;

/**
 * 알림 탭: 저장 뒤 링크를 붙이는 등 사용자가 보지 못한 변화(기기 안 기록, 최근 20개·14일).
 * 행 = 썸네일 · 종류 문구 · 제품명(지금 위시 이름, 없으면 기록한 이름) · 상대 시각. 안 읽은 행은 썸네일 좌상단 점 + 굵은 제목.
 * 누르면 위시 상세로 가고, 상세가 그 위시를 화면에 보이면 읽음 처리한다. 이미 없는 위시의 알림은 목록을 읽을 때 정리한다.
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const { notifications } = useNotifications();
  const [items, setItems] = useState<Map<string, Item> | null>(null); // null = 아직 못 읽음
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [fallbackUrls, setFallbackUrls] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
  // 겹쳐 읽을 때(포커스·새 알림) 늦게 끝난 옛 결과가 새 결과를 덮지 않게 마지막 요청만 반영한다.
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    let list: Item[];
    try {
      list = await listItems();
    } catch {
      // 위시 목록을 못 읽으면 기록한 이름으로만 보인다(정리는 하지 않는다).
      if (seq !== loadSeqRef.current) return;
      setNow(Date.now());
      setItems((prev) => prev ?? new Map());
      return;
    }
    if (seq !== loadSeqRef.current) return;
    setNow(Date.now()); // 상대 시각 기준(열 때마다 새로)
    const map = new Map(list.map((it) => [it.id, it]));
    setItems(map);
    await pruneMissingItems(new Set(map.keys())); // 이미 없는 위시의 알림·기록 정리
    const keys = getNotificationsSnapshot()
      .notifications.map((n) => map.get(n.itemId)?.image_key)
      .filter((k): k is string => !!k);
    try {
      const [thumbMap, origMap] = await Promise.all([getItemThumbSignedUrls(keys), getItemImageSignedUrls(keys)]);
      if (seq !== loadSeqRef.current) return;
      setThumbUrls(thumbMap);
      setFallbackUrls(origMap);
    } catch {
      /* 썸네일 발급 실패는 빈 자리표시로(이름·시각은 그대로) */
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // 이 화면이 떠 있는 동안 새 알림이 오면 그 위시의 썸네일·이름을 다시 읽는다(처음 열 때는 포커스에서 읽음).
  useEffect(() => {
    let newest = getNotificationsSnapshot().notifications[0]?.id;
    return subscribeNotifications(() => {
      const next = getNotificationsSnapshot().notifications[0]?.id;
      if (next && next !== newest) void load();
      newest = next;
    });
  }, [load]);

  function open(n: AppNotification) {
    capture('notification_opened', { source: 'list' });
    router.push({ pathname: '/item/[id]', params: { id: n.itemId } });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <TabHeaderLogo />
      <View style={styles.titleRow}>
        <Text style={styles.title}>알림</Text>
      </View>
      {notifications.length === 0 ? (
        <EmptyState title="알림 없음" description="저장한 위시에 링크를 붙이면 여기에 표시됩니다." />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.list}
          extraData={[items, thumbUrls, now]}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item: n }) => {
            const it = items?.get(n.itemId);
            const name = it?.product_name ?? n.productName;
            const title = NOTIFICATION_TITLE[n.type];
            const time = formatRelativeTime(n.createdAt, now);
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => open(n)}
                accessibilityRole="button"
                accessibilityLabel={`${title}, ${name}, ${time}${n.read ? '' : ', 읽지 않음'}`}
              >
                <View style={styles.thumbWrap}>
                  <Thumbnail
                    url={it ? (thumbUrls[it.image_key] ?? null) : null}
                    fallbackUrl={it ? (fallbackUrls[it.image_key] ?? null) : null}
                    style={[styles.thumb, n.read && styles.thumbRead]}
                  />
                  {n.read ? null : <NewDot style={styles.dotPos} />}
                </View>
                <View style={styles.texts}>
                  <Text style={[styles.rowTitle, n.read ? styles.rowTitleRead : styles.rowTitleUnread]} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text style={[styles.rowName, n.read && styles.rowNameRead]} numberOfLines={1}>
                    {name}
                  </Text>
                </View>
                <Text style={[styles.time, n.read && styles.rowNameRead]}>{time}</Text>
              </TouchableOpacity>
            );
          }}
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
  list: { paddingBottom: TABBAR_SPACE },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.three - spacing.one,
    paddingHorizontal: spacing.three,
    paddingVertical: spacing.three - spacing.one,
  },
  thumbWrap: { width: THUMB, height: THUMB, borderRadius: radius.sm, overflow: 'hidden' },
  thumb: { width: THUMB, height: THUMB },
  // 읽은 알림은 연하게(사진 반투명·글자 회색) — 안 읽은 알림(점·굵은 검정 제목)과 한눈에 구분.
  thumbRead: { opacity: 0.45 },
  // 타일과 같은 새 링크 점(NewDot)의 위치.
  dotPos: { top: 3, left: 3 },
  texts: { flex: 1, gap: 2 },
  rowTitle: { ...type.subhead, color: colors.textMain },
  rowTitleUnread: { fontWeight: '600' },
  rowTitleRead: { color: colors.textSub },
  rowName: { ...type.footnote, color: colors.textSub },
  rowNameRead: { color: colors.textDisabled },
  time: { ...type.footnote, color: colors.textSub },
  sep: {
    height: hairlineWidth,
    backgroundColor: colors.silver,
    marginLeft: spacing.three + THUMB + spacing.three - spacing.one,
  },
});
