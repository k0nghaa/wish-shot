import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: '위시샷',
  description: '나만의 개인 위시리스트',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: 'sans-serif', backgroundColor: '#f9fafb' }}>
        {children}
      </body>
    </html>
  );
}
