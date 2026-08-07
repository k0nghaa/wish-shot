#!/usr/bin/env node
/**
 * scripts/migrate.ts
 *
 * 일회성 마이그레이션 스크립트:
 *   SQLite (backend/wishlist.db) → Supabase Postgres
 *
 * - categories / products 행을 Postgres로 이전
 * - products.user_id = OWNER_UID 로 백필
 * - categories.name UNIQUE 제약 보존
 * - 마이그레이션 후 행 수 일치 검증
 *
 * 실행 전 .env.local 에 다음 환경 변수가 반드시 있어야 합니다:
 *   DATABASE_URL   — Supabase Postgres 연결 문자열
 *   OWNER_UID      — 소유자 Supabase Auth UID
 *
 * 주의: 멱등성 없음 — 깨끗한 Postgres 대상에서 한 번만 실행하세요.
 */

import { config } from 'dotenv';
// .env.local 우선, 없으면 .env 폴백
config({ path: '.env.local' });
config();

import Database from 'better-sqlite3';
import postgres from 'postgres';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── 환경 변수 검증 ───────────────────────────────────────────────────────────

const OWNER_UID = process.env.OWNER_UID;
const DATABASE_URL = process.env.DATABASE_URL;

if (!OWNER_UID) {
  console.error('오류: OWNER_UID 환경 변수가 설정되지 않았습니다');
  console.error('  Supabase Studio → Authentication → Users 에서 소유자 UID를 확인하세요');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('오류: DATABASE_URL 환경 변수가 설정되지 않았습니다');
  console.error('  예) postgresql://postgres:postgres@localhost:54322/postgres');
  process.exit(1);
}

// ── SQLite 연결 (읽기 전용 — 원본 DB 보호) ──────────────────────────────────

const SQLITE_PATH = path.resolve(__dirname, '../backend/wishlist.db');

