import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from '@/constants/theme';

/**
 * 모든 탭(전체·폴더·검색) 타이틀 위에 공통으로 얹는 로고 슬롯.
 * 지금은 자리표시([로고/심볼 추가 예정]). 나중에 이 컴포넌트 내부만 교체하면 전 탭에 반영된다.
 * right 슬롯은 폴더 탭의 설정 기어처럼 우측 액세서리를 넣을 때 쓴다.
 */
export function TabHeaderLogo({ right }: { right?: ReactNode }) {
  return (
    <View style={styles.bar}>
      <View style={styles.slot}>
        <Text style={styles.text}>[로고/심볼 추가 예정]</Text>
      </View>
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
  slot: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.silver,
    borderStyle: 'dashed',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.two,
    paddingVertical: spacing.half,
  },
  text: { ...type.caption, color: colors.textSub },
  right: {
    position: 'absolute',
    right: spacing.three,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
});
