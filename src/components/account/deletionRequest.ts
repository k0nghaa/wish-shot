import type { DeleteAccountInput } from '@/lib/queries';

// 계정 삭제 안내(delete)에서 삭제하는 중(deleting)으로 넘기는 요청. 두 화면은 경로 파라미터가 없으므로(설계 3) 메모리에 둔다.
// 사유 글은 화면 사이에만 머문다(저장·전송은 deleteAccount 가 한다). 앱이 도중에 꺼지면 사라지고,
// 다시 켠 deleting 화면은 요청 없이 이어서 부른다(서버가 "사용자 없음"이면 완료 처리).

export type DeletionRequest = { input: DeleteAccountInput };

let pending: DeletionRequest | null = null;

export function setDeletionRequest(request: DeletionRequest): void {
  pending = request;
}

export function takeDeletionRequest(): DeletionRequest | null {
  const request = pending;
  pending = null;
  return request;
}
