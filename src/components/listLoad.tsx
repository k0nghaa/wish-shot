import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, spacing, type } from '@/constants/theme';
import { showSnackbar } from '@/lib/snackbar';

// 목록 화면(전체·카테고리 홈·카테고리별·태그별·검색)의 불러오기 실패 표시 공용 부품.
// - 처음부터 못 불러옴: 목록 자리에 "불러오지 못했습니다" / "네트워크 연결을 확인하세요." / [다시 시도]
// - 이미 불러온 목록이 있음: 목록을 그대로 두고 스낵바 "불러오지 못했습니다" [다시 시도]
// - 화면에 들어올 때·다른 앱에서 돌아올 때 다시 불러오고, 목록은 당겨서 새로고침한다.
// 다시 시도 = 그 목록만 다시 불러옴(앱 새로고침 아님).

export type ListStatus = 'loading' | 'ready' | 'failed';

// 개발용(__DEV__): 목록 불러오기 실패를 흉내 낸다(설정의 개발용 버튼). 켜 두면 다음 불러오기부터 실패한다.
// 화면을 연 채로 켜면 "이미 불러온 목록 + 스낵바", 켠 채로 화면을 열면 "처음부터 못 불러옴"을 볼 수 있다.
// 모듈 상태라 컴포넌트 안에서 직접 읽지 않고 함수로만 다룬다(React Compiler).
let devListFailure = false;
export function setDevListFailure(on: boolean): void {
  devListFailure = __DEV__ && on;
}
export function isDevListFailure(): boolean {
  return devListFailure;
}

/**
 * load 는 실패하면 throw 한다(오류창을 띄우거나 삼키지 않는다).
 * 돌려주는 run 은 절대 throw 하지 않는다 — 다른 곳(일괄 이동 뒤 reload 등)에서도 그대로 부를 수 있다.
 */
export function useListLoad(load: () => Promise<void>) {
  const [status, setStatus] = useState<ListStatus>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const loadedOnce = useRef(false);
  const loadRef = useRef(load);
  const runRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const run = useCallback(async () => {
    try {
      if (isDevListFailure()) throw new Error('dev list failure');
      await loadRef.current();
      loadedOnce.current = true;
      setStatus('ready');
    } catch {
      if (loadedOnce.current) {
        showSnackbar({
          text: '불러오지 못했습니다',
          actionLabel: '다시 시도',
          onAction: () => void runRef.current(),
        });
      } else {
        setStatus('failed');
      }
    }
  }, []);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  // 화면에 들어올 때, 그리고 보이는 동안 다른 앱에서 돌아올 때.
  useFocusEffect(
    useCallback(() => {
      void run();
      const sub = AppState.addEventListener('change', (next) => {
        if (next === 'active') void run();
      });
      return () => sub.remove();
    }, [run]),
  );

  // 처음부터 못 불러온 화면의 [다시 시도].
  const retry = useCallback(async () => {
    if (!loadedOnce.current) setStatus('loading');
    await run();
  }, [run]);

  // 당겨서 새로고침.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await run();
    } finally {
      setRefreshing(false);
    }
  }, [run]);

  return { status, run, retry, refreshing, refresh };
}

/** 당겨서 새로고침 컨트롤(목록 FlatList 의 refreshControl). */
export function ListRefreshControl({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => Promise<void> }) {
  return <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.textSub} />;
}

/** 처음부터 목록을 못 불러왔을 때 목록 자리에 보이는 안내. 당겨서도 다시 불러온다. */
export function LoadFailed({
  onRetry,
  refreshing,
  onRefresh,
}: {
  onRetry: () => void;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<ListRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.box}>
        <Text style={styles.title}>불러오지 못했습니다</Text>
        <Text style={styles.description}>네트워크 연결을 확인하세요.</Text>
        <TouchableOpacity style={styles.cta} onPress={onRetry} accessibilityRole="button" accessibilityLabel="다시 시도">
          <Text style={styles.ctaText}>다시 시도</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.four },
  box: { alignItems: 'center', gap: spacing.two },
  title: { ...type.headline, color: colors.textMain, textAlign: 'center' },
  description: { ...type.subhead, color: colors.textSub, textAlign: 'center' },
  cta: {
    marginTop: spacing.three,
    paddingVertical: spacing.two,
    paddingHorizontal: spacing.four,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  ctaText: { fontSize: 15, fontWeight: '600', color: colors.bgCard },
});
