// parse-screenshot-text 정답셋 측정 실행기 — 사람이 붙인 정답(labels.csv)으로 가격 자동채움 정확도를 잰다.
// eval.ts(회귀 7케이스)의 호출·판정 구조를 바탕으로, 변형(프롬프트·온도·모델) × 회차를 돌려 지표를 낸다.
// 측정 전용이다. prompt.ts·index.ts(운영 함수)는 바꾸지 않고 읽기만 한다. 규칙: goldset/LABELING.md
//
// 실행(Deno, 키는 셸 환경 변수로만 — 커밋·채팅 금지. samples.md "자동 검증"):
//   deno run --allow-net=api.anthropic.com --allow-env=ANTHROPIC_API_KEY \
//     --allow-read=supabase/functions/parse-screenshot-text/samples \
//     --allow-write=supabase/functions/parse-screenshot-text/samples/goldset/out \
//     supabase/functions/parse-screenshot-text/samples/goldset-eval.ts --runs 3 --dry-run
//   (--dry-run: API를 부르지 않고 입력 검증·호출 수만 출력. 키·쓰기 권한 불필요)
//
// 옵션:
//   --runs N               변형별 회차(기본 3). 대표 출력 = 다수결(과반) 가격
//   --variants a,b,...     기본 v0,v1,v2,v1h,v1h-think
//   --dry-run              API 미호출. 입력 검증 + 변형·N·총 호출 수 출력
//   --only-holdout         holdout=1 행만 / --exclude-holdout: holdout=1 행 제외
//   --data DIR             raw.csv·labels.csv 폴더(기본 goldset/data). 가상 fixture 검증: goldset/fixture
//   --out DIR              결과 폴더(기본 goldset/out)
//   --concurrency N        동시 호출 수(기본 3)
//   --force                기존 결과 파일 덮어쓰기 허용(기본은 있으면 중단 — 비싼 실행 결과 보호)
//   --retry-errors         기존 results.csv 의 ERROR 행만 다시 호출해 바꾸고 summary 를 다시 만든다
//                          (같은 --runs·--variants·부분집합으로 실행. ERROR 가 없으면 summary 만 다시 만든다)
//   --crlf-to-lf           원문의 CR(\r)을 LF 로 바꿔 보낸다. 기본은 CR 이 있으면 중단 — 앱 OCR 원문엔 CR 이 없어
//                          내보내기 과정에서 생긴 것이기 때문(그대로 보내면 운영과 바디가 달라진다). 쓰면 summary 에 기록
//
// 출력(goldset/out — git 제외): results.csv(행 = 장 × 변형 × 회차), summary.md(지시서 3절 지표 — 전체·유형별·품목별, 'b장 중 a장').
// 원문·상품명은 콘솔·summary 에 찍지 않는다(id·숫자만). results.csv 엔 모델 출력(상품명 등)이 있어 git 제외 폴더에만 쓴다.
// export 된 함수는 API 없이 판정·파싱을 검증하기 위한 것이다. 직접 실행할 때만 main() 이 돈다(import.meta.main).

import {
  MODEL as CURRENT_MODEL,
  OUTPUT_SCHEMA as CURRENT_SCHEMA,
  TEMPERATURE as CURRENT_TEMPERATURE,
  buildSystemPrompt as buildCurrentPrompt,
} from '../prompt.ts';
import {
  OUTPUT_SCHEMA as SCHEMA_1004,
  TEMPERATURE as TEMPERATURE_1004,
  buildSystemPrompt as build1004Prompt,
} from './prompt-2026-10-04.ts';

// ───────────────────────── 상수 ─────────────────────────

/**
 * 비교 대상 최신 Haiku. 실행기 안에서만 쓴다(운영 MODEL 은 prompt.ts 그대로).
 * 공식 문서 확인(2026-11-03, platform.claude.com/docs/en/models/haiku-5-5/overview·migration-guide):
 * - 구조화 출력(output_config.format json_schema) 지원(structured-outputs 문서 지원 모델 목록).
 * - temperature/top_p/top_k 는 생략해야 한다("Omit temperature, top_p, and top_k") → temperature 0 불가,
 *   생략 = 기본값 1.0. 그래서 v1h 계열은 온도를 보내지 않는다(현재 운영 v1 의 0 과 다름 → v2 로 온도 효과 분리).
 * - adaptive thinking 기본 on, effort 기본 medium. thinking 토큰도 max_tokens 에 포함된다.
 *   thinking disabled 는 effort low~high 에서만 허용.
 * - 단가: 입력 $0.10 / 출력 $0.50 per MTok(프롬프트 10만 토큰 이하). 토크나이저가 바뀌어 같은 글이 약 30% 더 많은 토큰.
 */
const LATEST_HAIKU = 'claude-haiku-5-5';

/** 앱과 같은 텍스트 분기 기준: 원문이 이보다 짧으면 앱은 정제를 부르지 않는다(src/hooks/useAnalysis.ts OCR_MIN_CHARS). */
const OCR_MIN_CHARS = 20;
/** 운영 함수와 같은 출력 상한(index.ts max_tokens). */
const MAX_TOKENS = 400;
/** thinking 을 켠 변형은 생각 토큰이 상한을 같이 쓰므로 넉넉히 둔다(잘리면 TRUNCATED 로 따로 센다). */
const THINK_MAX_TOKENS = 4000;
/** 앱의 "확인이 필요해요" 기준(src/hooks/useAnalysis.ts LOW_CONFIDENCE_THRESHOLD). 바꾸지 않고 재기만 한다. */
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7];
/** 측정용 호출 타임아웃. 운영(20초)보다 넉넉히 — 정확도를 재는 것이지 지연을 재는 게 아니다. */
const CALL_TIMEOUT_MS = 60_000;
/** 화면 유형(LABELING.md 2절). G = 중고거래 상세(2026-11-05 추가 — 정답은 판매자 등록가, 정가 우선 미적용). */
const TYPES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;
type LabelType = (typeof TYPES)[number];
/**
 * 라벨 선택 열 price_foreign 형식: ISO 통화 코드 + 공백 + 화면의 숫자(콤마 없이, 소수점은 화면대로). 예: `JPY 3980`, `USD 17.51`.
 * 채점에는 쓰지 않는다 — 다음 Phase 에서 외화 처리를 바꿀 때 같은 정답셋으로 다시 재기 위한 기록(2026-11-05 결정).
 */
const FOREIGN_RE = /^[A-Z]{3} \d+(\.\d+)?$/;
/**
 * 품목(라벨 item_category, 2026-11-04 추가). 판정엔 쓰지 않고 품목별 집계에만 쓴다.
 * 입력은 norm() 으로 비교해 가운뎃점·슬래시·공백 차이를 같은 값으로 받는다('가구/인테리어' → '가구·인테리어').
 */
const CATEGORIES = ['생활용품', '가구·인테리어', '패션', '뷰티', '전자', '기타'] as const;
type ItemCategory = (typeof CATEGORIES)[number];

/** 라벨 품목 값을 표준 표기로 바꾼다. 목록에 없으면 null. */
export function toCategory(s: string): ItemCategory | null {
  const n = norm(s);
  return n === '' ? null : (CATEGORIES.find((c) => norm(c) === n) ?? null);
}

// ───────────────────────── 변형 ─────────────────────────

