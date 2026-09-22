import { unzip } from "./methoddoc/extract";
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

/** 새 위험률 id — 유형의 관례 기호(q 사망 · k 발생 · g 반복 · f 면제 · w 해지)에 겹치지 않게 번호를 붙인다 */
export function newRateId(role: RateRole, taken: string[]): string {
  const base = { death: "q", incidence: "k", recurring: "g", waiver: "f", lapse: "w", other: "r" }[role];
  let k = 1, id = base;
  while (taken.includes(id)) id = `${base}${++k}`;
  return id;
}

/** 값이 하나라도 수인 열 — 비고 같은 글자 열은 위험률로 잇지 않는다 */
export const hasNumbers = (sheet: Sheet, col: number) => sheet.rows.some((r) => cellNum(r[col] ?? "") !== null);

const norm = (s: string) => s.toLowerCase().replace(/[\s()[\]_·.\-]/g, "");
const isAgeHead = (h: string) => /^(연령|나이|가입나이|age|x)$/.test(norm(h)) || /연령|나이/.test(h);

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
  return `표: ${cols.join("·")}열 → ${t ? `${t.ages[0]}~${t.ages[t.ages.length - 1]}세 ${t.ages.length}행${who ? ` · ${who}` : ""}` : "연령 열을 정하면 붙습니다"}`;
}

/**
 * MethodSpec 의 위험률 표(RateRef.tables · table) → 위험률 표 창. attachTables 의 반대 —
 * 자유설계보험 등이 낸 JSON 을 열 때 표를 잃지 않게 한다(조건 파일에는 표가 실리지 않으므로).
 */
export function sheetFromSpec(spec: MethodSpec, name: string): SheetState | null {
  const cols = spec.rates.flatMap((r) => {
    const both = (["M", "F"] as const).flatMap((x) => (r.tables?.[x]?.ages?.length ? [{ r, sex: x as Sex | undefined, t: r.tables[x]! }] : []));
    return both.length ? both : r.table?.ages?.length ? [{ r, sex: r.table.sex, t: r.table }] : [];
  });
  if (!cols.length) return null;
  const ages = [...new Set(cols.flatMap((c) => c.t.ages))].sort((a, b) => a - b);
  return {
    sheet: {
      name, head: ["연령", ...cols.map((c) => `${c.r.name}${c.sex ? `(${sexName(c.sex)})` : ""}`)],
      rows: ages.map((a) => [String(a), ...cols.map((c) => { const i = c.t.ages.indexOf(a); return i < 0 ? "" : String(c.t.values[i]); })]),
    },
    map: [{ to: "age" }, ...cols.map((c): ColMap => ({ to: "rate", rateId: c.r.id, ...(c.sex ? { sex: c.sex } : {}) }))],
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
