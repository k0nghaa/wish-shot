import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const COOKIE_NAME = 'wishshot-session';

/**
 * Edge 런타임에서 실행되는 인증 미들웨어.
 *
 * jose로 Supabase JWKS를 이용해 JWT를 검증합니다 (exp/iss/aud/sub).
 * /login은 항상 허용하고, 그 외 경로는 소유자 토큰이 필요합니다.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 로그인 페이지는 인증 없이 허용
  if (pathname === '/login') {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const ownerUid = process.env.OWNER_UID;

    if (!supabaseUrl || !ownerUid) {
      throw new Error('환경 변수가 설정되지 않았습니다');
    }

    // Supabase JWKS 엔드포인트에서 공개 키 가져오기 (Edge 런타임 지원)
    const JWKS = createRemoteJWKSet(
      new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
    );

    // exp, iss, aud 클레임 자동 검증
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${supabaseUrl}/auth/v1`,
      audience: 'authenticated',
    });

    // sub 클레임: 소유자 UID와 일치 확인
    if (payload.sub !== ownerUid) {
      throw new Error('소유자 계정이 아닙니다');
    }

    return NextResponse.next();
  } catch {
    // 토큰이 유효하지 않으면 쿠키 삭제 후 로그인 페이지로 리다이렉트
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete(COOKIE_NAME);
    return response;
  }
}

export const config = {
  matcher: [
    // _next 내부 경로, 정적 파일, 파비콘, 로그인 페이지 제외
    '/((?!_next/static|_next/image|favicon\\.ico|login).*)',
  ],
};
