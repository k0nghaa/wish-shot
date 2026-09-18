import { manipulateAsync, SaveFormat, type Action } from 'expo-image-manipulator';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, type LayoutChangeEvent, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, type } from '@/constants/theme';
import { toFileUri } from '@/lib/imageBytes';
import type { ParseImage } from '@/lib/queries';

// 모서리 핸들 터치 크기(px)와 크롭 박스 최소 크기(표시 px).
const HANDLE = 30;
const MIN_BOX = 56;
// 전송 전 긴 변 상한(px). 크롭 후 이보다 크면 리사이즈.
const MAX_EDGE = 1024;

function clampW(v: number, min: number, max: number): number {
  'worklet';
  return Math.min(Math.max(v, min), max);
}

type NatSize = { w: number; h: number };

/**
 * 제품 영역 지정 시트(Phase 6). OCR 텍스트가 부족할 때 열린다.
 * 원본 이미지를 비율대로 보여주고, 중앙 사각 박스 + 4모서리 핸들로 영역을 고른다.
 * "분석" 시 선택 영역만 크롭·리사이즈·JPEG 로 만들어 onSubmit 으로 넘긴다(통이미지 전송 아님).
 *
 * 박스는 이미지 표시 영역 대비 "비율"(0~1)로 다룬다 — 초기화 effect 가 필요 없어(상수 기본값)
 * shared value 뮤테이션이 제스처에서만 일어난다. 크롭 좌표는 비율 × 원본 픽셀로 바로 환산.
 */
