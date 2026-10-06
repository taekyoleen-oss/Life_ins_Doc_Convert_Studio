import { describe, expect, it } from "vitest";
import { SAMPLES } from "@/lib/samples";
import { yamlToSpec, yamlView } from "@/lib/conditions/yaml";
import { benefitModels, combosOf, withFormulas } from "@/lib/methoddoc/formulas";
import { docToMarkdown, renderMethodDoc } from "@/lib/methoddoc/render";
import { docToDocx } from "@/lib/methoddoc/docx";
import { extractDocx, extractText, type ExtractedDoc } from "@/lib/methoddoc/extract";
import { parseMethodDoc } from "@/lib/methoddoc/parse";
import { computeSpec } from "@/lib/methoddoc/calc";
import type { MethodSpec } from "@/lib/methoddoc/spec";
import { attachTables, sampleSheet } from "@/lib/sheet";
import { BASE_RATES_CSV } from "@/lib/base-rates";

/**
 * 위험률 합성(C01 · 산출방법서 나. 기호의 정의 아래) — 유지자·보험금은 합성의 기호만 쓰고 합성 식은 한 곳에만 싣는다.
 * 이름을 준 합성 · 보험금이 고른 합성은 문서로 왕복해도 남고, 보험료는 그대로다.
 */
const spec0 = (id: string) => yamlToSpec(SAMPLES.find((s) => s.id === id)!.yaml).spec;
const FORMATS: [string, (s: MethodSpec) => Promise<ExtractedDoc>][] = [
  ["Word", async (s) => extractDocx(docToDocx(renderMethodDoc(withFormulas(s)), s.meta.productName))],
  ["Markdown", async (s) => extractText(new TextEncoder().encode(docToMarkdown(renderMethodDoc(withFormulas(s)), s.meta.productName)))],
];
const per100k = (s: MethodSpec) => computeSpec(attachTables(s, sampleSheet(s.rates, BASE_RATES_CSV)), { sex: "M", age: 40, payYears: 20, freq: 12 }).benefits.map((b) => b.per100k);

describe("위험률 합성", () => {
  const spec = spec0("wholeCancer");
  it("유지자의 탈퇴 사유 묶음에서 만들고, 기호의 정의 아래 표에만 식을 싣는다", () => {
    expect(combosOf(spec).map((c) => c.rateIds)).toEqual([["q", "r80"], ["q", "rc"], ["q", "r80", "rc"]]);
    const blocks = renderMethodDoc(withFormulas(spec)).flatMap((s) => s.blocks);
    const tab = blocks.find((b) => b.t === "table" && b.head.join("|") === "기호|이름|식");
    expect(tab?.t === "table" && tab.rows.map((r) => r[0])).toEqual(["Q^{(1)}_x", "Q^{(2)}_x", "R^{(3)}_x", "Q^{(3)}_x"]);
    const keep = blocks.filter((b) => b.t === "table" && b.rows.some((r) => r[0] === "대상 위험률"));
    expect(keep.map((b) => b.t === "table" && b.rows.find((r) => r[0] === "대상 위험률")![1])).toEqual(["Q^{(1)}_{x+t}", "Q^{(2)}_{x+t}", "Q^{(3)}_{x+t}"]);
    const ben = blocks.find((b) => b.t === "table" && b.rows.some((r) => r[0] === "현가 및 누계"));
    expect(ben).toBeTruthy();
  });

  // 이름을 붙이고, 암 진단 보험금이 질병 합성(80% 장해·암)을 급부 위험률로 고른 조건
  const named: MethodSpec = {
    ...spec,
    combos: [{ id: "c1", name: "사망·장해 탈퇴율", rateIds: ["q", "r80"] }, { id: "c2", rateIds: ["q", "rc"] }, { id: "c3", rateIds: ["q", "r80", "rc"] }, { id: "c4", name: "장해·암 발생률", rateIds: ["r80", "rc"] }],
    benefits: spec.benefits.map((b, i) => (i === 1 ? { ...b, rateId: "c4" } : b)),
  };
  it("보험금이 고른 합성은 그 기호로 지급자수를 내고, 정의 식을 보험금 식에 함께 싣는다", () => {
    const m = benefitModels(named)[1];
    expect(m.ev).toBe("R^{(4)}_{x+t}");
    expect(m.lines).toContain("R^{(4)}_{x+t} = 1 − ( 1 − r80_{x+t} )·( 1 − rc_{x+t} )");
    expect(per100k(named)[1]).toBeGreaterThan(per100k(spec)[1]);   // 장해까지 지급하므로 더 비싸다
  });
  for (const [fmt, make] of FORMATS) {
    it(`이름 · 보험금이 고른 합성이 되읽어도 남는다 — ${fmt}`, async () => {
      const r = parseMethodDoc(await make(named));
      expect(yamlView(r.spec)).toEqual(yamlView(named));
      expect(per100k(r.spec)).toEqual(per100k(named));
    });
  }
});

