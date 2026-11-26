import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Modal, StyleSheet, View } from 'react-native';

import { colors } from '@/constants/theme';
import { capture } from '@/lib/analytics';
import { CoachmarkSpotlight } from './CoachmarkSpotlight';
import { CATEGORIES_TAB_TARGET, useOnboardingTarget, type TargetRect } from './onboardingTarget';

// 카테고리 안내: 탭 바의 카테고리 버튼을 비춘다(기본 탭이 전체라 카테고리 화면은 처음에 마운트되지 않음).
// 미마운트/측정 실패면 스킵되고 바로 등록 투어로 넘어간다.
const CATEGORY_TEXT = '카테고리 탭에서 위시를 분류하고 관리합니다.';

type Phase = { kind: 'transition' } | { kind: 'category'; target: TargetRect };

type Props = { onDone: () => void };

/**
 * 사용 안내(탭 바 카테고리 코치마크 → 등록 폼 코치마크). 온보딩 순서는 카드 → 로그인 → 이 안내다 —
 * 전체 탭과 등록 화면이 그려진 뒤(세션이 있어야 그려진다)에 띄운다. 띄울 시점은 부르는 쪽이 정한다.
 * "다음"에서 등록 폼을 열며(onboarding 파라미터) 끝낸다. 등록 폼 위 코치마크는 등록 화면이 직접 띄운다
 * (RN Modal 위로 네이티브 모달이 얹히는 순서 문제 회피 — RegisterCoachmarkTour).
 * 완료·건너뛰기·측정 실패 모두 onDone 으로 수렴하고, 종료 계측(onboarding_finished)은 여기서 보낸다.
 */
export function OnboardingGuide({ onDone }: Props) {
  const router = useRouter();
  const { measure } = useOnboardingTarget();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'transition' });

  // 이 안내가 닫혔으면(언마운트) 측정 대기 뒤 등록 투어를 열지 않는다.
  const mountedRef = useRef(true);
  const finishedRef = useRef(false);
  const startedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (!cancelled) setReduceMotion(v);
      })
      .catch(() => {
        /* 조회 실패는 기본값(애니메이션 유지) */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const captureFinished = useCallback((result: 'completed' | 'skipped') => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    capture('onboarding_finished', { result, last_step: 'category_coachmark' });
  }, []);

  // 등록 폼을 열어(onboarding 파라미터) 등록 화면이 자체 코치마크 투어를 띄우게 하고, 이 안내는 끝낸다.
  const openRegisterTour = useCallback(() => {
    captureFinished('completed'); // 등록 폼 투어 진입 = 안내 완주
    router.push({ pathname: '/register', params: { onboarding: '1' } });
    onDone();
  }, [captureFinished, router, onDone]);

  // 건너뛰기(스킵 버튼·코치마크 스킵).
  const handleSkip = useCallback(() => {
    captureFinished('skipped');
    onDone();
  }, [captureFinished, onDone]);

  // 탭 바 카테고리 코치마크(측정 성공 시) → 없으면 바로 등록 투어로.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      const target = await measure(CATEGORIES_TAB_TARGET);
      if (!mountedRef.current) return;
      if (target) {
        setPhase({ kind: 'category', target });
        capture('onboarding_step_viewed', { step: 'category_coachmark' });
      } else {
        openRegisterTour();
      }
    })();
  }, [measure, openRegisterTour]);

  return (
    <Modal visible transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={handleSkip}>
      {phase.kind === 'transition' ? (
        <View style={styles.transition}>
          <ActivityIndicator color={colors.bg} />
        </View>
      ) : (
        <CoachmarkSpotlight target={phase.target} text={CATEGORY_TEXT} primaryLabel="다음" onPrimary={openRegisterTour} onSkip={handleSkip} />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  transition: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center' },
});
