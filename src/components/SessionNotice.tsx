import { reloadAppAsync } from 'expo';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { colors, spacing, type } from '@/constants/theme';
import { startOver } from '@/lib/queries';
import { inquiryNumber, lostAccountMailUrl, SUPPORT_EMAIL } from '@/lib/supportMail';

// 앱 시작 때 세션을 확인하지 못했을 때의 두 화면(AuthGate 가 띄운다). 그 뒤 세션이 오면 AuthGate 가 저절로 앱으로 넘긴다.
// 다시 시도 = 앱 새로고침. 같은 실행에서 시작 판정만 다시 부르면 auth-js 가 60초 동안 저장해 둔 실패를 돌려준다.

function reload() {
  reloadAppAsync().catch(() => {});
}

/** 연결 실패: 세션이나 사본이 있는데 확인하지 못함, 또는 새 설치의 가입 실패. */
export function OfflineScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        연결하지 못했습니다
      </Text>
      <Text style={styles.body}>네트워크 연결을 확인하세요.</Text>
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primary}
          onPress={reload}
          accessibilityRole="button"
          accessibilityLabel="다시 시도"
          accessibilityHint="앱을 다시 불러옵니다."
        >
          <Text style={styles.primaryText}>다시 시도</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** 끊긴 세션: 서버가 세션을 거절했거나 저장값이 사라짐. 새 계정은 사용자가 "새로 시작"을 고를 때만 만든다. */
export function LostSessionScreen({ userId }: { userId: string | null }) {
  const [starting, setStarting] = useState(false);

  async function handleStartOver() {
    setStarting(true);
    try {
      await startOver(); // 새 세션이 오면 AuthGate 가 앱으로 넘긴다
    } catch {
      setStarting(false);
      Alert.alert('새로 시작하지 못했습니다', '네트워크 연결을 확인하세요.');
    }
  }

  function confirmStartOver() {
    Alert.alert('새로 시작할까요?', '기존 위시를 다시 보지 못합니다. 찾으려면 먼저 문의하세요.', [
      { text: '취소', style: 'cancel' },
      { text: '새로 시작', style: 'destructive', onPress: () => void handleStartOver() },
    ]);
  }

  function handleInquiry() {
    Linking.openURL(lostAccountMailUrl(userId)).catch(() => {
      const number = inquiryNumber(userId);
      Alert.alert(
        '메일 열기 실패',
        `${SUPPORT_EMAIL} 으로 보내주세요.${number ? `\n문의 번호: ${number}` : ''}`
      );
    });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        계정을 확인하지 못했습니다
      </Text>
      <Text style={styles.body}>이 기기에 저장된 계정으로 접속할 수 없습니다.</Text>
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.primary, starting && styles.disabled]}
          onPress={reload}
          disabled={starting}
          accessibilityRole="button"
          accessibilityLabel="다시 시도"
          accessibilityHint="앱을 다시 불러옵니다."
        >
          <Text style={styles.primaryText}>다시 시도</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondary, starting && styles.disabled]}
          onPress={confirmStartOver}
          disabled={starting}
          accessibilityRole="button"
          accessibilityLabel="새로 시작"
          accessibilityHint="새 계정으로 시작합니다."
          accessibilityState={{ busy: starting, disabled: starting }}
        >
          {starting ? (
            <ActivityIndicator color={colors.textMain} />
          ) : (
            <Text style={styles.secondaryText}>새로 시작</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.textButton}
          onPress={handleInquiry}
          disabled={starting}
          accessibilityRole="button"
          accessibilityLabel="문의"
          accessibilityHint="메일 앱을 엽니다."
        >
          <Text style={styles.textButtonText}>문의</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.four,
    gap: spacing.two,
    backgroundColor: colors.bg,
  },
  title: { ...type.title, color: colors.textMain, textAlign: 'center' },
  body: { ...type.subhead, color: colors.textSub, textAlign: 'center' },
  actions: { alignSelf: 'stretch', marginTop: spacing.four, gap: spacing.two },
  primary: {
    minHeight: 50,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { ...type.headline, color: colors.bg },
  secondary: {
    minHeight: 50,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.silver,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { ...type.headline, color: colors.textMain },
  textButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  textButtonText: { ...type.body, color: colors.textMain },
  disabled: { opacity: 0.6 },
});
