import { describe, expect, it } from "vitest";
import { SAMPLES } from "@/lib/samples";
import { mergeSpec, yamlToSpec } from "@/lib/conditions/yaml";
import { withFormulas } from "@/lib/methoddoc/formulas";
import { renderMethodDoc } from "@/lib/methoddoc/render";
import { docToDocx } from "@/lib/methoddoc/docx";
import { extractDocx } from "@/lib/methoddoc/extract";
import { parseMethodDoc } from "@/lib/methoddoc/parse";
import { calcSheets, computeSavings, computeSpec } from "@/lib/methoddoc/calc";
import { calcWorkbook } from "@/lib/methoddoc/calc-xlsx";
import { attachTables, sampleSheet } from "@/lib/sheet";
import { BASE_RATES_CSV } from "@/lib/base-rates";

/**
 * 적립형(공시이율형 저축보험) — 월 기본보험료에서 사업비·위험보험료를 뺀 적립보험료를 공시이율로 쌓는다.
 * 기준값은 가상 상품안 시뮬레이션(40세 남 · 월 30만원 · 10년): 공시이율 2.27% 1년 95.2% · 5년 101.0% · 10년 107.2%(적립액 38,589,551원),
 * 평균공시이율 2.75% 10년 109.9%, 최저보증이율만 10년 100.8% — 앱은 산출방법서의 식을 읽어 같은 값을 낸다.
 */
const spec = yamlToSpec(SAMPLES.find((s) => s.id === "savings")!.yaml).spec;
const withRates = attachTables(spec, sampleSheet(spec.rates, BASE_RATES_CSV));
const contract = { sex: "M" as const, age: 40, payYears: 10, freq: 12, basePremium: 300000 };
const ratio = (sc: "credited" | "average" | "guarantee", t: number) => +(computeSavings(withRates, contract, sc).rows[t].ratio * 100).toFixed(1);

describe("적립형 — 공시이율형 저축보험", () => {
  it("시뮬레이션과 같은 환급률 · 적립액", () => {
    expect([1, 5, 10].map((t) => ratio("credited", t))).toEqual([95.2, 101.0, 107.2]);
    expect(computeSavings(withRates, contract).rows[10].av).toBe(38589551);
    expect(ratio("average", 10)).toBe(109.9);
    expect(ratio("guarantee", 10)).toBe(100.8);
    // 만기환급금 최저보증 — 납입보험료의 100.1% 아래로 내려가지 않는다
    const g = computeSavings(withRates, { ...contract, payYears: 5 }, "guarantee").rows[5];
    expect(g.w).toBeGreaterThanOrEqual(Math.round(1.001 * g.paid));
    // 사망보험금 = 기본보험료 500% + 적립액
    const r = computeSavings(withRates, contract).rows[3];
    expect(r.death).toBe(1500000 + r.av);
  });
  it("보험기간은 가입 조건의 5·10·15년 가운데 — 고른 납입기간이 없으면 가운데(10년)", () => {
    expect(computeSavings(withRates, { ...contract, payYears: 15 }).n).toBe(15);
    expect(computeSavings(withRates, { ...contract, payYears: 20 }).n).toBe(10);
  });
  it("보장성 계산은 담보가 없고, 계산 표는 공시이율 예시 셋", () => {
    expect(computeSpec(withRates).benefits).toEqual([]);
    const c = calcSheets(withRates, contract);
    expect(c.sheets.map((s) => s.name)).toEqual(["공시이율 2.27%", "평균공시이율 2.75%", "최저보증이율"]);
    expect(c.sheets[0].cols.map((x) => x.sym)).toEqual(["q", "j^{보증}", "j", "P^{위험}", "E^{체결}", "P^{적립}", "s", "AV", "해약공제", "납입누계", "W", "환급률", "사망보험금"]);
    expect(c.sheets[0].maturity?.ratio).toBeCloseTo(1.072, 3);
    expect(c.sheets.every((s) => !s.warnings.length && !s.error)).toBe(true);
    expect(calcWorkbook(withRates, contract).length).toBeGreaterThan(1000);
  });
  it("식이 계산의 정의 — 적립 식을 고치면 적립액이 바뀐다", () => {
    const f = withFormulas(spec).formulas.find((x) => x.key === "save:accum")!;
    const edited = { ...withRates, formulas: [{ section: f.section, label: f.label, text: f.text.replace("− β −", "−") }] };
    expect(computeSavings(edited, contract).rows[10].av).toBeGreaterThan(38589551);
  });
  it("산출방법서(Word) → 되읽기 → 조건이 그대로", async () => {
    const doc = await extractDocx(docToDocx(renderMethodDoc(withFormulas(spec)), spec.meta.productName));
    const back = parseMethodDoc(doc);
    expect(back.spec.savings).toEqual(spec.savings);
    expect(back.spec.basis.minGuaranteed).toBeUndefined();
    expect(mergeSpec(spec, back.spec, back.evidence, { standard: true }).changes).toEqual([]);
  });
});
