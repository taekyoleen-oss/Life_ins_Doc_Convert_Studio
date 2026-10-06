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
  coverages: { label: string; n: number; m: number; pvb: number; nStar: number; net: number; base: number; gross: number; pBeta: number; gross100k: number; monthlyGross: number; reserve100k: number[] }[];
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

  it("계산 표: 위험률 → 생존자 lx(k)·Dx·Nx → 이 담보의 l·지급자수 → 현가·누계 → 보험금, 열마다 그 식", () => {
    const { sheets, premium, per100k } = calcSheets(spec, want.contract);
    expect(sheets.map((s) => s.name)).toEqual(["사망·80% 이상 장해", "암 진단"]);
    const s0 = sheets[0];
    expect(s0.error).toBeUndefined();
    expect([s0.n, s0.m, s0.ages[0], s0.ages.at(-1)]).toEqual([71, 20, 40, 111]);
    // 위험률 열이 먼저, 그 뒤로 사람 수 → 현가 → 누계 → 보험금
    expect(s0.cols.filter((c) => c.kind === "rate").map((c) => c.sym)).toEqual(["q", "r80", "rc"]);   // 사망 · 장해 · 암 — 기호는 상품 전체에서 하나
    // 이 담보의 생존자 lx(1)(사망·장해) 과 [납입] 생존자 lx(3)(사망·장해·암)이 먼저, 그 뒤로 이 담보의 l(= lx(1)) · d · 현가 · 보험금
    expect(s0.cols.filter((c) => c.kind === "series").map((c) => c.sym)).toEqual(["Q^{(1)}", "l^{(1)}", "D^{(1)}", "N^{(1)}", "R^{(3)}", "Q^{(3)}", "l^{(3)}", "D^{(3)}", "N^{(3)}",
      "l", "d", "D", "D′", "N", "N′", "S", "C", "M", "V", "V^{10만}", "V^{표준}", "V^{결산}", "해약공제", "W^{표준}", "W", "납입누계", "환급률"]);
    for (const c of s0.cols) expect(c.values).toHaveLength(72);
    // 기준 인원에서 시작하고, 지급자수 = 유지자수 × 탈퇴율
    const col = (sym: string) => s0.cols.find((c) => c.sym === sym)!;
    expect(col("l").values[0]).toBe(100000);
    expect(col("l^{(3)}").values[0]).toBe(100000);
    expect(col("l").values).toEqual(col("l^{(1)}").values);                                   // 보험금은 앞의 lx 를 가져다 쓴다
    expect(col("D′").values).toEqual(col("D^{(3)}").values);                                  // 납입(N*)은 [납입] 생존자
    expect(col("d").values[3]).toBeCloseTo(col("l").values[3] * col("Q^{(1)}").values[3], 9);
    expect(col("l^{(1)}").formula).toContain("l^{(1)}_{x+t+1} = l^{(1)}_{x+t}");
    expect(col("l^{(1)}").label).toBe("유지자수 lx(1)");
    expect(col("q").formula).toContain("위험률 표에서 온 값");
    // 줄마다 "이 값들로 나왔다" — l 은 앞자리 l 과 그 자리 Q 로
    expect(col("l^{(1)}").parts(1).map((p) => p.ref)).toEqual(["l^{(1)}(40)", "Q^{(1)}(40)"]);
    expect(col("l^{(1)}").parts(1)[0].value).toBe(100000);
    // 표 아래 한 값들 — 엔진·엑셀과 같은 보험료
    expect(s0.scalars.map((x) => x.sym)).toEqual(["N*", "PVB", "P", "P_base", "G", "G₁", "G_10만", "P_β", "α^{표준}", "α^{공제}"]);
    expect(sheets.map((s) => s.per100k)).toEqual([261, 163]);
    expect([per100k, premium]).toEqual([424, 342500]);
    // 책임준비금 — 엔진(자유설계보험)의 연도별 10만원당 준비금과 같다 · P_β 도 같다
    sheets.forEach((s, i) => {
      const w = want.coverages[i];
      expect(s.cols.find((c) => c.sym === "V^{10만}")!.values.slice(0, w.n + 1)).toEqual(w.reserve100k);
      expect(s.scalars.find((x) => x.sym === "P_β")!.value / w.pBeta).toBeCloseTo(1, 7);
    });
    // 해지환급금 — 준비금에서 해약공제를 뺀 것(0 미만이면 0), 납입 완료 후엔 준비금과 같다 · 환급률 = W / 납입누계
    const W = s0.cols.find((c) => c.sym === "W")!, V = s0.cols.find((c) => c.sym === "V")!, R = s0.cols.find((c) => c.sym === "환급률")!;
    expect(W.values[1]).toBeLessThan(V.values[1]);
    expect(W.values[30]).toBeCloseTo(V.values[30], 12);
    expect(R.values[0]).toBe(0);
    expect(R.values[20]).toBeGreaterThan(0.5);
  });

  it("한 번에 계산한다 — 같은 자리의 값을 다시 세지 않는다(화면이 멈추지 않을 만큼)", () => {
    // 되돌이 정의(l_{x+t+1} = l_{x+t} × …)를 칸마다 t=0 부터 다시 세면 열이 O(n²) 이 된다.
    // 담보 2개 × 72줄 × 열 19개라 그 차이가 0.7초짜리 멈춤으로 나타났다 — 모델 하나에 캐시 하나.
    // 절대 시간은 다른 시험(파이썬·PDF)이 함께 돌면 몇 배로 흔들린다 — 같은 순간에 잰 computeSpec(보험료만) 과의 비율로 본다.
    // 캐시가 있으면 계산 표(열 28개 + 표준이율 모델)는 보험료만 내는 것의 약 7배, O(n²) 이면 40배였다. 세 번 재어 가장 빠른 것끼리 견준다
    const best = (f: () => void) => Math.min(...[0, 1, 2].map(() => { const t0 = performance.now(); f(); return performance.now() - t0; }));
    const r = calcSheets(spec, want.contract);
    expect([r.per100k, r.premium]).toEqual([424, 342500]);
    const sheet = best(() => calcSheets(spec, want.contract)), premiumOnly = best(() => computeSpec(spec, want.contract));
    expect(sheet / premiumOnly).toBeLessThan(20);
  });

  it("식을 고치면 계산이 바뀐다 — 조건만이 아니라 산출방법서의 식도 계산에 쓰인다", () => {
    const auto = withFormulas(spec).formulas.find((f) => f.key === "benefit:b2")!;
    expect(auto.text).toContain("S_t = 1 × if( t = 0, 1 − 3/12, 1 )");
    // 암 진단의 면책을 90일(첫해 1 − 3/12) 에서 없음으로 고쳐 적는다
    const edited = { ...spec, formulas: [{ section: auto.section, label: auto.label, text: auto.text.replace("if( t = 0, 1 − 3/12, 1 )", "1") }] };
    const b2 = computeSpec(edited, want.contract).benefits[1];
    expect(b2.error).toBeUndefined();
    expect(b2.gross).toBeGreaterThan(want.coverages[1].gross);          // 첫해 급부가 늘어 1원당 보험료가 오른다 (10만원당은 반올림에 가려질 수 있다)
  });
});
