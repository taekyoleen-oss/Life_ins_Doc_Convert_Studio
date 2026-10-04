import { baseName, cellNum, colLetter, guessRole, sexOf } from "./sheet";
import type { RateRole, Sex } from "./methoddoc/spec";

/**
 * 위험률 불러오기·가공 — M04 의 [스프레드시트에서 불러오기]·[위험률 가공] 창이 쓰는 계산(화면과 따로 시험한다).
 *  - 불러오기: 붙여넣은·올린 표의 첫 행이 제목인지 가리고, 연령 열과 위험률 열을 나눠 (남·여) 열로 만든다.
 *  - 가공: 이미 있는 위험률(표)을 연령마다 식으로 합치거나 곱해 새 위험률 열을 만든다 — 예: rc × 0.8 · 1 − (1 − rs)·(1 − ra).
 */

// ── 불러오기 ────────────────────────────────────────────────────────────────
/** 첫 행이 제목(열 이름)인가 — 수가 아닌 칸이 절반 넘으면 제목으로 본다 */
export function firstRowIsHead(rows: string[][]): boolean {
  const first = rows[0] ?? [];
  const cells = first.filter((c) => c.trim() !== "");
  if (!cells.length) return false;
  return cells.filter((c) => cellNum(c) === null).length * 2 > cells.length;
}

/** 표의 열 — 제목 행을 쓰는지에 따라 이름과 값 행이 달라진다. 제목이 없으면 "A열" · "B열" */
export function importColumns(rows: string[][], head: boolean): { heads: string[]; body: string[][] } {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim());
  const heads = head ? pad(rows[0] ?? []).map((h, i) => h || `${colLetter(i)}열`) : Array.from({ length: width }, (_, i) => `${colLetter(i)}열`);
  return { heads, body: (head ? rows.slice(1) : rows).map(pad) };
}

/** 연령 열 — 제목이 연령·나이면 그 열, 아니면 0~130 정수로 늘어나는 첫 열. 없으면 -1 */
export function guessAgeColumn(heads: string[], body: string[][]): number {
  const byName = heads.findIndex((h) => /연령|나이|^age$|^x$/i.test(h.trim()));
  if (byName >= 0) return byName;
  return heads.findIndex((_, c) => {
    const v = body.map((r) => cellNum(r[c] ?? ""));
    return v.length > 1 && v.every((x, i) => x !== null && Number.isInteger(x) && x >= 0 && x <= 130 && (i === 0 || x > v[i - 1]!));
  });
}

/** 불러올 열 하나의 처음 값 — 이름(성별을 뺀 것)·성별·유형을 제목으로 어림한다(사람이 고친다) */
export interface ImportCol { col: number; use: boolean; name: string; sex?: Sex; role: RateRole }
export function guessImportCols(heads: string[], body: string[][], ageCol: number): ImportCol[] {
  return heads.flatMap((h, col) => {
    if (col === ageCol || !body.some((r) => cellNum(r[col] ?? "") !== null)) return [];
    return [{ col, use: true, name: baseName(h), sex: sexOf(h), role: guessRole(h) }];
  });
}

/** 고른 열 → 위험률 표에 넣을 열(연령·값). 성별이 있으면 "이름(남)" — 표의 열 이름이 잇기(성별)를 정한다 */
export function importedColumns(body: string[][], ageCol: number, cols: ImportCol[]): { name: string; role: RateRole; head: string; ages: number[]; values: number[] }[] {
  return cols.filter((c) => c.use && c.name.trim()).map((c) => {
    const ages: number[] = [], values: number[] = [];
    for (const r of body) {
      const a = cellNum(r[ageCol] ?? ""), v = cellNum(r[c.col] ?? "");
      if (a === null || v === null) continue;
      ages.push(a); values.push(v);
    }
    const name = c.name.trim();
    return { name, role: c.role, head: c.sex ? `${name}(${c.sex === "M" ? "남" : "여"})` : name, ages, values };
  });
}

// ── 가공 ────────────────────────────────────────────────────────────────────
type Node = { k: "n"; v: number } | { k: "id"; id: string } | { k: "neg"; a: Node } | { k: "op"; op: "+" | "-" | "*" | "/"; a: Node; b: Node };

/**
 * 가공 식 읽기 — 수 · 위험률 기호(id) · + − × ÷ · * / · 괄호. 곱셈 기호를 빼고 붙여 쓴 괄호 곱 "(1 − a)(1 − b)" 도 읽는다.
 * 못 읽으면 오류를 던진다(화면이 그 글을 보인다).
 */
