import { useImageUpload } from '../hooks/useImageUpload';
import { useCategories } from '../hooks/useCategories';

export function UploadPage() {
  const { previewFile, form, isUploading, error, addFile, updateForm, upload, reset } =
    useImageUpload();
  const { categories } = useCategories();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) addFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) addFile(file);
  };

  const handleUpload = async () => {
    const success = await upload();
    if (success) {
      alert('저장됐어요!');
    }
  };

  return (
    <div className="min-h-screen bg-bg p-8">
      <div className="max-w-lg mx-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-8">
          <h1>새 위시 추가</h1>
          <button
            onClick={reset}
            className="text-sm text-text-sub hover:text-text-main transition-colors"
          >
            초기화
          </button>
        </div>

        {/* 이미지 업로드 영역 */}
        <div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()} className="mb-6">
          {previewFile ? (
            <div className="relative rounded-xl overflow-hidden bg-bg-card border border-silver">
              <img
                src={previewFile.previewUrl}
                alt="미리보기"
                className="w-full object-contain max-h-80"
              />
              <button
                onClick={() => reset()}
                className="absolute top-3 right-3 bg-black/50 text-white text-xs px-2 py-1 rounded-lg hover:bg-black/70 transition-colors"
              >
                변경
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center aspect-square rounded-xl border-2 border-dashed border-silver hover:border-primary cursor-pointer transition-colors bg-bg-card">
              <p className="text-4xl mb-3">📷</p>
              <p className="text-sm text-text-sub">클릭하거나 이미지를 드래그하세요</p>
              <p className="text-xs text-text-disabled mt-1">JPG, PNG, WEBP</p>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          )}
        </div>

        {/* 폼 */}
        <div className="flex flex-col gap-4">
          {/* 제품명 (필수) */}
          <div>
            <label className="block text-sm font-medium text-text-main mb-1.5">
              제품명 <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={form.productName}
              onChange={(e) => updateForm('productName', e.target.value)}
              placeholder="제품명을 입력하세요"
              className="w-full px-4 py-2.5 border border-silver rounded-lg text-sm focus:outline-none focus:border-primary placeholder:text-text-disabled"
            />
          </div>

          {/* 카테고리 (필수) */}
          <div>
            <label className="block text-sm font-medium text-text-main mb-1.5">
              카테고리 <span className="text-error">*</span>
            </label>
            <select
              value={form.categoryId ?? ''}
              onChange={(e) => updateForm('categoryId', Number(e.target.value) || null)}
              className="w-full px-4 py-2.5 border border-silver rounded-lg text-sm focus:outline-none focus:border-primary text-text-main bg-bg-card"
            >
              <option value="">카테고리 선택</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          {/* 브랜드 */}
          <div>
            <label className="block text-sm font-medium text-text-main mb-1.5">브랜드</label>
            <input
              type="text"
              value={form.brand}
              onChange={(e) => updateForm('brand', e.target.value)}
              placeholder="브랜드명 (선택)"
              className="w-full px-4 py-2.5 border border-silver rounded-lg text-sm focus:outline-none focus:border-primary placeholder:text-text-disabled"
            />
          </div>

          {/* 가격 */}
          <div>
            <label className="block text-sm font-medium text-text-main mb-1.5">가격</label>
            <input
              type="text"
              value={form.price}
              onChange={(e) => updateForm('price', e.target.value)}
              placeholder="가격 (선택)"
              className="w-full px-4 py-2.5 border border-silver rounded-lg text-sm focus:outline-none focus:border-primary placeholder:text-text-disabled"
            />
          </div>

          {/* 링크 */}
          <div>
            <label className="block text-sm font-medium text-text-main mb-1.5">구매 링크</label>
            <input
              type="text"
              value={form.sourceLink}
              onChange={(e) => updateForm('sourceLink', e.target.value)}
              placeholder="https://... (선택)"
              className="w-full px-4 py-2.5 border border-silver rounded-lg text-sm focus:outline-none focus:border-primary placeholder:text-text-disabled"
            />
          </div>

          {/* 메모 */}
          <div>
            <label className="block text-sm font-medium text-text-main mb-1.5">메모</label>
            <textarea
              value={form.memo}
              onChange={(e) => updateForm('memo', e.target.value)}
              placeholder="메모 (선택)"
              rows={3}
              className="w-full px-4 py-2.5 border border-silver rounded-lg text-sm focus:outline-none focus:border-primary placeholder:text-text-disabled resize-none"
            />
          </div>

          {/* 에러 메시지 */}
          {error && <p className="text-sm text-error">{error}</p>}

          {/* 저장 버튼 */}
          <button
            onClick={handleUpload}
            disabled={isUploading || !form.productName.trim()}
            className="w-full py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? '저장 중...' : '저장하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
