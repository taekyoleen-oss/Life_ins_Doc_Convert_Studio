import { describe, expect, it } from "vitest";
import { renderMethodDoc } from "@/lib/methoddoc/render";
import { withFormulas } from "@/lib/methoddoc/formulas";
import { yamlToSpec } from "@/lib/conditions/yaml";
import { anchorsForPaths, linesOfPaths, matchBlocks, pathsAtLines, pathsForAnchors, splitPaths } from "@/lib/conditions/link";
import { SAMPLES } from "@/lib/samples";

const src = SAMPLES[0].yaml;
const { spec, ranges } = yamlToSpec(src);
const lines = src.split("\n");
const lineOf = (re: RegExp) => lines.findIndex((l) => re.test(l)) + 1;
// 화면이 그리는 순서대로 블록(표는 행 단위) 경로를 늘어놓는다
const blocks: { text: string; paths: string[] }[] = [];
for (const sec of renderMethodDoc(withFormulas(spec))) for (const b of sec.blocks) {
  if (b.t === "table") b.rows.forEach((r, i) => blocks.push({ text: r.join(" | "), paths: splitPaths(b.rowPaths?.[i]) }));
  else blocks.push({ text: b.text, paths: splitPaths(b.path) });
}
const hl = (from: number, to = from) => [...matchBlocks(blocks.map((b) => b.paths), pathsAtLines(ranges, from, to))].map((i) => blocks[i].text);

describe("조건 줄 → 산출방법서 블록", () => {
  it("이율 줄 → 이율 표의 그 행 + 현가율 + 계산기수", () => {
    const got = hl(lineOf(/^\s+interest:/));
    expect(got.some((t) => /^적용이율 i \| 2\.500%/.test(t))).toBe(true);
    expect(got.some((t) => /현가율/.test(t))).toBe(true);
    expect(got.some((t) => /D_\{x\+t\}/.test(t))).toBe(true);
    expect(got.some((t) => /표준이율/.test(t))).toBe(false);
  });
  it("β_G 사업비 줄 → 사업비 표의 β_G 행만", () => {
    const got = hl(lineOf(/symbol: β_G/));
    expect(got).toEqual([expect.stringMatching(/계약관리비용 \(납입중\) \| β_G/)]);
  });
  it("expenses: 머리 줄 → 사업비 표 전체 + 영업보험료 식", () => {
    const got = hl(lineOf(/^expenses:/));
    expect(got.filter((t) => /^계약|^수금/.test(t))).toHaveLength(6);
    expect(got.some((t) => /^G = \[/.test(t))).toBe(true);
  });
  it("담보 안의 금액 줄 → 담보 표의 그 담보 행과 그 담보의 유지자수·납입자수 식", () => {
    const got = hl(lineOf(/amount: 100000000/));
    expect(got.some((t) => /^사망·80% 이상 장해 \| 주계약/.test(t))).toBe(true);
    expect(got.some((t) => /유지자수  l_\{x\+t\+1\}/.test(t))).toBe(true);
  });
  it("80% 장해율 위험률 → 위험률 표의 그 행 + 그 위험률을 쓰는 담보식", () => {
    const got = hl(lineOf(/id: k80/));
    expect(got.some((t) => /^80% 이상 장해율 \| k80 \| 최초발생/.test(t))).toBe(true);
    expect(got.some((t) => /k_x : 80% 이상 장해율/.test(t))).toBe(true);
  });
  it("성별 줄 → 피보험자 행", () => {
    expect(hl(lineOf(/sex: M/))).toEqual([expect.stringMatching(/^피보험자 \| 40세 남/)]);
  });
});

describe("산출방법서 블록 → 조건 줄", () => {
  it("블록 경로의 줄 범위를 돌려주고, 없는 경로는 가장 가까운 윗 경로로", () => {
    const [[a]] = linesOfPaths(ranges, ["basis.interest"]);
    expect(lines[a - 1]).toMatch(/interest: 2\.5%/);
    const [[b]] = linesOfPaths(ranges, ["meta.date"]);      // date 는 파일에 없다 → meta
    expect(lines[b - 1]).toMatch(/^meta:/);
  });
});

describe("원문 근거 ↔ 조건", () => {
  const evidence = [
    { path: "basis.interest", label: "", value: 0.0425, raw: "", source: "본문 55줄", confidence: "medium" as const },
    { path: "expenses[2]", label: "", value: 0.003, raw: "", source: "표 14", confidence: "high" as const },
  ];
  it("조건 경로 → 원문 자리, 원문 자리 → 조건 경로", () => {
    expect(anchorsForPaths(evidence, ["basis.interest"])).toEqual(new Set(["p-54"]));
    expect(anchorsForPaths(evidence, ["expenses"])).toEqual(new Set(["t-13"]));
    expect(pathsForAnchors(evidence, new Set(["t-13"]))).toEqual(["expenses[2]"]);
  });
});
