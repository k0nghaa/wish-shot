import { Tabs } from 'expo-router';

import { CustomTabBar } from '@/components/CustomTabBar';

/**
 * 하단 알약 탭바 그룹 (전체 / 폴더 / 검색).
 * 등록·설정·상세·카테고리·태그는 이 그룹 위의 스택으로 push 된다(전체화면).
 * 기본 탭 = index(폴더).
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: '폴더' }} />
      <Tabs.Screen name="all" options={{ title: '전체' }} />
      <Tabs.Screen name="search" options={{ title: '검색' }} />
    </Tabs>
  );
}
