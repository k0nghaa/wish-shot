import { uuid } from 'expo-modules-core';

/**
 * 앱 전체 스낵바 대기열. 화면 밖(저장 뒤 링크 붙이기 등)에서도 부를 수 있게 React 밖에 둔다.
 * 루트 레이아웃의 SnackbarHost 가 하나씩 차례로 보여 준다(3초, [보기] 등 동작 1개).
 */
export type SnackbarMessage = {
  id: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** VoiceOver 가 읽을 문장(없으면 제목·부제). */
  announcement?: string;
};

let queue: SnackbarMessage[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function showSnackbar(message: Omit<SnackbarMessage, 'id'>) {
  queue = [...queue, { ...message, id: uuid.v4() }];
  emit();
}

/** 지금 보이는 스낵바(대기열 맨 앞)를 내린다. 다음 것이 있으면 이어서 보인다. */
export function dismissSnackbar(id: string) {
  if (queue[0]?.id !== id) return;
  queue = queue.slice(1);
  emit();
}

export function subscribeSnackbar(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCurrentSnackbar(): SnackbarMessage | null {
  return queue[0] ?? null;
}
