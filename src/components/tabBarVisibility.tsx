import { createContext, useContext, useState, type ReactNode } from 'react';

/**
 * 플로팅 탭바 표시 여부 컨텍스트. 전체 탭 다중 선택 모드에서 탭바를 숨겨,
 * 그 자리에 선택 액션바(SelectionBar)를 겹치지 않게 노출한다(iOS 사진 앱 톤).
 * (탭바는 네비게이터 오버레이라 화면 내 절대배치보다 위에 그려지므로, 숨김으로 자리를 비운다.)
 */
type TabBarVisibility = { hidden: boolean; setHidden: (v: boolean) => void };

const TabBarVisibilityContext = createContext<TabBarVisibility>({ hidden: false, setHidden: () => {} });

export function TabBarVisibilityProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  return (
    <TabBarVisibilityContext.Provider value={{ hidden, setHidden }}>{children}</TabBarVisibilityContext.Provider>
  );
}

export function useTabBarVisibility() {
  return useContext(TabBarVisibilityContext);
}
