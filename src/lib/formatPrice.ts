/**
 * KRW 가격 표기. 천 단위 콤마 + '원'. price 가 없으면 null 을 돌려준다.
 * (Hermes 의 Intl 한계를 피하려고 콤마는 정규식으로 직접 넣는다.)
 */
export function formatPriceKRW(price: number | null | undefined): string | null {
  if (price === null || price === undefined) return null;
  const n = Math.round(price);
  const withCommas = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${withCommas}원`;
}