export function RegionSelectSheet({
  visible,
  imageUri,
  busy,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  imageUri: string | null;
  busy: boolean; // 상위(imageParsing) 진행 중 — 버튼 비활성
  onSubmit: (image: ParseImage) => void;
  onCancel: () => void;
}) {
  const [container, setContainer] = useState<{ w: number; h: number } | null>(null);
  const [nat, setNat] = useState<NatSize | null>(null);
  const [cropping, setCropping] = useState(false);

  // 표시 이미지의 화면 내 사각형(contain fit).
  const disp = useMemo(() => {
    if (!container || !nat) return null;
    const scale = Math.min(container.w / nat.w, container.h / nat.h);
    const w = nat.w * scale;
    const h = nat.h * scale;
    return { w, h, offsetX: (container.w - w) / 2, offsetY: (container.h - h) / 2 };
  }, [container, nat]);

  // 크롭 박스 = 이미지 표시 영역 대비 비율(0~1). 기본 중앙 70%.
  const fx = useSharedValue(0.15);
  const fy = useSharedValue(0.15);
  const fw = useSharedValue(0.7);
  const fh = useSharedValue(0.7);
  // 제스처 시작값 캡처용.
  const sfx = useSharedValue(0);
  const sfy = useSharedValue(0);
  const sfw = useSharedValue(0);
  const sfh = useSharedValue(0);

  // 원본 크기 조회(파일 uri). 이미지가 바뀌면 다시. (shared value 는 건드리지 않는다.)
  useEffect(() => {
    if (!imageUri) return;
    // 이미지가 바뀌면 이전 크기를 리셋해 로딩 상태로(새 크기 로드 전까지 stale disp 방지).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNat(null);
    let alive = true;
    Image.getSize(
      toFileUri(imageUri),
      (w, h) => {
        if (alive) setNat({ w, h });
      },
      () => {
        if (alive) Alert.alert('오류', '이미지를 불러오지 못했습니다.');
      },
    );
    return () => {
      alive = false;
    };
  }, [imageUri]);

  const dw = disp?.w ?? 0;
  const dh = disp?.h ?? 0;

  const bodyPan = useMemo(() => {
    const minFW = dw > 0 ? MIN_BOX / dw : 0;
    const minFH = dh > 0 ? MIN_BOX / dh : 0;
    return Gesture.Pan()
      .onBegin(() => {
        'worklet';
        sfx.value = fx.value;
        sfy.value = fy.value;
      })
      .onUpdate((e) => {
        'worklet';
        fx.value = clampW(sfx.value + e.translationX / dw, 0, 1 - fw.value);
        fy.value = clampW(sfy.value + e.translationY / dh, 0, 1 - fh.value);
      })
      .enabled(dw > 0 && dh > 0 && minFW < 1 && minFH < 1);
    // shared value 는 안정적 ref — deps 제외(mutate 충돌 방지). 표시 크기 변할 때만 재생성.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dw, dh]);

  // 모서리 핸들: 각 모서리가 두 변을 조절. 최소 크기(비율)·이미지 경계로 클램프.
  const corner = useMemo(() => {
    const minFW = dw > 0 ? MIN_BOX / dw : 0.1;
    const minFH = dh > 0 ? MIN_BOX / dh : 0.1;
    const capture = (g: ReturnType<typeof Gesture.Pan>) =>
      g.onBegin(() => {
        'worklet';
        sfx.value = fx.value;
        sfy.value = fy.value;
        sfw.value = fw.value;
        sfh.value = fh.value;
      }).enabled(dw > 0 && dh > 0);
    const tl = capture(Gesture.Pan()).onUpdate((e) => {
      'worklet';
      const nx = clampW(sfx.value + e.translationX / dw, 0, sfx.value + sfw.value - minFW);
      const ny = clampW(sfy.value + e.translationY / dh, 0, sfy.value + sfh.value - minFH);
      fx.value = nx;
      fy.value = ny;
      fw.value = sfw.value + (sfx.value - nx);
      fh.value = sfh.value + (sfy.value - ny);
    });
    const tr = capture(Gesture.Pan()).onUpdate((e) => {
      'worklet';
      const ny = clampW(sfy.value + e.translationY / dh, 0, sfy.value + sfh.value - minFH);
      fy.value = ny;
      fh.value = sfh.value + (sfy.value - ny);
      fw.value = clampW(sfw.value + e.translationX / dw, minFW, 1 - sfx.value);
    });
    const bl = capture(Gesture.Pan()).onUpdate((e) => {
      'worklet';
      const nx = clampW(sfx.value + e.translationX / dw, 0, sfx.value + sfw.value - minFW);
      fx.value = nx;
      fw.value = sfw.value + (sfx.value - nx);
      fh.value = clampW(sfh.value + e.translationY / dh, minFH, 1 - sfy.value);
    });
    const br = capture(Gesture.Pan()).onUpdate((e) => {
      'worklet';
      fw.value = clampW(sfw.value + e.translationX / dw, minFW, 1 - sfx.value);
      fh.value = clampW(sfh.value + e.translationY / dh, minFH, 1 - sfy.value);
    });
    return { tl, tr, bl, br };
    // shared value 는 안정적 ref — deps 제외(mutate 충돌 방지). 표시 크기 변할 때만 재생성.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dw, dh]);

  const boxStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateX: fx.value * dw }, { translateY: fy.value * dh }],
      width: fw.value * dw,
      height: fh.value * dh,
    }),
    [dw, dh],
  );
  const tlStyle = useAnimatedStyle(() => ({ transform: [{ translateX: fx.value * dw - HANDLE / 2 }, { translateY: fy.value * dh - HANDLE / 2 }] }), [dw, dh]);
  const trStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (fx.value + fw.value) * dw - HANDLE / 2 }, { translateY: fy.value * dh - HANDLE / 2 }] }), [dw, dh]);
  const blStyle = useAnimatedStyle(() => ({ transform: [{ translateX: fx.value * dw - HANDLE / 2 }, { translateY: (fy.value + fh.value) * dh - HANDLE / 2 }] }), [dw, dh]);
  const brStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (fx.value + fw.value) * dw - HANDLE / 2 }, { translateY: (fy.value + fh.value) * dh - HANDLE / 2 }] }), [dw, dh]);

  // 선택 영역 "밖"만 어둡게(영역 안은 원본 색 그대로). 상/하/좌/우 4개 사각형으로 박스만 비운다.
  const dimTop = useAnimatedStyle(() => ({ left: 0, top: 0, width: dw, height: fy.value * dh }), [dw, dh]);
  const dimBottom = useAnimatedStyle(() => {
    const b = (fy.value + fh.value) * dh;
    return { left: 0, top: b, width: dw, height: Math.max(0, dh - b) };
  }, [dw, dh]);
  const dimLeft = useAnimatedStyle(() => ({ left: 0, top: fy.value * dh, width: fx.value * dw, height: fh.value * dh }), [dw, dh]);
  const dimRight = useAnimatedStyle(() => {
    const r = (fx.value + fw.value) * dw;
    return { left: r, top: fy.value * dh, width: Math.max(0, dw - r), height: fh.value * dh };
  }, [dw, dh]);

  async function handleAnalyze() {
    if (!nat || !imageUri || cropping || busy) return;
    setCropping(true);
    try {
      const originX = Math.max(0, Math.round(fx.value * nat.w));
      const originY = Math.max(0, Math.round(fy.value * nat.h));
      const width = Math.min(Math.round(fw.value * nat.w), nat.w - originX);
      const height = Math.min(Math.round(fh.value * nat.h), nat.h - originY);

      const actions: Action[] = [{ crop: { originX, originY, width, height } }];
      const longEdge = Math.max(width, height);
      if (longEdge > MAX_EDGE) {
        actions.push(width >= height ? { resize: { width: MAX_EDGE } } : { resize: { height: MAX_EDGE } });
      }

      const result = await manipulateAsync(toFileUri(imageUri), actions, {
        compress: 0.8,
        format: SaveFormat.JPEG,
        base64: true,
      });
      setCropping(false);
      if (!result.base64) {
        Alert.alert('오류', '이미지 처리에 실패했습니다.');
        return;
      }
      onSubmit({ base64: result.base64, mediaType: 'image/jpeg' });
    } catch {
      setCropping(false);
      Alert.alert('오류', '이미지 처리에 실패했습니다.');
    }
  }

  const working = busy || cropping;
  const ready = !!disp;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaProvider>
        <GestureHandlerRootView style={styles.flex}>
          <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onCancel} hitSlop={8} accessibilityRole="button" accessibilityLabel="취소" disabled={working}>
              <Text style={[styles.cancel, working && styles.disabled]}>취소</Text>
            </TouchableOpacity>
            <Text style={styles.title}>제품 영역 지정</Text>
            <TouchableOpacity onPress={handleAnalyze} hitSlop={8} accessibilityRole="button" accessibilityLabel="분석" disabled={!ready || working}>
              {working ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={[styles.analyze, !ready && styles.disabled]}>분석</Text>
              )}
            </TouchableOpacity>
          </View>

          <View
            style={styles.stage}
            onLayout={(e: LayoutChangeEvent) => setContainer({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
          >
            {imageUri ? (
              <Image source={{ uri: toFileUri(imageUri) }} style={StyleSheet.absoluteFill} resizeMode="contain" />
            ) : null}

            {ready ? (
              <View style={[styles.imageLayer, { left: disp!.offsetX, top: disp!.offsetY, width: disp!.w, height: disp!.h }]} pointerEvents="box-none">
                {/* 영역 밖 딤(안은 원본 색 유지) — 제스처는 통과 */}
                <Animated.View pointerEvents="none" style={[styles.dim, dimTop]} />
                <Animated.View pointerEvents="none" style={[styles.dim, dimBottom]} />
                <Animated.View pointerEvents="none" style={[styles.dim, dimLeft]} />
                <Animated.View pointerEvents="none" style={[styles.dim, dimRight]} />
                {/* 크롭 박스(이동) */}
                <GestureDetector gesture={bodyPan}>
                  <Animated.View style={[styles.box, boxStyle]} />
                </GestureDetector>
                {/* 모서리 핸들(리사이즈) */}
                <GestureDetector gesture={corner.tl}>
                  <Animated.View style={[styles.handle, tlStyle]} />
                </GestureDetector>
                <GestureDetector gesture={corner.tr}>
                  <Animated.View style={[styles.handle, trStyle]} />
                </GestureDetector>
                <GestureDetector gesture={corner.bl}>
                  <Animated.View style={[styles.handle, blStyle]} />
                </GestureDetector>
                <GestureDetector gesture={corner.br}>
                  <Animated.View style={[styles.handle, brStyle]} />
                </GestureDetector>
              </View>
            ) : (
              <ActivityIndicator color={colors.primary} />
            )}
          </View>

          <Text style={styles.notice}>
            선택한 영역만 AI 분석에 전송됩니다.{'\n'}이 영역은 분석에만 쓰이며, 사진은 원본 그대로 저장됩니다.
          </Text>
          </SafeAreaView>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.three,
    paddingTop: spacing.three,
    paddingBottom: spacing.two,
  },
  cancel: { fontSize: 16, color: colors.primary },
  title: { ...type.headline, color: colors.textMain },
  analyze: { fontSize: 16, fontWeight: '700', color: colors.primary },
  disabled: { color: colors.textDisabled },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  imageLayer: { position: 'absolute' },
  dim: { position: 'absolute', backgroundColor: colors.overlay },
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
    borderRadius: 2,
  },
  handle: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  notice: {
    fontSize: 13,
    color: colors.textMain,
    textAlign: 'center',
    paddingHorizontal: spacing.three,
    paddingVertical: spacing.two,
  },
});
