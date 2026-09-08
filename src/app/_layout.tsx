import { Stack } from 'expo-router';

// Phase 1 Step 2: 최소 라우팅 골격.
// Step 3에서 세션 유무에 따른 /login ↔ / 라우팅 가드를 여기에 추가한다.
export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
