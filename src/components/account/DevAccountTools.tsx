import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { isDevListFailure, setDevListFailure } from '@/components/listLoad';
import { colors, radius, spacing } from '@/constants/theme';
import {
  ACCOUNT_SIMULATION_CHOICES,
  getSimulatedChoice,
  isSimulated,
  setSimulatedChoice,
  type AccountSimulationMap,
  type SimulatedFunction,
} from '@/lib/accountSimulation';

// 설정 화면의 __DEV__ 영역: 계정 데이터 레이어(src/lib/queries/account.ts)의 결과 흉내를 고르고, 화면을 바로 연다.
// 결과 흉내: 함수마다 돌려줄 결과를 고른다(accountSimulation.ts). "해제"를 고르면 기본값·진짜 구현으로 돌아간다.

const FUNCTIONS = Object.keys(ACCOUNT_SIMULATION_CHOICES) as SimulatedFunction[];

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

// 고른 결과(고르지 않은 함수는 빠진다).
async function loadChosen(): Promise<Partial<Record<SimulatedFunction, string>>> {
  const next: Partial<Record<SimulatedFunction, string>> = {};
  for (const fn of FUNCTIONS) {
    if (await isSimulated(fn)) next[fn] = describe(await getSimulatedChoice(fn));
  }
  return next;
}

function DevButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.button} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

export function DevAccountTools() {
  const router = useRouter();
  const [chosen, setChosen] = useState<Partial<Record<SimulatedFunction, string>>>({});
  const [listFailure, setListFailure] = useState(isDevListFailure());

  const refresh = useCallback(async () => {
    setChosen(await loadChosen());
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadChosen().then((next) => {
      if (!cancelled) setChosen(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function pick<K extends SimulatedFunction>(fn: K) {
    const choices = ACCOUNT_SIMULATION_CHOICES[fn] as readonly AccountSimulationMap[K][];
    const labels = choices.map(describe);
    ActionSheetIOS.showActionSheetWithOptions(
      { title: fn, options: [...labels, '해제', '취소'], cancelButtonIndex: labels.length + 1 },
      (index) => {
        if (index < labels.length) void setSimulatedChoice(fn, choices[index]).then(refresh);
        else if (index === labels.length) void setSimulatedChoice(fn, null).then(refresh);
      },
    );
  }

  // 기기 상태를 골라 로그인 화면(첫 화면)을 연다 — A(첫 실행)·B(최근 로그인)·C+D(끊긴 세션).
  async function openSignInAs(state: AccountSimulationMap['getStartState']) {
    await setSimulatedChoice('getStartState', state);
    await refresh();
    router.push('/sign-in');
  }

  function toggleListFailure() {
    const next = !listFailure;
    setDevListFailure(next);
    setListFailure(next);
    Alert.alert(
      '목록 불러오기 실패 흉내',
      next
        ? '켜짐 — 다음 불러오기부터 실패합니다. 목록 화면을 새로 열면 "불러오지 못했습니다" 안내, 이미 불러온 화면에서 당겨 새로고침하면 스낵바가 보입니다.'
        : '꺼짐',
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>계정 결과 흉내(개발용)</Text>
      {FUNCTIONS.map((fn) => (
        <TouchableOpacity
          key={fn}
          style={styles.pickRow}
          onPress={() => pick(fn)}
          accessibilityRole="button"
          accessibilityLabel={`${fn} 결과 고르기(개발용)`}
        >
          <Text style={styles.pickName}>{fn}</Text>
          <Text style={styles.pickValue} numberOfLines={1}>
            {chosen[fn] ?? '기본'}
          </Text>
        </TouchableOpacity>
      ))}

      <Text style={styles.heading}>계정 화면 열기(개발용)</Text>
      <DevButton label="로그인 화면 — 첫 실행·공유(확인창 A)" onPress={() => void openSignInAs({ kind: 'fresh' })} />
      <DevButton
        label="로그인 화면 — 로그아웃(최근 로그인 Apple, 확인창 B)"
        onPress={() => void openSignInAs({ kind: 'signed_out', lastProvider: 'apple' })}
      />
      <DevButton
        label="로그인 화면 — 로그인 세션 만료(최근 로그인 카카오, 확인창 B)"
        onPress={() => void openSignInAs({ kind: 'signed_out', lastProvider: 'kakao' })}
      />
      <DevButton
        label="로그인 화면 — 익명 세션 끊김(알림창 C, 확인창 D)"
        onPress={() => void openSignInAs({ kind: 'session_lost', previousUserId: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90' })}
      />
      <DevButton
        label="로그인 모달 — 설정·반시트·로그인 전용 기능(닫기 X)"
        onPress={() => router.push({ pathname: '/account/sign-in', params: { from: 'settings' } })}
      />
      <DevButton
        label="반시트 — 위시 개수 있음(12개)"
        onPress={() => router.push({ pathname: '/account/sign-in-sheet', params: { count: '12' } })}
      />
      <DevButton
        label="반시트 — 위시 개수 없음"
        onPress={() => router.push({ pathname: '/account/sign-in-sheet', params: { count: '0' } })}
      />
      <DevButton label="닉네임 — 가입([완료])" onPress={() => router.push({ pathname: '/account/nickname', params: { mode: 'signup' } })} />
      <DevButton label="닉네임 — 편집([저장])" onPress={() => router.push({ pathname: '/account/nickname', params: { mode: 'edit' } })} />
      <DevButton label="합치는 중" onPress={() => router.push('/account/merging')} />
      <DevButton label="계정 삭제 안내(위시 12개)" onPress={() => router.push({ pathname: '/account/delete', params: { count: '12' } })} />
      <DevButton label="삭제하는 중" onPress={() => router.push('/account/deleting')} />
      <DevButton label={`목록 불러오기 실패 흉내 ${listFailure ? '끄기' : '켜기'}`} onPress={toggleListFailure} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.four, gap: spacing.two },
  heading: { fontSize: 13, fontWeight: '600', color: colors.textSub, marginTop: spacing.two },
  button: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.silver,
    paddingVertical: spacing.three,
    paddingHorizontal: spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15, color: colors.textSub, textAlign: 'center' },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.three,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.silver,
    paddingVertical: spacing.two,
    paddingHorizontal: spacing.three,
  },
  pickName: { fontSize: 14, color: colors.textMain },
  pickValue: { fontSize: 13, color: colors.textSub, flexShrink: 1 },
});
