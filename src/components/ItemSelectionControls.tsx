import type { ItemSelection } from '@/hooks/useItemSelection';
import type { Category } from '@/lib/queries';

import { FolderPickerSheet } from './FolderPickerSheet';
import { SelectionBar } from './SelectionBar';

/**
 * 다중 선택 하단 액션바(카테고리 이동 / 삭제) + 이동 대상 선택 시트.
 * 선택 모드에서만 렌더. 전체 탭·카테고리 그리드 공용(로직은 useItemSelection).
 * 전체 탭에서는 플로팅 탭바를 숨긴 자리에 뜬다(TabBarVisibility).
 */
export function ItemSelectionControls({
  selection,
  categories,
}: {
  selection: ItemSelection;
  categories: Category[];
}) {
  if (!selection.selectMode) return null;
  return (
    <>
      <SelectionBar
        disabled={selection.busy || selection.selected.size === 0}
        actions={[
          { key: 'move', label: '카테고리 이동', icon: 'folder', onPress: () => selection.setMoveSheet(true) },
          { key: 'delete', label: '삭제', icon: 'trash', destructive: true, onPress: selection.confirmDelete },
        ]}
      />
      <FolderPickerSheet
        visible={selection.moveSheet}
        onClose={() => selection.setMoveSheet(false)}
        categories={categories}
        selectedId={null}
        onSelect={(id) => selection.handleMove(id)}
        onCreateCategory={selection.createCategoryInline}
      />
    </>
  );
}
