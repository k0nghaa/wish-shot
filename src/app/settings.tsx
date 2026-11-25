import { reloadAppAsync } from 'expo';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DisclosureRow, FormCard } from '@/components/FormField';
import { resetOnboarding } from '@/components/Onboarding/onboardingStorage';
import { PRIVACY_NOTICE } from '@/constants/privacy';
import { colors, spacing } from '@/constants/theme';
import { isAnalyticsAvailable, isCaptureEnabled, setCaptureEnabled } from '@/lib/analytics';
import { isMonitoringEnabled, triggerNativeCrashForTest } from '@/lib/monitoring';
import { readImageBytes } from '@/lib/imageBytes';
import { makeThumbnail } from '@/lib/imageResize';
import {
  devSimulateFreshInstall,
  devSimulateSessionProblem,
  getCurrentUserId,
  getItemImageSignedUrl,
  listItems,
  signInAnonymouslyIfNeeded,
  signOut,
  uploadItemImageThumb,
} from '@/lib/queries';
import { feedbackMailUrl, SUPPORT_EMAIL } from '@/lib/supportMail';

export default function SettingsScreen() {
  const router = useRouter();
  // 렌더 오류 검증용(__DEV__ 전용): 켜면 다음 렌더에서 throw — 루트 경계가 받아 전역 오류 처리로 넘기는지 확인한다.
  const [renderErrorTest, setRenderErrorTest] = useState(false);
  if (renderErrorTest) throw new Error('렌더 오류 검증용 테스트 에러');

  // 의견 보내기: 앱 안 피드백 경로는 메일 하나다. 모든 사용자에게 보인다.
  function handleSendFeedback() {
    Linking.openURL(feedbackMailUrl()).catch(() => {
      Alert.alert('메일 열기 실패', `${SUPPORT_EMAIL} 으로 보내주세요.`);
    });
  }

  // 개발용 세션 리셋: 현재 세션을 버리고 새 익명 세션으로 시작한다. 익명 경로를 재설치 없이
  // 즉시 테스트하기 위한 것 — __DEV__ 에서만 노출된다.
  // 재익명 로그인까지 await 한 뒤 전체 탭(/)으로 이동해, 새 세션으로 재로드되게 한다(레이스 방지).
  async function handleDevReset() {
    try {
      await signOut();
      await signInAnonymouslyIfNeeded();
      router.replace('/');
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : '세션 초기화에 실패했습니다.');
    }
  }

  // 시작 화면 확인용(__DEV__ 전용): 개발용 앱은 Metro 에서 JS 를 받아 비행기 모드로 다시 켤 수 없어서,
  // 연결 실패·서버 거절·새 설치를 흉내 낸 뒤 앱을 다시 시작해 연결 실패·끊긴 세션 화면을 본다.
  // "적용"만 누르면 앱을 끈 뒤 공유 시트로 열어 공유로 연 실행을 확인할 수 있다.
  function runDevSimulation(apply: () => Promise<void>, restart: boolean) {
    apply()
      .then(() =>
        restart
          ? reloadAppAsync()
          : Alert.alert('적용했습니다', '앱을 완전히 끈 뒤 홈 화면이나 공유 시트에서 여세요.')
      )
      .catch((e) => Alert.alert('오류', e instanceof Error ? e.message : '적용하지 못했습니다.'));
  }

  const simulateOffline = (restart: boolean) =>
    runDevSimulation(() => devSimulateSessionProblem('offline'), restart);

  function handleDevSimulateOffline() {
    Alert.alert(
      '연결 실패 흉내',
      '다시 시작할 때까지, 그리고 다음 실행 40초 동안 연결이 끊긴 것처럼 보입니다. 저장된 세션은 만료된 것으로 바뀝니다.',
      [
        { text: '취소', style: 'cancel' },
        { text: '적용', onPress: () => simulateOffline(false) },
        { text: '적용 후 다시 시작', onPress: () => simulateOffline(true) },
      ]
    );
  }

  function handleDevSimulateReject() {
    Alert.alert(
      '서버 거절 흉내',
      '다음 실행에서 서버가 세션을 거절한 것처럼 보입니다. 다시 시도하면 지금 계정으로 돌아오고, 새로 시작하면 새 계정이 됩니다. 이 기기에 위시를 저장한 흔적(등록 화면에서 사진을 고른 기록 등)이 없으면 화면 없이 바로 새 계정이 됩니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '적용 후 다시 시작',
          onPress: () => runDevSimulation(() => devSimulateSessionProblem('reject'), true),
        },
      ]
    );
  }

  function handleDevSimulateFreshInstall() {
    Alert.alert(
      '새 설치 흉내',
      '앱을 지운 것처럼 기기의 세션과 기록을 모두 지우고, 다음 실행 40초 동안 연결이 끊긴 것처럼 보입니다. 지금 계정은 이 기기에서 되찾을 수 없습니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '지우고 다시 시작',
          style: 'destructive',
          onPress: () => runDevSimulation(devSimulateFreshInstall, true),
        },
      ]
    );
  }

  // 온보딩 재검증용: 플래그를 지워 다음 앱 실행 시 온보딩이 다시 뜨게 한다(__DEV__ 전용).
  // 온보딩 게이트는 앱 최초 마운트 시 1회만 판단하므로 즉시 노출이 아니라 재시작 후 노출된다.
  async function handleResetOnboarding() {
    await resetOnboarding();
    Alert.alert('온보딩 초기화', '앱을 다시 시작하면 온보딩이 표시됩니다.');
  }

  // 썸네일 백필(__DEV__ 전용): 기존 아이템의 원본에서 400px 썸네일을 만들어 올린다.
  // RLS 로 본인 아이템만 대상(전역 백필 불가·불필요 — 실사용자 레거시는 그리드 원본 폴백으로 커버).
  async function handleBackfillThumbs() {
    try {
      const userId = await getCurrentUserId();
      const items = await listItems();
      let done = 0;
      let failed = 0;
      for (const it of items) {
        try {
          const url = await getItemImageSignedUrl(it.image_key); // 원본 signed URL
          const thumbUri = await makeThumbnail(url); // manipulateAsync 가 원격 URL 을 받아 400px 생성
          const bytes = await readImageBytes(thumbUri);
          await uploadItemImageThumb(userId, it.id, bytes);
          done++;
        } catch {
          failed++;
        }
      }
      Alert.alert('썸네일 백필', `완료 ${done} · 실패 ${failed}`);
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : '백필에 실패했습니다.');
    }
  }

  // 계측 토글(__DEV__ 전용): 개발 기기는 기본 옵트아웃이라 실발화 검증 때만 수동으로 켠다.
  // 상태는 PostHog 가 영속하므로(optIn/optOut) 재시작 후에도 유지된다.
  async function handleDevToggleAnalytics() {
    if (!isAnalyticsAvailable()) {
      Alert.alert('계측 비활성', 'PostHog 키가 설정되지 않았습니다(.env 확인).');
      return;
    }
    const next = !isCaptureEnabled();
    await setCaptureEnabled(next);
    Alert.alert('계측(개발용)', next ? '이벤트 수집 켜짐' : '이벤트 수집 꺼짐');
  }

  // app_error 검증용(__DEV__ 전용): 의도적 미처리 throw —
  // redbox 가 정상 표시되고(핸들러 체이닝 확인) PostHog 에 app_error 가 수신돼야 한다.
  function handleDevTestError() {
    setTimeout(() => {
      throw new Error('계측 검증용 테스트 에러');
    }, 0);
  }

  // 네이티브 크래시 검증용(__DEV__ 전용): 앱이 즉시 종료되고, 다음 실행 때 Sentry 로 보고된다.
  // Sentry 는 __DEV__ 에서 기본 비활성이라 EXPO_PUBLIC_SENTRY_DEV=1 로 띄웠을 때만 동작한다.
  function handleDevNativeCrash() {
    if (!isMonitoringEnabled()) {
      Alert.alert('Sentry 비활성', 'EXPO_PUBLIC_SENTRY_DSN 과 EXPO_PUBLIC_SENTRY_DEV=1 이 필요합니다(.env 확인).');
      return;
    }
    Alert.alert('네이티브 크래시', '앱이 바로 종료됩니다. 다시 열면 Sentry 로 보고됩니다.', [
      { text: '취소', style: 'cancel' },
      { text: '종료', style: 'destructive', onPress: triggerNativeCrashForTest },
    ]);
  }

  // 익명 로그인이라 계정·로그아웃 개념이 없다 — 개인정보 안내만 둔다.
  // 이메일 가입·계정 연결·로그아웃은 로그인을 도입할 때 넣는다.
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="뒤로">
          <Text style={styles.back}>‹ 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.title}>설정</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>개인정보 안내</Text>
        <View style={styles.card}>
          <Text style={styles.noticeTitle}>{PRIVACY_NOTICE.title}</Text>
          {PRIVACY_NOTICE.sections.map((s) => (
            <View key={s.heading} style={styles.noticeSection}>
              <Text style={styles.noticeHeading}>{s.heading}</Text>
              <Text style={styles.noticeBody}>{s.body}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>지원</Text>
        <FormCard>
          <DisclosureRow label="의견 보내기" value={SUPPORT_EMAIL} onPress={handleSendFeedback} />
        </FormCard>

        {__DEV__ ? (
          <View style={styles.devSection}>
            <TouchableOpacity
              style={styles.devButton}
              onPress={handleDevReset}
              accessibilityRole="button"
              accessibilityLabel="세션 초기화(개발용)"
            >
              <Text style={styles.devButtonText}>세션 초기화(개발용)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devButton}
              onPress={() => router.push('/login')}
              accessibilityRole="button"
              accessibilityLabel="이메일 로그인(개발용)"
            >
              <Text style={styles.devButtonText}>이메일 로그인(개발용)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devButton}
              onPress={handleDevSimulateOffline}
              accessibilityRole="button"
              accessibilityLabel="연결 실패 흉내(개발용)"
            >
              <Text style={styles.devButtonText}>연결 실패 흉내(개발용)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devButton}
              onPress={handleDevSimulateReject}
              accessibilityRole="button"
              accessibilityLabel="서버 거절 흉내(개발용)"
            >
              <Text style={styles.devButtonText}>서버 거절 흉내(개발용)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devButton}
              onPress={handleDevSimulateFreshInstall}
              accessibilityRole="button"
              accessibilityLabel="새 설치 흉내(개발용)"
            >
              <Text style={styles.devButtonText}>새 설치 흉내(개발용)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devButton}
              onPress={handleResetOnboarding}
              accessibilityRole="button"
              accessibilityLabel="온보딩 다시 보기(개발용)"
            >
              <Text style={styles.devButtonText}>온보딩 다시 보기(개발용)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devButton}
              onPress={handleBackfillThumbs}
              accessibilityRole="button"
              accessibilityLabel="썸네일 백필(개발용)"
            >
              <Text style={styles.devButtonText}>썸네일 백필(개발용)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devButton}
              onPress={handleDevToggleAnalytics}
              accessibilityRole="button"
              accessibilityLabel="계측 토글(개발용)"
            >
              <Text style={styles.devButtonText}>계측 토글(개발용)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devButton}
              onPress={handleDevTestError}
              accessibilityRole="button"
              accessibilityLabel="테스트 에러 발생(개발용)"
            >
              <Text style={styles.devButtonText}>테스트 에러 발생(개발용)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devButton}
              onPress={handleDevNativeCrash}
              accessibilityRole="button"
              accessibilityLabel="네이티브 크래시 테스트(개발용)"
            >
              <Text style={styles.devButtonText}>네이티브 크래시 테스트(개발용)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devButton}
              onPress={() => setRenderErrorTest(true)}
              accessibilityRole="button"
              accessibilityLabel="렌더 오류 테스트(개발용)"
            >
              <Text style={styles.devButtonText}>렌더 오류 테스트(개발용)</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.three,
    paddingTop: spacing.two,
    paddingBottom: spacing.two,
  },
  back: { fontSize: 16, color: colors.primary, width: 72 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.textMain, textAlign: 'center' },
  headerSpacer: { width: 72 },
  content: { padding: spacing.three, gap: spacing.two, paddingBottom: spacing.six },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSub,
    marginTop: spacing.three,
    marginBottom: spacing.one,
  },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.silver,
    padding: spacing.three,
    gap: spacing.two,
  },
  noticeTitle: { fontSize: 15, fontWeight: '600', color: colors.textMain },
  noticeSection: { gap: spacing.one },
  noticeHeading: { fontSize: 14, fontWeight: '600', color: colors.textMain },
  noticeBody: { fontSize: 14, color: colors.textSub, lineHeight: 21 },
  devSection: {
    marginTop: spacing.four,
    gap: spacing.two,
  },
  devButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.silver,
    paddingVertical: spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  devButtonText: { fontSize: 15, color: colors.textSub },
});
