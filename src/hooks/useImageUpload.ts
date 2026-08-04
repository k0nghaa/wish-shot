import { useState, useCallback } from 'react';

const API_URL = 'http://localhost:4000';

interface PreviewFile {
  file: File;
  previewUrl: string;
}

interface UploadForm {
  productName: string;
  brand: string;
  price: string;
  sourceLink: string;
  memo: string;
  categoryId: number | null;
}

export function useImageUpload() {
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [form, setForm] = useState<UploadForm>({
    productName: '',
    brand: '',
    price: '',
    sourceLink: '',
    memo: '',
    categoryId: null,
  });
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 파일 선택 시 미리보기 생성
  const addFile = useCallback(
    (file: File) => {
      // 기존 미리보기 URL 메모리 해제
      if (previewFile) {
        URL.revokeObjectURL(previewFile.previewUrl);
      }
      const previewUrl = URL.createObjectURL(file);
      setPreviewFile({ file, previewUrl });
    },
    [previewFile]
  );

  // 폼 필드 업데이트
  const updateForm = useCallback((field: keyof UploadForm, value: string | number | null) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  // 초기화
  const reset = useCallback(() => {
    if (previewFile) {
      URL.revokeObjectURL(previewFile.previewUrl);
    }
    setPreviewFile(null);
    setForm({
      productName: '',
      brand: '',
      price: '',
      sourceLink: '',
      memo: '',
      categoryId: null,
    });
    setError(null);
  }, [previewFile]);

  // 업로드 실행
  const upload = useCallback(async () => {
    if (!form.productName.trim()) {
      setError('제품명은 필수예요.');
      return false;
    }
    if (!form.categoryId) {
      setError('카테고리를 선택해주세요.');
      return false;
    }

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('product_name', form.productName.trim());
      formData.append('category_id', String(form.categoryId));
      if (previewFile) formData.append('image', previewFile.file);
      if (form.brand) formData.append('brand', form.brand);
      if (form.price) formData.append('price', form.price);
      if (form.sourceLink) formData.append('source_link', form.sourceLink);
      if (form.memo) formData.append('memo', form.memo);

      const response = await fetch(`${API_URL}/products`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error);
        return false;
      }

      reset();
      return true;
    } catch {
      setError('업로드에 실패했어요.');
      return false;
    } finally {
      setIsUploading(false);
    }
  }, [form, previewFile, reset]);

  return {
    previewFile,
    form,
    isUploading,
    error,
    addFile,
    updateForm,
    upload,
    reset,
  };
}
