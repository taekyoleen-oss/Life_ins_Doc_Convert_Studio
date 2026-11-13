import { syncFromSurvivors } from "../methoddoc/formulas";
import { coverTerms, endAgeLabel, hasProduct, RATE_ROLE_LABEL, type BenefitSpec, type MethodSpec, type ParseResult } from "../methoddoc/spec";
import type { SheetState } from "../sheet";

/**
 * 고친 산출방법서를 되읽어 지금 조건과 견준 결과를 **항목별**로 — 반영 확인 창이 줄마다 보여 주고 고르게 한다.
 *  - diffSpec(지금 조건, 반영한 조건)  → 바뀐 항목(묶음 · 한글 이름 · 지금 값 · 문서 값 · 고침/더함/뺌)
 *  - applyChanges(지금 조건, 반영한 조건, 고른 id) → 고른 항목만 반영한 조건(고르지 않은 항목은 지금 값 그대로)
 * 조건 파일(YAML)에 실리는 칸만 견준다(위험률 값 표 · 사업비 원문 표기 같은 것은 빼고).
 */
export type ChangeKind = "고침" | "더함" | "뺌";
export interface ChangeItem {
  id: string;
  /** 묶음 — 상품 · 이율 · 위험률 · 사업비 · 유지자 · 보험금·보장 · 적립 · 식 · 관련 사항 */
  group: string;
  label: string;
  before: string;
  after: string;
  kind: ChangeKind;
}
/** 묶음 차례 = 카드·산출방법서 차례 */
export const CHANGE_GROUPS = ["상품", "이율", "위험률", "사업비", "유지자", "보험금·보장", "적립", "식", "관련 사항"];

type Slot = ChangeItem & { apply: (out: MethodSpec) => void; late?: boolean };

const pct = (x: number) => `${+(x * 100).toFixed(10)}%`;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const empty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
const days = (d?: number) => (!d ? "" : d % 365 === 0 ? `${d / 365}년` : `${d}일`);

/** 위험률 기호(id)를 바꾼다 — 그 위험률을 가리키는 담보 · 유지자 · 합성 · 납입면제 사유까지 */
export function renameRate(s: MethodSpec, from: string, to: string) {
  const sw = (id: string) => (id === from ? to : id);
  for (const r of s.rates) r.id = sw(r.id);
  for (const b of s.benefits) { if (b.rateId) b.rateId = sw(b.rateId); if (b.exitRateIds) b.exitRateIds = b.exitRateIds.map(sw); }
  for (const x of s.survivors ?? []) x.exitRateIds = x.exitRateIds.map(sw);
  for (const x of s.combos ?? []) x.rateIds = x.rateIds.map(sw);
  if (s.basis.waiverRateIds) s.basis.waiverRateIds = s.basis.waiverRateIds.map(sw);
}
/** 이름은 같고 기호만 바뀐 위험률 — [지금 기호, 새 기호] */
export function renamedRates(cur: MethodSpec["rates"], next: MethodSpec["rates"]): [string, string][] {
  const out: [string, string][] = [];
  for (const r of next) {
    if (cur.some((c) => c.id === r.id)) continue;
    const c = cur.find((x) => x.name === r.name && !next.some((n) => n.id === x.id));
    if (c) out.push([c.id, r.id]);
  }
  return out;
}
/** 기호만 바뀐 위험률(renamedRates)은 위험률 표의 잇기를 새 기호로 옮긴다 — 값 표가 이어진 채로(화면의 표와 반영 확인 창의 보험료 계산이 같이 쓴다) */
export function relinkSheet(st: SheetState | null, moved: [string, string][]): SheetState | null {
  if (!st || !moved.length) return st;
  return { ...st, map: st.map.map((m) => { const hit = m.to === "rate" ? moved.find(([from]) => from === m.rateId) : undefined; return hit && m.to === "rate" ? { ...m, rateId: hit[1] } : m; }) };
}
/**
 * 반영 확인 창의 "확인이 필요한 곳" — 되읽기가 알린 것 + 문서에서 찾지 못한 항목.
 * 표준 양식에 없는 칸은 그 상품에 없는 것이지만, 지금 조건에 값이 있는데 문서에서 못 찾았으면(칸을 글자로 고쳤거나 비운 것) 알린다 — 말없이 "조건과 같습니다" 가 되지 않게.
 */
