import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { colors, radius, spacing, type } from '@/constants/theme';
import { CoachmarkSpotlight } from './CoachmarkSpotlight';
import { useOnboardingTarget, type TargetRect } from './onboardingTarget';

// 코치마크가 강조할 대상 key(홈의 "카테고리 추가" 알약이 등록). 미등록/미측정이면 스킵.
const COACHMARK_TARGET_KEY = 'home.addCategory';
const COACHMARK_TEXT = '여기서 카테고리를 추가하고 관리합니다.';

type Card = { icon: SymbolViewProps['name']; title: string; body: string };

// 문구는 실제 기능과 일치(없는 기능 홍보 금지) · 앱 톤 단답("~습니다").
const CARDS: Card[] = [
  {
    icon: 'square.and.arrow.up',
    title: '스크린샷으로 담기',
    body: '공유 시트에서 위시샷을 선택하면 스크린샷이 바로 담깁니다.',
  },
  {
    icon: 'sparkles',
    title: 'AI가 자동 정리',
    body: '제품명·가격·브랜드를 AI가 읽어 채우고 카테고리를 추천합니다.',
  },
  {
    icon: 'square.grid.2x2',
    title: '모아서 관리',
    body: '카테고리로 정리하고, 링크를 저장하고, 원본은 앨범에서 정리합니다.',
  },
];

type Props = { onDone: () => void };

/**
 * 첫 실행 온보딩 오버레이.
 * 1) 카드 캐러셀(FlatList horizontal + reanimated 도트) → 2) 코치마크 스포트라이트(대상 측정 성공 시).
 * 완료·건너뛰기·측정 실패 모두 onDone() 으로 수렴한다. reduce-motion 이면 전환 애니메이션을 끈다.
 */
export function OnboardingOverlay({ onDone }: Props) {
  const { width } = useWindowDimensions();
  const { measure } = useOnboardingTarget();
  const listRef = useRef<Animated.FlatList<Card>>(null);
  const scrollX = useSharedValue(0);
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [coachTarget, setCoachTarget] = useState<TargetRect | null>(null);
  const [phase, setPhase] = useState<'cards' | 'coachmark'>('cards');

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

  // 카드 끝 → 코치마크 대상 측정. 성공하면 스포트라이트, 실패(미마운트 등)면 그대로 완료.
  const finishCards = useCallback(async () => {
    const rect = await measure(COACHMARK_TARGET_KEY);
    if (rect) {
      setCoachTarget(rect);
      setPhase('coachmark');
    } else {
      onDone();
    }
  }, [measure, onDone]);

  function handlePrimary() {
    if (isLast) {
      void finishCards();
    } else {
      listRef.current?.scrollToIndex({ index: index + 1, animated: !reduceMotion });
    }
  }

  return (
    <Modal visible transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onDone}>
      {phase === 'coachmark' && coachTarget ? (
        <CoachmarkSpotlight target={coachTarget} text={COACHMARK_TEXT} onDone={onDone} />
      ) : (
        <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
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
            onScroll={scrollHandler}
            scrollEventThrottle={16}
            onMomentumScrollEnd={onMomentumEnd}
            renderItem={({ item }) => (
              <View style={[styles.card, { width }]}>
                <View style={styles.iconWrap}>
                  <SymbolView name={item.icon} size={72} tintColor={colors.primary} />
                </View>
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
        </SafeAreaView>
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
