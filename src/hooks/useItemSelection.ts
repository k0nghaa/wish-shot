import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { Alert } from 'react-native';

import { promptDeleteIfCategoryEmpty } from '@/lib/emptyCategory';
import {
  createCategory,
  deleteItemImages,
  deleteItems,
  moveItems,
  type Category,
  type Item,
} from '@/lib/queries';

/**
 * 위시 다중 선택 상태·동작(전체 탭·카테고리 그리드 공용).
 * 롱프레스 또는 "선택" 버튼으로 진입 → 카테고리 이동 / 일괄 삭제(앨범 앱 톤).
 * "삭제"는 위시(앱 데이터) 삭제이며 앨범 사진 삭제가 아니다.
 *
 * 이동·삭제로 원래 카테고리가 비면 `promptDeleteIfCategoryEmpty`로 삭제/유지를 안내한다.
 * 화면은 반환된 상태로 헤더(선택/취소·개수)와 `ItemSelectionControls`(액션바·이동 시트)를 그린다.
 */
export function useItemSelection({
  items,
  categories,
  setCategories,
  reload,
}: {
  items: Item[] | null;
  categories: Category[];
  setCategories: Dispatch<SetStateAction<Category[]>>;
  reload: () => Promise<void> | void;
}) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [moveSheet, setMoveSheet] = useState(false);
  const [busy, setBusy] = useState(false); // 이동·삭제 진행 중(중복 탭 방지)

  const enterSelect = useCallback((id?: string) => {
    setSelectMode(true);
    setSelected(id ? new Set([id]) : new Set());
  }, []);

  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
    setMoveSheet(false);
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 선택 항목이 원래 속했던 카테고리들(대상 제외, 미분류 제외)을 순차로 빈 카테고리 안내한다.
  async function promptEmptiedCategories(chosen: Item[], excludeCategoryId: string | null) {
    const affected = new Set<string>();
    for (const it of chosen) {
      if (it.category_id && it.category_id !== excludeCategoryId) affected.add(it.category_id);
    }
    for (const catId of affected) {
      const name = categories.find((c) => c.id === catId)?.name;
      await promptDeleteIfCategoryEmpty(catId, name);
    }
  }

  async function handleMove(categoryId: string | null) {
    if (busy) return;
    const chosen = (items ?? []).filter((it) => selected.has(it.id));
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      await moveItems(
        chosen.map((it) => it.id),
        categoryId,
      );
      await promptEmptiedCategories(chosen, categoryId);
      exitSelect();
      await reload();
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : '카테고리를 옮기지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    const chosen = (items ?? []).filter((it) => selected.has(it.id));
    if (chosen.length === 0) return;
    Alert.alert('삭제할까요?', `위시 ${chosen.length}개를 삭제합니다. 복구할 수 없습니다.`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => handleDelete(chosen) },
    ]);
  }

  async function handleDelete(chosen: Item[]) {
    if (busy) return;
    setBusy(true);
    try {
      await deleteItems(chosen.map((it) => it.id));
      // Storage 정리는 실패해도 행 삭제가 우선(단건 삭제와 동일).
      await deleteItemImages(chosen.map((it) => it.image_key)).catch(() => undefined);
      await promptEmptiedCategories(chosen, null);
      exitSelect();
      await reload();
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : '삭제하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  // 이동 시트의 인라인 카테고리 생성 — 만든 카테고리를 목록에 추가하고 반환.
  const createCategoryInline = useCallback(
    async (name: string): Promise<Category> => {
      const created = await createCategory(name);
      setCategories((prev) => [...prev, created]);
      return created;
    },
    [setCategories],
  );

  return {
    selectMode,
    selected,
    moveSheet,
    setMoveSheet,
    busy,
    enterSelect,
    exitSelect,
    toggle,
    handleMove,
    confirmDelete,
    createCategoryInline,
  };
}

export type ItemSelection = ReturnType<typeof useItemSelection>;
