import { Alert } from 'react-native';

import { deleteCategory, listItemsByCategory } from '@/lib/queries';

export type EmptyCategoryResult = {
  /** 카테고리가 비어 안내를 띄웠는지(호출부의 "뒤로 → 홈" 판단용). */
  wasEmpty: boolean;
  /** 사용자가 '삭제'를 골라 실제로 삭제됐는지. */
  deleted: boolean;
};

/**
 * 어떤 동작(이동·편집·아이템 삭제)으로 카테고리에 남은 아이템이 0개가 됐는지 확인하고,
 * 비었으면 "삭제할까요?" 안내를 띄운다. 삭제를 고르면 `deleteCategory` 실행 후 `onDeleted` 호출.
 *
 * - `categoryId === null`(미분류)이면 대상이 아니다.
 * - **사용자의 선택(삭제/그대로 두기)까지 기다렸다가** 결과를 반환한다. 그래서 호출부는
 *   삭제가 끝난 뒤 화면을 이동/갱신할 수 있다(홈이 삭제 전 상태로 먼저 로드되는 문제 방지).
 * - 아이템 개수 조회 실패는 조용히 넘어간다(원래 동작은 이미 성공했으므로).
 */
export async function promptDeleteIfCategoryEmpty(
  categoryId: string | null,
  categoryName: string | undefined,
  onDeleted?: () => void,
): Promise<EmptyCategoryResult> {
  if (!categoryId) return { wasEmpty: false, deleted: false };
  let remaining;
  try {
    remaining = await listItemsByCategory(categoryId);
  } catch {
    return { wasEmpty: false, deleted: false };
  }
  if (remaining.length > 0) return { wasEmpty: false, deleted: false };

  const name = categoryName ?? '이 카테고리';
  return new Promise<EmptyCategoryResult>((resolve) => {
    Alert.alert('빈 카테고리', `「${name}」에 남은 위시가 없어요. 카테고리를 삭제할까요?`, [
      { text: '그대로 두기', style: 'cancel', onPress: () => resolve({ wasEmpty: true, deleted: false }) },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCategory(categoryId);
            onDeleted?.();
            resolve({ wasEmpty: true, deleted: true });
          } catch (e) {
            Alert.alert('오류', e instanceof Error ? e.message : '카테고리를 삭제하지 못했어요.');
            resolve({ wasEmpty: true, deleted: false });
          }
        },
      },
    ]);
  });
}
