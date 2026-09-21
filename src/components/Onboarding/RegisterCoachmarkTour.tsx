import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors, radius } from '@/constants/theme';
import { CoachmarkSpotlight } from './CoachmarkSpotlight';
import { useOnboardingTarget, type TargetRect } from './onboardingTarget';

const IMAGE_KEY = 'register.imageBox';
const RECENT_KEY = 'register.recentPhoto';
const IMAGE_TEXT = '사진을 선택하면 AI가 제품 정보를 채웁니다.\n원하는 영역만 크롭해 다시 분석할 수 있습니다.';
const RECENT_TEXT = '가장 최근에 저장한 사진은 여기서 바로 담을 수 있습니다.';

// 등록 폼은 push 직후 레이아웃 전이라 좌표가 안 나올 수 있어 재시도하며 측정한다.
const RETRIES = 10;
const GAP_MS = 150;

type Rect = TargetRect;
type Phase = { kind: 'transition' } | { kind: 'image'; target: Rect } | { kind: 'recent'; target: Rect };

/**
 * 등록 폼 위 코치마크 2스텝(이미지 선택 → 방금 캡처한 사진).
 * 등록 화면 안의 절대배치 오버레이로 그린다 — 등록 폼이 네이티브 모달 "시트"라 화면 최상단과
 * 오프셋이 있으므로, 대상 좌표를 measureInWindow(윈도우) 로 얻은 뒤 이 오버레이 루트의 윈도우
 * 위치를 빼서 "오버레이 로컬 좌표"로 보정한다. 이렇게 해야 구멍이 요소에 정확히 맞는다.
 * 대상 미마운트/측정 실패는 어느 단계서든 안전하게 onDone 으로 종료(크래시 금지).
 */
export function RegisterCoachmarkTour({ onDone }: { onDone: () => void }) {
  const { measure } = useOnboardingTarget();
  const rootRef = useRef<View>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'transition' });
  const started = useRef(false);

  // 오버레이 루트의 윈도우 좌표(시트 오프셋 보정용).
  const measureRoot = useCallback(
    () =>
      new Promise<{ x: number; y: number } | null>((resolve) => {
        const node = rootRef.current;
        if (!node) {
          resolve(null);
          return;
        }
        node.measureInWindow((x, y) => resolve({ x, y }));
      }),
    [],
  );

  // 대상을 윈도우 기준으로 측정 → 오버레이 루트 기준으로 보정. 실패면 null(재시도).
  const measureRel = useCallback(
    async (key: string): Promise<Rect | null> => {
      for (let i = 0; i < RETRIES; i++) {
        const t = await measure(key);
        if (t) {
          const r = await measureRoot();
          return r ? { x: t.x - r.x, y: t.y - r.y, width: t.width, height: t.height } : t;
        }
        await new Promise((res) => setTimeout(res, GAP_MS));
      }
      return null;
    },
    [measure, measureRoot],
  );

  // 첫 스텝: 이미지 박스 측정 → 실패면 종료.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;
    (async () => {
      const target = await measureRel(IMAGE_KEY);
      if (cancelled) return;
      if (target) setPhase({ kind: 'image', target });
      else onDone();
    })();
    return () => {
      cancelled = true;
    };
  }, [measureRel, onDone]);

  const toRecent = useCallback(async () => {
    setPhase({ kind: 'transition' });
    const target = await measureRel(RECENT_KEY);
    if (target) setPhase({ kind: 'recent', target });
    else onDone();
  }, [measureRel, onDone]);

  return (
    <View
      ref={rootRef}
      style={StyleSheet.absoluteFill}
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      {phase.kind === 'transition' ? (
        <View style={styles.dim}>
          <ActivityIndicator color={colors.bg} />
        </View>
      ) : phase.kind === 'image' ? (
        <CoachmarkSpotlight
          target={phase.target}
          text={IMAGE_TEXT}
          primaryLabel="다음"
          onPrimary={() => void toRecent()}
          onSkip={onDone}
          containerSize={size ?? undefined}
          shape="square"
          holeRadius={radius.lg}
          holePad={12}
        />
      ) : (
        <CoachmarkSpotlight
          target={phase.target}
          text={RECENT_TEXT}
          primaryLabel="시작하기"
          onPrimary={onDone}
          onSkip={onDone}
          containerSize={size ?? undefined}
          shape="pill"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center' },
});
