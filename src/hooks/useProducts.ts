import { useState, useEffect, useCallback } from 'react';

const API_URL = 'http://localhost:4000';

interface Product {
  id: number;
  product_name: string;
  brand: string | null;
  price: string | null;
  source_link: string | null;
  image_path: string | null;
  memo: string | null;
  category_id: number;
  created_at: string;
}

export function useProducts(categoryId?: number) {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const url = categoryId
        ? `${API_URL}/products?category_id=${categoryId}` // 특정 카테고리 제품 보기
        : `${API_URL}/products`; // 전체 제품 보기
      const response = await fetch(url);
      const data = await response.json();
      setProducts(data);
    } catch {
      setError('제품을 불러오지 못했어요.');
    } finally {
      setIsLoading(false);
    }
  }, [categoryId]);

  const deleteProduct = async (id: number) => {
    try {
      await fetch(`${API_URL}/products/${id}`, { method: 'DELETE' });
      setProducts((prev) => prev.filter((p) => p.id !== id));
    } catch {
      setError('삭제에 실패했어요.');
    }
  };

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  return { products, isLoading, error, fetchProducts, deleteProduct };
}
