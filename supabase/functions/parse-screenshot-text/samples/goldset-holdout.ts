// 정답셋 홀드아웃 지정 — 시드 고정. labels.csv 의 holdout 열만 채운다(1 = 홀드아웃, 0 = 나머지).
// 유형(type)마다 25%(반올림)를 고른다. 순서는 SHA-256(시드 + ':' + id) 값의 오름차순이라
// 행 순서나 다른 칸과 상관없이 같은 id·유형이면 언제 다시 돌려도 같은 결과가 나온다.
// 홀드아웃은 프롬프트를 고칠 때 보지 않고 마지막 확인에만 쓴다(지시서 Step 4).
//
// 실행(Deno):
//   deno run --allow-read=supabase/functions/parse-screenshot-text/samples \
//     --allow-write=supabase/functions/parse-screenshot-text/samples/goldset/data \
//     supabase/functions/parse-screenshot-text/samples/goldset-holdout.ts [--data DIR] [--write] [--force]
//   --write 없이: 유형별 장수·홀드아웃 수만 출력(파일 안 바꿈)
//   --write: holdout 열을 쓴다. 이미 채운 holdout 이 있으면 중단(--force 로 다시 지정)
//
// 라벨에 오류가 있으면 지정하지 않는다(실행기 loadInputs 와 같은 검증). 원문·라벨 값은 출력하지 않는다(개수만).

import { loadInputs, parseCsv } from './goldset-eval.ts';

const SEED = 'goldset-v1-2026-11-06';
const RATE = 0.25;

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 유형별로 round(n × RATE)개를 해시 오름차순으로 고른다. 반환: 홀드아웃 id 집합. */
export async function pickHoldout(rows: { id: string; type: string }[], seed = SEED): Promise<Set<string>> {
  const byType = new Map<string, { id: string; key: string }[]>();
  for (const r of rows) {
    const list = byType.get(r.type) ?? [];
    list.push({ id: r.id, key: await sha256Hex(`${seed}:${r.id}`) });
    byType.set(r.type, list);
  }
  const picked = new Set<string>();
  for (const list of byType.values()) {
    list.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const x of list.slice(0, Math.round(list.length * RATE))) picked.add(x.id);
  }
  return picked;
}

async function main() {
  const args = [...Deno.args];
  const write = args.includes('--write');
  const force = args.includes('--force');
  const di = args.indexOf('--data');
  const dataDir: string | URL = di >= 0 ? args[di + 1].replace(/[\\/]?$/, '/') : new URL('goldset/data/', import.meta.url);

  const loaded = await loadInputs(dataDir);
  if (loaded.errors.length) {
    console.log(`라벨 오류 ${loaded.errors.length}건 — 홀드아웃을 지정하지 않습니다. 먼저 goldset-eval.ts --dry-run 으로 확인하세요.`);
    Deno.exit(1);
  }
  const rows = loaded.items.map((it: { id: string; label: { type: string } }) => ({ id: it.id, type: it.label.type }));
  const picked = await pickHoldout(rows);

  const types = [...new Set(rows.map((r) => r.type))].sort();
  console.log(`시드 ${SEED} · 유형별 ${RATE * 100}%(반올림)`);
  for (const t of types) {
    const n = rows.filter((r) => r.type === t).length;
    const k = rows.filter((r) => r.type === t && picked.has(r.id)).length;
    console.log(`  ${t}: ${n}장 중 홀드아웃 ${k}장`);
  }
  console.log(`  합계: ${rows.length}장 중 홀드아웃 ${picked.size}장`);
  if (!write) {
    console.log('(--write 없이 실행 — 파일은 바꾸지 않았습니다)');
    return;
  }

  const path = dataDir instanceof URL ? new URL('labels.csv', dataDir) : `${dataDir}labels.csv`;
  const text = await Deno.readTextFile(path);
  const csv: string[][] = parseCsv(text);
  const h = csv[0].map((x) => x.replace(/^﻿/, '').trim());
  const hi = h.indexOf('holdout');
  if (hi < 0) {
    console.log('labels.csv 에 holdout 열이 없습니다 — 중단');
    Deno.exit(1);
  }
  const filled = csv.slice(1).filter((r) => (r[hi] ?? '').trim() !== '').length;
  if (filled && !force) {
    console.log(`이미 holdout 을 채운 행 ${filled}개 — 중단(다시 지정하려면 --force)`);
    Deno.exit(1);
  }
  const bom = text.charCodeAt(0) === 0xfeff ? '﻿' : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const next = csv.map((r, i) => (i === 0 ? r : r.map((v, j) => (j === hi ? (picked.has(r[0].trim()) ? '1' : '0') : v))));
  await Deno.writeTextFile(path, bom + next.map((r) => r.map(csvCell).join(',')).join(eol) + eol);

  // 왕복 검사: holdout 열 밖은 글자 단위로 그대로인지, holdout 은 지정대로인지
  const back: string[][] = parseCsv(await Deno.readTextFile(path));
  let other = 0;
  let bad = 0;
  back.forEach((r, i) => r.forEach((v, j) => {
    if (j === hi && i > 0) {
      if (v !== (picked.has(r[0].trim()) ? '1' : '0')) bad++;
    } else if (v !== csv[i][j]) other++;
  }));
  console.log(`쓰기: ${back.length - 1}행 · holdout 불일치 ${bad} · holdout 밖에서 바뀐 칸 ${other}`);
  if (bad || other) Deno.exit(1);
}

if (import.meta.main) await main();
