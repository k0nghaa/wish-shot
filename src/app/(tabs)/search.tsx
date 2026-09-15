import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TabHeaderLogo } from '@/components/TabHeaderLogo';
import { colors, spacing, type } from '@/constants/theme';

/**
 * 검색 탭: Phase 5는 플레이스홀더만. 실제 검색 로직은 Phase 6.
 */
export default function SearchScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <TabHeaderLogo />
      <View style={styles.header}>
        <Text style={styles.title}>검색</Text>
      </View>
      <View style={styles.center}>
        <Text style={styles.placeholder}>검색 기능 추가 예정</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.three,
    paddingTop: spacing.one,
    paddingBottom: spacing.two,
  },
  title: { ...type.largeTitle, color: colors.textMain },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  placeholder: { ...type.body, color: colors.textSub },
});
