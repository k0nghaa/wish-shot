import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ImageStyle, ViewStyle } from 'react-native';

import { colors } from '@/constants/theme';

/**
 * signed URL 을 받아 이미지를 렌더한다. url 이 없으면(미발급/실패) 실버 플레이스홀더.
 * signed URL 발급은 화면에서 배치로 처리하고, 이 컴포넌트는 결과만 그린다(dumb).
 *
 * Phase 9 D — 썸네일 폴백: 그리드는 썸네일(url)을 우선 쓰되, 썸네일 객체가 없어(레거시/백필 전)
 * 로드에 실패하면 원본(fallbackUrl)으로 1회 교체해 화면이 비지 않게 한다(불변식 4).
 * failedUrl 을 현재 url 과 비교해, FlatList 타일 재활용으로 url 이 바뀌면 폴백 상태가 자동 리셋된다.
 */
export function Thumbnail({
  url,
  fallbackUrl,
  style,
}: {
  url: string | null;
  fallbackUrl?: string | null;
  style?: StyleProp<ImageStyle & ViewStyle>;
}) {
  const primary = url ?? fallbackUrl ?? null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const useFallback = !!primary && !!fallbackUrl && fallbackUrl !== primary && failedUrl === primary;
  const activeUrl = useFallback ? fallbackUrl : primary;

  if (!activeUrl) {
    return <View style={[styles.placeholder, style]} accessibilityLabel="이미지 없음" />;
  }
  return (
    <Image
      source={{ uri: activeUrl }}
      style={style}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey={activeUrl}
      transition={150}
      onError={() => {
        // 썸네일 로드 실패 시에만 원본으로 폴백(원본 바이트는 이때만 내려온다).
        if (fallbackUrl && fallbackUrl !== primary) setFailedUrl(primary);
      }}
      accessibilityIgnoresInvertColors
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: colors.placeholder,
  },
});
