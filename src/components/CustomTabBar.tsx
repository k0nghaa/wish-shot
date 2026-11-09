// expo-router 가 Tabs 내부에서 쓰는 실제 tabBar props 타입(공개 exports 맵이 없어 deep import).
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, shadow, spacing } from '@/constants/theme';

import { CATEGORIES_TAB_TARGET, useOnboardingTarget } from './Onboarding/onboardingTarget';
import { useTabBarVisibility } from './tabBarVisibility';

/**
 * 하단 플로팅 알약 탭바 (카테고리 / 전체 / 알림 / 검색). JS 전용 — 재빌드 없음.
 * 활성 = label(검정, 굵게), 비활성 = inactive.
 */
type TabDef = { route: string; label: string; icon: SFSymbol };

// 렌더 순서: 카테고리 | 전체 | 알림 | 검색 (파일 선언 순서와 무관하게 고정). 기본 탭은 전체(index).
const TABS: TabDef[] = [
  { route: 'categories', label: '카테고리', icon: 'square.grid.2x2.fill' },
  { route: 'index', label: '전체', icon: 'square.stack' },
  { route: 'notifications', label: '알림', icon: 'bell' },
  { route: 'search', label: '검색', icon: 'magnifyingglass' },
];

export function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { hidden } = useTabBarVisibility();
  const activeRoute = state.routes[state.index]?.name;
  const { register } = useOnboardingTarget();
  const setCategoriesTabRef = useCallback((n: View | null) => register(CATEGORIES_TAB_TARGET, n), [register]);

  // 다중 선택 중에는 숨겨 선택 액션바에 자리를 내준다.
  if (hidden) return null;

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom || spacing.two }]} pointerEvents="box-none">
      <View style={styles.pill}>
        {TABS.map((tab) => {
          const focused = activeRoute === tab.route;
          const tint = focused ? colors.textMain : colors.silverDark;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: tab.route, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(tab.route);
          };
          return (
            <TouchableOpacity
              key={tab.route}
              ref={tab.route === 'categories' ? setCategoriesTabRef : undefined}
              style={styles.tab}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={tab.label}
              hitSlop={8}
            >
              <SymbolView
                name={tab.icon}
                size={24}
                tintColor={tint}
                weight={focused ? 'semibold' : 'regular'}
              />
              <Text
                style={[styles.label, { color: tint, fontWeight: focused ? '700' : '500' }]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
              >
                {tab.label}
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
  // 4탭이 320pt 폭(확대 보기)에서도 들어가도록 탭 좌우 여백 16pt — 알약 전체 약 260pt(3탭 때 약 252pt).
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacing.three,
    paddingVertical: spacing.one,
  },
  label: {
    fontSize: 11,
  },
});
