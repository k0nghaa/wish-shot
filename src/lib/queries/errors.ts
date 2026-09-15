/**
 * items INSERT 시 UNIQUE(user_id, normalized_name) 위반(Postgres 23505).
 * 중복 사전조회를 놓친 경우(경합 등)의 안전망으로, 화면은 이를 덮어쓰기 모달로 폴백한다.
 */
export class DuplicateItemError extends Error {
  constructor() {
    super('이미 같은 브랜드·제품명의 위시가 있습니다.');
    this.name = 'DuplicateItemError';
  }
}

/**
 * categories INSERT/UPDATE 시 UNIQUE(user_id, name) 위반(Postgres 23505).
 * 사용자에겐 친화적인 문구만 보이고, 원본 DB 메시지는 콘솔에만 남긴다.
 */
export class DuplicateCategoryError extends Error {
  constructor() {
    super('같은 이름의 카테고리가 있습니다.');
    this.name = 'DuplicateCategoryError';
  }
}
