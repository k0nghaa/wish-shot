import { SymbolView, type SFSymbol } from 'expo-symbols';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, shadow, spacing } from '@/constants/theme';

/**
 * 다중 선택 하단 액션바(전체 탭). 플로팅 탭바 자리에 뜨는 알약(CustomTabBar 톤).
 * JS 전용. 선택이 없으면 disabled 로 흐리게 처리한다.
 */
export type SelectionAction = {
  key: string;
  label: string;
  icon: SFSymbol;
  destructive?: boolean;
  onPress: () => void;
};

export function SelectionBar({ actions, disabled }: { actions: SelectionAction[]; disabled?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom || spacing.two }]} pointerEvents="box-none">
      <View style={styles.pill}>
        {actions.map((a) => {
          const tint = disabled ? colors.silverDark : a.destructive ? colors.error : colors.textMain;
          return (
            <TouchableOpacity
              key={a.key}
              style={styles.action}
              onPress={a.onPress}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              accessibilityState={{ disabled: !!disabled }}
              hitSlop={8}
            >
              <SymbolView name={a.icon} size={22} tintColor={tint} />
              <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
                {a.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.silver,
    paddingVertical: spacing.two,
    paddingHorizontal: spacing.two,
    ...shadow.floating,
  },
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacing.four,
    paddingVertical: spacing.one,
  },
  label: {
    fontSize: 11,
    fontWeight: '600', // 하단 탭바 라벨 톤에 맞춘 굵기(기본 400은 얇아 보임)
  },
});
