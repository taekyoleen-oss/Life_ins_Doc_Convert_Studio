import { Document, isCollection, isMap, isNode, isScalar, isSeq, LineCounter, parseDocument, stringify, type Node } from "yaml";
import { parseRate, parseTimes } from "../methoddoc/parse";
import {
  emptySpec, hasProduct, METHOD_SPEC_VERSION, RATE_ROLE_LABEL, validateSpec,
  type BenefitSpec, type EntryRow, type Evidence, type ExpenseItem, type MethodSpec, type ProductInfo, type RateRef, type RateRole,
} from "../methoddoc/spec";

/**
 * 조건 파일(YAML) ↔ MethodSpec.
 *
 * 왼쪽 편집기에 보이는 사람용 표기다. 이율·사업비는 "2.5%", "1.5/1000" 처럼 실무 표기로 적고,
 * 읽을 때 소수로 바꾼다. 다른 앱에는 MethodSpec(JSON)을 넘긴다 — 두 형식은 1:1 이다.
 * 위험률 값 표(table)는 너무 길어 조건 파일에는 싣지 않는다(JSON 에는 남는다).
 */

// ── 표기 ────────────────────────────────────────────────────────────────────
/** 0.025 → "2.5%", 소수 오차는 지운다 */
export const pct = (x: number) => `${+(x * 100).toFixed(10)}%`;
/** 사업비 비율: 1% 이상은 %, 그 밖은 /1000 */
const expenseView = (x: number) => (x >= 0.01 ? pct(x) : `${+(x * 1000).toFixed(10)}/1000`);
/** "2.5%" · "1.5/1000" · 0.025 → 0.025 */
function rateOf(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") { const r = parseRate(v.trim()); return r ?? undefined; }
  return undefined;
}
const num = (v: unknown): number | undefined => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") { const x = Number(v.replace(/[,원세년\s]/g, "")); return Number.isFinite(x) && v.trim() ? x : undefined; }
  return undefined;
};
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
const ROLES = new Set(Object.keys(RATE_ROLE_LABEL));
const roleOf = (v: unknown): RateRole => {
  const s = str(v) ?? "";
  if (ROLES.has(s)) return s as RateRole;
  const byLabel = Object.entries(RATE_ROLE_LABEL).find(([, l]) => l === s)?.[0];
  return (byLabel as RateRole) ?? "other";
};

/** MethodSpec → 조건 파일에 보이는 모양(순서·표기 고정) */
export function yamlView(spec: MethodSpec): Record<string, unknown> {
  const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))) as T;
  const b = spec.basis;
  const view: Record<string, unknown> = {
    meta: clean({ productName: spec.meta.productName, insurer: spec.meta.insurer, kind: spec.meta.kind, version: spec.meta.version, date: spec.meta.date, note: spec.meta.note }),
    product: hasProduct(spec.product) ? clean({
      category: spec.product.category, types: spec.product.types,
      terms: spec.product.terms?.map((r) => clean({ label: r.label, term: r.term, pay: r.pay, age: r.age, ageF: r.ageF })),
      payFreqs: spec.product.payFreqs, sumLimit: spec.product.sumLimit, renewal: spec.product.renewal,
    }) : undefined,
    basis: clean({
      interest: b.interest !== undefined ? pct(b.interest) : undefined,
      standardInterest: b.standardInterest !== undefined ? pct(b.standardInterest) : undefined,
      minGuaranteed: b.minGuaranteed !== undefined ? pct(b.minGuaranteed) : undefined,
      averagePublished: b.averagePublished !== undefined ? pct(b.averagePublished) : undefined,
      waiver: b.waiver,
      lapse: b.lapse?.map((l) => clean({ label: l.label, rate: pct(l.rate), duringPayOnly: l.duringPayOnly })),
      lowRatio: b.lowRatio !== undefined ? pct(b.lowRatio) : undefined,
    }),
    rates: spec.rates.map((r) => clean({ id: r.id, name: r.name, role: r.role, source: r.source, adjustment: r.adjustment })),
    expenses: spec.expenses.map((e) => clean({
      group: e.group, symbol: e.symbol || undefined, basis: e.basis,
      rate: e.rate !== undefined ? expenseView(e.rate) : undefined,
      times: e.times !== undefined ? `${e.times}배` : undefined,
      phase: e.phase,
    })),
    benefits: spec.benefits.map((x) => clean({
      id: x.id, name: x.name, unit: x.unit, role: x.role, trigger: x.trigger, amount: x.amount, endAge: x.endAge,
      waitDays: x.waitDays, rateId: x.rateId, exitRateIds: x.exitRateIds, steps: x.steps, points: x.points,
    })),
    units: spec.units.length > 1 ? spec.units : undefined,
    reserve: spec.reserve.notes.length ? spec.reserve : undefined,
    surrender: spec.surrender.notes.length || spec.surrender.deductionYears ? clean({ ...spec.surrender }) : undefined,
    formulas: spec.formulas.length ? spec.formulas.map((f) => clean({ section: f.section, label: f.label, text: f.text, note: f.note })) : undefined,
    sections: spec.sections.length ? spec.sections : undefined,
  };
  return clean(view);
}

