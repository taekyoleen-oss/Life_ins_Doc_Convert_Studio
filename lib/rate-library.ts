import { BASE_RATES_CSV, BASE_RATES_SOURCE } from "./base-rates";
import type { RateRef, Sex } from "./methoddoc/spec";
import { baseName, cellNum, parseDelimited, sexOf } from "./sheet";

/**
 * 기본 위험률 모음 — 필요할 때 골라 위험률 표 창에 넣는 위험률.
 *  - 공개 기본 위험률(lib/base-rates.ts — 자유설계보험의 공개 표): 어디서나
 *  - 사내 위험률 모음(public/rate-library.json ← private/, 외부 반출 금지): 이 PC 에서 scripts/import-rate-library.py 를 돌렸을 때만
 * 같은 이름·회사의 남·여 두 열은 한 항목으로 묶는다(표에 넣으면 남·여 열 둘).
 */
export interface LibRate { id: string; group?: string; category?: string; name: string; detail?: string; sex?: Sex; company?: string; basis?: string; origin?: string; ages: number[]; values: number[] }
export interface RateLibrary { title: string; notice?: string; source?: string; createdAt?: string; rates: LibRate[] }
export interface LibItem { key: string; category: string; name: string; company?: string; source: string; origin?: string; private: boolean; M?: LibRate; F?: LibRate; any?: LibRate }

/** 받은 JSON 을 믿지 않는다 — 모양이 어긋난 항목은 버린다 */
export function sanitizeLibrary(raw: unknown): RateLibrary | null {
  const r = raw as Partial<RateLibrary> | null;
  if (!r || !Array.isArray(r.rates)) return null;
  const rates = r.rates.flatMap((x): LibRate[] => {
    const v = x as Partial<LibRate>;
    if (typeof v?.name !== "string" || !Array.isArray(v.ages) || !Array.isArray(v.values) || v.ages.length !== v.values.length) return [];
    return [{ ...v, id: String(v.id ?? v.name), name: v.name, sex: v.sex === "M" || v.sex === "F" ? v.sex : undefined, ages: v.ages.map(Number), values: v.values.map(Number) } as LibRate];
  });
  return { title: String(r.title ?? ""), notice: r.notice, source: r.source, createdAt: r.createdAt, rates };
}

/** 공개 기본 위험률(앱에 든 표) → 모음 항목 모양 */
export function baseLibraryRates(): LibRate[] {
  const rows = parseDelimited(BASE_RATES_CSV), head = rows[0];
  return head.slice(1).map((h, j) => {
    const name = baseName(h);
    return { id: `base:${h}`, group: "공개", category: "공개 기본 위험률", name, sex: sexOf(h), company: "공개 표(자유설계보험)", basis: BASE_RATES_SOURCE[name],
      ages: rows.slice(1).map((r) => Number(r[0])), values: rows.slice(1).map((r) => cellNum(r[j + 1] ?? "") ?? 0) };
  });
}

/** 남·여를 한 항목으로 묶은 목록 — 사내 모음은 분류 순서 그대로, 공개 기본 위험률이 맨 앞 */
export function libraryItems(lib: RateLibrary | null): LibItem[] {
  const out = new Map<string, LibItem>();
  const put = (r: LibRate, priv: boolean) => {
    const key = [priv ? "p" : "b", r.category, r.name, r.detail ?? "", r.company ?? ""].join("|");
    const it = out.get(key) ?? { key, category: r.category ?? "기타", name: r.detail ? `${r.name} ${r.detail}` : r.name, company: r.company, source: [r.company, r.basis].filter(Boolean).join(" · "), origin: r.origin, private: priv };
    if (r.sex === "M" && !it.M) it.M = r; else if (r.sex === "F" && !it.F) it.F = r; else if (!it.any) it.any = r;
    out.set(key, it);
  };
  for (const r of baseLibraryRates()) put(r, false);
  for (const r of lib?.rates ?? []) put(r, true);
  return [...out.values()];
}

/** 항목 → 위험률 표에 넣을 열(남·여 열 둘 또는 한 열) */
export const itemColumns = (it: LibItem) => (it.M || it.F
  ? [...(it.M ? [{ head: `${it.name}(남)`, ages: it.M.ages, values: it.M.values }] : []), ...(it.F ? [{ head: `${it.name}(여)`, ages: it.F.ages, values: it.F.values }] : [])]
  : it.any ? [{ head: it.name, ages: it.any.ages, values: it.any.values }] : []);

/** 항목의 한 줄 요약 — 성별·연령 범위·40세 값 */
export function itemSummary(it: LibItem): string {
  const one = it.M ?? it.F ?? it.any!;
  const at40 = (r?: LibRate) => { const i = r ? r.ages.indexOf(40) : -1; return i >= 0 ? String(r!.values[i]) : "—"; };
  const sex = it.M && it.F ? "남·여" : it.M ? "남" : it.F ? "여" : "공통";
  return `${sex} · ${one.ages[0]}~${one.ages[one.ages.length - 1]}세 · 40세 ${it.M || it.F ? `${at40(it.M)}/${at40(it.F)}` : at40(it.any)}`;
}

/** 조건의 위험률 가운데 이 항목을 이을 만한 것 — 이름이 같거나 한쪽이 다른 쪽을 품으면 */
export function suggestTarget(it: LibItem, rates: Pick<RateRef, "id" | "name">[]): string | undefined {
  const n = (s: string) => s.replace(/[\s()·_-]/g, "");
  const key = n(it.name);
  return (rates.find((r) => n(r.name) === key) ?? rates.find((r) => n(r.name).length >= 3 && (key.includes(n(r.name)) || n(r.name).includes(key))))?.id;
}
