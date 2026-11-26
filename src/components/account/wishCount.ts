// 전체 탭이 이미 불러온 위시 개수(메모리) — 로그인 권유 반시트의 제목("위시 12개를 계정에 보관")에 쓴다.
// 아직 못 불러왔거나 실패했으면 null(제목은 "위시를 계정에 보관"). 통신하지 않는다.
// 모듈 상태라 컴포넌트 안에서 직접 읽지 않고 함수로만 다룬다(React Compiler).

let loaded: number | null = null;

export function setLoadedWishCount(count: number | null): void {
  loaded = count;
}

export function getLoadedWishCount(): number | null {
  return loaded;
}

let sheetChecked = false;

/** 앱을 켠 뒤 처음 부를 때만 true — 전체 탭이 로그인 권유 반시트를 한 번만 따져 보게 한다(모듈 상태는 함수로만). */
export function takeSheetCheckOnce(): boolean {
  if (sheetChecked) return false;
  sheetChecked = true;
  return true;
}