const splitPath = (p: string): (string | number)[] => p.split(".").flatMap((seg) => {
  const m = /^([^[]+)((?:\[\d+\])*)$/.exec(seg);
  if (!m) return [seg];
  return [m[1], ...[...m[2].matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]))];
});

/** 한 줄로 두는 편이 읽기 쉬운 목록 — 사업비·해지율 한 행, 탈퇴 위험률 id 목록 */
function styleFlow(doc: Document) {
  const flowItems = (path: string[]) => {
    const seq = doc.getIn(path, true);
    if (isSeq(seq)) for (const it of seq.items) if (isMap(it)) it.flow = true;
  };
  flowItems(["expenses"]);
  flowItems(["basis", "lapse"]);
  flowItems(["product", "terms"]);
  for (const key of ["types", "payFreqs"]) { const s = doc.getIn(["product", key], true); if (isSeq(s)) s.flow = true; }
  const bens = doc.getIn(["benefits"], true);
  if (isSeq(bens)) for (const b of bens.items) {
    if (!isMap(b)) continue;
    for (const key of ["exitRateIds", "steps", "points"]) {
      const s = b.get(key, true);
      if (isSeq(s)) { s.flow = true; for (const it of s.items) if (isMap(it)) it.flow = true; }
    }
  }
}

const CONF_LABEL = { high: "표에서 직접", medium: "본문 규칙", low: "⚠ 추정 — 확인 필요" };

/** MethodSpec → 조건 파일. evidence 를 주면 값마다 출처를 주석으로 단다 */
export function specToYaml(spec: MethodSpec, evidence: Evidence[] = [], header?: string): string {
  const doc = new Document(yamlView(spec));
  doc.commentBefore = header ?? ` 산출방법서 조건 (MethodSpec ${METHOD_SPEC_VERSION}) — 이율·사업비는 "2.5%", "1.5/1000" 처럼 적습니다`;
  styleFlow(doc);
  for (const e of evidence) {
    const node = doc.getIn(splitPath(e.path), true) as Node | undefined;
    if (!node) continue;
    const note = ` ${e.source} · ${CONF_LABEL[e.confidence]}`;
    if (isScalar(node)) node.comment = note;
    else node.commentBefore = note;
  }
  return doc.toString({ lineWidth: 0 });
}

// ── 조건 파일 → MethodSpec ─────────────────────────────────────────────────
export interface ParsedConditions {
  spec: MethodSpec;
  errors: { line: number; message: string }[];
  /** 조건 경로 → [시작 줄, 끝 줄] (1부터) */
  ranges: Map<string, [number, number]>;
}

