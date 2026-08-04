import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import db from '../db';

const router = Router();

// 이미지 저장 설정
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('JPG, PNG, WEBP 형식만 업로드 가능해요.'));
    }
  },
});

// 제품 목록 조회 (카테고리별)
router.get('/', (req, res) => {
  const { category_id } = req.query;
  const rows = category_id
    ? db
        .prepare('SELECT * FROM products WHERE category_id = ? ORDER BY created_at DESC')
        .all(category_id)
    : db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  res.json(rows);
});

// 제품 등록 (이미지 + 데이터 함께)
router.post(
  '/',
  (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      next();
    });
  },
  (req, res) => {
    const { product_name, brand, price, source_link, memo, category_id } = req.body;
    if (!product_name) {
      res.status(400).json({ error: '제품명은 필수예요.' });
      return;
    }
    const image_path = req.file ? `/uploads/${req.file.filename}` : null;
    const result = db
      .prepare(
        `
    INSERT INTO products (product_name, brand, price, source_link, image_path, memo, category_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
      )
      .run(
        product_name,
        brand ?? null,
        price ?? null,
        source_link ?? null,
        image_path,
        memo ?? null,
        category_id ?? 0
      );

    res.status(201).json({ id: result.lastInsertRowid, product_name });
  }
);

// 제품 삭제
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ message: '삭제됐어요.' });
});

export default router;