let sqlite: InstanceType<typeof Database>;
try {
  sqlite = new Database(SQLITE_PATH, { readonly: true });
} catch (err) {
  console.error('오류: SQLite 데이터베이스를 열 수 없습니다:', SQLITE_PATH);
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

// ── Postgres 연결 ────────────────────────────────────────────────────────────
// prepare: false → PgBouncer 트랜잭션 모드 호환 (세션 수준 prepared statement 비활성화)

const sql = postgres(DATABASE_URL, {
  max: 1,
  prepare: false,
  onnotice: () => {}, // NOTICE 메시지 무시
});

// ── 타입 정의 ────────────────────────────────────────────────────────────────

interface SqliteCategory {
  id: number;
  name: string;
  created_at: string | null;
}

interface SqliteProduct {
  id: number;
  product_name: string;
  brand: string | null;
  price: string | null;
  source_link: string | null;
  image_path: string | null;
  memo: string | null;
  category_id: number;
  created_at: string | null;
}

// ── 마이그레이션 본체 ─────────────────────────────────────────────────────────

async function migrate(): Promise<void> {
  // 1) SQLite에서 전체 데이터 읽기
  const categories = sqlite
    .prepare('SELECT id, name, created_at FROM categories ORDER BY id')
    .all() as SqliteCategory[];

  const products = sqlite
    .prepare(
      `SELECT id, product_name, brand, price, source_link,
              image_path, memo, category_id, created_at
       FROM products ORDER BY id`
    )
    .all() as SqliteProduct[];

  console.log(`SQLite 원본: 카테고리 ${categories.length}개, 제품 ${products.length}개`);
  console.log(`소유자 UID: ${OWNER_UID}`);
  console.log('');

  // 2) Postgres 테이블 생성 (categories.name UNIQUE 제약 포함)
  console.log('Postgres 테이블 생성 중...');

  await sql`
    CREATE TABLE IF NOT EXISTS categories (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id           SERIAL PRIMARY KEY,
      product_name TEXT NOT NULL,
      brand        TEXT,
      price        TEXT,
      source_link  TEXT,
      image_path   TEXT,
      memo         TEXT,
      category_id  INTEGER NOT NULL DEFAULT 0,
      user_id      UUID NOT NULL,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  console.log('테이블 생성 완료');
  console.log('');

  // 3) 카테고리 삽입 (name UNIQUE 제약 자동 적용)
  console.log(`카테고리 ${categories.length}개 삽입 중...`);
  for (const cat of categories) {
    await sql`
      INSERT INTO categories (id, name, created_at)
      VALUES (
        ${cat.id},
        ${cat.name},
        ${cat.created_at ?? new Date().toISOString()}::TIMESTAMPTZ
      )
    `;
  }

  // categories id 시퀀스를 최대값으로 재설정
  if (categories.length > 0) {
    const maxCatId = Math.max(...categories.map((c) => c.id));
    await sql`SELECT setval('categories_id_seq', ${maxCatId}, true)`;
  }

  console.log(`카테고리 ${categories.length}개 삽입 완료`);
  console.log('');

  // 4) 제품 삽입 (user_id = OWNER_UID 백필)
  console.log(`제품 ${products.length}개 삽입 중 (user_id 백필)...`);
  for (const prod of products) {
    await sql`
      INSERT INTO products (
        id, product_name, brand, price, source_link,
        image_path, memo, category_id, user_id, created_at
      ) VALUES (
        ${prod.id},
        ${prod.product_name},
        ${prod.brand},
        ${prod.price},
        ${prod.source_link},
        ${prod.image_path},
        ${prod.memo},
        ${prod.category_id},
        ${OWNER_UID!}::UUID,
        ${prod.created_at ?? new Date().toISOString()}::TIMESTAMPTZ
      )
    `;
  }

  // products id 시퀀스를 최대값으로 재설정
  if (products.length > 0) {
    const maxProdId = Math.max(...products.map((p) => p.id));
    await sql`SELECT setval('products_id_seq', ${maxProdId}, true)`;
  }

  console.log(`제품 ${products.length}개 삽입 완료`);
  console.log('');

  // 5) 행 수 검증 (SQLite ↔ Postgres 일치 확인)
  console.log('행 수 검증 중...');

  const [pgCat] = await sql<[{ count: string }]>`
    SELECT COUNT(*)::text AS count FROM categories
  `;
  const [pgProd] = await sql<[{ count: string }]>`
    SELECT COUNT(*)::text AS count FROM products
  `;

  const pgCatCount = parseInt(pgCat.count, 10);
  const pgProdCount = parseInt(pgProd.count, 10);

  console.log(
    `  카테고리: SQLite ${categories.length}개 → Postgres ${pgCatCount}개`
  );
  console.log(
    `  제품:     SQLite ${products.length}개 → Postgres ${pgProdCount}개`
  );

  if (pgCatCount !== categories.length) {
    throw new Error(
      `카테고리 행 수 불일치: SQLite ${categories.length} ≠ Postgres ${pgCatCount}`
    );
  }
  if (pgProdCount !== products.length) {
    throw new Error(
      `제품 행 수 불일치: SQLite ${products.length} ≠ Postgres ${pgProdCount}`
    );
  }

  // 6) user_id 백필 검증
  const [ownerCheck] = await sql<[{ count: string }]>`
    SELECT COUNT(*)::text AS count FROM products
    WHERE user_id = ${OWNER_UID!}::UUID
  `;
  const ownerCount = parseInt(ownerCheck.count, 10);

  if (ownerCount !== products.length) {
    throw new Error(
      `user_id 백필 불일치: 전체 제품 ${products.length}개 중 ${ownerCount}개만 OWNER_UID와 일치`
    );
  }

  console.log('');
  console.log('✅ 마이그레이션 성공');
  console.log(`   카테고리 ${pgCatCount}개, 제품 ${pgProdCount}개 (모두 user_id = ${OWNER_UID})`);
}

// ── 실행 ─────────────────────────────────────────────────────────────────────

migrate()
  .then(() => {
    sqlite.close();
    return sql.end();
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('');
    console.error('❌ 마이그레이션 실패:', message);
    sqlite.close();
    void sql.end();
    process.exit(1);
  });
