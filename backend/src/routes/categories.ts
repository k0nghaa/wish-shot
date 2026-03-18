import { Router } from 'express';
import db from '../db';

const router = Router();

// 카테고리 목록 조회 (아이템 있는 것만)
router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `
    SELECT c.*, COUNT(p.id) as item_count
    FROM categories c
    INNER JOIN products p ON p.category_id = c.id
    GROUP BY c.id
  `
    )
    .all();
  res.json(rows);
});

// 카테고리 생성
router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    res.status(400).json({ error: '카테고리 이름은 필수예요.' });
    return;
  }
  try {
    const result = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    res.status(201).json({ id: result.lastInsertRowid, name });
  } catch {
    res.status(409).json({ error: '이미 존재하는 카테고리예요.' });
  }
});

export default router;
