import { LoginForm } from './LoginForm';

export const metadata = {
  title: '로그인 — 위시샷',
};

/**
 * 로그인 페이지 (Server Component).
 * 공개 접근 허용 — 미들웨어가 /login을 화이트리스트 처리합니다.
 * 회원가입 페이지는 존재하지 않으며, 소유자 계정은 Supabase Studio에서 직접 생성합니다.
 */
export default function LoginPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f9fafb',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          padding: '2rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}
      >
        <h1
          style={{
            textAlign: 'center',
            marginTop: 0,
            marginBottom: '0.5rem',
            fontSize: '1.5rem',
            fontWeight: 700,
            color: '#111827',
          }}
        >
          위시샷
        </h1>
        <p
          style={{
            textAlign: 'center',
            color: '#6b7280',
            fontSize: '0.875rem',
            marginBottom: '2rem',
            marginTop: 0,
          }}
        >
          소유자 계정으로 로그인하세요
        </p>

        <LoginForm />
      </div>
    </main>
  );
}
