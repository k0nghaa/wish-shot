'use client';

import { useActionState } from 'react';
import { loginAction } from './actions';

/**
 * 로그인 폼 — Client Component.
 * useActionState로 서버 액션 오류를 인라인 표시합니다.
 */
export function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, null);

  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {state?.error && (
        <p
          role="alert"
          style={{
            color: '#dc2626',
            margin: 0,
            fontSize: '0.875rem',
            padding: '0.5rem 0.75rem',
            backgroundColor: '#fef2f2',
            borderRadius: '6px',
          }}
        >
          {state.error}
        </p>
      )}

      <div>
        <label
          htmlFor="email"
          style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500 }}
        >
          이메일
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={isPending}
          style={{
            display: 'block',
            width: '100%',
            padding: '0.5rem 0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '1rem',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div>
        <label
          htmlFor="password"
          style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500 }}
        >
          비밀번호
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={isPending}
          style={{
            display: 'block',
            width: '100%',
            padding: '0.5rem 0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '1rem',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        style={{
          padding: '0.625rem 1rem',
          backgroundColor: isPending ? '#9ca3af' : '#16a34a',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          fontSize: '1rem',
          fontWeight: 500,
          cursor: isPending ? 'not-allowed' : 'pointer',
          transition: 'background-color 0.15s',
        }}
      >
        {isPending ? '로그인 중...' : '로그인'}
      </button>
    </form>
  );
}
