import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

/**
 * HttpOnly 쿠키 이름 — 미들웨어와 서버 액션 모두 동일한 이름 사용
 */
export const COOKIE_NAME = 'wishshot-session';

export interface OwnerJWTPayload extends JWTPayload {
  sub: string;
  email?: string;
  role?: string;
}

/**
 * Supabase JWKS 엔드포인트를 이용해 JWT를 직접 검증합니다.
 *
 * jose가 자동으로 검증하는 클레임:
 *   - exp  : 만료 시각 (JWTExpired 에러로 처리)
 *   - iss  : issuer 옵션과 비교 (= SUPABASE_URL/auth/v1)
 *   - aud  : audience 옵션과 비교 (= 'authenticated')
 *
 * 추가 검증:
 *   - sub  : 소유자 UID (OWNER_UID 환경 변수)와 일치해야 함
 *
 * @param token Supabase Auth API가 발급한 access_token
 * @returns 검증된 JWT payload
 * @throws 검증 실패 시 한국어 에러 메시지
 */
export async function verifyOwnerJWT(token: string): Promise<OwnerJWTPayload> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ownerUid = process.env.OWNER_UID;

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다');
  }
  if (!ownerUid) {
    throw new Error('OWNER_UID가 설정되지 않았습니다');
  }

  // JWKS 엔드포인트에서 공개 키 세트를 가져옵니다 (내부적으로 캐시됨)
  const JWKS = createRemoteJWKSet(
    new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
  );

  // exp / iss / aud 클레임을 jose가 자동 검증
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `${supabaseUrl}/auth/v1`,
    audience: 'authenticated',
  });

  // sub 클레임: 소유자 UID와 반드시 일치해야 함
  if (payload.sub !== ownerUid) {
    throw new Error('소유자 계정이 아닙니다');
  }

  return payload as OwnerJWTPayload;
}
