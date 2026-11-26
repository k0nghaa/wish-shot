// 계측 이벤트 타입(src/lib/analytics.ts)이 작업 문서 설계 5의 표와 이름·속성·값까지 같은지 대조한다.
// analytics.ts 는 PostHog 를 불러오므로 import 하지 않고 글자로 읽는다. 문서가 바뀌면 이 시험이 다시 대조한다.
// 실행: deno test --no-lock --allow-read supabase/tests/analytics_events_test.ts
const doc = await Deno.readTextFile(new URL('../../docs/phases/phase-22-account-login.md', import.meta.url));
const src = await Deno.readTextFile(new URL('../../src/lib/analytics.ts', import.meta.url));

type Spec = { keys: string[]; values: Record<string, string[]> };

// 문서 표: | `이벤트` | `속성`: a/b/c, `속성` ... |
function docEvents(): Map<string, Spec> {
  const section = doc.slice(doc.indexOf('### 5. 계측 이벤트'), doc.indexOf('### 6. 파일 담당'));
  const out = new Map<string, Spec>();
  for (const m of section.matchAll(/^\| `(\w+)` \| (.*) \|\s*$/gm)) {
    const spec: Spec = { keys: [], values: {} };
    for (const part of m[2].split(/,\s*(?=`)/)) {
      const kv = part.match(/^`(\w+)`(?::\s*(.*))?$/);
      if (!kv) continue;
      spec.keys.push(kv[1]);
      if (kv[2]) spec.values[kv[1]] = kv[2].split('/').map((v) => v.trim());
    }
    out.set(m[1], spec);
  }
  return out;
}

// 코드: AnalyticsEventMap 안의 `이름: { ... };` 또는 `이름: Record<string, never>;`
function codeBody(name: string): string {
  const map = src.slice(src.indexOf('export type AnalyticsEventMap'), src.indexOf('/** 로그인을 권한 곳'));
  const start = map.search(new RegExp(`^  ${name}: `, 'm'));
  if (start < 0) throw new Error(`코드에 이벤트 없음: ${name}`);
  let depth = 0;
  for (let i = start; i < map.length; i++) {
    const c = map[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ';' && depth === 0) return map.slice(start + name.length + 3, i).trim();
  }
  throw new Error(`이벤트 끝을 못 찾음: ${name}`);
}

function aliasLiterals(name: string): string[] {
  const m = src.match(new RegExp(`export type ${name} =([^;]*);`));
  if (!m) throw new Error(`별칭 없음: ${name}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function codeProps(body: string): Map<string, string[] | null> {
  const props = new Map<string, string[] | null>();
  if (!body.startsWith('{')) return props; // Record<string, never> = 속성 없음
  for (const m of body.matchAll(/(\w+): ([^;]+?)(?:;|\s*\})/g)) {
    const type = m[2].trim();
    const alias = /^[A-Z]\w+$/.test(type) ? aliasLiterals(type) : null;
    const literals = alias ?? [...type.matchAll(/'([^']+)'/g)].map((x) => x[1]);
    props.set(m[1], literals.length ? literals : null);
  }
  return props;
}

const sorted = (a: string[]) => [...a].sort();

Deno.test('계측 이벤트: 문서 설계 5의 8개 이벤트가 코드에 같은 이름·속성·값으로 있다', () => {
  const events = docEvents();
  const expected = ['sign_in_viewed', 'sign_in_skipped', 'sign_in_result', 'wishes_merged', 'nickname_saved', 'signed_out', 'apple_credential_revoked', 'account_deleted'];
  if (JSON.stringify([...events.keys()]) !== JSON.stringify(expected)) {
    throw new Error(`문서 표를 읽지 못함: ${[...events.keys()].join(', ')}`);
  }
  for (const [name, spec] of events) {
    const props = codeProps(codeBody(name));
    if (JSON.stringify(sorted([...props.keys()])) !== JSON.stringify(sorted(spec.keys))) {
      throw new Error(`${name}: 속성 이름이 다름 — 문서 ${spec.keys.join(',')} / 코드 ${[...props.keys()].join(',')}`);
    }
    for (const [key, values] of Object.entries(spec.values)) {
      const code = props.get(key);
      if (!code || JSON.stringify(sorted(code)) !== JSON.stringify(sorted(values))) {
        throw new Error(`${name}.${key}: 값이 다름 — 문서 ${values.join('/')} / 코드 ${code?.join('/') ?? '(없음)'}`);
      }
    }
  }
});

Deno.test('계측 이벤트: 속성은 enum·boolean·수치뿐(사용자 콘텐츠 타입 없음)', () => {
  for (const name of docEvents().keys()) {
    const body = codeBody(name);
    if (/\bstring\b/.test(body.replace('Record<string, never>', ''))) throw new Error(`${name}: string 속성 금지`);
  }
});
