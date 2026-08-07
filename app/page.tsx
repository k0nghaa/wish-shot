import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_NAME } from '@/lib/auth';

/**
 * 로그아웃 Server Action.
 * wishshot-session 쿠키를 삭제하고 /login으로 리다이렉트합니다.
 */
async function logoutAction() {
  'use server';
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  redirect('/login');
}

/**
 * 홈 페이지 (Server Component, 미들웨어로 보호됨).
 * 2라운드에서 카테고리·제품 목록이 추가됩니다.
 */
export default async function HomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME);

  // 미들웨어가 이미 인증을 처리하지만, 혹시 쿠키가 없으면 로그인으로 이동
  if (!token) {
    redirect('/login');
  }

  return (
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '2rem',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.5rem', color: '#111827' }}>위시샷</h1>
        <form action={logoutAction}>
          <button
            type="submit"
            style={{
              padding: '0.375rem 0.75rem',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              backgroundColor: '#fff',
              color: '#374151',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            로그아웃
          </button>
        </form>
      </header>

      <section>
        <p style={{ color: '#6b7280' }}>
          로그인되었습니다. 카테고리와 제품 목록은 2라운드에서 추가됩니다.
        </p>
      </section>
    </main>
  );
}