function toSpec(raw: Record<string, unknown>, errors: ParsedConditions["errors"]): MethodSpec {
  const spec = emptySpec();
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const m = obj(raw.meta), b = obj(raw.basis);

  spec.meta = { productName: str(m.productName) ?? "" };
  for (const k of ["insurer", "kind", "version", "date", "note"] as const) if (str(m[k])) spec.meta[k] = str(m[k]);

  // 가입 조건 — 원문 표기 그대로 글자로 둔다. 빈 행(입력 화면에서 막 더한 것)은 건너뛴다
  const pr = obj(raw.product);
  const strs = (v: unknown) => arr(v).map(str).filter((s): s is string => !!s);
  const product: ProductInfo = {};
  if (str(pr.category)) product.category = str(pr.category);
  if (strs(pr.types).length) product.types = strs(pr.types);
  const terms = arr(pr.terms).map(obj).map((r): EntryRow => ({
    ...(str(r.label) ? { label: str(r.label) } : {}), term: str(r.term) ?? "", pay: str(r.pay) ?? "", age: str(r.age) ?? "",
    ...(str(r.ageF) ? { ageF: str(r.ageF) } : {}),
  })).filter((r) => r.label || r.term || r.pay || r.age || r.ageF);
  if (terms.length) product.terms = terms;
  if (strs(pr.payFreqs).length) product.payFreqs = strs(pr.payFreqs);
  for (const k of ["sumLimit", "renewal"] as const) if (str(pr[k])) product[k] = str(pr[k]);
  if (hasProduct(product)) spec.product = product;

  // 시산 기준(contract)은 조건이 아니다 — 보험료를 계산하는 앱(자유설계보험 상품 만들기 M02 계약정보)이 정한다
  if (raw.contract !== undefined) errors.push({ line: 0, message: "contract(시산 기준)는 쓰지 않습니다 — 가입나이·보험기간·납입기간은 자유설계보험 상품 만들기의 M02 계약정보에서 정합니다. 이 줄들은 지워도 됩니다" });

  for (const k of ["interest", "standardInterest", "minGuaranteed", "averagePublished", "lowRatio"] as const) {
    if (b[k] === undefined) continue;
    const v = rateOf(b[k]);
    if (v === undefined) errors.push({ line: 0, message: `basis.${k}: "${String(b[k])}" 를 비율로 읽을 수 없습니다 (예: 2.5%)` });
    else spec.basis[k] = v;
  }
  if (typeof b.waiver === "boolean") spec.basis.waiver = b.waiver;
  const lapse = arr(b.lapse).map(obj).map((l) => ({ label: str(l.label), rate: rateOf(l.rate) ?? 0, duringPayOnly: l.duringPayOnly === true }));
  if (lapse.length) spec.basis.lapse = lapse.map((l) => (l.label ? l : { rate: l.rate, duringPayOnly: l.duringPayOnly }));

  spec.rates = arr(raw.rates).map(obj).map((r, i): RateRef => ({
    id: str(r.id) ?? `r${i + 1}`, name: str(r.name) ?? `위험률 ${i + 1}`, role: roleOf(r.role),
    ...(str(r.source) ? { source: str(r.source) } : {}), ...(str(r.adjustment) ? { adjustment: str(r.adjustment) } : {}),
  }));

  spec.expenses = arr(raw.expenses).map(obj).map((e): ExpenseItem => {
    const item: ExpenseItem = { group: str(e.group) ?? "사업비", symbol: str(e.symbol) ?? "", basis: str(e.basis) ?? "" };
    const times = typeof e.times === "number" ? e.times : typeof e.times === "string" ? parseTimes(e.times) ?? num(e.times) : undefined;
    if (times !== undefined && times !== null) item.times = times;
    else { const r = rateOf(e.rate); if (r !== undefined) item.rate = r; }
    if (str(e.phase)) item.phase = str(e.phase);
    return item;
  });

  spec.benefits = arr(raw.benefits).map(obj).map((x, i): BenefitSpec => {
    const role = roleOf(x.role);
    const ben: BenefitSpec = { id: str(x.id) ?? `b${i + 1}`, name: str(x.name) ?? `담보 ${i + 1}`, role: role === "waiver" || role === "lapse" ? "other" : role };
    if (str(x.unit)) ben.unit = str(x.unit);
    if (str(x.trigger)) ben.trigger = str(x.trigger);
    for (const k of ["amount", "endAge", "waitDays"] as const) { const v = num(x[k]); if (v !== undefined) ben[k] = v; }
    if (str(x.rateId)) ben.rateId = str(x.rateId);
    const ids = arr(x.exitRateIds).map(str).filter((s): s is string => !!s);
    if (ids.length) ben.exitRateIds = ids;
    const steps = arr(x.steps).map(obj).map((s) => ({ fromAge: num(s.fromAge) ?? 0, toAge: num(s.toAge) ?? 0, multiple: num(s.multiple) ?? 1 }));
    if (steps.length) ben.steps = steps;
    const points = arr(x.points).map(obj).map((p) => ({ age: num(p.age) ?? 0, multiple: num(p.multiple) ?? 1 }));
    if (points.length) ben.points = points;
    return ben;
  });

  spec.units = arr(raw.units) as MethodSpec["units"];
  const rs = obj(raw.reserve), sr = obj(raw.surrender);
  spec.reserve = { notes: arr(rs.notes).map(str).filter((s): s is string => !!s) };
  spec.surrender = { notes: arr(sr.notes).map(str).filter((s): s is string => !!s), ...(num(sr.deductionYears) ? { deductionYears: num(sr.deductionYears) } : {}) };
  spec.formulas = arr(raw.formulas).map(obj).map((f) => ({ section: str(f.section) ?? "기타", label: str(f.label) ?? "", text: str(f.text) ?? "", ...(str(f.note) ? { note: str(f.note) } : {}) }));
  spec.sections = arr(raw.sections).map(obj).map((s) => ({ title: str(s.title) ?? "", paragraphs: arr(s.paragraphs).map(str).filter((x): x is string => !!x) }));

  // 담보가 가리키는 위험률 id 가 목록에 있는지
  const ids = new Set(spec.rates.map((r) => r.id));
  for (const ben of spec.benefits) for (const id of [ben.rateId, ...(ben.exitRateIds ?? [])]) {
    if (id && !ids.has(id)) errors.push({ line: 0, message: `담보 "${ben.name}" 가 없는 위험률 id "${id}" 를 가리킵니다` });
  }
  return spec;
}

