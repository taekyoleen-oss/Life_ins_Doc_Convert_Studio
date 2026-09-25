import { unzip, type ExtractedDoc } from "./methoddoc/extract";
import { rateGrid } from "./methoddoc/render";
import type { MethodSpec, RateRef, RateRole, Sex } from "./methoddoc/spec";

/**
 * 위험률 스프레드시트 — 붙여넣기(Excel TSV)·CSV·XLSX 를 읽어 첫 행을 열 이름으로 두고,
 * 열마다 조건(연령 · 위험률 rates[].id · 성별)에 잇는다.
 *
 * 표 자체는 조건 파일(YAML)에 싣지 않는다(길다). 이어 둔 열을 MethodSpec 의 RateRef.table 로 붙여
 * 산출방법서·JSON 에 넘긴다 — 자유설계보험(flexible_insurance)의 위험률 시트(A열 연령 + 위험률 열)가 이 표를 그대로 받는다.
 * 남·여 열이 따로 있으면 두 벌 다 싣는다(RateRef.tables) — 계산하는 앱이 피보험자 성별로 고른다.
 */

export interface Sheet { name: string; head: string[]; rows: string[][] }
export type ColMap = { to: "skip" } | { to: "age" } | { to: "rate"; rateId: string; sex?: Sex };
export interface SheetState { sheet: Sheet; map: ColMap[] }

export const colLetter = (i: number): string => (i >= 26 ? colLetter(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));

/** "0.00123" · "1.23%" · "1.23‰" · "1,234" → 수. 못 읽으면 null */
export function cellNum(s: string): number | null {
  const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(%|‰|세)?$/.exec(s.replace(/[,\s]/g, ""));
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "%" ? n / 100 : m[2] === "‰" ? n / 1000 : n;
}

