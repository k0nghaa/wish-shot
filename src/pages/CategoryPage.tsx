import { useState } from 'react';
import { useCategories } from '../hooks/useCategories';

export function CategoryPage() {
  const { categories, isLoading, error, createCategory } = useCategories();
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const success = await createCategory(newName.trim());
    if (success) {
      setNewName('');
      setIsCreating(false);
    }
  };

  if (isLoading) return <p className="p-8 text-center text-text-sub">불러오는 중...</p>;
  if (error) return <p className="p-8 text-center text-error">{error}</p>;

  return (
    <div className="min-h-screen bg-bg p-8">
      <div className="max-w-2xl mx-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-8">
          <h1>내 위시리스트</h1>
          <button
            onClick={() => setIsCreating(true)}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-hover transition-colors"
          >
            + 카테고리 추가
          </button>
        </div>

        {/* 카테고리 생성 인풋 */}
        {isCreating && (
          <div className="flex gap-2 mb-6">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="카테고리 이름 입력"
              autoFocus
              className="flex-1 px-4 py-2 border border-silver rounded-lg text-sm focus:outline-none focus:border-primary placeholder:text-text-disabled"
            />
            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-hover transition-colors"
            >
              저장
            </button>
            <button
              onClick={() => {
                setIsCreating(false);
                setNewName('');
              }}
              className="px-4 py-2 border border-silver text-text-sub rounded-lg text-sm hover:bg-silver transition-colors"
            >
              취소
            </button>
          </div>
        )}

        {/* 카테고리 목록 */}
        {categories.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-4xl mb-4">🗂️</p>
            <p className="text-sm text-text-sub">아직 카테고리가 없어요.</p>
            <p className="text-sm text-text-disabled">위시리스트를 추가하면 카테고리가 생겨요.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {categories.map((category) => (
              <div
                key={category.id}
                className="bg-bg-card rounded-xl p-6 border border-silver hover:border-primary cursor-pointer transition-colors"
              >
                <p className="font-semibold text-text-main mb-1">{category.name}</p>
                <p className="text-sm text-text-sub">{category.item_count}개</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
