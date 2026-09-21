import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, shadow, spacing, type } from '@/constants/theme';

// 공유 시트 앱 행 목업(위시샷 타일 강조). 실제 화면을 흉내 낸 정적 그래픽 — 에셋 불필요·테마 자동 대응.
const APPS: { icon: SymbolViewProps['name']; label: string }[] = [
  { icon: 'safari', label: 'Safari' },
  { icon: 'message.fill', label: '메시지' },
  { icon: 'square.and.arrow.down', label: '저장' },
];

/**
 * 첫 카드("스크린샷으로 담기") 데모 그래픽.
 * iOS 공유 시트를 흉내 낸 미니 목업 — 앱 아이콘 행에서 "위시샷" 타일이 강조돼,
 * 스크린샷을 공유 시트에서 위시샷으로 바로 담는 흐름을 보여준다.
 */
export function ShareSheetMock() {
  return (
    <View style={styles.sheet}>
      <View style={styles.grabber} />
      <View style={styles.previewRow}>
        <View style={styles.previewThumb}>
          <SymbolView name="photo" size={22} tintColor={colors.silverDark} />
        </View>
        <View style={styles.previewMeta}>
          <View style={[styles.metaLine, { width: '70%' }]} />
          <View style={[styles.metaLine, { width: '45%' }]} />
        </View>
      </View>
      <View style={styles.appsRow}>
        {APPS.map((a) => (
          <View key={a.label} style={styles.app}>
            <View style={styles.appIcon}>
              <SymbolView name={a.icon} size={24} tintColor={colors.silverDark} />
            </View>
            <Text style={styles.appLabel} numberOfLines={1}>
              {a.label}
            </Text>
          </View>
        ))}
        {/* 위시샷 타일 — 강조(검정 배경 + 링) */}
        <View style={styles.app}>
          <View style={styles.appIconActive}>
            <SymbolView name="heart.fill" size={24} tintColor={colors.bg} />
          </View>
          <Text style={[styles.appLabel, styles.appLabelActive]} numberOfLines={1}>
            위시샷
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.three,
    gap: spacing.three,
    ...shadow.card,
  },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: radius.pill, backgroundColor: colors.silver },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.two },
  previewThumb: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.placeholder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewMeta: { flex: 1, gap: spacing.two },
  metaLine: { height: 8, borderRadius: radius.pill, backgroundColor: colors.silver },
  appsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.two },
  app: { alignItems: 'center', gap: spacing.one, width: 60 },
  appIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.silver,
  },
  appIconActive: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  appLabel: { ...type.caption, color: colors.textSub },
  appLabelActive: { color: colors.textMain, fontWeight: '700' },
});