export function parseRateExpr(src: string): Node {
  const s = src.replace(/[−–]/g, "-").replace(/[×·]/g, "*").replace(/÷/g, "/");
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const peek = () => { ws(); return s[i]; };
  const atom = (): Node => {
    const c = peek();
    if (c === "(") { i++; const e = expr(); if (peek() !== ")") throw new Error("괄호가 닫히지 않았습니다"); i++; return e; }
    if (c === "-") { i++; return { k: "neg", a: atom() }; }
    const num = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (num) { i += num[0].length; return { k: "n", v: Number(num[1]) }; }
    const id = /^[A-Za-z가-힣_][A-Za-z0-9가-힣_]*/.exec(s.slice(i));
    if (id) { i += id[0].length; return { k: "id", id: id[0] }; }
    throw new Error(c === undefined ? "식이 끝났습니다 — 뒤에 무엇이 와야 합니다" : `읽을 수 없는 글자: "${c}"`);
  };
  const term = (): Node => {
    let a = atom();
    for (;;) {
      const c = peek();
      if (c === "*" || c === "/") { i++; a = { k: "op", op: c, a, b: atom() }; }
      else if (c === "(") a = { k: "op", op: "*", a, b: atom() };          // (1 − a)(1 − b)
      else return a;
    }
  };
  const expr = (): Node => {
    let a = term();
    for (;;) {
      const c = peek();
      if (c === "+" || c === "-") { i++; a = { k: "op", op: c, a, b: term() }; } else return a;
    }
  };
  const out = expr();
  if (peek() !== undefined) throw new Error(`식 끝에 남은 글자: "${s.slice(i).trim()}"`);
  return out;
}

/** 식에 쓰인 위험률 기호 */
export function exprIds(n: Node): string[] {
  const out = new Set<string>();
  const walk = (x: Node) => { if (x.k === "id") out.add(x.id); else if (x.k === "neg") walk(x.a); else if (x.k === "op") { walk(x.a); walk(x.b); } };
  walk(n);
  return [...out];
}

function evalNode(n: Node, val: (id: string) => number | undefined): number | undefined {
  switch (n.k) {
    case "n": return n.v;
    case "id": return val(n.id);
    case "neg": { const a = evalNode(n.a, val); return a === undefined ? undefined : -a; }
    case "op": {
      const a = evalNode(n.a, val), b = evalNode(n.b, val);
      if (a === undefined || b === undefined) return undefined;
      return n.op === "+" ? a + b : n.op === "-" ? a - b : n.op === "*" ? a * b : b === 0 ? undefined : a / b;
    }
  }
}

/** 위험률 표 한 벌(연령 → 값) */
export interface AgeTable { ages: number[]; values: number[] }

/**
 * 가공 — 식에 쓰인 위험률의 표(성별마다)를 연령마다 계산한다. 쓰인 위험률이 모두 그 연령에 값이 있을 때만 그 연령을 싣는다.
 * 성별: 쓰인 위험률 가운데 하나라도 남·여 표가 있으면 남·여 두 벌(공통 표는 두 성별에 같이 쓴다), 모두 공통이면 한 벌.
 * 값은 0 아래면 0 으로 막는다(발생률) — 1 은 넘을 수 있다(기대 입원일수처럼 횟수인 것).
 */
export function processRates(src: string, tables: (id: string) => { M?: AgeTable; F?: AgeTable; any?: AgeTable } | undefined): { sex?: Sex; ages: number[]; values: number[] }[] {
  const tree = parseRateExpr(src);
  const ids = exprIds(tree);
  if (!ids.length) throw new Error("위험률 기호를 하나 이상 쓰세요 — 예: rc × 0.8");
  const t = Object.fromEntries(ids.map((id) => {
    const x = tables(id);
    if (!x || !(x.M || x.F || x.any)) throw new Error(`"${id}" 는 값 표가 있는 위험률 기호가 아닙니다`);
    return [id, x];
  }));
  const sexes: (Sex | undefined)[] = ids.some((id) => t[id].M || t[id].F) ? ["M", "F"] : [undefined];
  return sexes.map((sex) => {
    const pick = (id: string) => (sex ? t[id][sex] ?? t[id].any : t[id].any) ?? (sex ? undefined : t[id].M ?? t[id].F);
    const tabs = ids.map((id) => [id, pick(id)] as const);
    if (tabs.some(([, x]) => !x)) return { sex, ages: [], values: [] };
    const ages = [...new Set(tabs.flatMap(([, x]) => x!.ages))].sort((a, b) => a - b);
    const out = { sex, ages: [] as number[], values: [] as number[] };
    for (const a of ages) {
      const v = evalNode(tree, (id) => { const x = tabs.find(([k]) => k === id)![1]!; const k = x.ages.indexOf(a); return k < 0 ? undefined : x.values[k]; });
      if (v === undefined || !Number.isFinite(v)) continue;
      out.ages.push(a); out.values.push(Math.max(0, Number(v.toPrecision(12))));
    }
    return out;
  }).filter((x) => x.ages.length);
}

/** 식의 기호를 위험률 이름으로 바꾼 글 — 근거·출처 칸에 싣는다("암발생률 × 0.8") */
export const exprWithNames = (src: string, nameOf: (id: string) => string | undefined) =>
  src.replace(/[A-Za-z가-힣_][A-Za-z0-9가-힣_]*/g, (id) => nameOf(id) ?? id).replace(/\*/g, "×").replace(/\s+/g, " ").trim();
