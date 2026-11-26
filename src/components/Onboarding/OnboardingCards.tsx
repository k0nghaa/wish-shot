import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { capture, type OnboardingStep } from '@/lib/analytics';
import { colors, radius, spacing, type } from '@/constants/theme';
import { AutoFillMock, CaptureFlowMock, OrganizeMock } from './CardMock';

type Card = { title: string; body: string; mock: 'captureFlow' | 'autoFill' | 'organize' };

// 문구는 실제 기능과 일치(없는 기능 홍보 금지) · 앱 톤 단답("~습니다").
const CARDS: Card[] = [
  {
    title: '스크린샷 바로 담기',
    body: '캡처 직후 스크린샷을 눌러 WishShot에 진입해보세요.\n바로 위시리스트를 저장할 수 있습니다.',
    mock: 'captureFlow',
  },
  {
    title: 'AI가 자동 정리',
    body: '담기만 하면 제품 정보를 AI가 읽어 채우고\n 카테고리까지 추천합니다.',
    mock: 'autoFill',
  },
  {
    title: '카테고리로 정리',
    body: '담은 위시를 카테고리별로 \n한눈에 모아 보세요.',
    mock: 'organize',
  },
];

// 계측 스텝 식별자 — 캐러셀 장 번호와 1:1.
const CARD_STEPS: OnboardingStep[] = ['card_1', 'card_2', 'card_3'];

type Props = {
  /**
   * 카드를 마쳤을 때. completed = "시작하기", skipped = 건너뛰기(뒤로가기 포함).
   * 온보딩 순서는 카드 → 로그인 → 사용 안내(OnboardingGuide) — 다음 화면은 부르는 쪽이 정한다.
   * skipped 의 계측(onboarding_finished)은 여기서 보낸다. completed 는 사용 안내가 마칠 때 보낸다.
   */
  onDone: (result: 'completed' | 'skipped') => void;
};

/**
 * 첫 실행 온보딩 카드(3장 캐러셀, 첫 카드 = 캡처 흐름 모션 그래픽). 사용 안내(탭 바·등록 폼 코치마크)는 따로다.
 * reduce-motion 이면 전환 애니메이션을 끈다.
 */
export function OnboardingCards({ onDone }: Props) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<Animated.FlatList<Card>>(null);
  const scrollX = useSharedValue(0);
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  // 계측: 스텝 노출은 스텝당 1회(뒤로 스와이프 재노출은 last_step 만 갱신), 종료는 1회.
  const viewedStepsRef = useRef(new Set<OnboardingStep>());
  const lastStepRef = useRef<OnboardingStep>('card_1');
  const finishedRef = useRef(false);

  const captureStepViewed = useCallback((step: OnboardingStep) => {
    lastStepRef.current = step; // 이탈 지점 추적은 재노출도 반영
    if (viewedStepsRef.current.has(step)) return;
    viewedStepsRef.current.add(step);
    capture('onboarding_step_viewed', { step });
  }, []);

  // 현재 카드 스텝 노출(마운트 시 card_1 포함).
  useEffect(() => {
    const step = CARD_STEPS[index];
    if (step) captureStepViewed(step);
  }, [index, captureStepViewed]);

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

  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });

  const onMomentumEnd = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
    },
    [width],
  );

  const isLast = index >= CARDS.length - 1;

  // 건너뛰기(스킵 버튼·뒤로가기) → 이탈 스텝과 함께 종료 기록.
  const handleSkip = useCallback(() => {
    if (!finishedRef.current) {
      finishedRef.current = true;
      capture('onboarding_finished', { result: 'skipped', last_step: lastStepRef.current });
    }
    onDone('skipped');
  }, [onDone]);

  function handlePrimary() {
    if (isLast) onDone('completed');
    else listRef.current?.scrollToIndex({ index: index + 1, animated: !reduceMotion });
  }

  return (
    <Modal visible transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={handleSkip}>
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* Modal 안에서는 SafeAreaView top edge 가 0 으로 잡힐 수 있어 인셋을 명시 적용(헤더/노치 가림 방지). */}
        <View style={styles.skipRow}>
          <TouchableOpacity onPress={handleSkip} hitSlop={8} accessibilityRole="button" accessibilityLabel="건너뛰기">
            <Text style={styles.skip}>건너뛰기</Text>
          </TouchableOpacity>
        </View>

        <Animated.FlatList
          ref={listRef}
          data={CARDS}
          keyExtractor={(c) => c.title}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          onMomentumScrollEnd={onMomentumEnd}
          extraData={index}
          renderItem={({ item, index: i }) => {
            // 해당 카드가 활성일 때만 모션이 돌아간다. key 를 active 로 바꿔 활성 시 처음부터 재생.
            const active = index === i;
            return (
              <View style={[styles.card, { width }]}>
                {item.mock === 'captureFlow' ? (
                  <View style={styles.mockWrap}>
                    <CaptureFlowMock key={active ? 'on' : 'off'} active={active} />
                  </View>
                ) : item.mock === 'autoFill' ? (
                  <View style={styles.mockWrap}>
                    <AutoFillMock key={active ? 'on' : 'off'} active={active} />
                  </View>
                ) : (
                  <View style={styles.mockWrap}>
                    <OrganizeMock key={active ? 'on' : 'off'} active={active} />
                  </View>
                )}
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardBody}>{item.body}</Text>
              </View>
            );
          }}
        />

        <View style={styles.dots}>
          {CARDS.map((c, i) => (
            <Dot key={c.title} index={i} scrollX={scrollX} width={width} reduceMotion={reduceMotion} active={index} />
          ))}
        </View>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handlePrimary}
          accessibilityRole="button"
          accessibilityLabel={isLast ? '시작하기' : '다음'}
        >
          <Text style={styles.primaryBtnText}>{isLast ? '시작하기' : '다음'}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// 페이지 도트. reduce-motion 이면 스크롤 연동 없이 현재 인덱스로 정적 표시.
function Dot({
  index,
  scrollX,
  width,
  reduceMotion,
  active,
}: {
  index: number;
  scrollX: SharedValue<number>;
  width: number;
  reduceMotion: boolean;
  active: number;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const input = [(index - 1) * width, index * width, (index + 1) * width];
    return {
      width: interpolate(scrollX.value, input, [8, 20, 8], Extrapolation.CLAMP),
      opacity: interpolate(scrollX.value, input, [0.3, 1, 0.3], Extrapolation.CLAMP),
    };
  });
  if (reduceMotion) {
    const on = index === active;
    return <View style={[styles.dot, { width: on ? 20 : 8, opacity: on ? 1 : 0.3 }]} />;
  }
  return <Animated.View style={[styles.dot, animatedStyle]} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  skipRow: { alignItems: 'flex-end', paddingHorizontal: spacing.three, paddingTop: spacing.two },
  skip: { fontSize: 15, color: colors.textSub },
  card: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.five, gap: spacing.three },
  mockWrap: { width: '100%', alignItems: 'center', marginBottom: spacing.two },
  cardTitle: { ...type.title, color: colors.textMain, textAlign: 'center' },
  cardBody: { ...type.body, color: colors.textSub, textAlign: 'center', lineHeight: 24 },
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.two, marginBottom: spacing.four },
  dot: { height: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
  primaryBtn: {
    marginHorizontal: spacing.four,
    marginBottom: spacing.three,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  primaryBtnText: { fontSize: 17, fontWeight: '700', color: colors.bg },
});
