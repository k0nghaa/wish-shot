import type { PurchaseChannel } from '@/lib/purchaseChannel';
import { supabase } from '@/lib/supabase';

/**
 * find-purchase-links Edge Function 이 찾은 판매 링크. 함수가 악성 사이트 목록 대조와 접속 확인을 마친 것이다.
 * - official·site: 웹 검색 결과에 실제로 나온 상품 페이지(브랜드 공식몰 / 그 사이트·몰)
 * - search: 상품 페이지를 못 찾아 넣은 그 몰 검색 결과 링크(mall = 몰 id)
 */
export interface PurchaseLink {
  url: string;
  domain: string;
  kind: 'official' | 'site' | 'search';
  mall?: string;
}

/** 앱 쪽 호출 시간 제한(ms). 함수의 최악 소요(검색·고르기·링크 확인)가 약 70초라 넉넉히 둔다. */
const INVOKE_TIMEOUT_MS = 90_000;

/**
 * 등록 폼의 링크 찾기. 제품명·브랜드·입구 채널(도메인 또는 몰 id)만 보낸다 — OCR 원문·이미지는 보내지 않는다.
 * 못 찾음·한도 초과·네트워크 오류·시간 초과 등 어떤 실패든 null(링크 칸을 비워 둔다). throw 하지 않는다.
 */
export async function findPurchaseLink(
  productName: string,
  brand: string | null,
  channel: PurchaseChannel,
): Promise<PurchaseLink | null> {
  try {
    const { data, error } = await supabase.functions.invoke<{ link: PurchaseLink | null }>('find-purchase-links', {
      body: { productName, brand, ...(channel ?? {}) },
      timeout: INVOKE_TIMEOUT_MS,
    });
    if (error) {
      if (__DEV__) console.warn('[WishShot/purchaseLink] 실패', error.message);
      return null;
    }
    const link = data?.link;
    // 방어: https 주소만 받는다(함수도 https 만 돌려준다)
    if (!link || typeof link.url !== 'string' || !link.url.startsWith('https://')) return null;
    return link;
  } catch (e) {
    if (__DEV__) console.warn('[WishShot/purchaseLink] 실패', e);
    return null;
  }
}
