import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Next.js 전용 tsconfig 사용 (Vite tsconfig와 분리)
  typescript: {
    tsconfigPath: './tsconfig.next.json',
  },
};

export default nextConfig;
