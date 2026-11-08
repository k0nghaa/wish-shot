// AI 정제 요청 한도 실제 동작 시험 — 운영 parse-screenshot-text 를 공개 anon 키로만 호출한다.
//
// 하는 일:
//   1) 새 익명 세션을 1개 만든다(앱과 같은 익명 로그인).
//   2) 2,001자 가짜 텍스트를 1번 보낸다 → 400 text_too_long 기대(LLM 미호출·한도에 안 셈).
//   3) 짧은 가짜 텍스트를 (한도 + 1)번 보낸다 → 한도까지 200, 마지막은 429(scope=user) + Retry-After 기대.
//   실제 사진·OCR 원문은 쓰지 않는다. LLM 호출은 허용된 요청 수만큼만 나간다(--limit 2 면 2번).
//
// 실행(사람, 이 워크트리 루트에서 — 키는 .env 의 공개 값만 읽는다):
//   npx supabase@2.121.0 secrets set PARSE_LIMIT_USER_HOURLY=2        # 시험용으로 낮춤(재배포 불필요)
//   deno run --allow-net --allow-env=EXPO_PUBLIC_SUPABASE_URL,EXPO_PUBLIC_SUPABASE_ANON_KEY --env-file=.env supabase/tests/parse_quota_live.ts --limit 2
//   npx supabase@2.121.0 secrets unset PARSE_LIMIT_USER_HOURLY        # 바로 되돌림(기본값 30)
//   ※ 한도를 낮춘 동안은 모든 사용자가 시간당 2회로 제한되므로 시험 직후 바로 되돌린다.
//
// 시험 뒤(SQL Editor):
//   - supabase/tests/parse_failures.sql §4 의 <UID> 를 아래 출력의 사용자 id 로 바꿔 실행
//     → rate_limited_user 1건, text_too_long 1건(max_len 2001) 기대.
//   - 시험 계정을 지표에서 빼려면: insert into ops.internal_users (user_id, note) values ('<UID>', '요청 한도 실제 시험');
//   - 시험 계정은 아이템이 없어 30일 뒤 빈 익명 계정 정리 잡이 지운다(실패 기록은 남는다).

const SUPABASE_URL = Deno.env.get('EXPO_PUBLIC_SUPABASE_URL')?.replace(/\/+$/, '');
const ANON_KEY = Deno.env.get('EXPO_PUBLIC_SUPABASE_ANON_KEY');
if (!SUPABASE_URL || !ANON_KEY) {
  console.error('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY 가 없습니다(--env-file=.env 확인).');
  Deno.exit(2);
}

function argInt(name: string, fallback: number): number {
  const i = Deno.args.indexOf(name);
  const n = i >= 0 ? Number(Deno.args[i + 1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : fallback;
}
const LIMIT = argInt('--limit', 2); // 서버에 설정한 PARSE_LIMIT_USER_HOURLY 와 같아야 한다

// 1) 익명 로그인(auth-js signInAnonymously 와 같은 요청)
const signup = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: {}, gotrue_meta_security: {} }),
});
const session = await signup.json().catch(() => null) as
  | { access_token?: string; user?: { id?: string; is_anonymous?: boolean } }
  | null;
if (!signup.ok || !session?.access_token || !session.user?.id) {
  console.error(`익명 로그인 실패: HTTP ${signup.status}`);
  Deno.exit(1);
}
const accessToken = session.access_token;
const userId = session.user.id;
console.log(`시험 사용자 id: ${userId}  (익명: ${session.user.is_anonymous === true})`);
console.log(`가정한 사용자 시간당 한도: ${LIMIT}\n`);

type Row = { step: string; status: number; error: string; scope: string; retryAfter: string; ms: number };
async function call(step: string, text: string): Promise<Row> {
  const t0 = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/parse-screenshot-text`, {
    method: 'POST',
    headers: { apikey: ANON_KEY!, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const body = await res.json().catch(() => ({})) as { error?: unknown; scope?: unknown };
  return {
    step,
    status: res.status,
    error: typeof body.error === 'string' ? body.error : '',
    scope: typeof body.scope === 'string' ? body.scope : '',
    retryAfter: res.headers.get('retry-after') ?? '',
    ms: Date.now() - t0,
  };
}

// 2) 입력 상한(한도에 세지 않음) → 3) 한도 + 1 번
const FAKE_TEXT = 'WishShot 요청 한도 시험 무지 반팔 티셔츠 12,000원'; // 실제 사용자 데이터 아님
const rows: Row[] = [];
rows.push(await call('2,001자 텍스트', '가'.repeat(2001)));
for (let i = 1; i <= LIMIT + 1; i++) rows.push(await call(`짧은 텍스트 ${i}`, FAKE_TEXT));
console.table(rows);

// 판정
const checks: [string, boolean][] = [
  ['2,001자 → 400 text_too_long', rows[0].status === 400 && rows[0].error === 'text_too_long'],
];
for (let i = 1; i <= LIMIT; i++) {
  checks.push([`짧은 텍스트 ${i} → 200(한도 안)`, rows[i].status === 200]);
}
const last = rows[LIMIT + 1];
const retry = Number(last.retryAfter);
checks.push([`짧은 텍스트 ${LIMIT + 1} → 429 rate_limited, scope=user`,
  last.status === 429 && last.error === 'rate_limited' && last.scope === 'user']);
checks.push([`Retry-After 가 1~3600초(실제 ${last.retryAfter || '없음'})`,
  Number.isInteger(retry) && retry >= 1 && retry <= 3600]);

console.log('');
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
const allOk = checks.every(([, ok]) => ok);
console.log(allOk
  ? `\n모든 검사 통과. parse_failures.sql §4 의 <UID> 에 ${userId} 를 넣어 기록을 확인하세요.`
  : '\n일부 실패. 한도를 낮춘 직후라면 1분쯤 뒤 다시 실행(새 익명 세션으로 시작)하거나, 출력 표를 알려 주세요.');
Deno.exit(allOk ? 0 : 1);
