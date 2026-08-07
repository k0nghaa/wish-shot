import { useProducts } from '../hooks/useProducts';

interface Props {
  categoryId?: number;
  categoryName?: string;
}

export function ProductPage({ categoryId, categoryName }: Props) {
  const { products, isLoading, error, deleteProduct } = useProducts(categoryId);

  if (isLoading) return <p className="p-8 text-center text-text-sub">불러오는 중...</p>;
  if (error) return <p className="p-8 text-center text-error">{error}</p>;

  return (
    <div className="min-h-screen bg-bg p-8">
      <div className="max-w-4xl mx-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-8">
          <h1>{categoryName ?? '전체'}</h1>
        </div>

        {/* 제품 목록 */}
        {products.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-4xl mb-4">🛍️</p>
            <p className="text-sm text-text-sub">아직 저장된 제품이 없어요.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {products.map((product) => (
              <div
                key={product.id}
                className="bg-bg-card rounded-xl border border-silver hover:border-primary transition-colors overflow-hidden"
              >
                {/* 이미지 */}
                {product.image_path ? (
                  <img
                    src={`http://localhost:4000${product.image_path}`}
                    alt={product.product_name}
                    className="w-full aspect-square object-cover"
                  />
                ) : (
                  <div className="w-full aspect-square bg-bg flex items-center justify-center">
                    <p className="text-3xl">🖼️</p>
                  </div>
                )}

                {/* 제품 정보 */}
                <div className="p-4">
                  <p className="font-semibold text-text-main truncate">{product.product_name}</p>
                  {product.brand && (
                    <p className="text-sm text-text-sub truncate">{product.brand}</p>
                  )}
                  {product.price && (
                    <p className="text-sm text-accent font-medium mt-1">{product.price}</p>
                  )}
                </div>

                {/* 삭제 버튼 */}
                <div className="px-4 pb-4">
                  <button
                    onClick={() => deleteProduct(product.id)}
                    className="w-full py-1.5 text-xs text-text-disabled border border-silver rounded-lg hover:border-error hover:text-error transition-colors"
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
