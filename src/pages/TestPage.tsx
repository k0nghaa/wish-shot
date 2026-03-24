/* 테스트 페이지로 개발 모드에서만 렌더링됩니다. */

import { CategoryPage } from './CategoryPage';
import { ProductPage } from './ProductPage';

export default function TestPage() {
  return (
    <>
      {/* <CategoryPage /> */}
      {/* <ProductPage /> */}
      <ProductPage categoryId={5} categoryName="전자기기" />
    </>
  );
}