export function yamlToSpec(src: string): ParsedConditions {
  const lc = new LineCounter();
  const doc = parseDocument(src, { lineCounter: lc });
  const errors: ParsedConditions["errors"] = doc.errors.map((e) => ({ line: e.linePos?.[0]?.line ?? 0, message: e.message.split("\n")[0] }));
  const ranges = new Map<string, [number, number]>();
  const lineOf = (off: number) => lc.linePos(Math.max(0, off)).line;
  const record = (path: string, from?: number, to?: number) => {
    if (from === undefined) return;
    const end = to !== undefined && to > from ? to - 1 : from;
    ranges.set(path, [lineOf(from), lineOf(end)]);
  };
  const walk = (node: unknown, path: string) => {
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
        const p = path ? `${path}.${key}` : key;
        const k = pair.key as Node | null, v = pair.value as Node | null;
        record(p, k?.range?.[0], v?.range?.[1] ?? k?.range?.[1]);
        walk(pair.value, p);
      }
    } else if (isSeq(node)) {
      node.items.forEach((it, i) => { const n = it as Node; const p = `${path}[${i}]`; record(p, n?.range?.[0], n?.range?.[1]); walk(it, p); });
    }
  };
  walk(doc.contents, "");
  let spec = emptySpec();
  if (!doc.errors.length) {
    const js = doc.toJS({ maxAliasCount: 50 });
    if (js && typeof js === "object") spec = toSpec(js as Record<string, unknown>, errors);
    else if (src.trim()) errors.push({ line: 1, message: "조건 파일의 맨 위는 meta:, basis: 같은 항목이어야 합니다" });
  }
  for (const w of validateSpec(spec)) errors.push({ line: 0, message: w });
  return { spec, errors, ranges };
}

/** JSON(MethodSpec) → 스펙. 다른 앱이 낸 파일을 그대로 받는다 */
export function jsonToSpec(text: string): MethodSpec {
  const raw = JSON.parse(text) as Partial<MethodSpec>;
  if (!raw || typeof raw !== "object" || !("basis" in raw || "meta" in raw)) throw new Error("MethodSpec JSON 이 아닙니다 (meta·basis 가 없음)");
  const errors: ParsedConditions["errors"] = [];
  // 표기를 한 번 거쳐 모양을 맞춘다(없는 칸 채우기·id 확인)
  const spec = toSpec(yamlView({ ...emptySpec(), ...raw, meta: { productName: "", ...raw.meta } } as MethodSpec) as Record<string, unknown>, errors);
  // 위험률 값 표는 조건 파일에 싣지 않지만 JSON 으로 받은 것은 살려 둔다
  raw.rates?.forEach((r, i) => {
    if (!spec.rates[i]) return;
    if (r.table) spec.rates[i].table = r.table;
    if (r.tables) spec.rates[i].tables = r.tables;
  });
  return spec;
}