// ── 읽기 ────────────────────────────────────────────────────────────────────
/** CSV·TSV(Excel 복사) → 행. 따옴표 안의 구분자·줄바꿈도 읽는다 */
export function parseDelimited(src: string): string[][] {
  const t = src.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const nl = t.indexOf("\n"), first = nl < 0 ? t : t.slice(0, nl);
  const d = first.includes("\t") ? "\t" : first.includes(",") ? "," : first.includes(";") ? ";" : "\t";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch !== '"') cell += ch;
      else if (t[i + 1] === '"') { cell += '"'; i++; }
      else q = false;
    } else if (ch === '"' && !cell.trim()) { q = true; cell = ""; }
    else if (ch === d) { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

const xmlText = (s: string) => s.replace(/<[^>]*>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** XLSX 첫 시트 → 행. SheetJS 없이 — ZIP 은 methoddoc 의 unzip, 시트는 XML 을 직접 읽는다 */
export async function readXlsx(buf: Uint8Array): Promise<string[][]> {
  const files = await unzip(buf);
  const text = (name: string) => { const f = files.get(name); return f ? new TextDecoder().decode(f) : ""; };
  const rid = attr(/<sheet\s[^>]*>/.exec(text("xl/workbook.xml"))?.[0] ?? "", "r:id");
  const rel = (text("xl/_rels/workbook.xml.rels").match(/<Relationship\s[^>]*>/g) ?? []).find((t) => attr(t, "Id") === rid);
  const target = rel && attr(rel, "Target");
  const path = !target ? "xl/worksheets/sheet1.xml" : target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const xml = text(path);
  if (!xml) throw new Error("XLSX 에서 시트를 찾지 못했습니다");
  const shared = (text("xl/sharedStrings.xml").match(/<si\b[^>]*>[\s\S]*?<\/si>/g) ?? [])
    .map((si) => (si.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").match(/<t\b[^>]*>[\s\S]*?<\/t>/g) ?? []).map(xmlText).join(""));
  const rows: string[][] = [];
  for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const m = /^([A-Z]+)(\d+)$/.exec(attr(c[1], "r") ?? "");
    if (!m) continue;
    const col = [...m[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const body = c[2] ?? "", t = attr(c[1], "t"), v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    const val = t === "s" ? shared[Number(v)] ?? ""
      : t === "inlineStr" ? xmlText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "")
      : t === "b" ? (v === "1" ? "TRUE" : "FALSE")
      : v !== undefined ? xmlText(v) : "";
    (rows[Number(m[2]) - 1] ??= [])[col] = val;
  }
  return Array.from(rows, (r) => Array.from(r ?? [], (x) => (x ?? "").trim())).filter((r) => r.some((c) => c !== ""));
}

function toSheet(name: string, rows: string[][]): Sheet {
  if (rows.length < 2) throw new Error("첫 행(열 이름)과 값이 든 행이 있어야 합니다");
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? "");
  return { name, head: pad(rows[0]).map((h, i) => h || `${colLetter(i)}열`), rows: rows.slice(1).map(pad) };
}

export const sheetFromText = (name: string, text: string) => toSheet(name, parseDelimited(text));

export async function sheetFromFile(file: File): Promise<Sheet> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (ext === "xls") throw new Error("옛 Excel(.xls)은 읽지 못합니다 — .xlsx 나 .csv 로 저장해 주세요");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (ext === "xlsx") return toSheet(file.name, await readXlsx(bytes));
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { text = new TextDecoder("euc-kr").decode(bytes); }        // 한글 Excel 이 낸 CSV
  return sheetFromText(file.name, text);
}

// ── 열 → 조건 ───────────────────────────────────────────────────────────────
export function sexOf(head: string): Sex | undefined {
  if (/여|female/i.test(head) || /(^|[^A-Za-z])F($|[^A-Za-z])/.test(head)) return "F";
  if (/남|male/i.test(head) || /(^|[^A-Za-z])M($|[^A-Za-z])/.test(head)) return "M";
  return undefined;
}
/** "사망률(남)" · "암발생률_여" · "남자 사망률" → 성별을 뺀 이름 */
export const baseName = (head: string) => head
  .replace(/(남자|여자|남성|여성|female|male)/gi, "").replace(/[([]\s*(남|여|M|F)\s*[)\]]/g, "")
  .replace(/(^|[\s_-])(남|여|M|F)$/, "").replace(/^(남|여|M|F)[\s_-]/, "").replace(/^[\s_-]+|[\s_-]+$/g, "") || head.trim();

/** 열 이름으로 유형을 어림한다 — 새 위험률로 더할 때만 쓴다 */
export function guessRole(head: string): RateRole {
  if (/사망/.test(head)) return "death";
  if (/해지/.test(head)) return "lapse";
  if (/납입\s*면제|면제/.test(head)) return "waiver";
  if (/입원|일당|수술|통원|기대\s*일수/.test(head)) return "recurring";
  return "incidence";
}

/** 새 위험률 id — 유형의 관례 기호(q 사망 · r 발생 · g 반복 · f 면제 · w 해지 — 산출식·기호의 정의와 같다)에 겹치지 않게 번호를 붙인다 */
export function newRateId(role: RateRole, taken: string[]): string {
  const base = { death: "q", incidence: "r", recurring: "g", waiver: "f", lapse: "w", other: "o" }[role];
  let k = 1, id = base;
  while (taken.includes(id)) id = `${base}${++k}`;
  return id;
}

/** 값이 하나라도 수인 열 — 비고 같은 글자 열은 위험률로 잇지 않는다 */
export const hasNumbers = (sheet: Sheet, col: number) => sheet.rows.some((r) => cellNum(r[col] ?? "") !== null);

const norm = (s: string) => s.toLowerCase().replace(/[\s()[\]_·.\-]/g, "");
const isAgeHead = (h: string) => /^(연령|나이|가입나이|age|x)$/.test(norm(h)) || /연령|나이/.test(h);

/**
 * 산출방법서 문서 속 위험률 값 표(별첨: 첫 열이 연령, 나머지가 수) → 위험률 표 창.
 * 쪽마다 나뉜 표는 열 이름으로 합치고, 같은 열 이름이 여러 표에 있으면 연령으로 잇는다. 그런 표가 없으면 null
 */
export function sheetFromDoc(doc: ExtractedDoc, name: string): Sheet | null {
  const parts = doc.tables.filter((t) => t.head.length >= 2 && isAgeHead(t.head[0]) && t.rows.length >= 2
    && t.rows.every((r) => Number.isInteger(cellNum(r[0] ?? ""))) && t.rows.some((r) => r.slice(1).some((c) => cellNum(c) !== null)));
  if (!parts.length) return null;
  const heads = [...new Set(parts.flatMap((t) => t.head.slice(1).map((h) => h.trim())).filter(Boolean))];
  const byAge = new Map<number, string[]>();
  for (const t of parts) for (const r of t.rows) {
    const age = cellNum(r[0] ?? "")!;
    const row = byAge.get(age) ?? heads.map(() => "");
    t.head.slice(1).forEach((h, i) => { const v = (r[i + 1] ?? "").trim(); if (v && v !== "—") row[heads.indexOf(h.trim())] = v; });
    byAge.set(age, row);
  }
  return { name, head: ["연령", ...heads], rows: [...byAge].sort((a, b) => a[0] - b[0]).map(([a, r]) => [String(a), ...r]) };
}

/** 열 이름으로 처음 잇기: 연령 열 하나, 이름이 같거나 겹치는 위험률 */
export function autoMap(sheet: Sheet, rates: Pick<RateRef, "id" | "name">[]): ColMap[] {
  let age = sheet.head.findIndex(isAgeHead);
  if (age < 0) {    // 머리글이 없으면 첫 열이 0~130 정수로 늘어나면 연령으로 본다
    const v = sheet.rows.map((r) => cellNum(r[0] ?? ""));
    if (v.length && v.every((x, i) => x !== null && Number.isInteger(x) && x >= 0 && x <= 130 && (i === 0 || x >= v[i - 1]!))) age = 0;
  }
  return sheet.head.map((h, i): ColMap => {
    if (i === age) return { to: "age" };
    const key = norm(baseName(h));
    const hit = rates.find((r) => norm(r.id) === key || norm(r.name) === key)
      ?? (key.length >= 2 ? rates.find((r) => norm(r.name).includes(key) || key.includes(norm(r.name))) : undefined);
    return hit ? { to: "rate", rateId: hit.id, ...(sexOf(h) ? { sex: sexOf(h) } : {}) } : { to: "skip" };
  });
}

// ── 조건 ↔ 표를 유기적으로 — 표를 올리면 조건에, 조건에 더하면 표에 ─────────────
/**
 * 아직 잇지 않은 수 열 가운데 조건에 같은 이름의 위험률이 없는 것 — 성별을 뺀 이름마다 하나(남·여 열은 한 위험률).
 * 표를 올릴 때 이것들을 새 위험률로 조건에 더한다(유형은 이름으로 어림 — 사람이 확인).
 */
export function unlinkedGroups(st: SheetState, rates: Pick<RateRef, "id" | "name">[]): { name: string; role: RateRole; cols: number[] }[] {
  const byName = new Map<string, number[]>();
  st.map.forEach((m, i) => {
    if (m.to !== "skip" || !hasNumbers(st.sheet, i)) return;
    const name = baseName(st.sheet.head[i]);
    if (rates.some((r) => r.name === name)) return;
    byName.set(name, [...(byName.get(name) ?? []), i]);
  });
  return [...byName].map(([name, cols]) => ({ name, role: guessRole(name), cols }));
}

/** 이름마다 정해진 위험률 id 로 그 열들을 잇는다 — unlinkedGroups 의 짝 */
export function linkGroups(st: SheetState, groups: { cols: number[] }[], ids: string[]): SheetState {
  const map = [...st.map];
  groups.forEach((g, k) => { if (ids[k]) for (const i of g.cols) map[i] = { to: "rate", rateId: ids[k], ...(sexOf(st.sheet.head[i]) ? { sex: sexOf(st.sheet.head[i]) } : {}) }; });
  return { ...st, map };
}

/**
 * 조건에 더한 위험률의 빈 열 — 값은 사람이 붙여넣는다. 연령 열이 없거나 이미 그 위험률의 열이 있으면 그대로.
 * 표가 없을 때는 만들지 않는다(표를 올리면 autoMap 이 이름으로 잇는다)
 */
export function addEmptyColumn(st: SheetState | null, rate: Pick<RateRef, "id" | "name">): SheetState | null {
  if (!st || !st.map.some((m) => m.to === "age") || st.map.some((m) => m.to === "rate" && m.rateId === rate.id)) return st;
  return {
    sheet: { ...st.sheet, head: [...st.sheet.head, rate.name], rows: st.sheet.rows.map((r) => [...r, ""]) },
    map: [...st.map, { to: "rate", rateId: rate.id }],
  };
}

/** 표 창에서 칸 하나를 고친다 — 값은 글자 그대로 두고(attachTables 가 수만 읽는다) 새 표를 돌려준다 */
export function setCell(st: SheetState, row: number, col: number, value: string): SheetState {
  if (!st.sheet.rows[row] || col < 0 || col >= st.sheet.head.length || st.sheet.rows[row][col] === value) return st;
  return { ...st, sheet: { ...st.sheet, rows: st.sheet.rows.map((r, i) => (i === row ? r.map((c, j) => (j === col ? value : c)) : r)) } };
}

/** 열 이름을 고친다 — 이름은 잇기(autoMap)와 별첨 표 머리글에 쓰인다 */
export function setHead(st: SheetState, col: number, name: string): SheetState {
  const v = name.trim();
  if (!v || st.sheet.head[col] === v || col < 0 || col >= st.sheet.head.length) return st;
  return { ...st, sheet: { ...st.sheet, head: st.sheet.head.map((h, i) => (i === col ? v : h)) } };
}

/** 조건에서 지운 위험률 — 그 열은 잇지 않은 상태로(열과 값은 남긴다) */
export function unlinkRate(st: SheetState | null, id: string): SheetState | null {
  if (!st || !st.map.some((m) => m.to === "rate" && m.rateId === id)) return st;
  return { ...st, map: st.map.map((m): ColMap => (m.to === "rate" && m.rateId === id ? { to: "skip" } : m)) };
}

/** 값 표가 없는(열이 없거나 열이 비어 있는) 위험률 — 계산하는 앱에서 0 이 된다. 화면이 알려 준다 */
export const ratesWithoutTable = (withTables: MethodSpec) =>
  withTables.rates.filter((r) => r.role !== "lapse" && !(r.tables?.M?.ages.length || r.tables?.F?.ages.length || r.table?.ages.length));

/**
 * 샘플 조건에 딸려 오는 위험률 표 — 견본 CSV 에서 그 조건의 위험률과 이름이 맞는 열만(연령 + 이은 열) 남긴다.
 * 첫 화면·[샘플] 이 조건·산출방법서·위험률 표를 한 세트로 보여 주기 위한 것. 맞는 열이 없으면 null
 */
export function sampleSheet(rates: Pick<RateRef, "id" | "name">[], csv: string, name = "견본 위험률 표(가상의 값)"): SheetState | null {
  const sh = sheetFromText(name, csv);
  const map = autoMap(sh, rates);
  const keep = map.flatMap((m, i) => (m.to === "skip" ? [] : [i]));
  if (!map.some((m) => m.to === "rate")) return null;
  return { sheet: { name, head: keep.map((i) => sh.head[i]), rows: sh.rows.map((r) => keep.map((i) => r[i])) }, map: keep.map((i) => map[i]) };
}

/** 저장본을 믿지 않는다 — 모양이 어긋나면 null */
export function sanitizeSheet(raw: unknown): SheetState | null {
  const s = raw as Partial<SheetState> | null;
  const sh = s?.sheet;
  if (!sh || !Array.isArray(sh.head) || !Array.isArray(sh.rows) || !Array.isArray(s.map)) return null;
  const head = sh.head.map(String);
  const map = head.map((_, i): ColMap => {
    const m = s.map?.[i] as ColMap | undefined;
    if (m?.to === "age") return m;
    if (m?.to === "rate" && typeof m.rateId === "string") return { to: "rate", rateId: m.rateId, ...(m.sex === "M" || m.sex === "F" ? { sex: m.sex } : {}) };
    return { to: "skip" };
  });
  return { sheet: { name: String(sh.name ?? "위험률 표"), head, rows: sh.rows.map((r) => head.map((_, i) => String(r?.[i] ?? ""))) }, map };
}

/** 위험률마다 실제로 쓰는 열 — 남 열 하나 · 여 열 하나, 성별 열이 없으면 공통 열(없으면 첫 열) 하나 */
export function usedColumns(st: SheetState, rateId: string): { M?: number; F?: number; any?: number } {
  const cols = st.map.flatMap((m, i) => (m.to === "rate" && m.rateId === rateId ? [{ sex: m.sex, i }] : []));
  const M = cols.find((c) => c.sex === "M")?.i, F = cols.find((c) => c.sex === "F")?.i;
  if (M !== undefined || F !== undefined) return { M, F };
  return cols.length ? { any: (cols.find((c) => !c.sex) ?? cols[0]).i } : {};
}

const sexName = (s?: Sex) => (s === "M" ? "남" : s === "F" ? "여" : "");

/** 입력 화면의 위험률 칸에 보이는 연결 설명 — "표: B(남)·C(여)열 → 40~41세 2행 · 남·여" */
export function linkNote(st: SheetState | null, withTables: MethodSpec, rateId: string): string | undefined {
  const cols = st?.map.flatMap((m, i) => (m.to === "rate" && m.rateId === rateId ? [`${colLetter(i)}${m.sex ? `(${sexName(m.sex)})` : ""}`] : [])) ?? [];
  if (!cols.length) return undefined;
  const r = withTables.rates.find((x) => x.id === rateId);
  const t = r?.tables?.M ?? r?.tables?.F ?? r?.table;
  const who = r?.tables ? (["M", "F"] as const).filter((x) => r.tables?.[x]).map(sexName).join("·") : sexName(r?.table?.sex);
  const age = st?.map.some((m) => m.to === "age");
  return `표: ${cols.join("·")}열 → ${t ? `${t.ages[0]}~${t.ages[t.ages.length - 1]}세 ${t.ages.length}행${who ? ` · ${who}` : ""}` : age ? "값이 비어 있습니다 — 아래 표에 붙여넣으세요" : "연령 열을 정하면 붙습니다"}`;
}

/**
 * MethodSpec 의 위험률 표(RateRef.tables · table) → 위험률 표 창. attachTables 의 반대 —
 * 자유설계보험 등이 낸 JSON 을 열 때 표를 잃지 않게 한다(조건 파일에는 표가 실리지 않으므로).
 */
export function sheetFromSpec(spec: MethodSpec, name: string): SheetState | null {
  const g = rateGrid(spec);
  if (!g) return null;
  return {
    sheet: {
      name, head: ["연령", ...g.cols.map((c) => c.head)],
      rows: g.ages.map((a) => [String(a), ...g.cols.map((c) => { const i = c.t.ages.indexOf(a); return i < 0 ? "" : String(c.t.values[i]); })]),
    },
    map: [{ to: "age" }, ...g.cols.map((c): ColMap => ({ to: "rate", rateId: c.r.id, ...(c.sex ? { sex: c.sex } : {}) }))],
  };
}

/** 이어 둔 열을 위험률 표로 붙인 스펙 — 남·여 열이 있으면 tables 에 두 벌(table 에는 남 → 여 한 벌). 연령 열이 없으면 그대로 */
export function attachTables(spec: MethodSpec, st: SheetState | null): MethodSpec {
  const ageCol = st ? st.map.findIndex((m) => m.to === "age") : -1;
  if (!st || ageCol < 0) return spec;
  const read = (col: number) => {
    const ages: number[] = [], values: number[] = [];
    for (const row of st.sheet.rows) {
      const a = cellNum(row[ageCol] ?? ""), v = cellNum(row[col] ?? "");
      if (a === null || v === null) continue;
      ages.push(a); values.push(v);
    }
    return ages.length ? { ages, values } : undefined;
  };
  let touched = false;
  const rates = spec.rates.map((r): RateRef => {
    const u = usedColumns(st, r.id);
    if (u.any !== undefined) {
      const t = read(u.any);
      if (!t) return r;
      touched = true;
      return { ...r, table: t };
    }
    const M = u.M !== undefined ? read(u.M) : undefined, F = u.F !== undefined ? read(u.F) : undefined;
    if (!M && !F) return r;
    touched = true;
    return { ...r, tables: { ...(M ? { M } : {}), ...(F ? { F } : {}) }, table: M ? { ...M, sex: "M" } : { ...F!, sex: "F" } };
  });
  return touched ? { ...spec, rates } : spec;
}
