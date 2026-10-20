// parse-screenshot-text 회귀 검증 — samples.md 케이스 1~7을 배포 없이 Anthropic API로 직접 호출한다.
// 배포 함수와 같은 prompt.ts 를 쓰므로 "배포 전 프롬프트"를 그대로 검증한다.
//
// 실행(Deno, 키는 셸 환경 변수로만 — 커밋·채팅 금지):
//   deno run --allow-net=api.anthropic.com --allow-env=ANTHROPIC_API_KEY \
//     supabase/functions/parse-screenshot-text/samples/eval.ts [반복횟수=1]
// 하나라도 FAIL 이면 종료 코드 1. temperature 0 이어도 서버 측 미세 비결정성이 있어 반복 3회 권장.

import { MODEL, OUTPUT_SCHEMA, TEMPERATURE, buildSystemPrompt } from '../prompt.ts';

type Expect = {
  price: number | null;
  nameIncludes?: string; // productName 에 포함돼야 하는 핵심어
  suggestedCategory?: string | null;
};

type Case = { id: string; text: string; categories?: string[]; expect: Expect };

const AESOP =
  '12:58 / 5G / Aesop. / Rōzu / Eau de Parfum / 296 / 25 / 30 / 203 /\n' +
  'working.hoho / 잔향은 또 파우더리한게 미친 향수예요. / Follow / Add comment...';

const CASES: Case[] = [
  {
    id: '1 정가·할인가 병기',
    text:
      '9:47 / 5G 78 / 8fter.co.kr / 신규가입 혜택 | 쿠폰팩 3만원 + 무료배송 /\n' +
      '8fter. / 지금까지 61407명이 관심을 보였어요. / 홀터 이지 브라탑 /\n' +
      '42,700원 / 32,900원 23% / 리뷰 80 / 구매하기',
    expect: { price: 42700, nameIncludes: '브라탑' },
  },
  { id: '2 가격 없음(좋아요 수)', text: AESOP, expect: { price: null } },
  {
    id: '3 할인가+쿠폰 노이즈',
    text:
      '5:20 / 5G 33 / m.dearcus.com / Instagram / DEAR.CUS /\n' +
      '오직 여기서만, 피니셔 스퀴지 UP TO 33% / 3차 입고 품절 되기 전에 놓치지 마세요 /\n' +
      '[비밀특가] 두 번 닦은 듯 깔끔하게 피니셔 스퀴지 / 30% 26,900원 18,900원 /\n' +
      '카카오톡 친구추가하면 2,000원 추가할인! / 5,000원 / 후기 보기 / 구매하기',
    expect: { price: 26900, nameIncludes: '스퀴지' },
  },
  {
    id: '4 카테고리 추천',
    text: AESOP,
    categories: ['운동', '향수', '주방'],
    expect: { price: null, suggestedCategory: '향수' },
  },
  {
    id: '5 추천 상품 가격 섞임',
    text:
      '10:12 / LTE 64 / 상품 상세 / 무드 린넨 셔츠 / 59,000원 / 리뷰 1,204 / 4.8 / 구매하기 /\n' +
      '함께 보면 좋은 상품 / 코튼 와이드 팬츠 / 45,000원 / 데님 버킷햇 / 29,000원',
    expect: { price: 59000, nameIncludes: '린넨 셔츠' },
  },
  {
    id: '6 숫자 노이즈만',
    text:
      '8:03 / 5G / dailyfit.official / 이번 시즌 최애 러닝화 / 구매 12,000+ / 리뷰 3,512 /\n' +
      '좋아요 2,348 / 245mm / 2024.09.12 / Follow',
    expect: { price: null },
  },
  {
    id: '7 외화 가격만',
    text:
      '11:30 / 5G / store.example.com / Ceramic Pour-Over Dripper / $17.51 /\n' +
      'Free shipping over $50 / Add to cart',
    expect: { price: null },
  },
];

type Parsed = {
  productName: string | null;
  price: number | null;
  brand: string | null;
  confidence: number;
  suggestedCategory: string | null;
};

// index.ts 와 같은 요청 바디(이미지 분기 제외 — 이 케이스들은 텍스트 전용).
async function callModel(apiKey: string, c: Case): Promise<Parsed> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      temperature: TEMPERATURE,
      system: buildSystemPrompt(c.categories ?? [], false),
      output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      messages: [{ role: 'user', content: c.text }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const block = data?.content?.find((b: { type?: string }) => b?.type === 'text');
  return JSON.parse(block.text) as Parsed;
}

// 실패 사유 목록(빈 배열 = PASS)
function check(p: Parsed, e: Expect): string[] {
  const fails: string[] = [];
  if (p.price !== e.price) fails.push(`price ${p.price} ≠ ${e.price}`);
  if (e.nameIncludes && !(p.productName ?? '').includes(e.nameIncludes)) {
    fails.push(`productName "${p.productName}" ∌ "${e.nameIncludes}"`);
  }
  if (e.suggestedCategory !== undefined && p.suggestedCategory !== e.suggestedCategory) {
    fails.push(`suggestedCategory ${p.suggestedCategory} ≠ ${e.suggestedCategory}`);
  }
  return fails;
}

const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY 환경 변수가 없습니다(samples.md "자동 검증" 참고).');
  Deno.exit(2);
}
const runs = Math.max(1, Number(Deno.args[0] ?? 1) || 1);

let failed = 0;
for (const c of CASES) {
  for (let r = 1; r <= runs; r++) {
    const tag = runs > 1 ? `${c.id} #${r}` : c.id;
    try {
      const p = await callModel(apiKey, c);
      const fails = check(p, c.expect);
      if (fails.length) failed++;
      const head = fails.length ? 'FAIL' : 'PASS';
      console.log(
        `${head}  ${tag}  → name="${p.productName}" brand="${p.brand}" price=${p.price} conf=${p.confidence}` +
          (fails.length ? `  [${fails.join('; ')}]` : ''),
      );
    } catch (err) {
      failed++;
      console.log(`ERROR ${tag}  ${(err as Error).message}`);
    }
  }
}

const total = CASES.length * runs;
console.log(`\n${total - failed}/${total} 통과`);
if (failed > 0) Deno.exit(1);
