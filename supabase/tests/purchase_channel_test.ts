// 앱의 입구 채널 판별(src/lib/purchaseChannel.ts — import 없는 순수 TS) 단위 검증. 앱엔 테스트 실행기가 없어
// 구매처 함수 시험과 같이 Deno 로 돌린다(네트워크·키 없음).
// 실행: deno test --no-lock supabase/tests/purchase_channel_test.ts
import { detectPurchaseChannel, findMalls } from '../../src/lib/purchaseChannel.ts';

function eq(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}

Deno.test('몰 단독 표기·행사 이름·공식 계정: 상품명·브랜드에 있어도 그 몰', () => {
  // 상품명에만 '[오늘의집 단독]'이 있는 오늘의집 앱 캡처
  eq(
    detectPurchaseChannel('[오늘의집 단독] 토리 와이드 서랍장\n특별인증가\n10% 183,000', ['[오늘의집 단독] 토리 와이드 서랍장', null]),
    { mall: 'ohou' },
  );
  eq(detectPurchaseChannel('[무신사 단독] 데님 자켓\n89,000원', ['[무신사 단독] 데님 자켓', '리바이스']), { mall: 'musinsa' });
  eq(detectPurchaseChannel('[29CM 단독] 울 코트\n259,000원', ['[29CM 단독] 울 코트', '브랜드']), { mall: '29cm' });
  // 정제가 29CM 행사 이름을 브랜드로 뽑은 29CM 앱 캡처
  eq(detectPurchaseChannel('이구패션위크\nHAZE 아이보리\n89,000원', ['HAZE 아이보리', '이구패션위크']), { mall: '29cm' });
  eq(detectPurchaseChannel('이구위크 최대 혜택\n니트\n59,000원', ['니트', null]), { mall: '29cm' });
  // 29CM 공식 인스타 게시물(계정명 — 도메인으로 읽지 않는다)
  eq(detectPurchaseChannel('29CM\n29cm.official\n29cm.official 가을이라고 맨날 밤색\n추천 릴', ['HAZE 아이보리', '엄브로']), {
    mall: '29cm',
  });
});

Deno.test('치수·일반 글자는 29CM·오늘의집으로 읽지 않는다(종전과 같음)', () => {
  eq(detectPurchaseChannel('가로 29cm 세로 40cm\n수납함\n12,000원', ['수납함', null]), null);
  eq(detectPurchaseChannel('가로 29cm 단독 설치 가능\n원목 선반', ['원목 선반', null]), null, '단독 표기는 대괄호로 시작할 때만');
  eq(detectPurchaseChannel('29CM\n니트\n59,000원', ['니트', null]), null);
  eq(detectPurchaseChannel('29cm단독\n니트', ['니트', null]), null);
  eq(detectPurchaseChannel('오늘의 집밥 레시피\n냄비\n30,000원', ['냄비', null]), null);
  eq(detectPurchaseChannel('지그재그 패턴 니트\n39,000원', ['지그재그 패턴 니트', null]), null);
});

Deno.test('브랜드 이름은 강한 문구가 아니다 — 무신사 스탠다드 쿠팡 캡처는 쿠팡', () => {
  eq(detectPurchaseChannel('로켓배송\n무신사 스탠다드 와이드 슬랙스', ['와이드 슬랙스', '무신사 스탠다드']), { mall: 'coupang' });
});

Deno.test('여러 몰이 보이면 판별하지 않는다', () => {
  eq(findMalls('29cm.official\n무신사에서도 판매', ['코트', null]), ['musinsa', '29cm']);
  eq(detectPurchaseChannel('29cm.official\n무신사에서도 판매', ['코트', null]), null);
  eq(detectPurchaseChannel('[오늘의집 단독] 서랍장\n로켓배송', ['서랍장', null]), null);
});

Deno.test('주소가 보이면 주소가 먼저(종전과 같음)', () => {
  eq(detectPurchaseChannel('Https://www.musinsa.com/products/2009089\n채팅하기', ['가디건', '메종키츠네']), {
    domain: 'musinsa.com',
  });
  eq(detectPurchaseChannel('29cm.co.kr\n이구위크\n니트', ['니트', null]), { domain: '29cm.co.kr' });
});