// ── 산출방법서를 고쳐 되읽은 값을 조건 파일에 반영 ──────────────────────────
export interface MergeResult { spec: MethodSpec; changes: string[] }

/** 가입 조건 비교용 — 칸 순서가 달라도 같은 내용이면 같다 */
const productKey = (p?: ProductInfo) => JSON.stringify(p ? {
  category: p.category, types: p.types, payFreqs: p.payFreqs, sumLimit: p.sumLimit, renewal: p.renewal,
  terms: p.terms?.map((r) => ({ label: r.label, term: r.term, pay: r.pay, age: r.age, ageF: r.ageF })),
} : null);

/**
 * 되읽은 스펙(parsed)에서 근거가 있는 값만 지금 조건(current)에 덮는다.
 * 위험률은 이름으로 짝지어 id·값 표를 지키고, 담보가 가리키는 id 도 그에 맞춰 옮긴다.
 */
export function mergeSpec(current: MethodSpec, parsed: MethodSpec, evidence: Evidence[]): MergeResult {
  const out: MethodSpec = JSON.parse(JSON.stringify(current));
  const changes: string[] = [];
  const took = new Set(evidence.filter((e) => e.confidence !== "low").map((e) => e.path.replace(/\[\d+\].*$/, "")));
  const show = (v: unknown) => (typeof v === "number" ? (v < 1 && v > 0 ? pct(v) : String(v)) : JSON.stringify(v));
  const setIf = (path: string, get: (s: MethodSpec) => unknown, set: (s: MethodSpec, v: never) => void) => {
    if (!took.has(path)) return;
    const a = get(out), b = get(parsed);
    if (b === undefined || JSON.stringify(a) === JSON.stringify(b)) return;
    set(out, b as never);
    changes.push(`${path}: ${show(a)} → ${show(b)}`);
  };
  setIf("meta.productName", (s) => s.meta.productName || undefined, (s, v) => { s.meta.productName = v; });
  setIf("meta.kind", (s) => s.meta.kind, (s, v) => { s.meta.kind = v; });
  if (took.has("product") && hasProduct(parsed.product) && productKey(out.product) !== productKey(parsed.product)) {
    changes.push(`product: 가입 조건 ${out.product?.terms?.length ?? 0}행 → ${parsed.product.terms?.length ?? 0}행 갱신`);
    out.product = parsed.product;
  }
  for (const k of ["interest", "standardInterest", "minGuaranteed", "averagePublished", "lowRatio", "waiver"] as const) {
    setIf(`basis.${k}`, (s) => s.basis[k], (s, v) => { (s.basis as Record<string, unknown>)[k] = v; });
  }
  setIf("basis.lapse", (s) => s.basis.lapse, (s, v) => { s.basis.lapse = v; });
  if (took.has("expenses") && parsed.expenses.length) {
    const view = (s: MethodSpec) => s.expenses.map((e) => `${e.symbol}=${e.rate ?? e.times}`).join(" ");
    if (view(out) !== view(parsed)) { changes.push(`expenses: ${view(out)} → ${view(parsed)}`); out.expenses = parsed.expenses.map((e) => ({ ...e, raw: undefined })); }
  }
  // 위험률: 이름으로 짝짓는다
  const idMap = new Map<string, string>();
  if (took.has("rates")) for (const r of parsed.rates) {
    const bare = r.name.replace(/^.* · /, "");
    const hit = out.rates.find((x) => x.name === r.name || x.name === bare);
    if (hit) {
      idMap.set(r.id, hit.id);
      if (hit.role !== r.role) { changes.push(`rates "${hit.name}" 유형: ${hit.role} → ${r.role}`); hit.role = r.role; }
      if (r.source && r.source !== hit.source && !/^시트 /.test(r.source)) { hit.source = r.source; }
    } else {
      const id = out.rates.some((x) => x.id === r.id) ? `r${out.rates.length + 1}` : r.id;
      idMap.set(r.id, id);
      out.rates.push({ ...r, id });
      changes.push(`rates: "${r.name}" 추가`);
    }
  }
  if (took.has("benefits") && parsed.benefits.length) {
    const fix = (id?: string) => (id ? idMap.get(id) ?? id : id);
    const next = parsed.benefits.map((b) => {
      const prev = out.benefits.find((x) => x.name === b.name);
      return { ...prev, ...b, id: prev?.id ?? b.id, rateId: fix(b.rateId), exitRateIds: b.exitRateIds?.map((x) => fix(x)!) };
    });
    const view = (bs: BenefitSpec[]) => JSON.stringify(bs.map((b) => [b.name, b.role, b.amount, b.endAge, b.rateId, b.exitRateIds, b.steps, b.points]));
    if (view(out.benefits) !== view(next)) { changes.push(`benefits: ${out.benefits.length}개 → ${next.length}개 갱신`); out.benefits = next; }
  }
  // 표준 산출방법서에서만 오는 것 — 회사·판·비고, 식, 준비금·환급금 주석, 원문 절
  for (const k of ["insurer", "version", "date", "note"] as const) setIf(`meta.${k}`, (s) => s.meta[k], (s, v) => { s.meta[k] = v; });
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  // 식은 문서에서 절 순서로 나온다 — 순서만 다른 것은 바뀐 게 아니다
  const fkey = (fs: MethodSpec["formulas"]) => fs.map((f) => JSON.stringify([f.section, f.label, f.text, f.note ?? ""])).sort();
  if (took.has("formulas") && !same(fkey(out.formulas), fkey(parsed.formulas))) {
    changes.push(`formulas: 조건의 식 ${out.formulas.length}개 → ${parsed.formulas.length}개 (${parsed.formulas.map((f) => f.label).join(", ") || "자동 식만"})`);
    out.formulas = parsed.formulas;
  }
  if (took.has("reserve") && !same(out.reserve.notes, parsed.reserve.notes)) {
    changes.push(`reserve.notes: ${out.reserve.notes.length}줄 → ${parsed.reserve.notes.length}줄`);
    out.reserve = { notes: parsed.reserve.notes };
  }
  if (took.has("surrender") && !same(out.surrender, parsed.surrender)) {
    changes.push(`surrender: 해약공제 ${out.surrender.deductionYears ?? "—"}년 · 주석 ${out.surrender.notes.length}줄 → ${parsed.surrender.deductionYears ?? "—"}년 · ${parsed.surrender.notes.length}줄`);
    out.surrender = parsed.surrender;
  }
  if (took.has("sections") && !same(out.sections, parsed.sections)) {
    changes.push(`sections: 원문 절 ${out.sections.length}개 → ${parsed.sections.length}개`);
    out.sections = parsed.sections;
  }
  return { spec: out, changes };
}