export function syncWarnings(current: MethodSpec, back: Pick<ParseResult, "warnings" | "missing" | "format">): string[] {
  const has: Record<string, boolean> = { 적용이율: current.basis.interest !== undefined, 사업비: current.expenses.length > 0, 위험률: current.rates.length > 0 };
  return [...back.warnings, ...back.missing.filter((m) => (back.format ? has[m] === true : true))
    .map((m) => `문서에서 찾지 못한 항목 — ${m} (지금 조건 값을 그대로 둡니다 — 문서의 그 칸을 "2.5%" 처럼 수로 적었는지 확인하세요)`)];
}
const usedRates =(s: MethodSpec) => new Set([...s.benefits.flatMap((b) => [b.rateId, ...(b.exitRateIds ?? [])]), ...(s.survivors ?? []).flatMap((x) => x.exitRateIds),
  ...(s.combos ?? []).flatMap((x) => x.rateIds), ...(s.basis.waiverRateIds ?? [])].filter((x): x is string => !!x));

function slots(current: MethodSpec, next: MethodSpec): Slot[] {
  const out: Slot[] = [];
  // 기호만 바뀐 위험률은 먼저 옮겨 놓고 견준다 — 그 위험률을 가리키는 칸이 줄줄이 바뀐 것으로 나오지 않게
  const renames = renamedRates(current.rates, next.rates);
  const cur = clone(current);
  for (const [from, to] of renames) renameRate(cur, from, to);
  const alias = new Map(renames.map(([from, to]) => [to, from]));
  const rateIn = (o: MethodSpec, id: string) => o.rates.find((r) => r.id === id) ?? o.rates.find((r) => r.id === alias.get(id));
  const rname = (id: string) => next.rates.find((r) => r.id === id)?.name ?? cur.rates.find((r) => r.id === id)?.name ?? id;
  const rnames = (ids?: string[]) => (ids?.length ? ids.map(rname).join(" · ") : "없음");

  const field = <T>(id: string, group: string, label: string, get: (s: MethodSpec) => T | undefined, set: (s: MethodSpec, v: T | undefined) => void, fmt: (v: T) => string = String, late = false) => {
    const a = get(cur), b = get(next);
    if (same(a, b)) return;
    out.push({ id, group, label, before: empty(a) ? "—" : fmt(a as T), after: empty(b) ? "—" : fmt(b as T), kind: empty(a) ? "더함" : empty(b) ? "뺌" : "고침", apply: (o) => set(o, clone(b)), late });
  };
  /** id 로 짝짓는 목록 — 항목마다 더함 · 뺌, 같은 id 는 both 가 칸마다 견준다. 반영 뒤 차례는 문서 차례 */
  const list = <T>(get: (s: MethodSpec) => T[] | undefined, set: (s: MethodSpec, v: T[] | undefined) => void, key: (x: T) => string,
    slot: (x: T, kind: "더함" | "뺌") => Pick<Slot, "id" | "group" | "label"> & { text: string; late?: boolean }, both: (a: T, b: T, find: (o: MethodSpec) => T | undefined) => void) => {
    const A = get(cur) ?? [], B = get(next) ?? [];
    const order = (o: MethodSpec) => {
      const l = get(o) ?? [], rank = new Map(B.map((x, i) => [key(x), i]));
      const sorted = l.every((x) => rank.has(key(x))) ? [...l].sort((x, y) => rank.get(key(x))! - rank.get(key(y))!) : l;
      set(o, sorted.length || get(next) ? sorted : undefined);
    };
    for (const b of B) {
      const a = A.find((x) => key(x) === key(b));
      if (a) { both(a, b, (o) => (get(o) ?? []).find((x) => key(x) === key(b))); continue; }
      const s = slot(b, "더함");
      out.push({ id: s.id, group: s.group, label: s.label, before: "—", after: s.text, kind: "더함", apply: (o) => { if (!(get(o) ?? []).some((x) => key(x) === key(b))) set(o, [...(get(o) ?? []), clone(b)]); order(o); } });
    }
    for (const a of A) {
      if (B.some((x) => key(x) === key(a))) continue;
      const s = slot(a, "뺌");
      out.push({ id: s.id, group: s.group, label: s.label, before: s.text, after: "—", kind: "뺌", late: s.late, apply: (o) => { set(o, (get(o) ?? []).filter((x) => key(x) !== key(a))); order(o); } });
    }
  };

  // ── 상품 ──
  const META: [keyof MethodSpec["meta"], string][] = [["productName", "상품명"], ["kind", "종류"], ["insurer", "회사"], ["version", "판"], ["date", "작성일"], ["note", "비고"]];
  for (const [k, label] of META) field(`meta.${k}`, "상품", label, (s) => s.meta[k] || undefined, (s, v) => { if (v === undefined && k !== "productName") delete s.meta[k]; else s.meta[k] = v ?? ""; });
  const prod = (s: MethodSpec) => (hasProduct(s.product) ? s.product : undefined);
  const setProd = (s: MethodSpec, k: string, v: unknown) => { const p = { ...(s.product ?? {}) } as Record<string, unknown>; if (empty(v)) delete p[k]; else p[k] = v; s.product = hasProduct(p) ? p : undefined; };
  field("product.category", "상품", "보험의 종류", (s) => prod(s)?.category, (s, v) => setProd(s, "category", v));
  field("product.types", "상품", "보험종목", (s) => prod(s)?.types, (s, v) => setProd(s, "types", v), (v) => v.join(" · "));
  field("product.payFreqs", "상품", "납입주기", (s) => prod(s)?.payFreqs, (s, v) => setProd(s, "payFreqs", v), (v) => v.join(" · "));
  field("product.sumLimit", "상품", "가입금액 한도", (s) => prod(s)?.sumLimit, (s, v) => setProd(s, "sumLimit", v));
  field("product.renewal", "상품", "갱신", (s) => prod(s)?.renewal, (s, v) => setProd(s, "renewal", v));
  field("product.terms", "상품", "가입 조건 표 (보험기간 · 납입기간 · 가입나이)", (s) => prod(s)?.terms?.map((r) => ({ label: r.label || undefined, term: r.term, pay: r.pay, age: r.age, ageF: r.ageF || undefined })),
    (s, v) => setProd(s, "terms", v), (v) => v.map((r) => [r.label, r.term, r.pay, r.age, r.ageF && `여 ${r.ageF}`].filter(Boolean).join(" / ")).join(" ｜ "));

  // ── 이율 ──
  const RATES: [("interest" | "standardInterest" | "minGuaranteed" | "averagePublished" | "lowRatio"), string][] =
    [["interest", "적용(예정)이율"], ["standardInterest", "표준이율"], ["minGuaranteed", "최저보증이율"], ["averagePublished", "평균공시이율"], ["lowRatio", "저해지 환급 비율"]];
  for (const [k, label] of RATES) field(`basis.${k}`, "이율", label, (s) => s.basis[k], (s, v) => { if (v === undefined) delete s.basis[k]; else s.basis[k] = v; }, pct);
  field("basis.lapse", "이율", "적용해지율", (s) => s.basis.lapse?.map((l) => ({ label: l.label || undefined, rate: l.rate, duringPayOnly: !!l.duringPayOnly })),
    (s, v) => { if (v?.length) s.basis.lapse = v; else delete s.basis.lapse; }, (v) => v.map((l) => `${l.label ? `${l.label} ` : ""}${pct(l.rate)}${l.duringPayOnly ? " (납입 중)" : ""}`).join(" · "));

  // ── 위험률 ──
  for (const [from, to] of renames) {
    out.push({ id: `rates.${to}.id`, group: "위험률", label: `${rname(to)} — 기호`, before: from, after: to, kind: "고침", apply: (o) => { if (!o.rates.some((r) => r.id === to)) renameRate(o, from, to); } });
  }
  list((s) => s.rates.map((r) => ({ id: r.id, name: r.name, role: r.role, source: r.source, adjustment: r.adjustment })), (s, v) => {
    // 값 표(table · tables)는 지금 조건의 것을 지킨다
    s.rates = (v ?? []).map((r) => ({ ...(rateIn(s, r.id) ?? {}), ...r, id: rateIn(s, r.id)?.id ?? r.id }));
  }, (r) => r.id, (r, kind) => ({ id: `rates.${r.id}`, group: "위험률", label: `위험률 ${r.name}`, text: `${r.name} (기호 ${r.id} · ${RATE_ROLE_LABEL[r.role]})`, late: kind === "뺌" }), (a, b) => {
    const at = (o: MethodSpec) => rateIn(o, b.id);
    if (a.name !== b.name) out.push({ id: `rates.${b.id}.name`, group: "위험률", label: `위험률 ${b.id} — 이름`, before: a.name, after: b.name, kind: "고침", apply: (o) => { const r = at(o); if (r) r.name = b.name; } });
    if (a.role !== b.role) out.push({ id: `rates.${b.id}.role`, group: "위험률", label: `${b.name} — 유형`, before: RATE_ROLE_LABEL[a.role], after: RATE_ROLE_LABEL[b.role], kind: "고침", apply: (o) => { const r = at(o); if (r) r.role = b.role; } });
    for (const [k, label] of [["source", "근거·출처"], ["adjustment", "보정"]] as const) {
      if ((a[k] ?? "") !== (b[k] ?? "")) out.push({ id: `rates.${b.id}.${k}`, group: "위험률", label: `${b.name} — ${label}`, before: a[k] || "—", after: b[k] || "—", kind: !a[k] ? "더함" : !b[k] ? "뺌" : "고침",
        apply: (o) => { const r = at(o); if (!r) return; if (b[k]) r[k] = b[k]; else delete r[k]; } });
    }
  });

  // ── 사업비 ──
  const ekey = (e: MethodSpec["expenses"][number]) => e.symbol || `${e.group}/${e.basis}`;
  const eview = (e: MethodSpec["expenses"][number]) => ({ group: e.group, symbol: e.symbol, basis: e.basis, rate: e.rate, times: e.times, phase: e.phase || undefined });
  const etext = (e: ReturnType<typeof eview>) => `${e.rate !== undefined ? (e.rate >= 0.01 ? pct(e.rate) : `${+(e.rate * 1000).toFixed(10)}/1000`) : e.times !== undefined ? `${e.times}배` : "—"} (${[e.group, e.basis, e.phase].filter(Boolean).join(" · ")})`;
  list((s) => s.expenses.map(eview), (s, v) => { s.expenses = (v ?? []).map((e) => clone(e)); }, ekey,
    (e) => ({ id: `expenses.${ekey(e)}`, group: "사업비", label: `사업비 ${e.symbol || e.group}`, text: etext(e) }), (a, b) => {
      if (same(a, b)) return;
      out.push({ id: `expenses.${ekey(b)}`, group: "사업비", label: `사업비 ${b.symbol || b.group}`, before: etext(a), after: etext(b), kind: "고침",
        apply: (o) => { o.expenses = o.expenses.map((e) => (ekey(e) === ekey(b) ? clone(b) : e)); } });
    });

  // ── 유지자 · 위험률 합성 · 납입면제 ──
  const stext = (x: NonNullable<MethodSpec["survivors"]>[number]) => `${x.name ? `${x.name} — ` : ""}대상 위험률 ${rnames(x.exitRateIds)}${x.unit ? ` · ${x.unit}` : ""}${x.payFor?.length ? ` · [납입] ${x.payFor.join(" · ")}` : ""}`;
  const sno = (id: string) => `유지자 lx(${id.replace(/^s/, "")})`;
  list((s) => s.survivors, (s, v) => { s.survivors = v; }, (x) => x.id, (x) => ({ id: `survivors.${x.id}`, group: "유지자", label: sno(x.id), text: stext(x) }), (a, b) => {
    if (same(a, b)) return;
    out.push({ id: `survivors.${b.id}`, group: "유지자", label: sno(b.id), before: stext(a), after: stext(b), kind: "고침", apply: (o) => { o.survivors = o.survivors?.map((x) => (x.id === b.id ? clone(b) : x)); } });
  });
  const ctext = (x: NonNullable<MethodSpec["combos"]>[number]) => `${x.name ? `${x.name} — ` : ""}${rnames(x.rateIds)}`;
  list((s) => s.combos, (s, v) => { s.combos = v; }, (x) => x.id, (x) => ({ id: `combos.${x.id}`, group: "유지자", label: `위험률 합성 (${x.id.replace(/^c/, "")})`, text: ctext(x) }), (a, b) => {
    if (same(a, b)) return;
    out.push({ id: `combos.${b.id}`, group: "유지자", label: `위험률 합성 (${b.id.replace(/^c/, "")})`, before: ctext(a), after: ctext(b), kind: "고침", apply: (o) => { o.combos = o.combos?.map((x) => (x.id === b.id ? clone(b) : x)); } });
  });
  field("basis.waiver", "유지자", "납입면제", (s) => s.basis.waiver, (s, v) => { if (v === undefined) delete s.basis.waiver; else s.basis.waiver = v; }, (v) => (v ? "적용" : "미적용"));
  field("basis.waiverRateIds", "유지자", "납입면제 사유", (s) => s.basis.waiverRateIds, (s, v) => { if (v?.length) s.basis.waiverRateIds = v; else delete s.basis.waiverRateIds; }, rnames);

  // ── 보험금 · 보장 ──
  const amount = (b: BenefitSpec) => (b.multiple !== undefined ? `${b.base === "premium" ? "보험료" : "가입금액"}의 ${b.multiple}배` : b.amount !== undefined ? `${b.amount.toLocaleString("ko-KR")}원` : "—");
  const cover = (b: BenefitSpec) => { const c = coverTerms(b); return [c.wait && `${days(c.wait)} 면책`, c.reduce && `${days(c.reduce)} ${pct(c.ratio ?? 0.5)} 지급(삭감)`].filter(Boolean).join(" · ") || "없음"; };
  const ROLE = (r: BenefitSpec["role"]) => ({ death: "사망형", incidence: "진단형", recurring: "일당형", other: "기타" }[r]);
  type BF = { label: string; get: (b: BenefitSpec) => unknown; text: (b: BenefitSpec) => string; keys: (keyof BenefitSpec)[]; group?: string };
  const BEN: BF[] = [
    { label: "이름", get: (b) => b.name, text: (b) => b.name, keys: ["name"] },
    { label: "계약 단위", get: (b) => b.unit || undefined, text: (b) => b.unit || "주계약", keys: ["unit"] },
    { label: "급부 유형", get: (b) => b.role, text: (b) => ROLE(b.role), keys: ["role"] },
    { label: "보장금액", get: (b) => [b.multiple, b.base, b.amount], text: amount, keys: ["multiple", "base", "amount"] },
    { label: "보험기간", get: (b) => b.endAge, text: (b) => endAgeLabel(b.endAge), keys: ["endAge"] },
    { label: "면책 · 삭감", get: (b) => [b.waitDays, b.waitPayRatio, b.reduceDays, b.reduceRatio], text: cover, keys: ["waitDays", "waitPayRatio", "reduceDays", "reduceRatio"] },
    { label: "대상자수(유지자)", get: (b) => [b.survivorId, b.exitRateIds], text: (b) => (b.survivorId ? `lx(${b.survivorId.replace(/^s/, "")}) · ` : "") + `탈퇴 ${rnames(b.exitRateIds)}`, keys: ["survivorId", "exitRateIds"], group: "유지자" },
    { label: "대상 위험률", get: (b) => b.rateId, text: (b) => (b.rateId ? (/^c\d+$/.test(b.rateId) && !next.rates.some((r) => r.id === b.rateId) ? `위험률 합성 (${b.rateId.slice(1)})` : rname(b.rateId)) : "유지자의 대상 위험률에서"), keys: ["rateId"] },
    { label: "연령 구간 배수", get: (b) => b.steps, text: (b) => b.steps?.map((s) => `${s.fromAge}~${s.toAge}세 ${s.multiple}배`).join(" · ") || "없음", keys: ["steps"] },
    { label: "생존 지급 시점", get: (b) => b.points, text: (b) => b.points?.map((p) => `${p.age}세 ${p.multiple}배`).join(" · ") || "없음", keys: ["points"] },
    { label: "지급 사유", get: (b) => b.trigger, text: (b) => b.trigger || "—", keys: ["trigger"] },
  ];
  list((s) => s.benefits, (s, v) => { s.benefits = v ?? []; }, (b) => b.id, (b) => ({ id: `benefits.${b.id}`, group: "보험금·보장", label: `보장 ${b.name}`, text: `${ROLE(b.role)} · ${amount(b)} · ${endAgeLabel(b.endAge)} · ${cover(b)}` }), (a, b, find) => {
    for (const f of BEN) {
      if (same(f.get(a), f.get(b))) continue;
      out.push({ id: `benefits.${b.id}.${f.keys[0]}`, group: f.group ?? "보험금·보장", label: `${b.name} — ${f.label}`, before: f.text(a), after: f.text(b), kind: "고침", apply: (o) => {
        const x = find(o) as Record<string, unknown> | undefined;
        if (x) for (const k of f.keys) { if (b[k] === undefined) delete x[k]; else x[k] = clone(b[k]); }
      } });
    }
  });

  // ── 적립 ──
  if (!cur.savings || !next.savings) field("savings", "적립", "적립형(공시이율형 저축보험) 조건", (s) => s.savings, (s, v) => { s.savings = v; }, () => "있음");
  else {
    const g = (v: NonNullable<MethodSpec["savings"]>["guarantee"]) => v.map((x) => `${x.from}년부터 ${pct(x.rate)}`).join(" · ");
    const sv = <K extends keyof NonNullable<MethodSpec["savings"]>>(k: K, label: string, fmt: (v: NonNullable<MethodSpec["savings"]>[K]) => string) =>
      field(`savings.${k}`, "적립", label, (s) => s.savings?.[k], (s, v) => { if (s.savings && v !== undefined) s.savings[k] = v; }, fmt);
    sv("credited", "공시이율(예시)", pct); sv("guarantee", "최저보증이율 구간", g); sv("maturityFloor", "만기환급금 최저보증", pct);
    sv("alphaYears", "계약체결비용 α 기간", (v) => `${v}년`); sv("deductRatio", "해약공제 비율", pct); sv("deductYears", "해약공제 기간", (v) => `${v}년`);
  }

  // ── 식 ──
  const fkey = (f: MethodSpec["formulas"][number]) => `${f.section}|${f.label}`;
  const fview = (f: MethodSpec["formulas"][number]) => ({ section: f.section, label: f.label, text: f.text, note: f.note || undefined });
  const ftext = (f: ReturnType<typeof fview>) => f.text + (f.note ? `  ※ ${f.note}` : "");
  list((s) => s.formulas.map(fview), (s, v) => { s.formulas = v ?? []; }, fkey, (f, kind) => ({ id: `formulas.${fkey(f)}`, group: "식", label: `식 — ${f.label}${kind === "뺌" ? " (기본 식으로 되돌림)" : ""}`, text: ftext(f) }), (a, b) => {
    if (same(a, b)) return;
    out.push({ id: `formulas.${fkey(b)}`, group: "식", label: `식 — ${b.label}`, before: ftext(a), after: ftext(b), kind: "고침", apply: (o) => { o.formulas = o.formulas.map((f) => (fkey(f) === fkey(b) ? clone(b) : f)); } });
  });

  // ── 관련 사항 ──
  const lines = (v: string[]) => `${v.length}줄 — ${v.map((x) => (x.length > 40 ? `${x.slice(0, 40)}…` : x)).join(" / ")}`;
  field("reserve.notes", "관련 사항", "책임준비금 관련 사항", (s) => s.reserve.notes, (s, v) => { s.reserve = { notes: v ?? [] }; }, lines);
  field("surrender.deductionYears", "관련 사항", "해약공제 기간", (s) => s.surrender.deductionYears, (s, v) => { if (v === undefined) delete s.surrender.deductionYears; else s.surrender.deductionYears = v; }, (v) => `${v}년`);
  field("surrender.notes", "관련 사항", "해지환급금 관련 사항", (s) => s.surrender.notes, (s, v) => { s.surrender.notes = v ?? []; }, lines);
  field("sections", "관련 사항", "그 밖의 절(원문)", (s) => s.sections.map((x) => ({ title: x.title, paragraphs: x.paragraphs })), (s, v) => { s.sections = v ?? []; }, (v) => `${v.length}개 — ${v.map((x) => x.title).join(" / ")}`);
  return out.filter((s) => s.before !== s.after || s.kind !== "고침");
}

