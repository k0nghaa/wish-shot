import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/constants/theme';

/**
 * 모든 탭(전체·폴더·검색) 타이틀 위에 공통으로 얹는 로고 슬롯.
 * right 슬롯은 폴더 탭의 설정 기어처럼 우측 액세서리를 넣을 때 쓴다.
 */
export function TabHeaderLogo({ right }: { right?: ReactNode }) {
  return (
    <View style={styles.bar}>
      <Image
        source={require('../../assets/images/logo.png')}
        style={styles.logo}
        contentFit="contain"
        accessibilityLabel="WishShot"
      />
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.three,
    paddingTop: spacing.two,
    paddingBottom: spacing.one,
  },
  logo: { width: 90, height: 24 }, // 600×160 원본 비율(3.75:1) 유지
  right: {
    position: 'absolute',
    right: spacing.three,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
});