describe("특약은 주계약 아래 따로 · 위험률 기호는 M04 표의 기호", () => {
  const spec = spec0("cancerPlan");
  const secs = renderMethodDoc(withFormulas(spec));
  it("주계약 1~3장 다음에 특약마다 [특약 이름] 1~3장 — 독립특약: 그 특약의 예정기초율 · 유지자 · 보험금 · 보장", () => {
    expect(secs.map((s) => s.title).filter((t) => !/별첨/.test(t))).toEqual([
      "개요", "1. 보험료의 계산에 관한 사항", "2. 책임준비금의 계산에 관한 사항", "3. 해지환급금의 계산에 관한 사항",
      "[암입원특약] 1. 보험료의 계산에 관한 사항", "[암입원특약] 2. 책임준비금의 계산에 관한 사항", "[암입원특약] 3. 해지환급금의 계산에 관한 사항",
      "[암수술특약] 1. 보험료의 계산에 관한 사항", "[암수술특약] 2. 책임준비금의 계산에 관한 사항", "[암수술특약] 3. 해지환급금의 계산에 관한 사항"]);
    const text = (i: number) => secs[i].blocks.map((b) => (b.t === "table" ? b.rows.map((r) => r.join("|")).join("\n") : b.text)).join("\n");
    expect(text(1)).toContain("(1) 암 진단");
    expect(text(1)).not.toContain("암 입원");
    expect(text(4)).toContain("(1) 암 입원(1일당)");
    expect(text(4)).toContain("d^{(2)}_{x+t} = l^{(2)}_{x+t} × ch_{x+t}");
    // 독립특약 — 주계약과 같은 탈퇴 사유(암)라도 그 특약의 유지자 lx(3) 을 따로 세우고, 예정위험률도 그 특약이 쓰는 것만 다시 싣는다
    expect(text(7)).toContain("d^{(3)}_{x+t} = l^{(3)}_{x+t} × cs_{x+t}");
    expect(text(7)).toContain("(3) l^{(3)}_x — 암 아닌 유지자");
    expect(text(7)).toContain("암발생률|rc|최초발생");
    expect(text(7)).toContain("암수술률|cs|최초발생");
    expect(text(7)).not.toContain("주계약");
    // 암입원특약은 탈퇴 사유가 없어 기준 인원 100,000 명을 그대로 유지하고, 주계약의 납입면제(암)를 가져오지 않는다 — 납입자도 그 lx
    expect(text(4)).toContain("l^{(2)}_{x+t+1} = l^{(2)}_{x+t}");
    expect(text(4)).toContain("D′_{x+t} = l^{(2)}_{x+t}·v^t");
    expect(text(4)).not.toContain("암발생률");
    // 대상 위험률은 M04 에서 정한 기호(rc) — r^{(1)} 이 아니다
    expect(text(1)).toContain("대상 위험률|rc_{x+t}");
    expect(text(1)).not.toContain("r^{(1)}");
  });
});