/** 지금 조건 → 반영한 조건에서 바뀐 항목(조건 파일에 실리는 칸만) */
export function diffSpec(current: MethodSpec, next: MethodSpec): ChangeItem[] {
  return slots(current, next).map(({ id, group, label, before, after, kind }) => ({ id, group, label, before, after, kind }));
}

/**
 * 고른 항목만 반영한 조건 — 고르지 않은 항목은 지금 조건 값이 남는다.
 * 딸린 것은 함께 따라온다: 고른 보장·유지자가 새 위험률(또는 새 기호 · 새 유지자 · 새 합성)을 가리키면 그것도 넣고,
 * 아직 쓰이는 위험률은 빼지 않는다 — 없는 것을 가리키는 조건이 되지 않게.
 */
export function applyChanges(current: MethodSpec, merged: MethodSpec, ids: Iterable<string>): MethodSpec {
  const pick = new Set(ids);
  const all = slots(current, merged);
  if (!all.length) return current;   // 바뀐 항목이 없으면 그대로 — 읽지 못한 칸까지 통째로 바꾸지 않는다
  if (all.every((s) => pick.has(s.id))) return merged;
  const out = clone(current);
  const chosen = all.filter((s) => pick.has(s.id));
  for (const s of chosen) if (!s.late) s.apply(out);
  // 딸린 것 — 새 기호 · 새 위험률 · 새 유지자 · 새 합성
  const renames = renamedRates(current.rates, merged.rates);
  for (const id of usedRates(out)) {
    if (out.rates.some((r) => r.id === id) || out.combos?.some((c) => c.id === id)) continue;
    const rn = renames.find(([, to]) => to === id);
    if (rn) { renameRate(out, rn[0], rn[1]); continue; }
    const r = merged.rates.find((x) => x.id === id), c = merged.combos?.find((x) => x.id === id);
    if (r) out.rates.push(clone(r));
    else if (c) out.combos = [...(out.combos ?? []), clone(c)];
  }
  for (const b of out.benefits) {
    if (!b.survivorId || out.survivors?.some((x) => x.id === b.survivorId)) continue;
    const sv = merged.survivors?.find((x) => x.id === b.survivorId);
    if (sv) out.survivors = [...(out.survivors ?? []), clone(sv)];
    else delete b.survivorId;
  }
  // 위험률 빼기는 맨 뒤에 — 아직 쓰이면 둔다
  for (const s of chosen) if (s.late && !usedRates(out).has(s.id.replace(/^rates\./, ""))) s.apply(out);
  return syncFromSurvivors(out);
}
