import { useRouter } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { colors, radius, spacing, type } from '@/constants/theme';
import { AutoFillMock, CaptureFlowMock, OrganizeMock } from './CardMock';
import { CoachmarkSpotlight } from './CoachmarkSpotlight';
import { useOnboardingTarget, type TargetRect } from './onboardingTarget';

// 홈 "카테고리 추가" 알약 코치마크 대상. 미마운트/측정 실패면 스킵되고 바로 등록 투어로 넘어간다.
const CATEGORY_KEY = 'home.addCategory';
const CATEGORY_TEXT = '여기서 카테고리를 추가하고 관리합니다.';

type Card = { icon: SymbolViewProps['name']; title: string; body: string; mock?: 'captureFlow' | 'autoFill' | 'organize' };

// 문구는 실제 기능과 일치(없는 기능 홍보 금지) · 앱 톤 단답("~습니다").
const CARDS: Card[] = [
  {
    icon: 'square.and.arrow.up',
    title: '스크린샷 바로 담기',
    body: '캡처 직후 스크린샷을 눌러 WishShot에 진입해보세요.\n바로 위시리스트를 저장할 수 있습니다.',
    mock: 'captureFlow',
  },
  {
    icon: 'sparkles',
    title: 'AI가 자동 정리',
    body: '담기만 하면 제품 정보를 AI가 읽어 채우고\n 카테고리까지 추천합니다.',
    mock: 'autoFill',
  },
  {
    icon: 'square.grid.2x2',
    title: '카테고리로 정리',
    body: '담은 위시를 카테고리로 정리해\n한눈에 모아 봅니다.',
    mock: 'organize',
  },
];

type Phase = { kind: 'cards' } | { kind: 'transition' } | { kind: 'category'; target: TargetRect };

type Props = { onDone: () => void };

/**
 * 첫 실행 온보딩 오버레이(카드 + 홈 카테고리 코치마크).
 * 카드 캐러셀(FlatList + reanimated 도트, 첫 카드=캡처 흐름 모션 그래픽) → 홈 "카테고리 추가" 코치마크
 * → "다음"에서 등록 폼을 열며(onboarding 파라미터) 완료. 등록 폼 위 코치마크는 등록 화면이 직접 띄운다
 * (RN Modal 위로 네이티브 모달이 얹히는 순서 문제 회피 — RegisterCoachmarkTour).
 * 완료·건너뛰기·측정 실패 모두 onDone 으로 수렴. reduce-motion 이면 전환 애니메이션을 끈다.
 */
export function OnboardingOverlay({ onDone }: Props) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { measure } = useOnboardingTarget();
  const listRef = useRef<Animated.FlatList<Card>>(null);
  const scrollX = useSharedValue(0);
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'cards' });

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

  // 등록 폼을 열어(onboarding 파라미터) 등록 화면이 자체 코치마크 투어를 띄우게 하고, 이 오버레이는 종료한다.
  const openRegisterTour = useCallback(() => {
    router.push({ pathname: '/register', params: { onboarding: '1' } });
    onDone();
  }, [router, onDone]);

  // 카드 끝 → 카테고리 코치마크(측정 성공 시) → 없으면 바로 등록 투어로.
  const finishCards = useCallback(async () => {
    setPhase({ kind: 'transition' });
    const target = await measure(CATEGORY_KEY);
    if (target) setPhase({ kind: 'category', target });
    else openRegisterTour();
  }, [measure, openRegisterTour]);

  function handlePrimary() {
    if (isLast) void finishCards();
    else listRef.current?.scrollToIndex({ index: index + 1, animated: !reduceMotion });
  }

  return (
    <Modal visible transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onDone}>
      {phase.kind === 'transition' ? (
        <View style={styles.transition}>
          <ActivityIndicator color={colors.bg} />
        </View>
      ) : phase.kind === 'category' ? (
        <CoachmarkSpotlight target={phase.target} text={CATEGORY_TEXT} primaryLabel="다음" onPrimary={openRegisterTour} onSkip={onDone} />
      ) : (
        <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          {/* Modal 안에서는 SafeAreaView top edge 가 0 으로 잡힐 수 있어 인셋을 명시 적용(헤더/노치 가림 방지). */}
          <View style={styles.skipRow}>
            <TouchableOpacity onPress={onDone} hitSlop={8} accessibilityRole="button" accessibilityLabel="건너뛰기">
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
            renderItem={({ item }) => (
              <View style={[styles.card, { width }]}>
                {item.mock === 'captureFlow' ? (
                  <View style={styles.mockWrap}>
                    <CaptureFlowMock />
                  </View>
                ) : item.mock === 'autoFill' ? (
                  <View style={styles.mockWrap}>
                    <AutoFillMock />
                  </View>
                ) : item.mock === 'organize' ? (
                  <View style={styles.mockWrap}>
                    <OrganizeMock />
                  </View>
                ) : (
                  <View style={styles.iconWrap}>
                    <SymbolView name={item.icon} size={72} tintColor={colors.primary} />
                  </View>
                )}
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardBody}>{item.body}</Text>
              </View>
            )}
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
      )}
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
  transition: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center' },
  skipRow: { alignItems: 'flex-end', paddingHorizontal: spacing.three, paddingTop: spacing.two },
  skip: { fontSize: 15, color: colors.textSub },
  card: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.five, gap: spacing.three },
  iconWrap: {
    width: 128,
    height: 128,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCard,
    marginBottom: spacing.two,
  },
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
