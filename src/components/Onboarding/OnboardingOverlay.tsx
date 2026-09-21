import { useRouter } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
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
import { ShareSheetMock } from './CardMock';
import { CoachmarkSpotlight } from './CoachmarkSpotlight';
import { useOnboardingTarget, type TargetRect } from './onboardingTarget';

// 코치마크 단계별 대상 key·문구. 대상 미마운트/측정 실패 시 해당 단계는 안전하게 스킵된다.
const CATEGORY_KEY = 'home.addCategory';
const REG_IMAGE_KEY = 'register.imageBox';
const REG_RECENT_KEY = 'register.recentPhoto';
const CATEGORY_TEXT = '여기서 카테고리를 추가하고 관리합니다.';
const REG_IMAGE_TEXT = '사진을 선택하면 AI가 제품명·가격을 채우고, 원하는 영역만 크롭해 다시 분석할 수 있습니다.';
const REG_RECENT_TEXT = '방금 캡처한 스크린샷은 여기서 바로 담을 수 있습니다.';

type Card = { icon: SymbolViewProps['name']; title: string; body: string; mock?: 'shareSheet' };

// 문구는 실제 기능과 일치(없는 기능 홍보 금지) · 앱 톤 단답("~습니다").
const CARDS: Card[] = [
  {
    icon: 'square.and.arrow.up',
    title: '스크린샷으로 담기',
    body: '공유 시트에서 위시샷을 선택하면 스크린샷이 바로 담깁니다.',
    mock: 'shareSheet',
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

// 등록 폼은 push 직후 아직 레이아웃 전이라 좌표가 안 나올 수 있어 재시도하며 측정한다.
const MEASURE_RETRIES = 8;
const MEASURE_GAP_MS = 200;

type Phase =
  | { kind: 'cards' }
  | { kind: 'transition' } // 폼 push·측정 중 매끄러운 딤
  | { kind: 'category'; target: TargetRect }
  | { kind: 'regImage'; target: TargetRect }
  | { kind: 'regRecent'; target: TargetRect };

type Props = { onDone: () => void };

/**
 * 첫 실행 온보딩 오버레이.
 * 1) 카드 캐러셀(FlatList + reanimated 도트) → 2) 홈 "카테고리 추가" 코치마크 →
 * 3) 등록 폼을 자동으로 열어 "사진 선택/영역 크롭"·"방금 캡처한 사진" 코치마크 2스텝.
 * 완료·건너뛰기·측정 실패는 모두 finish() 로 수렴(열었던 폼은 닫고 종료). reduce-motion 대응.
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
  // 등록 폼을 우리가 열었으면 종료 시 되돌린다.
  const pushedRegister = useRef(false);

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

  // 온보딩 종료: 우리가 연 등록 폼이면 닫고, 완료 콜백을 부른다.
  const finish = useCallback(() => {
    if (pushedRegister.current) {
      pushedRegister.current = false;
      try {
        router.back();
      } catch {
        /* 되돌리기 실패는 무시(그대로 종료) */
      }
    }
    onDone();
  }, [onDone, router]);

  const measureWithRetry = useCallback(
    async (key: string): Promise<TargetRect | null> => {
      for (let i = 0; i < MEASURE_RETRIES; i++) {
        const r = await measure(key);
        if (r) return r;
        await new Promise((res) => setTimeout(res, MEASURE_GAP_MS));
      }
      return null;
    },
    [measure],
  );

  // 등록 폼을 열어 코치마크 2스텝을 시작한다. 측정 실패면 조용히 종료.
  const startRegisterTour = useCallback(async () => {
    setPhase({ kind: 'transition' });
    router.push('/register');
    pushedRegister.current = true;
    const target = await measureWithRetry(REG_IMAGE_KEY);
    if (target) setPhase({ kind: 'regImage', target });
    else finish();
  }, [router, measureWithRetry, finish]);

  // 카드 끝 → 카테고리 코치마크(측정 성공 시) → 없으면 바로 등록 투어로.
  const finishCards = useCallback(async () => {
    setPhase({ kind: 'transition' });
    const target = await measure(CATEGORY_KEY);
    if (target) setPhase({ kind: 'category', target });
    else void startRegisterTour();
  }, [measure, startRegisterTour]);

  // 등록 폼 이미지 코치마크 → "방금 캡처한 사진" 코치마크.
  const nextToRecent = useCallback(async () => {
    setPhase({ kind: 'transition' });
    const target = await measureWithRetry(REG_RECENT_KEY);
    if (target) setPhase({ kind: 'regRecent', target });
    else finish();
  }, [measureWithRetry, finish]);

  function handlePrimary() {
    if (isLast) void finishCards();
    else listRef.current?.scrollToIndex({ index: index + 1, animated: !reduceMotion });
  }

  return (
    <Modal visible transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={finish}>
      {phase.kind === 'transition' ? (
        <View style={styles.transition}>
          <ActivityIndicator color={colors.bg} />
        </View>
      ) : phase.kind === 'category' ? (
        <CoachmarkSpotlight target={phase.target} text={CATEGORY_TEXT} primaryLabel="다음" onPrimary={() => void startRegisterTour()} onSkip={finish} />
      ) : phase.kind === 'regImage' ? (
        <CoachmarkSpotlight target={phase.target} text={REG_IMAGE_TEXT} primaryLabel="다음" onPrimary={() => void nextToRecent()} onSkip={finish} />
      ) : phase.kind === 'regRecent' ? (
        <CoachmarkSpotlight target={phase.target} text={REG_RECENT_TEXT} primaryLabel="시작하기" onPrimary={finish} onSkip={finish} />
      ) : (
        <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          {/* Modal 안에서는 SafeAreaView top edge 가 0 으로 잡힐 수 있어 인셋을 명시 적용(헤더/노치 가림 방지). */}
          <View style={styles.skipRow}>
            <TouchableOpacity onPress={finish} hitSlop={8} accessibilityRole="button" accessibilityLabel="건너뛰기">
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
                {item.mock === 'shareSheet' ? (
                  <View style={styles.mockWrap}>
                    <ShareSheetMock />
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
