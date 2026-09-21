import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react';
import type { View } from 'react-native';

/**
 * 온보딩 코치마크 스포트라이트의 "대상 요소" 등록소.
 * 화면(예: 홈)이 강조하고 싶은 요소를 key 로 등록하면, 온보딩 오버레이가 그 요소를
 * measureInWindow 로 측정해 둥근 마스크 구멍을 뚫는다.
 *
 * 대상이 미등록·미마운트·측정 실패면 measure() 가 null 을 돌려주고 코치마크는 안전하게 스킵된다
 * (크래시 금지 — 좌표는 실기기 튜닝 전제).
 */
export type TargetRect = { x: number; y: number; width: number; height: number };

type Registry = {
  register: (key: string, node: View | null) => void;
  measure: (key: string) => Promise<TargetRect | null>;
};

const OnboardingTargetContext = createContext<Registry>({
  register: () => {},
  measure: async () => null,
});

// measureInWindow 콜백이 끝내 안 오는 경우(레이아웃 전 등)를 대비한 안전 타임아웃.
const MEASURE_TIMEOUT_MS = 400;

export function OnboardingTargetProvider({ children }: { children: ReactNode }) {
  const nodes = useRef<Map<string, View>>(new Map());

  const register = useCallback((key: string, node: View | null) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
  }, []);

  const measure = useCallback((key: string) => {
    return new Promise<TargetRect | null>((resolve) => {
      const node = nodes.current.get(key);
      if (!node) {
        resolve(null);
        return;
      }
      let settled = false;
      const done = (rect: TargetRect | null) => {
        if (settled) return;
        settled = true;
        resolve(rect);
      };
      const timer = setTimeout(() => done(null), MEASURE_TIMEOUT_MS);
      try {
        node.measureInWindow((x, y, width, height) => {
          clearTimeout(timer);
          // 레이아웃 전이면 0 이 올 수 있다 → 유효하지 않은 측정은 스킵.
          if (width > 0 && height > 0) done({ x, y, width, height });
          else done(null);
        });
      } catch {
        clearTimeout(timer);
        done(null);
      }
    });
  }, []);

  return (
    <OnboardingTargetContext.Provider value={{ register, measure }}>{children}</OnboardingTargetContext.Provider>
  );
}

export function useOnboardingTarget() {
  return useContext(OnboardingTargetContext);
}