export type Variant = {
  key: string;
  desc: string;
  model: string;
  prompt: '2026-10-04' | 'current';
  system: string;
  schema: unknown;
  /** undefined = 요청에서 temperature 필드 생략(API 기본값 1.0) */
  temperature: number | undefined;
  /** undefined = 요청에서 thinking 필드 생략 */
  thinking: { type: 'disabled' } | { type: 'adaptive' } | undefined;
  /** undefined = 요청에서 effort 생략 */
  effort: 'low' | 'medium' | 'high' | undefined;
  maxTokens: number;
};

// 카테고리는 보내지 않는다(buildSystemPrompt([], false)) — 가격 측정과 무관하고 변형 사이 조건을 같게 둔다.
export const VARIANTS: Record<string, Variant> = {
  v0: {
    key: 'v0',
    desc: '10/04 프롬프트 + 당시 온도(생략=1.0) + 현재 모델',
    model: CURRENT_MODEL,
    prompt: '2026-10-04',
    system: build1004Prompt([], false),
    schema: SCHEMA_1004,
    temperature: TEMPERATURE_1004,
    thinking: undefined,
    effort: undefined,
    maxTokens: MAX_TOKENS,
  },
  v1: {
    key: 'v1',
    desc: '현재 프롬프트 + 현재 온도(0) + 현재 모델 = 운영',
    model: CURRENT_MODEL,
    prompt: 'current',
    system: buildCurrentPrompt([], false),
    schema: CURRENT_SCHEMA,
    temperature: CURRENT_TEMPERATURE,
    thinking: undefined,
    effort: undefined,
    maxTokens: MAX_TOKENS,
  },
  v2: {
    key: 'v2',
    desc: '현재 프롬프트 + 당시 온도(생략=1.0) + 현재 모델 — 규칙 효과(v0→v2)·온도 효과(v2→v1) 분리',
    model: CURRENT_MODEL,
    prompt: 'current',
    system: buildCurrentPrompt([], false),
    schema: CURRENT_SCHEMA,
    temperature: TEMPERATURE_1004,
    thinking: undefined,
    effort: undefined,
    maxTokens: MAX_TOKENS,
  },
  v1h: {
    key: 'v1h',
    desc: '현재 프롬프트 + 최신 Haiku, thinking 끔(온도 생략=1.0, effort medium)',
    model: LATEST_HAIKU,
    prompt: 'current',
    system: buildCurrentPrompt([], false),
    schema: CURRENT_SCHEMA,
    temperature: undefined,
    thinking: { type: 'disabled' },
    effort: 'medium',
    maxTokens: MAX_TOKENS,
  },
  'v1h-think': {
    key: 'v1h-think',
    desc: '현재 프롬프트 + 최신 Haiku, thinking 기본(adaptive, effort medium, 온도 생략=1.0)',
    model: LATEST_HAIKU,
    prompt: 'current',
    system: buildCurrentPrompt([], false),
    schema: CURRENT_SCHEMA,
    temperature: undefined,
    thinking: { type: 'adaptive' },
    effort: 'medium',
    maxTokens: THINK_MAX_TOKENS,
  },
};
const DEFAULT_VARIANTS = ['v0', 'v1', 'v2', 'v1h', 'v1h-think'];

// ───────────────────────── 인자 ─────────────────────────

export type Options = {
  runs: number;
  variants: Variant[];
  dryRun: boolean;
  subset: 'all' | 'only-holdout' | 'exclude-holdout';
  dataDir: string | URL;
  outDir: string | URL;
  concurrency: number;
  force: boolean;
  retryErrors: boolean;
  crlfToLf: boolean;
};

const HERE = new URL('.', import.meta.url);

function usageAndExit(msg: string): never {
  console.error(`인자 오류: ${msg}`);
  console.error(
    '사용: goldset-eval.ts [--runs N] [--variants v0,v1,...] [--dry-run] [--only-holdout | --exclude-holdout] ' +
      '[--data DIR] [--out DIR] [--concurrency N] [--force] [--retry-errors] [--crlf-to-lf]',
  );
  Deno.exit(2);
}

function parseArgs(args: string[]): Options {
  const o: Options = {
    runs: 3,
    variants: DEFAULT_VARIANTS.map((k) => VARIANTS[k]),
    dryRun: false,
    subset: 'all',
    dataDir: new URL('goldset/data/', HERE),
    outDir: new URL('goldset/out/', HERE),
    concurrency: 3,
    force: false,
    retryErrors: false,
    crlfToLf: false,
  };
  const value = (i: number, flag: string): string => {
    const v = args[i + 1];
    if (v === undefined || v.startsWith('--')) usageAndExit(`${flag} 값이 없습니다`);
    return v;
  };
  const positiveInt = (s: string, flag: string): number => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 1) usageAndExit(`${flag} 는 1 이상의 정수여야 합니다`);
    return n;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--runs':
        o.runs = positiveInt(value(i, a), a);
        i++;
        break;
      case '--variants': {
        const keys = value(i, a).split(',').map((s) => s.trim()).filter(Boolean);
        const unknown = keys.filter((k) => !(k in VARIANTS));
        if (unknown.length) usageAndExit(`알 수 없는 변형: ${unknown.join(', ')} (가능: ${Object.keys(VARIANTS).join(', ')})`);
        if (new Set(keys).size !== keys.length) usageAndExit('변형이 중복됐습니다');
        o.variants = keys.map((k) => VARIANTS[k]);
        i++;
        break;
      }
      case '--dry-run':
        o.dryRun = true;
        break;
      case '--only-holdout':
      case '--exclude-holdout': {
        const s = a === '--only-holdout' ? 'only-holdout' : 'exclude-holdout';
        if (o.subset !== 'all' && o.subset !== s) usageAndExit('--only-holdout 과 --exclude-holdout 은 함께 쓸 수 없습니다');
        o.subset = s;
        break;
      }
      case '--data':
        o.dataDir = withSlash(value(i, a));
        i++;
        break;
      case '--out':
        o.outDir = withSlash(value(i, a));
        i++;
        break;
      case '--concurrency':
        o.concurrency = positiveInt(value(i, a), a);
        i++;
        break;
      case '--force':
        o.force = true;
        break;
      case '--retry-errors':
        o.retryErrors = true;
        break;
      case '--crlf-to-lf':
        o.crlfToLf = true;
        break;
      default:
        usageAndExit(`알 수 없는 인자 ${a}`);
    }
  }
  if (o.retryErrors && o.force) usageAndExit('--retry-errors 는 기존 결과를 이어 쓰므로 --force 와 함께 쓸 수 없습니다');
  return o;
}

function withSlash(p: string): string {
  return p.endsWith('/') || p.endsWith('\\') ? p : `${p}/`;
}

function joinPath(dir: string | URL, name: string): string | URL {
  return dir instanceof URL ? new URL(name, dir) : `${dir}${name}`;
}

function showPath(p: string | URL): string {
  if (!(p instanceof URL)) return p;
  // 레포 기준 상대 경로로 보여 준다(samples/ 아래).
  const rel = decodeURIComponent(p.href.slice(HERE.href.length));
  return `samples/${rel}`;
}

// ───────────────────────── CSV ─────────────────────────

