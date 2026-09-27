import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildDefs, calcSheets, computeSpec, parseEquation, parseLines, valueOf, type Model } from "@/lib/methoddoc/calc";
import { withFormulas } from "@/lib/methoddoc/formulas";
import { jsonToSpec } from "@/lib/conditions/yaml";

/**
 * 산출방법서의 식을 그대로 읽어 계산한 값이 계산 앱(자유설계보험 엔진)·엑셀 검산과 같은지.
 * samples/09_…_계산결과.json 은 자유설계보험이 같은 조건으로 낸 값이다 — 두 길이 만나는 지점이다.
 */
const spec = jsonToSpec(readFileSync("samples/09_종신보험(암진단포함)_MethodSpec.json", "utf8"));
const want = JSON.parse(readFileSync("samples/09_종신보험(암진단포함)_계산결과.json", "utf8")) as {
  contract: { sex: "M"; age: number; payYears: number; freq: number };
  coverages: { label: string; n: number; m: number; pvb: number; nStar: number; net: number; base: number; gross: number; gross100k: number; monthlyGross: number }[];
  monthlyGross: number;
};

const model = (lines: string[], scalar: Record<string, number> = {}, known: Record<string, number[]> = {}): Model =>
  ({ defs: buildDefs(parseLines(lines.join("\n")).eqs), known, scalar: { n: 3, m: 2, k: 1, v: 1, ...scalar }, n: scalar.n ?? 3 });

describe("식 읽기", () => {
  it("아래첨자 · 점화식 · Σ · if · 비교 사슬", () => {
    const mo = model([
      "l_x = 100,000",
      "l_{x+t+1} = l_{x+t} × ( 1 − q_{x+t} )",
      "D_{x+t} = l_{x+t}·v^t",
      "N_{x+t} = Σ_{u≥t} D_{x+u}",
      "S_t = if( 0 ≤ t ≤ 1, 1, 0.5 ) × if( t = 0, 1 − 3/12, 1 )",
      "합 = Σ_{u=0}^{n−1} S_u·D_{x+u}",
    ], { n: 3, v: 0.5 }, { q: [0.1, 0.2, 0.5, 0] });
    expect(valueOf(mo, "l", 0)).toBe(100000);
    expect(valueOf(mo, "l", 1)).toBeCloseTo(90000, 9);
    expect(valueOf(mo, "l", 2)).toBeCloseTo(72000, 9);
    expect(valueOf(mo, "D", 2)).toBeCloseTo(72000 * 0.25, 9);
    expect(valueOf(mo, "N", 2)).toBeCloseTo(72000 * 0.25 + 36000 * 0.125, 9);
    expect(valueOf(mo, "S", 0)).toBeCloseTo(0.75, 12);
    expect(valueOf(mo, "S", 2)).toBeCloseTo(0.5, 12);
    expect(valueOf(mo, "합")).toBeCloseTo(0.75 * 100000 + 1 * 45000 + 0.5 * 18000, 9);
  });

  it("스칼라 · min · 괄호 · N* 처럼 별표가 붙은 이름", () => {
    const mo = model(["N* = k · [ ( A − B ) − ( k−1 )/( 2·k )·C ]", "A = 10", "B = 4", "C = 2", "짧 = min(n,20)"], { k: 2, n: 71 });
    expect(valueOf(mo, "N*")).toBeCloseTo(2 * (6 - (1 / 4) * 2), 12);
    expect(valueOf(mo, "짧")).toBe(20);
  });

  it("식이 아닌 줄은 건너뛰고, 스스로를 돌아 참조하면 알린다", () => {
    const { eqs, skipped } = parseLines("기준 인원\nl_x = 100,000\nq_x : 사망률");
    expect(eqs.length).toBe(1);
    expect(skipped).toEqual(["기준 인원", "q_x : 사망률"]);
    expect(() => valueOf(model(["A_{x+t} = B_{x+t}", "B_{x+t} = A_{x+t}"]), "A", 0)).toThrow(/돌아 참조/);
    expect(() => parseEquation("l_{x+t}")).toThrow(/= 가 없어/);
  });
});

