/**
 * items INSERT 시 UNIQUE(user_id, normalized_name) 위반(Postgres 23505).
 * 중복 사전조회를 놓친 경우(경합 등)의 안전망으로, 화면은 이를 덮어쓰기 모달로 폴백한다.
 */
export class DuplicateItemError extends Error {
  constructor() {
    super('이미 같은 브랜드·제품명의 아이템이 있어요.');
    this.name = 'DuplicateItemError';
  }
}