/** RFC 4180 CSV 파서. 따옴표 안 줄바꿈·콤마·"" 를 지원하고 필드 내용은 손대지 않는다(원문 재현). */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      inQuotes = true;
      i++;
    } else if (c === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\r' || c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += c;
      i++;
    }
  }
  if (inQuotes) throw new Error('CSV: 닫히지 않은 따옴표가 있습니다');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // 완전히 빈 줄 제거
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toRecords(rows: string[][], fileLabel: string, required: string[]): Record<string, string>[] {
  if (rows.length === 0) throw new Error(`${fileLabel}: 비어 있습니다`);
  const header = rows[0].map((h) => h.trim());
  const missing = required.filter((r) => !header.includes(r));
  if (missing.length) throw new Error(`${fileLabel}: 헤더에 ${missing.join(', ')} 열이 없습니다`);
  return rows.slice(1).map((r, idx) => {
    if (r.length !== header.length) {
      throw new Error(`${fileLabel}: ${idx + 2}번째 줄의 칸 수(${r.length})가 헤더(${header.length})와 다릅니다`);
    }
    const rec: Record<string, string> = {};
    header.forEach((h, j) => (rec[h] = r[j]));
    return rec;
  });
}

/** UTF-8 이 아닌 파일(예: 엑셀 기본 저장 CP949)은 읽으면 U+FFFD 로 깨진다 → 조용히 틀리지 않게 중단. */
async function readUtf8(path: string | URL, label: string): Promise<string> {
  const text = await Deno.readTextFile(path);
  if (text.includes('�')) {
    throw new Error(`${label}: UTF-8 이 아닌 글자가 있습니다. 엑셀이면 'CSV UTF-8(쉼표로 분리)'로 다시 저장하세요`);
  }
  return text;
}

// ───────────────────────── 입력 로드·검증 ─────────────────────────

type Label = {
  id: string;
  type: LabelType;
  category: ItemCategory;
  priceGold: number | null;
  priceList: number | null;
  priceSale: number | null;
  nameKeywords: string[];
  brandAliases: string[];
  holdout: boolean | null; // null = 미지정
};

export type Item = { id: string; raw: string; label: Label; ocrShort: boolean };

type Loaded = {
  items: Item[];
  errors: string[];
  warnings: string[];
  rawCount: number;
  labelCount: number;
  /** CR 이 든 원문 수(변환 전 기준) */
  crCount: number;
};

const INT_RE = /^\d+$/;

function splitAlts(s: string): string[] {
  return s.split('|').map((x) => x.trim()).filter(Boolean);
}

export async function loadInputs(dataDir: string | URL, crlfToLf = false): Promise<Loaded> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rawRecs = toRecords(parseCsv(await readUtf8(joinPath(dataDir, 'raw.csv'), 'raw.csv')), 'raw.csv', ['id', 'raw_text']);
  const labelRecs = toRecords(
    parseCsv(await readUtf8(joinPath(dataDir, 'labels.csv'), 'labels.csv')),
    'labels.csv',
    ['id', 'type', 'item_category', 'price_gold'],
  );

  const raws = new Map<string, string>();
  for (const r of rawRecs) {
    const id = r.id.trim();
    if (!id) errors.push('raw.csv: id 가 빈 행이 있습니다');
    else if (raws.has(id)) errors.push(`raw.csv: id 중복 ${id}`);
    else raws.set(id, r.raw_text); // 원문은 손대지 않는다(트림·정규화 없음)
  }
  const crIds = [...raws].filter(([, t]) => t.includes('\r')).map(([id]) => id);
  if (crIds.length && !crlfToLf) {
    errors.push(
      `원문에 CR(\\r)이 든 행 ${crIds.length}개(id=${crIds.slice(0, 5).join(', ')}${crIds.length > 5 ? ' …' : ''}) — ` +
        '앱 OCR 원문엔 CR 이 없어 내보내기에서 생긴 것입니다. 확인 후 --crlf-to-lf 로 실행하세요',
    );
  }

  const labels = new Map<string, Label>();
  for (const r of labelRecs) {
    const id = (r.id ?? '').trim();
    const where = `labels.csv id=${id || '(빈 id)'}`;
    if (!id) {
      errors.push('labels.csv: id 가 빈 행이 있습니다');
      continue;
    }
    if (labels.has(id)) {
      errors.push(`labels.csv: id 중복 ${id}`);
      continue;
    }
    const type = (r.type ?? '').trim().toUpperCase();
    if (!(TYPES as readonly string[]).includes(type)) errors.push(`${where}: type 은 A~G 여야 합니다`);
    const catRaw = (r.item_category ?? '').trim();
    const category = toCategory(catRaw);
    if (catRaw === '') errors.push(`${where}: item_category 가 비어 있습니다`);
    else if (!category) errors.push(`${where}: item_category 는 ${CATEGORIES.join(' / ')} 중 하나`);
    const pg = (r.price_gold ?? '').trim();
    let priceGold: number | null = null;
    if (pg === '') errors.push(`${where}: price_gold 가 비어 있습니다(정답이 없으면 null)`);
    else if (pg === 'null') priceGold = null;
    else if (INT_RE.test(pg)) priceGold = Number(pg);
    else errors.push(`${where}: price_gold 는 숫자만(콤마·원 없이) 또는 null`);
    const optInt = (col: string): number | null => {
      const v = (r[col] ?? '').trim();
      if (v === '') return null;
      if (INT_RE.test(v)) return Number(v);
      errors.push(`${where}: ${col} 는 숫자만 또는 빈칸`);
      return null;
    };
    const priceList = optInt('price_list');
    const priceSale = optInt('price_sale');
    // 외화 금액 기록(선택 열, 채점 미사용). 열이 없거나 빈칸이면 기록 없음.
    const priceForeign = (r.price_foreign ?? '').trim();
    if (priceForeign !== '' && !FOREIGN_RE.test(priceForeign)) {
      errors.push(`${where}: price_foreign 은 '통화코드 숫자'(예: JPY 3980, USD 17.51 — 콤마 없이) 또는 빈칸`);
    }
    const ho = (r.holdout ?? '').trim();
    let holdout: boolean | null = null;
    if (ho === '1') holdout = true;
    else if (ho === '0') holdout = false;
    else if (ho !== '') errors.push(`${where}: holdout 은 1·0·빈칸`);

    // 라벨 규칙 점검(경고 — 사람이 확인). 원문·값은 찍지 않고 id 와 사유만.
    if (type === 'G') {
      // 중고거래는 정가 우선을 적용하지 않는다(정답 = 판매자 등록가). 정가·할인가 보조 칸은 비운다.
      if (priceList !== null || priceSale !== null) {
        warnings.push(`${where}: G(중고거래)는 price_list·price_sale 을 비웁니다 — 본문의 정가·구매가는 note 에`);
      }
    } else if (priceList !== null && priceSale !== null) {
      if (priceSale > priceList) warnings.push(`${where}: price_sale 이 price_list 보다 큽니다`);
      if (priceGold !== priceList) warnings.push(`${where}: 정가·할인가가 모두 있는데 price_gold ≠ price_list(정가 우선 규칙)`);
    } else if (priceGold !== null && (priceList !== null || priceSale !== null) && priceGold !== priceList && priceGold !== priceSale) {
      warnings.push(`${where}: price_gold 가 price_list·price_sale 어느 쪽과도 다릅니다`);
    }
    if (type === 'E' && priceGold !== null) warnings.push(`${where}: E(외화만)인데 price_gold 가 숫자입니다`);
    if (type === 'E' && priceForeign === '') warnings.push(`${where}: E(외화만)인데 price_foreign 이 비어 있습니다`);
    if (type === 'C' && priceGold !== null) {
      warnings.push(`${where}: C(가격 없는 SNS)인데 price_gold 가 숫자입니다 — 가격이 하나 적힌 SNS 게시물은 B, 정가·할인가가 함께면 A`);
    }

    labels.set(id, {
      id,
      type: type as LabelType,
      category: category ?? '기타', // 잘못된 값이면 위에서 오류로 중단된다
      priceGold,
      priceList,
      priceSale,
      nameKeywords: splitAlts(r.name_keywords ?? ''),
      brandAliases: splitAlts(r.brand_aliases ?? ''),
      holdout,
    });
  }

  for (const id of raws.keys()) if (!labels.has(id)) errors.push(`라벨 없음: id=${id}`);
  for (const id of labels.keys()) if (!raws.has(id)) errors.push(`raw.csv 에 없는 라벨: id=${id}`);

  // raw.csv 순서(= 담은 순서)를 유지한다.
  const items: Item[] = [];
  for (const [id, original] of raws) {
    const label = labels.get(id);
    if (!label) continue;
    const raw = crlfToLf ? original.replace(/\r\n?/g, '\n') : original;
    // 앱은 trim 된 원문 길이로 판정한다. 저장된 raw_text 는 이미 trim 된 값이라 다시 trim 해도 같다.
    items.push({ id, raw, label, ocrShort: raw.trim().length < OCR_MIN_CHARS });
  }
  return { items, errors, warnings, rawCount: raws.size, labelCount: labels.size, crCount: crIds.length };
}

