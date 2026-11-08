import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { detectPurchaseChannel } from '@/lib/purchaseChannel';
import { findPurchaseLink, setSourceLinkIfEmpty, type PurchaseLink } from '@/lib/queries';

/** 진행 중(또는 끝난) 링크 찾기 한 건. promise 는 throw 하지 않는다(실패 = null). */
export interface LinkSearch {
  key: string;
  promise: Promise<PurchaseLink | null>;
}

/** 저장 뒤 이 시간이 지나 도착한 결과는 붙이지 않는다(다른 화면에서 뒤늦게 안내가 뜨지 않게 — 놓친 것으로 본다). */
const ATTACH_WINDOW_MS = 3 * 60_000;

/**
 * 등록 폼의 링크 자동 찾기(구매처 찾기).
 *
 * - `enabled` 이고 AI 정제 결과에 제품명이 있으면, (제품명·브랜드·입구 채널) 조합마다 한 번만 함수를 부른다
 *   (조합별로 결과를 보관해 A→B→A 로 돌아와도 다시 부르지 않는다 — 한도·비용).
 * - 다시 분석해 조합이 바뀌면 그 조합의 결과만 내보낸다(늦게 도착한 다른 조합의 결과가 지우지 않는다).
 * - `blockNewRef.current` 가 true 면 새 찾기를 시작하지 않는다(저장이 시작된 뒤 — 결과를 붙일 곳이 없다).
 * - 입구 채널은 OCR 원문으로 기기에서 판별하고, 원문은 보내지 않는다(@/lib/purchaseChannel).
 * - `link`: 현재 조합으로 찾은 링크(없으면 null). `searching`: 현재 조합을 찾는 중.
 * - `takeForHandOff()`: 저장 직전에 부른다 — 현재 조합의 찾기를 돌려준다(저장 뒤 이어 받기용).
 *   화면 상태가 바뀌기 전(markSubmitted 전)에 잡아 둬야 한다.
 */
export function usePurchaseLinkSearch(input: {
  enabled: boolean;
  productName: string | null;
  brand: string | null;
  ocrText: string | null;
  blockNewRef: RefObject<boolean>;
}) {
  const { enabled, productName, brand, ocrText, blockNewRef } = input;
  const channel = useMemo(() => detectPurchaseChannel(ocrText), [ocrText]);
  const currentKey = enabled && productName ? JSON.stringify([productName, brand ?? null, channel]) : null;

  // 조합(key)별 결과와 진행 중 찾기
  const [results, setResults] = useState<Record<string, PurchaseLink | null>>({});
  const searchesRef = useRef(new Map<string, LinkSearch>());
  const currentKeyRef = useRef<string | null>(currentKey);

  useEffect(() => {
    currentKeyRef.current = currentKey;
  }, [currentKey]);

  useEffect(() => {
    if (!currentKey || !productName) return;
    if (searchesRef.current.has(currentKey)) return; // 같은 조합은 다시 부르지 않는다
    if (blockNewRef.current) return;
    const search: LinkSearch = { key: currentKey, promise: findPurchaseLink(productName, brand, channel) };
    searchesRef.current.set(currentKey, search);
    void search.promise.then((link) => {
      setResults((prev) => ({ ...prev, [search.key]: link }));
    });
  }, [currentKey, productName, brand, channel, blockNewRef]);

  const done = currentKey !== null && Object.prototype.hasOwnProperty.call(results, currentKey);
  const link = done ? results[currentKey!] : null;
  // 찾기를 시작했고(맵에 있음) 아직 결과가 없으면 찾는 중. 렌더 중 ref 를 읽지 않도록 결과 유무로만 판단한다:
  // 시작은 currentKey 가 정해진 직후 effect 에서 일어나므로, 결과가 없으면 찾는 중으로 본다.
  const searching = currentKey !== null && !done;

  function takeForHandOff(): LinkSearch | null {
    const key = currentKeyRef.current;
    return key ? (searchesRef.current.get(key) ?? null) : null;
  }

  return { link, searching, takeForHandOff };
}

/**
 * 저장 뒤 링크 붙이기: 찾기가 끝나면 그 위시의 링크가 **아직 비어 있을 때만** 붙이고 onAttached 를 부른다.
 * 화면이 닫혀도 계속된다(이 함수는 화면 상태를 쓰지 않는다). 앱이 백그라운드로 가 결과를 놓치거나
 * 저장 뒤 ATTACH_WINDOW_MS 가 지나 도착하면 비워 둔다.
 * 링크 외 필드는 바꾸지 않는다(제품명·브랜드는 중복 판정에 쓰여 저장 뒤 바꾸면 충돌할 수 있다).
 */
export function attachLinkAfterSave(search: LinkSearch, itemId: string, onAttached: (itemId: string) => void): void {
  const savedAt = Date.now();
  void (async () => {
    const link = await search.promise;
    if (!link || Date.now() - savedAt > ATTACH_WINDOW_MS) return;
    try {
      if (await setSourceLinkIfEmpty(itemId, link.url)) onAttached(itemId);
    } catch (e) {
      if (__DEV__) console.warn('[WishShot/purchaseLink] 저장 뒤 붙이기 실패', e);
    }
  })();
}