/**
 * 바뀐 항목만 조건 파일 안에서 고친다 — 사용자가 적은 주석·순서를 지킨다.
 * 새 파일을 통째로 다시 쓰지 않는다.
 */
export function patchYaml(src: string, next: MethodSpec): string {
  const doc = parseDocument(src);
  if (doc.errors.length) return specToYaml(next);
  const view = yamlView(next);
  const cur = yamlView(yamlToSpec(src).spec);
  for (const [section, value] of Object.entries(view)) {
    if (JSON.stringify(cur[section]) === JSON.stringify(value)) continue;
    const isObj = value && typeof value === "object" && !Array.isArray(value);
    if (isObj && cur[section] && typeof cur[section] === "object" && !Array.isArray(cur[section])) {
      // meta·basis 는 칸 단위로
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (JSON.stringify((cur[section] as Record<string, unknown>)[k]) !== JSON.stringify(v)) doc.setIn([section, k], doc.createNode(v));
      }
    } else doc.setIn([section], doc.createNode(value));
  }
  for (const section of Object.keys(cur)) if (!(section in view)) doc.deleteIn([section]);
  styleFlow(doc);
  return doc.toString({ lineWidth: 0 });
}

// ── 입력 화면에서 한 칸씩 고치기 ────────────────────────────────────────────
export type YamlPath = (string | number)[];
/** value 가 undefined 면 지운다. add 는 목록 끝에 붙인다 */
export interface YamlEdit { path: YamlPath; value?: unknown; add?: boolean }