function selectSubset(items: Item[], subset: Options['subset'], errors: string[]): Item[] {
  if (subset === 'all') return items;
  const unassigned = items.filter((it) => it.label.holdout === null);
  if (unassigned.length) errors.push(`holdout 미지정 ${unassigned.length}행 — --${subset} 를 쓰려면 Step 4 지정이 먼저입니다`);
  return subset === 'only-holdout' ? items.filter((it) => it.label.holdout === true) : items.filter((it) => it.label.holdout !== true);
}

// ───────────────────────── API 호출 ─────────────────────────

/**
 * OK          정상 응답
 * ERROR       API·네트워크 오류(1회 재시도 후에도 실패) → --retry-errors 로 다시 부를 대상
 * BAD_OUTPUT  응답은 왔지만 text 블록이 없거나 JSON 이 깨짐(재시도 안 함 — 운영에선 E-2 폴백)
 * TRUNCATED   stop_reason=max_tokens(재시도 안 함)
 * REFUSAL     stop_reason=refusal(재시도 안 함)
 * SKIP_OCR_SHORT 원문 20자 미만 — 앱처럼 호출하지 않음
 */
type Status = 'OK' | 'ERROR' | 'BAD_OUTPUT' | 'TRUNCATED' | 'REFUSAL' | 'SKIP_OCR_SHORT';
const STATUSES: Status[] = ['OK', 'ERROR', 'BAD_OUTPUT', 'TRUNCATED', 'REFUSAL', 'SKIP_OCR_SHORT'];

export type RunResult = {
  status: Status;
  price: number | null;
  productName: string | null;
  brand: string | null;
  confidence: number | null;
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  latencyMs: number;
  attempts: number;
  /** 실패 사유. 재시도로 성공한 OK 행엔 첫 시도의 오류 코드가 남는다(재시도 원인 구분용). */
  error: string;
};

class CallError extends Error {
  constructor(readonly code: string, readonly retryAfterSec: number | null = null) {
    super(code);
  }
}

export function buildBody(v: Variant, text: string): Record<string, unknown> {
  // 운영 index.ts 와 같은 바디(이미지 분기 제외). 변형이 지정한 필드만 더하거나 뺀다.
  const body: Record<string, unknown> = { model: v.model, max_tokens: v.maxTokens };
  if (v.temperature !== undefined) body.temperature = v.temperature;
  if (v.thinking) body.thinking = v.thinking;
  body.system = v.system;
  body.output_config = {
    format: { type: 'json_schema', schema: v.schema },
    ...(v.effort ? { effort: v.effort } : {}),
  };
  body.messages = [{ role: 'user', content: text }];
  return body;
}

type Usage = { input_tokens?: number; output_tokens?: number; output_tokens_details?: { thinking_tokens?: number } | null };

const EMPTY_FIELDS = { price: null, productName: null, brand: null, confidence: null };

function isTimeout(e: unknown): boolean {
  const name = e instanceof DOMException ? e.name : (e as Error)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/** API 오류는 CallError 로 던진다(재시도 대상). 모델 출력 문제는 상태로 돌려준다(재시도 안 함). */
async function callOnce(apiKey: string, v: Variant, text: string): Promise<Omit<RunResult, 'attempts'>> {
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildBody(v, text)),
    });
  } catch (e) {
    throw new CallError(isTimeout(e) ? 'timeout' : 'network');
  }
  if (!res.ok) {
    // 오류 본문엔 입력이 담기지 않지만, 결과엔 상태 코드·오류 type 만 남긴다.
    let type = '';
    try {
      type = (await res.json())?.error?.type ?? '';
    } catch {
      /* 본문 없음 */
    }
    const ra = Number(res.headers.get('retry-after'));
    throw new CallError(`http_${res.status}${type ? `_${type}` : ''}`, Number.isFinite(ra) && ra > 0 ? ra : null);
  }
  let data: {
    stop_reason?: string;
    usage?: Usage;
    content?: Array<{ type?: string; text?: string }>;
  };
  try {
    data = await res.json(); // 본문 읽기도 같은 타임아웃 신호 아래에 있다
  } catch (e) {
    throw new CallError(isTimeout(e) ? 'timeout' : 'bad_response_body');
  }
  const latencyMs = Math.round(performance.now() - t0);
  const usage: Usage = data?.usage ?? {};
  const base = {
    stopReason: String(data?.stop_reason ?? ''),
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    thinkingTokens: usage.output_tokens_details?.thinking_tokens ?? 0,
    latencyMs,
  };
  if (data?.stop_reason === 'refusal') return { status: 'REFUSAL', ...EMPTY_FIELDS, ...base, error: '' };
  if (data?.stop_reason === 'max_tokens') return { status: 'TRUNCATED', ...EMPTY_FIELDS, ...base, error: '' };

  // thinking 블록이 앞에 올 수 있으므로 위치가 아니라 type 으로 찾는다.
  const block = Array.isArray(data?.content) ? data.content.find((b) => b?.type === 'text') : undefined;
  if (!block?.text) return { status: 'BAD_OUTPUT', ...EMPTY_FIELDS, ...base, error: 'llm_empty' };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    return { status: 'BAD_OUTPUT', ...EMPTY_FIELDS, ...base, error: 'llm_bad_json' };
  }
  // 운영 index.ts 의 후처리를 그대로 재현한다(앱이 받는 값과 같게).
  const price = typeof parsed.price === 'number' && Number.isFinite(parsed.price) ? Math.round(parsed.price) : null;
  return {
    status: 'OK',
    price,
    productName: typeof parsed.productName === 'string' ? parsed.productName : null,
    brand: typeof parsed.brand === 'string' ? parsed.brand : null,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    ...base,
    error: '',
  };
}

