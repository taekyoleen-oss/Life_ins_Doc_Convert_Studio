import { describe, expect, it } from "vitest";
import { SAMPLES } from "@/lib/samples";
import { mergeSpec, specToYaml, yamlToSpec } from "@/lib/conditions/yaml";
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
 * 산출방법서 모양은 보장성과 같다(유지자 lx · 보험금 Cx·Mx · 보장 — 기본보험료의 5배 · 순보험료 P → 위험보험료 = 5 × P, 2026-10-10).
 * 기준값(40세 남 · 월 30만원 · 10년): 공시이율 2.27% 1년 95.2% · 5년 101.0% · 10년 107.2%(적립액 38,589,512원 — 위험보험료 월 180원),
 * 평균공시이율 2.75% 10년 109.9%, 최저보증이율만 10년 100.8% — 환급률은 가상 상품안 시뮬레이션과 같다(위험보험료를 매월 자연보험료에서
 * 유지자·보험금 기수의 평준 순보험료로 바꿔 적립액만 39원 줄었다).
 */
const spec = yamlToSpec(SAMPLES.find((s) => s.id === "savings")!.yaml).spec;
const withRates = attachTables(spec, sampleSheet(spec.rates, BASE_RATES_CSV));
const contract = { sex: "M" as const, age: 40, payYears: 10, freq: 12, basePremium: 300000 };
const ratio = (sc: "credited" | "average" | "guarantee", t: number) => +(computeSavings(withRates, contract, sc).rows[t].ratio * 100).toFixed(1);

describe("보장금액 기준 — 정액 · 보험료의 배수 (보장성도)", () => {
  // 종신보험에 "사망 시 보험료의 3배" 보장을 더한다 — 보장금액 = 정액 보장(사망 1억)의 1회 보험료 × 3
  const whole = yamlToSpec(SAMPLES.find((s) => s.id === "whole")!.yaml).spec;
  const w0 = attachTables(whole, sampleSheet(whole.rates, BASE_RATES_CSV));
  const plus = { ...w0, benefits: [...w0.benefits, { ...w0.benefits[0], id: "b9", name: "보험료 반환", base: "premium" as const, multiple: 3 }] };
  const c = { sex: "M" as const, age: 40, payYears: 20, freq: 12, sumAssured: 1e8 };
  it("보장금액 = 정액 보장의 보험료 × 배수 — 그 보장의 보험료는 같은 1원당 식으로", () => {
    const fixed = computeSpec(w0, c).premium;
    const r = computeSpec(plus, c);
    const b9 = r.benefits.find((x) => x.id === "b9")!;
    expect(b9.amount).toBe(fixed * 3);
    expect(b9.per100k).toBe(r.benefits[0].per100k);           // 같은 유지자·급부 — 10만원당은 같고 보장금액만 다르다
    expect(r.premium).toBe(fixed + b9.premium);
    expect(calcSheets(plus, c).sheets.map((s) => s.id)).toEqual(["b1", "b9"]);   // 표는 조건의 차례
  });
  it("조건 파일 · 산출방법서(Word)를 거쳐도 기준이 남는다", async () => {
    expect(yamlToSpec(specToYaml(plus)).spec.benefits[1].base).toBe("premium");
    const back = parseMethodDoc(await extractDocx(docToDocx(renderMethodDoc(withFormulas(plus)), "종신")));
    expect(back.spec.benefits.map((b) => [b.name, b.base, b.multiple])).toEqual([["사망", undefined, 1], ["보험료 반환", "premium", 3]]);
  });
});

describe("적립형 — 공시이율형 저축보험", () => {
  it("시뮬레이션과 같은 환급률 · 적립액", () => {
    expect([1, 5, 10].map((t) => ratio("credited", t))).toEqual([95.2, 101.0, 107.2]);
    expect(computeSavings(withRates, contract).rows[10].av).toBe(38589512);
    expect(computeSavings(withRates, contract).risk).toBe(180);
    expect(ratio("average", 10)).toBe(109.9);
    expect(ratio("guarantee", 10)).toBe(100.8);
    // 만기환급금 최저보증 — 납입보험료의 100.1% 아래로 내려가지 않는다
    const g = computeSavings(withRates, { ...contract, payYears: 5 }, "guarantee").rows[5];
    expect(g.w).toBeGreaterThanOrEqual(Math.round(1.001 * g.paid));
    // 사망보험금 = 보장금액(기본보험료의 5배) + 적립액
    const r = computeSavings(withRates, contract).rows[3];
    expect(r.death).toBe(1500000 + r.av);
  });
  it("보험기간은 가입 조건의 5·10·15년 가운데 — 고른 납입기간이 없으면 가운데(10년)", () => {
    expect(computeSavings(withRates, { ...contract, payYears: 15 }).n).toBe(15);
    expect(computeSavings(withRates, { ...contract, payYears: 20 }).n).toBe(10);
  });
  it("표준 모양 — 유지자 · 보험금 · 보장(기본보험료의 배수) · 순보험료 P 를 쓰고, 계산 표는 공시이율 예시 셋", () => {
    // 보장 — 보장금액 = 기본보험료 × 5, 순보험료 P(보장금액 1원당 · 월)까지만(보험료가 정해져 있어 영업보험료 식이 없다)
    const [b] = computeSpec(withRates, contract).benefits;
    expect([b.name, b.amount, b.premium, b.error]).toEqual(["사망", 1500000, 0, undefined]);
    expect(b.net).toBeCloseTo(0.000120037, 8);
    const c = calcSheets(withRates, contract);
    expect(c.sheets.map((s) => s.name)).toEqual(["공시이율 2.27%", "평균공시이율 2.75%", "최저보증이율"]);
    expect(c.sheets[0].cols.map((x) => x.sym)).toEqual(["q", "v^t", "v^{t+½}", "l^{(1)}", "D^{(1)}", "N^{(1)}", "l", "D", "D′", "N", "N′", "S", "C", "M",
      "j^{보증}", "j", "E^{체결}", "P^{적립}", "s", "AV", "해약공제", "납입누계", "W", "환급률", "사망보험금"]);
    expect(c.sheets[0].scalars.map((x) => x.sym)).toEqual(["N*", "PVB", "P", "P^{위험}"]);
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
