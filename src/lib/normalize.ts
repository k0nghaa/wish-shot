/**
 * 중복 판정용 정규화 문자열을 만든다. `brand + '|' + product_name` 을 각각 정규화해 합친다.
 *
 * 규칙(토큰별):
 *   - 유니코드 NFC 정규화 → 한글 조합형/분해형(예: iOS 파일명)을 한 형태로 통일
 *   - 소문자화 → 영문 대소문자 차이 무시
 *   - 문자(모든 스크립트)와 숫자만 남김 → 공백·특수문자 제거, 한글/영문/숫자는 유지
 *
 * brand 가 비어 있으면 '' 로 취급한다(브랜드 없는 동명끼리는 중복으로 본다).
 * 구분자 '|' 는 각 토큰을 정규화한 뒤 붙이므로, 입력값 안의 '|' 는 제거되어 충돌하지 않는다.
 *
 * ⚠️ 이 값은 DB `items.normalized_name`(서버 전용 숨김 컬럼)과 `UNIQUE(user_id, normalized_name)`
 * 의 판정 소스다. Step 4 의 중복 사전조회와 저장이 반드시 이 함수를 함께 써야 판정이 일치한다.
 */
export function normalizeName(
  brand: string | null | undefined,
  productName: string,
): string {
  return `${normalizeToken(brand ?? '')}|${normalizeToken(productName)}`;
}

function normalizeToken(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}
