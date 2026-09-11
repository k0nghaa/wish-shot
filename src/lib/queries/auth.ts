import { supabase } from '@/lib/supabase';

/**
 * 현재 로그인한 사용자의 id 를 반환한다. 로그인 상태가 아니면 에러를 던진다.
 *
 * INSERT 시 `user_id` 를 채우는 데 쓴다. RLS 의 `with check (user_id = auth.uid())` 가
 * DB 에서 한 번 더 강제하므로, 여기서 넣는 값은 편의일 뿐 신뢰의 근거가 아니다.
 * getSession() 은 로컬(AsyncStorage) 세션을 읽어 네트워크 왕복이 없다.
 */
export async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(`세션을 확인하지 못했어요: ${error.message}`);
  const userId = data.session?.user.id;
  if (!userId) throw new Error('로그인이 필요해요.');
  return userId;
}
