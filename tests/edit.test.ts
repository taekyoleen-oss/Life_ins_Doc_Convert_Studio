import { describe, expect, it } from "vitest";
import { editYaml, pathKey, yamlToSpec } from "@/lib/conditions/yaml";
import { SAMPLES } from "@/lib/samples";

const src = SAMPLES[0].yaml;
const lineWith = (text: string, re: RegExp) => text.split("\n").find((l) => re.test(l));

describe("입력 화면 → 조건 파일 (editYaml)", () => {
  it("값 한 칸은 그 글자만 바꾼다 — 주석·줄 맞춤·다른 줄 그대로", () => {
    const next = editYaml(src, [{ path: ["basis", "interest"], value: "3%" }, { path: ["contract", "age"], value: 45 }]);
    expect(lineWith(next, /interest:/)).toBe("  interest: 3%      # 적용(예정)이율");
    expect(lineWith(next, /age:/)).toBe("  age: 45             # 가입나이");
    const a = src.split("\n"), b = next.split("\n");
    expect(b.length).toBe(a.length);
    expect(b.filter((l, i) => l !== a[i])).toHaveLength(2);
    expect(yamlToSpec(next).spec.basis.interest).toBe(0.03);
  });
  it("흐름 표기 안에서 쉼표가 든 값은 문서 트리로 고친다(따옴표) — 값과 주석은 남는다", () => {
    const next = editYaml(src, [{ path: ["expenses", 0, "basis"], value: "보험가입금액, 초년도" }]);
    expect(yamlToSpec(next).errors).toEqual([]);
    expect(yamlToSpec(next).spec.expenses[0].basis).toBe("보험가입금액, 초년도");
    expect(next).toContain("# 가입나이");
  });
  it("사업비 비율 ↔ 배수를 바꾼다 (두 칸을 한 번에)", () => {
    const next = editYaml(src, [{ path: ["expenses", 0, "rate"] }, { path: ["expenses", 0, "times"], value: "2배" }]);
    const e = yamlToSpec(next).spec.expenses[0];
    expect(e.times).toBe(2);
    expect(e.rate).toBeUndefined();
  });
  it("항목을 더하고 지운다 — 사업비 새 행은 한 줄(흐름 표기)", () => {
    let next = editYaml(src, [{ path: ["rates"], add: true, value: { id: "kc", name: "암발생률", role: "incidence" } }]);
    expect(yamlToSpec(next).spec.rates.map((r) => r.id)).toEqual(["q", "k80", "kc"]);
    next = editYaml(next, [{ path: ["expenses"], add: true, value: { group: "수금비용", symbol: "γ2", basis: "영업보험료", rate: "1%" } }]);
    expect(lineWith(next, /γ2/)?.trim()).toBe("- { group: 수금비용, symbol: γ2, basis: 영업보험료, rate: 1% }");
    next = editYaml(next, [{ path: ["rates", 1] }]);
    expect(yamlToSpec(next).spec.rates.map((r) => r.id)).toEqual(["q", "kc"]);
    expect(next).toContain("# 가입나이");
  });
  it("없던 목록에 첫 항목을 더하면 목록을 만든다 (식·사업비)", () => {
    const next = editYaml("meta:\n  productName: A\n", [
      { path: ["formulas"], add: true, value: { section: "보험료의 계산", label: "순보험료", text: "P = A / B" } },
      { path: ["expenses"], add: true, value: { group: "수금비용", symbol: "γ", basis: "영업보험료", rate: "2%" } },
    ]);
    const { spec, errors } = yamlToSpec(next);
    expect(errors).toEqual([]);
    expect(spec.formulas).toEqual([{ section: "보험료의 계산", label: "순보험료", text: "P = A / B" }]);
    expect(lineWith(next, /γ/)?.trim()).toBe("- { group: 수금비용, symbol: γ, basis: 영업보험료, rate: 2% }");
  });
  it("목록 값을 바꿔도 한 줄 표기와 줄 끝 주석을 이어받는다", () => {
    const next = editYaml(src, [{ path: ["benefits", 0, "exitRateIds"], value: ["q"] }]);
    expect(lineWith(next, /exitRateIds/)).toMatch(/exitRateIds: \[ ?q ?\] # 유지자수·납입자수/);
    expect(yamlToSpec(next).spec.benefits[0].exitRateIds).toEqual(["q"]);
  });
  it("값 없음(undefined)은 지우고, 비어 있는 윗 항목은 새로 채운다", () => {
    expect(editYaml(src, [{ path: ["meta", "kind"] }])).not.toMatch(/kind:/);
    expect(editYaml(src, [{ path: ["reserve", "notes", 0], value: "" }])).toMatch(/- ""/);     // 목록 칸은 비워도 남는다
    const next = editYaml("meta:\n  productName: A\nreserve:\n", [{ path: ["reserve", "notes"], value: ["연말 기준"] }]);
    expect(yamlToSpec(next).spec.reserve.notes).toEqual(["연말 기준"]);
  });
  it("문법 오류가 있으면 건드리지 않는다", () => {
    expect(editYaml("meta: [\n", [{ path: ["meta", "x"], value: 1 }])).toBe("meta: [\n");
  });
  it("경로 글자는 산출방법서 블록 경로와 같다", () => {
    expect(pathKey(["benefits", 0, "amount"])).toBe("benefits[0].amount");
    expect(pathKey(["basis", "lapse", 1])).toBe("basis.lapse[1]");
  });
});