/** API 오류는 회차별로 1회 재시도한다. 그래도 실패하면 ERROR 로 남긴다(조용히 빼지 않는다). */
export async function callWithRetry(apiKey: string, v: Variant, text: string): Promise<RunResult> {
  let firstCode = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await callOnce(apiKey, v, text);
      // 재시도로 성공했으면 첫 시도의 오류 코드를 남긴다(429 인지 타임아웃인지 구분).
      return { ...r, attempts: attempt, error: r.error || (attempt > 1 ? `retried:${firstCode}` : '') };
    } catch (e) {
      const ce = e instanceof CallError ? e : new CallError('unexpected');
      if (attempt === 1) {
        firstCode = ce.code;
        const busy = /^http_(429|5\d\d)/.test(ce.code);
        const waitSec = Math.min(60, ce.retryAfterSec ?? (busy ? 10 : 2));
        await new Promise((r) => setTimeout(r, waitSec * 1000));
      } else {
        return {
          status: 'ERROR',
          ...EMPTY_FIELDS,
          stopReason: '',
          inputTokens: 0,
          outputTokens: 0,
          thinkingTokens: 0,
          latencyMs: 0,
          attempts: 2,
          error: firstCode === ce.code ? ce.code : `${firstCode}>${ce.code}`,
        };
      }
    }
  }
  throw new Error('unreachable');
}

// ───────────────────────── 판정·집계 ─────────────────────────

