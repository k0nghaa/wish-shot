import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ImageStyle, ViewStyle } from 'react-native';

import { colors } from '@/constants/theme';

/**
 * signed URL 을 받아 이미지를 렌더한다. url 이 없으면(미발급/실패) 실버 플레이스홀더.
 * signed URL 발급은 화면에서 배치로 처리하고, 이 컴포넌트는 결과만 그린다(dumb).
 */
export function Thumbnail({
  url,
  style,
}: {
  url: string | null;
  style?: StyleProp<ImageStyle & ViewStyle>;
}) {
  if (!url) {
    return <View style={[styles.placeholder, style]} accessibilityLabel="이미지 없음" />;
  }
  return (
    <Image
      source={{ uri: url }}
      style={style}
      contentFit="cover"
      transition={150}
      accessibilityIgnoresInvertColors
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: colors.silver,
  },
});