describe("산출방법서의 식으로 낸 보험료 = 계산 앱의 값", () => {
  const got = computeSpec(spec, want.contract);

  it("못 읽은 식·오류가 없다", () => {
    expect(got.errors).toEqual([]);
    expect(got.missingRates).toEqual([]);
    // 설명 줄만 건너뛴다 — "=" 가 든 줄은 모두 읽힌다
    for (const b of got.benefits) expect(b.skipped.filter((s) => s.includes("="))).toEqual([]);
  });

  it("담보마다 PVB · N* · P · 기준연납 · G 가 같다", () => {
    expect(got.benefits.map((b) => b.name)).toEqual(["사망·80% 이상 장해", "암 진단"]);
    got.benefits.forEach((b, i) => {
      const w = want.coverages[i];
      expect([b.n, b.m]).toEqual([w.n, w.m]);
      // 식을 적은 순서가 엔진의 계산 순서와 조금 달라(q + r − q·r/2 ↔ Σd − (Σd² − Σd²)/4) 끝자리만 다르다
      const rel = (a: number, want: number) => expect(a / want).toBeCloseTo(1, 7);
      rel(b.pvb, w.pvb); rel(b.nStar, w.nStar); rel(b.net, w.net); rel(b.base, w.base); rel(b.gross, w.gross);
      expect(b.per100k).toBe(w.gross100k);
      expect(b.premium).toBe(w.monthlyGross);
    });
    expect(got.premium).toBe(want.monthlyGross);
  });

  it("계산 표: 위험률 → 유지자수·납입자수·지급자수 → 현가·누계 → 보험금, 열마다 그 식", () => {
    const { sheets, premium, per100k } = calcSheets(spec, want.contract);
    expect(sheets.map((s) => s.name)).toEqual(["사망·80% 이상 장해", "암 진단"]);
    const s0 = sheets[0];
    expect(s0.error).toBeUndefined();
    expect([s0.n, s0.m, s0.ages[0], s0.ages.at(-1)]).toEqual([71, 20, 40, 111]);
    // 위험률 열이 먼저, 그 뒤로 사람 수 → 현가 → 누계 → 보험금
    expect(s0.cols.filter((c) => c.kind === "rate").map((c) => c.sym)).toEqual(["q", "r", "f"]);
    expect(s0.cols.filter((c) => c.kind === "series").map((c) => c.sym)).toEqual(["Q", "l", "l′", "d", "D", "D′", "N", "N′", "S", "C", "M"]);
    for (const c of s0.cols) expect(c.values).toHaveLength(72);
    // 기준 인원에서 시작하고, 지급자수 = 유지자수 × 탈퇴율
    const col = (sym: string) => s0.cols.find((c) => c.sym === sym)!;
    expect(col("l").values[0]).toBe(100000);
    expect(col("l′").values[0]).toBe(100000);
    expect(col("d").values[3]).toBeCloseTo(col("l").values[3] * col("Q").values[3], 9);
    expect(col("l").formula).toContain("l_{x+t+1} = l_{x+t}");
    expect(col("q").formula).toContain("위험률 표에서 온 값");
    // 줄마다 "이 값들로 나왔다" — l 은 앞자리 l 과 그 자리 Q 로
    expect(col("l").parts[1].map((p) => p.ref)).toEqual(["l(40)", "Q(40)"]);
    expect(col("l").parts[1][0].value).toBe(100000);
    // 표 아래 한 값들 — 엔진·엑셀과 같은 보험료
    expect(s0.scalars.map((x) => x.sym)).toEqual(["N*", "PVB", "P", "P_base", "G"]);
    expect(sheets.map((s) => s.per100k)).toEqual([261, 162]);
    expect([per100k, premium]).toEqual([423, 342000]);
  });

  it("식을 고치면 계산이 바뀐다 — 조건만이 아니라 산출방법서의 식도 계산에 쓰인다", () => {
    const auto = withFormulas(spec).formulas.find((f) => f.key === "benefit:b2")!;
    // 암 진단의 면책을 90일(첫해 1 − 3/12) 에서 없음으로 고쳐 적는다
    const edited = { ...spec, formulas: [{ section: auto.section, label: auto.label, text: auto.text.replace("if( t = 0, 1 − 3/12, 1 )", "1") }] };
    const b2 = computeSpec(edited, want.contract).benefits[1];
    expect(b2.error).toBeUndefined();
    expect(b2.per100k).toBeGreaterThan(want.coverages[1].gross100k);
  });
});