/** ["rates", 0, "name"] → "rates[0].name" (산출방법서 블록·줄 범위와 같은 경로) */
export const pathKey = (p: YamlPath) => p.map((k, i) => (typeof k === "number" ? `[${k}]` : i ? `.${k}` : k)).join("");

/** 새로 만드는 항목 중 한 줄로 두는 것 — specToYaml 의 styleFlow 와 같은 관례 */
const FLOW = /^(expenses|basis\.lapse|product\.terms)\[\d+\]$|\.(exitRateIds|steps|points)(\[\d+\])?$|^product\.(types|payFreqs)$/;
function markFlow(node: unknown, key: string) {
  if (!isCollection(node)) return;
  if (FLOW.test(key)) node.flow = true;
  if (isMap(node)) for (const p of node.items) markFlow(p.value, `${key}.${isScalar(p.key) ? String(p.key.value) : String(p.key)}`);
  else node.items.forEach((it, i) => markFlow(it, `${key}[${i}]`));
}

/**
 * 입력 화면이 고친 값을 조건 파일에 넣는다 — 파일을 통째로 다시 쓰지 않는다.
 * 값 한 칸만 바뀌면 그 글자만 바꿔 끼운다(주석·줄 맞춤·순서 그대로).
 * 항목을 더하고 지우는 것처럼 모양이 바뀔 때만 문서 트리로 고친다(주석은 남고, 주석 앞 줄 맞춤만 한 칸으로 준다).
 */
export function editYaml(src: string, edits: YamlEdit[]): string {
  try { return edits.reduce(editOne, src); }
  catch { return src; }         // 맨 위가 목록·글자 같은, 칸으로 고칠 수 없는 파일 — 입력 화면이 먼저 막는다
}

function editOne(src: string, e: YamlEdit): string {
  const doc = parseDocument(src);
  if (doc.errors.length) return src;
  const del = !e.add && e.value === undefined;
  const old = doc.getIn(e.path, true);
  const obj = e.value !== null && typeof e.value === "object";
  if (!del && !e.add && !obj && isScalar(old) && old.range) {
    const next = src.slice(0, old.range[0]) + stringify(e.value, { lineWidth: 0 }).trimEnd() + src.slice(old.range[1]);
    const chk = parseDocument(next);
    if (!chk.errors.length && chk.getIn(e.path) === e.value) return next;   // 흐름 표기 안의 "a, b" 처럼 깨지면 아래로
  }
  if (del) {
    if (old === undefined) return src;              // 없는 칸 지우기 — 파일을 다시 쓰지 않는다
    doc.deleteIn(e.path);
    return doc.toString({ lineWidth: 0 });
  }
  // "reserve:" 처럼 비어 있는 윗 항목은 먼저 목록·표로 바꾼다
  for (let i = 1; i < e.path.length; i++) {
    const up = doc.getIn(e.path.slice(0, i), true);
    if (isScalar(up) && up.value === null) doc.setIn(e.path.slice(0, i), doc.createNode(typeof e.path[i] === "number" ? [] : {}));
  }
  const node = obj ? doc.createNode(e.value) : e.value;
  if (e.add) {
    const list = doc.getIn(e.path, true);
    if (isSeq(list)) { markFlow(node, pathKey([...e.path, list.items.length])); list.add(node); }
    else { const seq = doc.createNode([e.value]); markFlow(seq, pathKey(e.path)); doc.setIn(e.path, seq); }   // 첫 항목이면 목록째 만든다
  } else {
    markFlow(node, pathKey(e.path));
    if (isCollection(node) && isNode(old)) {       // 사용자가 둔 모양·주석을 이어받는다
      if (isCollection(old)) node.flow = old.flow;
      node.comment = old.comment; node.commentBefore = old.commentBefore;
    }
    doc.setIn(e.path, node);
  }
  return doc.toString({ lineWidth: 0 });
}
