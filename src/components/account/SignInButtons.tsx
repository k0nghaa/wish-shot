import * as AppleAuthentication from 'expo-apple-authentication';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { brand, colors, radius, spacing, type } from '@/constants/theme';
import type { SignInProvider } from '@/lib/queries';

// Apple 버튼은 다른 로그인 버튼보다 작지 않게(Apple HIG), 최소 너비 140pt. 두 버튼은 같은 크기로 세로로 둔다.
export const SIGN_IN_BUTTON_HEIGHT = 52;

type Props = {
  /** 마지막으로 쓴 수단 — 이 버튼에만 "최근 로그인"을 붙인다. */
  lastProvider?: SignInProvider | null;
  /** 로그인 중인 수단(스피너). 있으면 두 버튼 모두 눌리지 않는다. */
  busy: SignInProvider | null;
  onPress: (provider: SignInProvider) => void;
};

/** Apple로 로그인 + 카카오 로그인 — 로그인 화면과 반시트가 같은 부품을 쓴다. */
export function SignInButtons({ lastProvider = null, busy, onPress }: Props) {
  const disabled = busy !== null;
  return (
    <View style={styles.wrap}>
      <View style={styles.slot}>
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={radius.md}
          style={[styles.apple, disabled && styles.disabled]}
          onPress={() => {
            if (!disabled) onPress('apple');
          }}
        />
        {busy === 'apple' ? (
          <View style={styles.busy} pointerEvents="none">
            <ActivityIndicator color={colors.bg} />
          </View>
        ) : null}
        {lastProvider === 'apple' ? <RecentBadge /> : null}
      </View>

      <View style={styles.slot}>
        <TouchableOpacity
          style={[styles.kakao, disabled && styles.disabled]}
          onPress={() => onPress('kakao')}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="카카오 로그인"
          accessibilityState={{ disabled, busy: busy === 'kakao' }}
        >
          {busy === 'kakao' ? (
            <ActivityIndicator color={brand.kakaoSymbol} />
          ) : (
            <>
              <SymbolView name="message.fill" size={18} tintColor={brand.kakaoSymbol} />
              <Text style={styles.kakaoText}>카카오 로그인</Text>
            </>
          )}
        </TouchableOpacity>
        {lastProvider === 'kakao' ? <RecentBadge /> : null}
      </View>
    </View>
  );
}

function RecentBadge() {
  return (
    <View style={styles.badge} pointerEvents="none">
      <Text style={styles.badgeText}>최근 로그인</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: spacing.two },
  slot: { alignSelf: 'stretch' },
  apple: { height: SIGN_IN_BUTTON_HEIGHT, minWidth: 140, alignSelf: 'stretch' },
  kakao: {
    height: SIGN_IN_BUTTON_HEIGHT,
    minWidth: 140,
    borderRadius: radius.md,
    backgroundColor: brand.kakaoBackground,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.two,
  },
  kakaoText: { ...type.headline, color: brand.kakaoLabel },
  disabled: { opacity: 0.6 },
  busy: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -10,
    right: spacing.three,
    paddingHorizontal: spacing.two,
    paddingVertical: spacing.half,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.silver,
  },
  badgeText: { ...type.caption, fontWeight: '600', color: colors.textMain },
});
