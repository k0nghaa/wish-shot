import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { TabHeaderLogo } from '@/components/TabHeaderLogo';
import { colors, spacing, type } from '@/constants/theme';

/**
 * 알림 탭: 저장 뒤 링크를 붙이는 등 사용자가 보지 못한 변화를 모아 보여 준다(기기 안 기록).
 * 지금은 빈 화면만 — 목록·읽음 처리는 알림 저장소와 함께 붙인다.
 */
export default function NotificationsScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <TabHeaderLogo />
      <View style={styles.titleRow}>
        <Text style={styles.title}>알림</Text>
      </View>
      <EmptyState title="알림 없음" description="저장한 위시에 링크를 붙이면 여기에 표시됩니다." />
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
});
