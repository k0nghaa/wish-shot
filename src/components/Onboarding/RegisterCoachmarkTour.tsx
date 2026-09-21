import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Modal, StyleSheet, View } from 'react-native';

import { colors } from '@/constants/theme';
import { CoachmarkSpotlight } from './CoachmarkSpotlight';
import { useOnboardingTarget, type TargetRect } from './onboardingTarget';

const IMAGE_KEY = 'register.imageBox';
const RECENT_KEY = 'register.recentPhoto';
const IMAGE_TEXT = '사진을 선택하면 AI가 제품명·가격을 채우고, 원하는 영역만 크롭해 다시 분석할 수 있습니다.';
const RECENT_TEXT = '방금 캡처한 스크린샷은 여기서 바로 담을 수 있습니다.';

// 등록 폼은 push 직후 레이아웃 전이라 좌표가 안 나올 수 있어 재시도하며 측정한다.
const RETRIES = 10;
const GAP_MS = 150;

/**
 * 등록 폼 위 코치마크 2스텝(이미지 선택 → 방금 캡처한 사진).
 * 반드시 "등록 화면 안에서" 렌더한다 — _layout 의 온보딩 Modal 위로 등록 네이티브 모달이 얹히므로,
 * 코치마크를 등록 화면이 직접 띄워야 등록 폼 위에 올라간다(RN Modal 은 자신을 띄운 화면 위에 표시).
 * 대상 미마운트/측정 실패는 어느 단계서든 안전하게 onDone 으로 종료(크래시 금지).
 */
export function RegisterCoachmarkTour({ onDone }: { onDone: () => void }) {
  const { measure } = useOnboardingTarget();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [phase, setPhase] = useState<
    { kind: 'transition' } | { kind: 'image'; target: TargetRect } | { kind: 'recent'; target: TargetRect }
  >({ kind: 'transition' });
  const started = useRef(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (!cancelled) setReduceMotion(v);
      })
      .catch(() => {
        /* 조회 실패는 기본값 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const measureWithRetry = useCallback(
    async (key: string): Promise<TargetRect | null> => {
      for (let i = 0; i < RETRIES; i++) {
        const r = await measure(key);
        if (r) return r;
        await new Promise((res) => setTimeout(res, GAP_MS));
      }
      return null;
    },
    [measure],
  );

  // 첫 스텝: 이미지 박스 측정 → 실패면 종료.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;
    (async () => {
      const target = await measureWithRetry(IMAGE_KEY);
      if (cancelled) return;
      if (target) setPhase({ kind: 'image', target });
      else onDone();
    })();
    return () => {
      cancelled = true;
    };
  }, [measureWithRetry, onDone]);

  const toRecent = useCallback(async () => {
    setPhase({ kind: 'transition' });
    const target = await measureWithRetry(RECENT_KEY);
    if (target) setPhase({ kind: 'recent', target });
    else onDone();
  }, [measureWithRetry, onDone]);

  return (
    <Modal visible transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onDone}>
      {phase.kind === 'transition' ? (
        <View style={styles.dim}>
          <ActivityIndicator color={colors.bg} />
        </View>
      ) : phase.kind === 'image' ? (
        <CoachmarkSpotlight target={phase.target} text={IMAGE_TEXT} primaryLabel="다음" onPrimary={() => void toRecent()} onSkip={onDone} />
      ) : (
        <CoachmarkSpotlight target={phase.target} text={RECENT_TEXT} primaryLabel="시작하기" onPrimary={onDone} onSkip={onDone} />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center' },
});
