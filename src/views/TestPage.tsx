/* 테스트 페이지로 개발 모드에서만 렌더링됩니다. */

import { CategoryPage } from './CategoryPage';
import { ProductPage } from './ProductPage';
import { UploadPage } from './UploadPage';

export default function TestPage() {
  return (
    <>
      {/* <CategoryPage /> */}
      {/* <ProductPage /> */}
      <ProductPage categoryId={1} categoryName="뷰티" />
      {/* <UploadPage /> */}
    </>
  );
}
