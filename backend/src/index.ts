import express from 'express';
import cors from 'cors';
import path from 'path';
import categoriesRouter from './routes/categories';
import productsRouter from './routes/products';

const app = express();
const PORT = 4000;

app.use(cors({ origin: 'http://localhost:5173' })); // Vite 기본 포트
app.use(express.json());

// 업로드된 이미지를 URL로 접근 가능하게
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/categories', categoriesRouter);
app.use('/products', productsRouter);

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
