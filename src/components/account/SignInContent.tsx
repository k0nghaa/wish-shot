import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SignInButtons } from '@/components/account/SignInButtons';
import { otherProviderMessage, useProviderSignIn } from '@/components/account/useProviderSignIn';
import { colors, spacing, type } from '@/constants/theme';
import { capture, type SignInEntry } from '@/lib/analytics';
import { retryLostSession, startWithoutSignIn, type SignInProvider } from '@/lib/queries';
import { inquiryNumber, lostAccountMailUrl, SUPPORT_EMAIL } from '@/lib/supportMail';

// 개인정보처리방침 게시 주소(docs/legal/privacy.html 의 GitHub Pages 게시본).
export const PRIVACY_POLICY_URL = 'https://k0nghaa.github.io/wish-shot/legal/privacy.html';

/** 확인창: A 첫 실행·공유 / B 로그아웃·세션 만료 / D 끊긴 익명 세션. */
export type SkipAlert = 'A' | 'B' | 'D';

const SKIP_ALERT_BODY: Record<SkipAlert, string> = {
  A: '로그인하지 않으면 앱을 삭제하거나 기기를 바꿀 때 위시를 되찾을 수 없습니다. 로그인은 설정에서 언제든 할 수 있습니다.',
  B: '이전 계정의 위시는 다시 로그인해야 볼 수 있습니다. 지금부터 담는 위시는 나중에 로그인하면 계정에 합쳐집니다.',
  D: '이전 위시는 문의로만 되찾을 수 있습니다.',
};

type Props = {
  entry: SignInEntry;
  /** 하단: 로그인 없이 시작(확인창 A·B·D) 또는 닫기(X). */
  bottom: { kind: 'skip'; alert: SkipAlert } | { kind: 'close'; onClose: () => void };
  /** 썼던 수단 — 그 버튼에 "최근 로그인". */
  lastProvider?: SignInProvider | null;
  /** 끊긴 익명 세션이면 열릴 때 알림창 C. 값은 이전 계정 id(문의 번호용, 없을 수 있음). */
  lostSession?: { previousUserId: string | null } | null;
  /** 로그인 성공(닉네임·합치기가 아닌 경우)·로그인 없이 시작 성공 뒤 — 원래 가려던 화면으로. */
  onDone: () => void;
};

/**
 * 로그인 화면 본체 — 첫 화면(sign-in)과 설정·로그인 전용 기능에서 연 모달(account/sign-in)이 같이 쓴다.
 * 설명 문구·제목은 두지 않는다(로고 + 버튼 + 하단 링크).
 */
export function SignInContent({ entry, bottom, lastProvider, lostSession, onDone }: Props) {
  const { busy, conflict, press } = useProviderSignIn({ onDone });
  const [starting, setStarting] = useState(false);
  const shown = useRef(false);

  // 노출 계측 + 열릴 때 알림창 C(1회).
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    capture('sign_in_viewed', { surface: 'screen', entry });
    if (lostSession) showLostSessionAlert(lostSession.previousUserId, onDone);
  }, [entry, lostSession, onDone]);

  const skipAlert = bottom.kind === 'skip' ? bottom.alert : null;

  function confirmSkip() {
    if (!skipAlert) return;
    Alert.alert('로그인 없이 시작할까요?', SKIP_ALERT_BODY[skipAlert], [
      { text: '취소', style: 'cancel' },
      { text: '시작', onPress: () => void start() },
    ]);
  }

  async function start() {
    setStarting(true);
    try {
      const result = await startWithoutSignIn();
      if (result.kind === 'success') {
        capture('sign_in_skipped', { surface: 'screen', entry });
        onDone();
      } else {
        Alert.alert('시작하지 못했습니다', '네트워크 연결을 확인하세요.', [{ text: '확인' }]);
      }
    } catch {
      Alert.alert('시작하지 못했습니다', '네트워크 연결을 확인하세요.', [{ text: '확인' }]);
    } finally {
      setStarting(false);
    }
  }

  function close() {
    if (bottom.kind !== 'close') return;
    capture('sign_in_skipped', { surface: 'screen', entry });
    bottom.onClose();
  }

  const disabled = busy !== null || starting;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      {bottom.kind === 'close' ? (
        <View style={styles.closeRow}>
          <TouchableOpacity onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="닫기">
            <SymbolView name="xmark" size={20} tintColor={colors.textMain} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.closeRow} />
      )}

      <View style={styles.center}>
        <Image
          source={require('../../../assets/images/logo.png')}
          style={styles.logo}
          contentFit="contain"
          accessibilityLabel="WishShot"
        />
        <View style={styles.buttons}>
          <SignInButtons lastProvider={lastProvider} busy={busy} onPress={(p) => void press(p)} />
          {conflict ? (
            <Text style={styles.conflict} accessibilityRole="alert">
              {otherProviderMessage(conflict)}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.footer}>
        {bottom.kind === 'skip' ? (
          <TouchableOpacity
            style={styles.link}
            onPress={confirmSkip}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="로그인 없이 시작"
            accessibilityState={{ disabled, busy: starting }}
          >
            <Text style={[styles.skipText, disabled && styles.dim]}>로그인 없이 시작</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.link}
          onPress={() => void Linking.openURL(PRIVACY_POLICY_URL).catch(() => {})}
          accessibilityRole="link"
          accessibilityLabel="개인정보처리방침"
        >
          <Text style={styles.privacyText}>개인정보처리방침</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// 알림창 C: 서버가 이 기기의 익명 세션을 거절함. 다시 시도 = 세션 재확인(통신, 앱 새로고침 아님):
// restored 면 데이터 레이어가 기기 상태를 되돌려 알렸으니 로그인 화면을 떠난다(onRestored — 전체 탭) / still_lost 면 창을 다시 띄운다 /
// error 면 네트워크 안내.
function showLostSessionAlert(previousUserId: string | null, onRestored: () => void) {
  Alert.alert('계정을 확인하지 못했습니다', '이 기기에 저장된 계정을 서버에서 찾을 수 없습니다.', [
    {
      text: '문의하기',
      onPress: () => {
        Linking.openURL(lostAccountMailUrl(previousUserId)).catch(() => {
          const number = inquiryNumber(previousUserId);
          Alert.alert('메일 열기 실패', `문의 주소: ${SUPPORT_EMAIL}${number ? `\n문의 번호: ${number}` : ''}`);
        });
      },
    },
    {
      text: '다시 시도',
      onPress: () => {
        retryLostSession()
          .then((result) => {
            if (result.kind === 'restored') onRestored();
            else if (result.kind === 'still_lost') showLostSessionAlert(previousUserId, onRestored);
            else if (result.kind === 'error') {
              Alert.alert('계정을 확인하지 못했습니다', '네트워크 연결을 확인하세요.', [{ text: '확인' }]);
            }
          })
          .catch(() => {
            Alert.alert('계정을 확인하지 못했습니다', '네트워크 연결을 확인하세요.', [{ text: '확인' }]);
          });
      },
    },
    { text: '확인', style: 'cancel' },
  ]);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.four },
  closeRow: { height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.five },
  logo: { width: 200, height: 53 }, // 600×160 원본 비율(3.75:1) 유지
  buttons: { alignSelf: 'stretch', gap: spacing.three },
  conflict: { ...type.footnote, color: colors.error, textAlign: 'center' },
  footer: { alignItems: 'center', paddingBottom: spacing.two },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.three },
  skipText: { ...type.subhead, color: colors.textSub },
  privacyText: { ...type.footnote, color: colors.textSub, textDecorationLine: 'underline' },
  dim: { opacity: 0.5 },
});
