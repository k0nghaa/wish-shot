import { useState, useEffect } from 'react';

const API_URL = 'http://localhost:4000';

interface Category {
  id: number;
  name: string;
  item_count: number;
  created_at: string;
}

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GET /categories - 목록 불러오기
  const fetchCategories = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/categories`);
      const data = await response.json();
      setCategories(data);
    } catch {
      setError('카테고리를 불러오지 못했어요.');
    } finally {
      setIsLoading(false);
    }
  };

  // POST /categories - 카테고리 생성
  const createCategory = async (name: string) => {
    setError(null);
    try {
      const response = await fetch(`${API_URL}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const data = await response.json();
        setError(data.error);
        return false;
      }
      await fetchCategories(); // 생성 후 목록 갱신
      return true;
    } catch {
      setError('카테고리 생성에 실패했어요.');
      return false;
    }
  };

  // 컴포넌트 마운트 시 자동으로 목록 불러오기
  useEffect(() => {
    fetchCategories();
  }, []); // 빈 배열 = 컴포넌트 처음 마운트될 때 딱 한 번만 실행

  return { categories, isLoading, error, createCategory };
}
