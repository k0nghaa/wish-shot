import Database from 'better-sqlite3';
import path from 'path';

// DB 파일 연결 (없으면 자동 생성)
const db = new Database(path.join(__dirname, '../wishlist.db'));

// 테이블이 없으면 생성 (서버 시작 시 자동 실행)
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL,
    brand TEXT,
    price TEXT,
    source_link TEXT,
    image_path TEXT,
    memo TEXT,
    category_id INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );
`);

export default db;
