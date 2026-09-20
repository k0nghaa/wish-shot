/**
 * 공유 재진입 가드(기능 1): 등록/편집 폼이 "작성 중"인지 모듈 전역으로 표시한다.
 *
 * iOS 공유 딥링크는 앱을 홈(/)으로 재진입시키며 위에 떠 있던 등록/편집 화면을 정리(pop)한다.
 * 그 언마운트와 홈의 인텐트 처리 사이 경합을 피하려고 React 상태가 아닌 모듈 스코프에 둔다.
 *
 * 규칙: 폼에 내용이 생기면 true(`setFormInProgress(true)`), **저장/취소 같은 명시적 종료에서만** false.
 * (언마운트에서는 끄지 않는다 — 딥링크 pop 은 저장도 취소도 아니므로 true 로 남아야 홈이 감지한다.)
 * 홈은 URL 공유를 처리할 때 이 값을 읽고 곧바로 비운다(consume) → 오래 남아 오작동하지 않게 한다.
 */
let formInProgress = false;

export function setFormInProgress(value: boolean): void {
  formInProgress = value;
}

/** 현재 값을 읽고 즉시 비운다(홈이 소비). 다음 공유 처리까지 상태가 눌어붙지 않게 한다. */
export function consumeFormInProgress(): boolean {
  const was = formInProgress;
  formInProgress = false;
  return was;
}