/** 앱 중복 판정 정규화와 같은 규칙(src/lib/normalize.ts normalizeToken): NFC → 소문자 → 문자·숫자만. */
function norm(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function nameHit(productName: string | null, keywords: string[]): boolean {
  const n = norm(productName ?? '');
  return n !== '' && keywords.some((k) => norm(k) !== '' && n.includes(norm(k)));
}

export function brandHit(brand: string | null, aliases: string[]): boolean {
  const b = norm(brand ?? '');
  return b !== '' && aliases.some((a) => norm(a) === b);
}

/** 정답 숫자(콤마 제거)가 원문에 숫자 경계로 들어 있는지 — OCR 단계 한계 분리용. */
export function ocrContains(raw: string, gold: number): boolean {
  return new RegExp(`(?<!\\d)${gold}(?!\\d)`).test(raw.replace(/,/g, ''));
}

/**
 * 정답 / 오추출 / 오값 / 누락 — 대표 출력(과반 가격)으로 판정
 * 불안정   — 모든 회차가 정상 응답인데 과반 가격이 없음(모델이 흔들림)
 * 응답부족 — 정상 응답이 모자라 과반을 못 정함(API 오류·잘림·거부·깨진 출력 때문 — 모델 흔들림과 구분)
 */
type Outcome = '정답' | '오추출' | '오값' | '누락' | '불안정' | '응답부족';
const WRONG_OUTCOMES: Outcome[] = ['오추출', '오값', '누락', '불안정'];

type RowEval = {
  item: Item;
  outcome: Outcome;
  correct: boolean;
  allSame: boolean;
  /** 정상 회차들의 confidence */
  confidences: number[];
  /** 과반 기준 회차 수 */
  need: number;
  nameOk: boolean | null; // null = 핵심어 없음(지표 제외)
  brandOk: boolean | null;
};

export function evaluateRow(item: Item, runs: RunResult[], nRuns: number): RowEval {
  const ok = runs.filter((r) => r.status === 'OK');
  const need = Math.floor(nRuns / 2) + 1; // 과반(3회면 2회). 분모는 요청한 회차 수
  const counts = new Map<string, number>();
  for (const r of ok) counts.set(String(r.price), (counts.get(String(r.price)) ?? 0) + 1);
  let rep: number | null | undefined; // undefined = 과반 없음
  for (const [k, c] of counts) if (c >= need) rep = k === 'null' ? null : Number(k);

  const gold = item.label.priceGold;
  let outcome: Outcome;
  if (rep === undefined) outcome = ok.length < nRuns ? '응답부족' : '불안정';
  else if (gold === null) outcome = rep === null ? '정답' : '오추출';
  else if (rep === gold) outcome = '정답';
  else if (rep === null) outcome = '누락';
  else outcome = '오값';

  const allSame = ok.length === nRuns && new Set(ok.map((r) => String(r.price))).size === 1;
  const majority = (hits: number) => hits >= need;
  const nameOk = item.label.nameKeywords.length
    ? majority(ok.filter((r) => nameHit(r.productName, item.label.nameKeywords)).length)
    : null;
  const brandOk = item.label.brandAliases.length
    ? majority(ok.filter((r) => brandHit(r.brand, item.label.brandAliases)).length)
    : null;
  return {
    item,
    outcome,
    correct: outcome === '정답',
    allSame,
    confidences: ok.map((r) => r.confidence ?? 0),
    need,
    nameOk,
    brandOk,
  };
}

/** 앱은 회차마다 confidence < 기준값이면 "확인 필요"를 띄운다 → 과반 회차에서 떴으면 그 장은 안내가 뜬 것으로 센다. */
function warned(e: RowEval, th: number): boolean {
  return e.confidences.filter((c) => c < th).length >= e.need;
}

const frac = (a: number, b: number) => `${a}/${b}`;

type EvalMap = Map<string, RowEval[]>; // variant key → 측정 장별 판정

/** 지시서 3절 지표 표(변형별 열). subset = 이 표가 다루는 측정 장들(전체 또는 유형 하나). */
function metricTable(opts: Options, evals: EvalMap, subset: Item[]): string[] {
  const ids = new Set(subset.map((it) => it.id));
  const N = subset.length;
  const nNull = subset.filter((it) => it.label.priceGold === null).length;
  const nNum = N - nNull;
  const cols = opts.variants.map((v) => v.key);
  const per = (f: (es: RowEval[]) => string) =>
    opts.variants.map((v) => f(evals.get(v.key)!.filter((e) => ids.has(e.item.id))));
  const cnt = (es: RowEval[], o: Outcome) => es.filter((e) => e.outcome === o).length;
  const lowAmongWrong = (es: RowEval[], th: number) => {
    const pool = es.filter((e) => WRONG_OUTCOMES.includes(e.outcome));
    return frac(pool.filter((e) => warned(e, th)).length, pool.length);
  };
  const lowAmongCorrect = (es: RowEval[], th: number) => {
    const pool = es.filter((e) => e.correct);
    return frac(pool.filter((e) => warned(e, th)).length, pool.length);
  };
  const aux = (es: RowEval[], k: 'nameOk' | 'brandOk') => {
    const pool = es.filter((e) => e[k] !== null);
    return frac(pool.filter((e) => e[k]).length, pool.length);
  };
  const row = (name: string, cells: string[]) => `| ${name} | ${cells.join(' | ')} |`;
  return [
    `| 지표 | ${cols.join(' | ')} |`,
    `|---|${cols.map(() => '---').join('|')}|`,
    row('가격 정답', per((es) => frac(cnt(es, '정답'), N))),
    row('오추출(정답 null인데 숫자)', per((es) => frac(cnt(es, '오추출'), nNull))),
    row('오값(정답 숫자인데 다른 숫자)', per((es) => frac(cnt(es, '오값'), nNum))),
    row('누락(정답 숫자인데 null)', per((es) => frac(cnt(es, '누락'), nNum))),
    row('불안정(전 회차 정상인데 과반 없음)', per((es) => frac(cnt(es, '불안정'), N))),
    row('응답 부족(오류 등으로 과반 못 정함)', per((es) => frac(cnt(es, '응답부족'), N))),
    row(`${opts.runs}회 일치`, per((es) => frac(es.filter((e) => e.allSame).length, N))),
    row(`오답 중 저신뢰 안내(<${LOW_CONFIDENCE_THRESHOLD})`, per((es) => lowAmongWrong(es, LOW_CONFIDENCE_THRESHOLD))),
    row(`정답 중 괜한 안내(<${LOW_CONFIDENCE_THRESHOLD})`, per((es) => lowAmongCorrect(es, LOW_CONFIDENCE_THRESHOLD))),
    row('제품명 핵심어 포함(보조)', per((es) => aux(es, 'nameOk'))),
    row('브랜드 별칭 일치(보조)', per((es) => aux(es, 'brandOk'))),
  ];
}

export function buildSummary(
  opts: Options,
  items: Item[],
  results: Map<string, RunResult[]>, // key = `${variant}\u0000${id}`
  startedAt: Date,
  notes: string[] = [],
): string {
  const measured = items.filter((it) => !it.ocrShort);
  const ocrShort = items.filter((it) => it.ocrShort);
  const ofType = (list: Item[], t: LabelType) => list.filter((it) => it.label.type === t);
  const typeCount = (list: Item[]) => TYPES.map((t) => `${t} ${ofType(list, t).length}장`).join(' · ');
  const ofCat = (list: Item[], c: ItemCategory) => list.filter((it) => it.label.category === c);
  const catCount = (list: Item[]) => CATEGORIES.map((c) => `${c} ${ofCat(list, c).length}장`).join(' · ');
  const N = measured.length;
  const numRows = measured.filter((it) => it.label.priceGold !== null);
  const cols = opts.variants.map((v) => v.key);

  const evals: EvalMap = new Map();
  for (const v of opts.variants) {
    evals.set(v.key, measured.map((it) => evaluateRow(it, results.get(`${v.key}\u0000${it.id}`) ?? [], opts.runs)));
  }
  const ocrIn = (list: Item[]) => {
    const nums = list.filter((it) => it.label.priceGold !== null);
    return frac(nums.filter((it) => ocrContains(it.raw, it.label.priceGold as number)).length, nums.length);
  };

  const L: string[] = [];
  L.push(`# 정답셋 측정 요약 (자동 생성 — 원문·상품명 없음)`);
  L.push('');
  L.push(`- 실행: ${startedAt.toISOString()} · 회차 ${opts.runs} · 부분집합: ${opts.subset}`);
  L.push(`- 라벨 ${items.length}장 = 측정(텍스트 분기) ${N}장 + OCR 부족(${OCR_MIN_CHARS}자 미만, 호출 안 함) ${ocrShort.length}장`);
  L.push(`- 측정 유형: ${typeCount(measured)}`);
  L.push(`- 측정 품목: ${catCount(measured)}`);
  if (ocrShort.length) L.push(`- OCR 부족 유형: ${typeCount(ocrShort)} / 품목: ${catCount(ocrShort)}`);
  L.push(`- 정답 null ${N - numRows.length}장 · 정답 숫자 ${numRows.length}장`);
  L.push(
    `- 표의 \`a/b\` 는 'b장 중 a장'. 대표 출력 = ${opts.runs}회 중 과반(${Math.floor(opts.runs / 2) + 1}회 이상) 같은 가격.`,
  );
  for (const n of notes) L.push(`- ${n}`);
  L.push('');

  L.push('## 변형');
  L.push('');
  L.push('| 변형 | 모델 | 프롬프트 | temperature | thinking | effort | max_tokens | 설명 |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const v of opts.variants) {
    L.push(
      `| ${v.key} | \`${v.model}\` | ${v.prompt} | ${v.temperature ?? '생략(1.0)'} | ${v.thinking?.type ?? '생략'} | ${v.effort ?? '생략'} | ${v.maxTokens} | ${v.desc} |`,
    );
  }
  L.push('');

  L.push('## 가격 지표(전체)');
  L.push('');
  L.push(...metricTable(opts, evals, measured));
  L.push('');
  L.push('- 오답 = 오추출·오값·누락·불안정. 응답 부족은 정답도 오답도 아닌 것으로 따로 센다(저신뢰 지표 분모에서도 뺀다).');
  L.push(`- 저신뢰 안내 = 정상 회차 중 과반(${Math.floor(opts.runs / 2) + 1}회 이상)에서 confidence 가 기준값 미만이라 앱이 "확인 필요"를 띄운 장.`);
  L.push('- 제품명·브랜드는 정상 회차 중 과반이 맞으면 그 장을 맞음으로 센다. 핵심어·별칭이 빈 장은 분모에서 뺀다.');
  L.push('');

  L.push(`## OCR 포함(공통)`);
  L.push('');
  L.push(`- 정답 숫자(콤마 제거)가 원문에 숫자 경계로 들어 있음: **${ocrIn(measured)}**`);
  L.push('- 원문에 없는 장의 오답은 OCR 단계 한계, 있는 장의 오답은 LLM 단계 문제로 나눠 본다.');
  L.push('');
  L.push(`| OCR 포함 여부별 가격 정답 | ${cols.join(' | ')} |`);
  L.push(`|---|${cols.map(() => '---').join('|')}|`);
  for (const inRaw of [true, false]) {
    const ids = new Set(numRows.filter((it) => ocrContains(it.raw, it.label.priceGold as number) === inRaw).map((it) => it.id));
    const cells = opts.variants.map((v) => {
      const pool = evals.get(v.key)!.filter((e) => ids.has(e.item.id));
      return frac(pool.filter((e) => e.correct).length, pool.length);
    });
    L.push(`| ${inRaw ? '원문에 정답 숫자 있음' : '원문에 정답 숫자 없음'} | ${cells.join(' | ')} |`);
  }
  L.push('');

  L.push('## confidence 기준값별(재계산 — 앱 기준값은 바꾸지 않음)');
  L.push('');
  L.push(`| 기준값 | ${cols.map((c) => `${c} 오답 중 안내`).join(' | ')} | ${cols.map((c) => `${c} 정답 중 괜한 안내`).join(' | ')} |`);
  L.push(`|---|${cols.map(() => '---').join('|')}|${cols.map(() => '---').join('|')}|`);
  for (const th of THRESHOLDS) {
    const wrongCells = opts.variants.map((v) => {
      const pool = evals.get(v.key)!.filter((e) => WRONG_OUTCOMES.includes(e.outcome));
      return frac(pool.filter((e) => warned(e, th)).length, pool.length);
    });
    const correctCells = opts.variants.map((v) => {
      const pool = evals.get(v.key)!.filter((e) => e.correct);
      return frac(pool.filter((e) => warned(e, th)).length, pool.length);
    });
    L.push(`| ${th} | ${wrongCells.join(' | ')} | ${correctCells.join(' | ')} |`);
  }
  L.push('');

  L.push('## 유형별');
  L.push('');
  for (const t of TYPES) {
    const sub = ofType(measured, t);
    const short = ofType(ocrShort, t).length;
    if (sub.length === 0 && short === 0) continue;
    L.push(`### ${t} — 측정 ${sub.length}장 · OCR 부족 ${short}장 · OCR 포함 ${ocrIn(sub)}`);
    L.push('');
    if (sub.length) L.push(...metricTable(opts, evals, sub));
    L.push('');
  }

  L.push('## 품목별');
  L.push('');
  L.push('측정 장수(유형 × 품목). 품목은 라벨 item_category — 판정엔 쓰지 않고 나눠 보기만 한다.');
  L.push('');
  L.push(`| 유형 | ${CATEGORIES.join(' | ')} | 계 |`);
  L.push(`|---|${CATEGORIES.map(() => '---').join('|')}|---|`);
  for (const t of TYPES) {
    const sub = ofType(measured, t);
    if (sub.length === 0) continue;
    L.push(`| ${t} | ${CATEGORIES.map((c) => ofCat(sub, c).length).join(' | ')} | ${sub.length} |`);
  }
  L.push(`| 계 | ${CATEGORIES.map((c) => ofCat(measured, c).length).join(' | ')} | ${N} |`);
  L.push('');
  for (const c of CATEGORIES) {
    const sub = ofCat(measured, c);
    const short = ofCat(ocrShort, c).length;
    if (sub.length === 0 && short === 0) continue;
    L.push(`### ${c} — 측정 ${sub.length}장 · OCR 부족 ${short}장 · OCR 포함 ${ocrIn(sub)}`);
    L.push('');
    if (sub.length) L.push(...metricTable(opts, evals, sub));
    L.push('');
  }

  L.push('## 호출·토큰(비용 = 토큰 × 공식 단가, 사람이 계산)');
  L.push('');
  L.push(`| 변형 | 호출 | ${STATUSES.filter((s) => s !== 'SKIP_OCR_SHORT').join(' | ')} | 재시도 | 입력 토큰 | 출력 토큰 | 그중 thinking |`);
  L.push(`|---|---|${STATUSES.filter((s) => s !== 'SKIP_OCR_SHORT').map(() => '---').join('|')}|---|---|---|---|`);
  for (const v of opts.variants) {
    const all = measured.flatMap((it) => results.get(`${v.key}\u0000${it.id}`) ?? []);
    const s = (st: Status) => all.filter((r) => r.status === st).length;
    const sum = (f: (r: RunResult) => number) => all.reduce((a, r) => a + f(r), 0);
    L.push(
      `| ${v.key} | ${all.length} | ${STATUSES.filter((x) => x !== 'SKIP_OCR_SHORT').map(s).join(' | ')} | ` +
        `${all.filter((r) => r.attempts > 1).length} | ${sum((r) => r.inputTokens)} | ${sum((r) => r.outputTokens)} | ${sum((r) => r.thinkingTokens)} |`,
    );
  }
  L.push('');
  L.push('- 출력 토큰은 thinking 을 포함한 과금 기준 합계다(usage.output_tokens). thinking 열은 usage.output_tokens_details.thinking_tokens.');
  L.push('- ERROR 는 results.csv 의 error 열(상태 코드·오류 type)로 사유를 확인하고 `--retry-errors` 로 다시 부르거나 사유를 기록한다.');
  L.push('- BAD_OUTPUT(빈 응답·깨진 JSON)·TRUNCATED·REFUSAL 은 모델 쪽 결과라 재시도하지 않는다.');
  L.push('');
  return L.join('\n');
}

// ───────────────────────── 결과 파일 ─────────────────────────

async function exists(p: string | URL): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

async function runPool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const t = items[next++];
      await fn(t);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

const RESULT_COLUMNS = [
  'id', 'type', 'item_category', 'holdout', 'variant', 'model', 'prompt', 'temperature', 'thinking', 'effort', 'max_tokens',
  'run', 'status', 'price', 'productName', 'brand', 'confidence', 'stop_reason',
  'input_tokens', 'output_tokens', 'thinking_tokens', 'latency_ms', 'attempts', 'error',
];

function resultLine(it: Item, v: Variant, run: number, r: RunResult): string {
  return [
    it.id, it.label.type, it.label.category, it.label.holdout === null ? '' : it.label.holdout ? 1 : 0, v.key, v.model, v.prompt,
    v.temperature ?? 'omit', v.thinking?.type ?? 'omit', v.effort ?? 'omit', v.maxTokens,
    run, r.status, r.price, r.productName, r.brand, r.confidence, r.stopReason,
    r.inputTokens, r.outputTokens, r.thinkingTokens, r.latencyMs, r.attempts, r.error,
  ].map(csvCell).join(',') + '\n';
}

function recordToRun(rec: Record<string, string>): RunResult {
  const num = (s: string) => (s === '' ? null : Number(s));
  const status = rec.status as Status;
  if (!STATUSES.includes(status)) throw new Error(`results.csv: 알 수 없는 status ${rec.status}`);
  return {
    status,
    price: num(rec.price),
    productName: rec.productName === '' ? null : rec.productName,
    brand: rec.brand === '' ? null : rec.brand,
    confidence: num(rec.confidence),
    stopReason: rec.stop_reason,
    inputTokens: Number(rec.input_tokens) || 0,
    outputTokens: Number(rec.output_tokens) || 0,
    thinkingTokens: Number(rec.thinking_tokens) || 0,
    latencyMs: Number(rec.latency_ms) || 0,
    attempts: Number(rec.attempts) || 0,
    error: rec.error,
  };
}

type Slot = { it: Item; v: Variant; run: number };
const slotKey = (variant: string, id: string, run: number) => `${variant}\u0000${id}\u0000${run}`;

// ───────────────────────── 실행 ─────────────────────────

async function main() {
  const opts = parseArgs(Deno.args);
  let loaded: Loaded;
  try {
    loaded = await loadInputs(opts.dataDir, opts.crlfToLf);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      console.error(`입력 파일이 없습니다: ${showPath(opts.dataDir)}raw.csv·labels.csv (Step 3·4에서 만든다. 가상 검증은 --data .../goldset/fixture)`);
    } else {
      console.error(`입력 오류: ${(e as Error).message}`); // CSV 형식·인코딩 오류 — 원문은 담지 않는다
    }
    Deno.exit(1);
  }
  const errors = [...loaded.errors];
  const items = selectSubset(loaded.items, opts.subset, errors);
  const measured = items.filter((it) => !it.ocrShort);
  const calls = measured.length * opts.variants.length * opts.runs;
  const resultRows = items.length * opts.variants.length * opts.runs;
  const notes: string[] = [];
  if (opts.crlfToLf && loaded.crCount) notes.push(`입력 정규화: 원문 ${loaded.crCount}행의 CR(\\r)을 LF 로 바꿔 보냄(--crlf-to-lf)`);

  console.log(`${opts.dryRun ? '[dry-run] ' : ''}데이터: ${showPath(opts.dataDir)} (raw ${loaded.rawCount}행 · labels ${loaded.labelCount}행)`);
  console.log(`검증: 오류 ${errors.length} · 경고 ${loaded.warnings.length}`);
  for (const e of errors) console.log(`  오류  ${e}`);
  for (const w of loaded.warnings) console.log(`  경고  ${w}`);
  for (const n of notes) console.log(`  참고  ${n}`);
  console.log(`부분집합: ${opts.subset} → 대상 ${items.length}장 = 측정 ${measured.length}장 + OCR 부족(${OCR_MIN_CHARS}자 미만, 호출 안 함) ${items.length - measured.length}장`);
  console.log(`유형: ${TYPES.map((t) => `${t} ${measured.filter((it) => it.label.type === t).length}`).join(' · ')} (측정 대상)`);
  console.log(`품목: ${CATEGORIES.map((c) => `${c} ${measured.filter((it) => it.label.category === c).length}`).join(' · ')} (측정 대상)`);
  console.log(`변형 ${opts.variants.length}개:`);
  for (const v of opts.variants) {
    console.log(
      `  ${v.key.padEnd(10)} model=${v.model} prompt=${v.prompt} temperature=${v.temperature ?? '생략(1.0)'} ` +
        `thinking=${v.thinking?.type ?? '생략'} effort=${v.effort ?? '생략'} max_tokens=${v.maxTokens}`,
    );
  }
  console.log(`회차: ${opts.runs}`);
  console.log(`총 API 호출: ${measured.length}장 × ${opts.variants.length}변형 × ${opts.runs}회 = ${calls}회 (재시도 제외)`);
  console.log(`results.csv 예상 행 수: ${items.length}장 × ${opts.variants.length} × ${opts.runs} = ${resultRows}행 (OCR 부족 행은 SKIP_OCR_SHORT)`);

  if (errors.length) {
    console.log('\n입력 오류가 있어 중단합니다. LABELING.md 형식을 확인하세요.');
    Deno.exit(1);
  }
  if (opts.dryRun) return;

  const suffix = opts.subset === 'all' ? '' : `.${opts.subset}`;
  const resultsPath = joinPath(opts.outDir, `results${suffix}.csv`);
  const summaryPath = joinPath(opts.outDir, `summary${suffix}.md`);
  const getKey = (): string => {
    const k = Deno.env.get('ANTHROPIC_API_KEY');
    if (!k) {
      console.error('ANTHROPIC_API_KEY 환경 변수가 없습니다(samples.md "자동 검증" 참고).');
      Deno.exit(2);
    }
    return k;
  };

  const results = new Map<string, RunResult[]>();
  const byId = new Map(items.map((it) => [it.id, it]));
  let startedAt = new Date();

  if (opts.retryErrors) {
    // ── 기존 결과를 읽어 ERROR 행만 다시 부른다 ──
    if (!(await exists(resultsPath))) {
      console.error(`--retry-errors: 결과 파일이 없습니다(${showPath(resultsPath)}).`);
      Deno.exit(2);
    }
    const recs = toRecords(parseCsv(await Deno.readTextFile(resultsPath)), 'results.csv', RESULT_COLUMNS);
    const slots = new Map<string, RunResult>();
    for (const rec of recs) {
      const v = opts.variants.find((x) => x.key === rec.variant);
      const run = Number(rec.run);
      if (!v || !byId.has(rec.id) || !(run >= 1 && run <= opts.runs)) {
        console.error(`--retry-errors: 결과 파일과 옵션이 다릅니다(id=${rec.id} variant=${rec.variant} run=${rec.run}). 같은 --runs·--variants·부분집합으로 실행하세요.`);
        Deno.exit(2);
      }
      slots.set(slotKey(v.key, rec.id, run), recordToRun(rec));
    }
    if (slots.size !== resultRows) {
      console.error(`--retry-errors: 결과 행 ${slots.size}개 ≠ 예상 ${resultRows}개. 같은 옵션으로 실행하세요.`);
      Deno.exit(2);
    }
    const todo: Slot[] = [];
    for (let run = 1; run <= opts.runs; run++) {
      for (const v of opts.variants) {
        for (const it of measured) if (slots.get(slotKey(v.key, it.id, run))!.status === 'ERROR') todo.push({ it, v, run });
      }
    }
    console.log(`\nERROR 행 ${todo.length}개 다시 호출`);
    if (todo.length) {
      const apiKey = getKey();
      let done = 0;
      await runPool(todo, opts.concurrency, async ({ it, v, run }) => {
        const r = await callWithRetry(apiKey, v, it.raw);
        slots.set(slotKey(v.key, it.id, run), r);
        done++;
        console.log(`  ${done}/${todo.length}  ${v.key} run${run} id=${it.id} ${r.status}${r.error ? ` ${r.error}` : ''}`);
      });
      notes.push(`--retry-errors: ERROR ${todo.length}행 다시 호출(${new Date().toISOString()})`);
    }
    // 원래 순서대로 다시 쓴다.
    let out = RESULT_COLUMNS.join(',') + '\n';
    for (const rec of recs) {
      const v = opts.variants.find((x) => x.key === rec.variant)!;
      const run = Number(rec.run);
      const r = slots.get(slotKey(v.key, rec.id, run))!;
      out += resultLine(byId.get(rec.id)!, v, run, r);
      if (r.status !== 'SKIP_OCR_SHORT') results.set(`${v.key}\u0000${rec.id}`, [...(results.get(`${v.key}\u0000${rec.id}`) ?? []), r]);
    }
    await Deno.writeTextFile(resultsPath, out);
  } else {
    // ── 새로 측정 ──
    const apiKey = getKey();
    if (!opts.force && ((await exists(resultsPath)) || (await exists(summaryPath)))) {
      console.error(`결과 파일이 이미 있습니다(${showPath(resultsPath)}). 덮어쓰려면 --force, ERROR 만 다시 부르려면 --retry-errors.`);
      Deno.exit(2);
    }
    await Deno.mkdir(opts.outDir, { recursive: true });
    await Deno.writeTextFile(resultsPath, RESULT_COLUMNS.join(',') + '\n');
    startedAt = new Date();

    const skip: RunResult = {
      status: 'SKIP_OCR_SHORT', ...EMPTY_FIELDS, stopReason: '',
      inputTokens: 0, outputTokens: 0, thinkingTokens: 0, latencyMs: 0, attempts: 0, error: '',
    };
    // OCR 부족 행: 호출 없이 SKIP 으로 기록(행 수 = 장 × 변형 × 회차 유지).
    for (let run = 1; run <= opts.runs; run++) {
      for (const v of opts.variants) {
        for (const it of items.filter((x) => x.ocrShort)) {
          await Deno.writeTextFile(resultsPath, resultLine(it, v, run, skip), { append: true });
        }
      }
    }

    const jobs: Slot[] = [];
    for (let run = 1; run <= opts.runs; run++) for (const v of opts.variants) for (const it of measured) jobs.push({ it, v, run });

    let done = 0;
    await runPool(jobs, opts.concurrency, async ({ it, v, run }) => {
      const r = await callWithRetry(apiKey, v, it.raw);
      const key = `${v.key}\u0000${it.id}`;
      results.set(key, [...(results.get(key) ?? []), r]);
      await Deno.writeTextFile(resultsPath, resultLine(it, v, run, r), { append: true });
      done++;
      if (r.status !== 'OK' || done % 20 === 0 || done === jobs.length) {
        console.log(`  ${done}/${jobs.length}  ${v.key} run${run} id=${it.id} ${r.status}${r.error ? ` ${r.error}` : ''}`);
      }
    });
  }

  const summary = buildSummary(opts, items, results, startedAt, notes);
  await Deno.writeTextFile(summaryPath, summary);
  console.log(`\n완료: ${showPath(resultsPath)} · ${showPath(summaryPath)}`);
  for (const v of opts.variants) {
    const es = measured.map((it) => evaluateRow(it, results.get(`${v.key}\u0000${it.id}`) ?? [], opts.runs));
    const left = [...results.entries()].filter(([k]) => k.startsWith(`${v.key}\u0000`)).flatMap(([, rs]) => rs).filter((r) => r.status === 'ERROR').length;
    console.log(`  ${v.key.padEnd(10)} 가격 정답 ${es.filter((e) => e.correct).length}/${measured.length}${left ? ` · 남은 ERROR ${left}` : ''}`);
  }
}

if (import.meta.main) await main();
