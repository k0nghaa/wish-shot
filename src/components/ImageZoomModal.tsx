import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Image as RNImage, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { radius, shadow } from '@/constants/theme';
import { toFileUri } from '@/lib/imageBytes';

/**
 * 원본 이미지 미리보기(iOS 앨범 롱프레스 peek 스타일). 등록·편집에서 사진을 롱프레스로 연다 —
 * 자동으로 텍스트를 못 뽑았을 때 원본을 크게 보고, iOS Live Text 로 글자를 선택·복사해 붙여넣는 용도.
 * - 원본이 화면의 ~85% 카드로 뜨고 배경은 어두운 스크림(뒤 화면 살짝 비침).
 * - 카드 안에서 핀치 줌(ScrollView 네이티브 줌) + enableLiveTextInteraction(글자 선택·복사, iOS 16+).
 * - 카드 바깥(배경)을 탭하면 닫힌다. 카드는 ScrollView 가 터치를 온전히 가져야 핀치가 되므로
 *   Pressable 로 감싸지 않고, 딤 배경 Pressable 을 카드 "뒤"에 깔아 바깥 탭만 닫히게 한다.
 */
export function ImageZoomModal({ visible, uri, onClose }: { visible: boolean; uri: string | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const [aspect, setAspect] = useState<number | null>(null);

  // 카드 크기를 원본 비율에 맞추기 위해 미리 크기를 잰다(카드 렌더 전에 필요).
  useEffect(() => {
    if (!visible || !uri) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAspect(null);
      return;
    }
    let alive = true;
    RNImage.getSize(
      toFileUri(uri),
      (w, h) => {
        if (alive) setAspect(h > 0 ? w / h : 0.75);
      },
      () => {
        if (alive) setAspect(0.75); // 실패 시 세로형 기본값
      },
    );
    return () => {
      alive = false;
    };
  }, [visible, uri]);

  // 화면의 85% 폭 / 72% 높이 안에서 원본 비율 유지.
  const maxW = width * 0.85;
  const maxH = height * 0.72;
  let cardW = maxW;
  let cardH = aspect ? maxW / aspect : maxH;
  if (aspect && cardH > maxH) {
    cardH = maxH;
    cardW = maxH * aspect;
  }

  return (
    <Modal visible={visible && !!uri} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.fill}>
        {/* 뒤: 어두운 스크림 — 바깥(배경) 탭 시 닫기 */}
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="닫기" />
        {/* 앞: 카드(중앙). 빈 영역 탭은 box-none 으로 뒤 스크림에 전달, 카드 위 탭·핀치는 ScrollView 가 처리 */}
        <View style={styles.center} pointerEvents="box-none">
          {uri && aspect ? (
            <Animated.View entering={ZoomIn.duration(180)} style={[styles.card, { width: cardW, height: cardH }]}>
              <ScrollView
                style={StyleSheet.absoluteFill}
                contentContainerStyle={{ width: cardW, height: cardH }}
                maximumZoomScale={4}
                minimumZoomScale={1}
                bouncesZoom
                centerContent
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
              >
                <Image
                  source={{ uri: toFileUri(uri) }}
                  style={{ width: cardW, height: cardH }}
                  contentFit="contain"
                  enableLiveTextInteraction
                />
              </ScrollView>
            </Animated.View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: 'transparent', // 흰 카드 플래시 방지 — 이미지 디코딩 전엔 스크림만 보임
    ...shadow.floating,
  },
});
