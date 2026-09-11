import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import type { Database } from '@/types/database';

// URL/키는 .env의 EXPO_PUBLIC_* 에서 읽는다. anon 키만 사용하며 service_role 키는
// 앱에 절대 넣지 않는다. (CLAUDE.md 규칙 2)
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase 환경 변수가 없어요. .env에 EXPO_PUBLIC_SUPABASE_URL과 EXPO_PUBLIC_SUPABASE_ANON_KEY를 설정해 주세요.',
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage, // 세션을 기기에 저장 → 앱 재시작 후에도 로그인 유지
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // React Native에서는 꺼둔다 (브라우저 전용 옵션)
  },
});

// 앱이 포그라운드(active)일 때만 토큰을 자동 갱신한다. (Supabase 공식 가이드 권장)
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
