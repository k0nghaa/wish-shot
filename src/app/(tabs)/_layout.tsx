import { Tabs } from 'expo-router';

import { CustomTabBar } from '@/components/CustomTabBar';
import { TabBarVisibilityProvider } from '@/components/tabBarVisibility';

/**
 * 하단 알약 탭바 그룹 (카테고리 / 전체 / 알림 / 검색 — 렌더 순서는 CustomTabBar 가 정한다).
 * 등록·설정·상세·카테고리·태그는 이 그룹 위의 스택으로 push 된다(전체화면).
 * 기본 탭 = index(전체) — 앱을 열면 `/` = 전체.
 *
 * TabBarVisibilityProvider: 전체 탭 다중 선택 시 탭바를 숨겨 선택 액션바가 겹치지 않게 한다.
 */
export default function TabsLayout() {
  return (
    <TabBarVisibilityProvider>
      <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <CustomTabBar {...props} />}>
        <Tabs.Screen name="index" options={{ title: '전체' }} />
        <Tabs.Screen name="categories" options={{ title: '카테고리' }} />
        <Tabs.Screen name="notifications" options={{ title: '알림' }} />
        <Tabs.Screen name="search" options={{ title: '검색' }} />
      </Tabs>
    </TabBarVisibilityProvider>
  );
}
