'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyOwnerJWT, COOKIE_NAME } from '@/lib/auth';

export type LoginState = { error: string } | null;

/**
 * 로그인 Server Action.
 *
 * 처리 순서:
 * 1. Supabase Auth API에 이메일/비밀번호 전달 → access_token 획득
 * 2. jose로 JWKS 기반 JWT 검증 (exp / iss / aud / sub 클레임)
 * 3. 검증 통과 시 access_token을 HttpOnly 쿠키에 저장
 * 4. 홈(/)으로 리다이렉트
 *
 * useActionState(loginAction, null) 형태로 사용:
 *   첫 번째 인수 _prevState는 이전 상태(무시)
 */
export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  const password = (formData.get('password') as string | null) ?? '';

  if (!email || !password) {
    return { error: '이메일과 비밀번호를 입력해주세요' };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return { error: '서버 설정 오류가 발생했습니다' };
  }

  // 1) Supabase Auth API 호출
  let response: Response;
  try {
    response = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
        },
        body: JSON.stringify({ email, password }),
        cache: 'no-store',
      }
    );
  } catch {
    return { error: '서버에 연결할 수 없습니다' };
  }

  if (!response.ok) {
    return { error: '이메일 또는 비밀번호가 올바르지 않습니다' };
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  const accessToken = data.access_token;
  const expiresIn = data.expires_in ?? 3600;

  if (!accessToken) {
    return { error: '인증 토큰을 받을 수 없습니다' };
  }

  // 2) jose로 JWT 검증 (exp / iss / aud / sub)
  try {
    await verifyOwnerJWT(accessToken);
  } catch (err) {
    if (err instanceof Error && err.message.includes('소유자')) {
      return { error: '소유자 계정으로만 로그인할 수 있습니다' };
    }
    console.error('[JWT 검증 오류]', err);
    return { error: '로그인 처리 중 오류가 발생했습니다' };
  }

  // 3) 검증 완료 → HttpOnly 쿠키에 저장
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: expiresIn,
    path: '/',
  });

  // 4) 홈으로 리다이렉트 (redirect는 try/catch 바깥에서 호출)
  redirect('/');
}
