import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { yamlToSpec } from "@/lib/conditions/yaml";
import { BASE_RATES_CSV } from "@/lib/base-rates";
import { withFormulas } from "@/lib/methoddoc/formulas";
import { computeSpec } from "@/lib/methoddoc/calc";
import { docToMarkdown, renderMethodDoc } from "@/lib/methoddoc/render";
import { waiverRates } from "@/lib/methoddoc/spec";
import { DEFAULT_SAMPLE_ID, SAMPLES } from "@/lib/samples";
import { attachTables, sampleSheet } from "@/lib/sheet";

/**
 * 기본 상품 — 종신보험(암진단 포함).
 *  사망·80% 이상 장해(사망형 1억) + 암 진단(진단형, 사망보험금의 50% = 5천만, 90일 면책, 100세)
 *  납입면제: 80% 이상 장해 · 암 진단 (사망은 계약 소멸 — 탈퇴로 준다). 위험률은 모두 남·여 표(공개 기본 위험률).
 * samples/09_종신보험(암진단포함)_MethodSpec.json 은 이 조건 + 표 그대로 — 자유설계보험 계산(tests/ui/default-product)과
 * 엑셀 검산 파일(scripts/make-verify-xlsx.py)이 이 파일을 읽는다. VERIFY_UPDATE=1 이면 다시 쓴다.
 */
const FILE = "samples/09_종신보험(암진단포함)_MethodSpec.json";
const sample = SAMPLES.find((s) => s.id === DEFAULT_SAMPLE_ID)!;
const cond = yamlToSpec(sample.yaml);
const spec = attachTables(cond.spec, sampleSheet(cond.spec.rates, BASE_RATES_CSV, "기본 위험률 표"));

describe("기본 상품 종신보험(암진단 포함)", () => {
  it("조건: 오류 없음 · 담보 둘 · 암 진단 = 사망보험금의 50%, 90일 면책 · 납입면제 사유 = 80% 장해·암", () => {
    expect(cond.errors).toEqual([]);
    expect(spec.meta.productName).toBe("종신보험(암진단 포함)");
    const [death, cancer] = spec.benefits;
    expect([death.role, death.amount, death.exitRateIds]).toEqual(["death", 1e8, ["q", "r80"]]);
    expect([cancer.role, cancer.amount! / death.amount!, cancer.waitDays, cancer.rateId, cancer.exitRateIds, cancer.endAge]).toEqual(["incidence", 0.5, 90, "rc", ["q", "rc"], 100]);
    expect(waiverRates(spec).map((r) => r.id)).toEqual(["r80", "rc"]);
  });

  it("위험률은 모두 남·여 두 벌(장해율 포함) — 계산 앱이 계약 성별로 고른다", () => {
    for (const r of spec.rates) expect(Object.keys(r.tables ?? {}).sort()).toEqual(["F", "M"]);
    const r80 = spec.rates.find((r) => r.id === "r80")!;
    expect(r80.tables!.M!.values[40]).toBeCloseTo(0.000147, 12);
    expect(r80.tables!.F!.values[40]).toBeCloseTo(0.000167, 12);
  });

  it("산출식: 집단마다 납입면제 f 는 그 집단의 탈퇴 사유를 뺀 것 · 암 진단은 첫해 (1 − 3/12)", () => {
    const f = withFormulas(spec).formulas;
    // 담보 둘의 탈퇴 사유가 달라 집단도 둘이다 (사망·80% 장해 / 사망·암)
    const main = f.find((x) => x.key === "group:g1")!.text, can = f.find((x) => x.key === "group:g2")!.text;
    expect(main).toContain("f_x : 암발생률 — 납입만 면제되는 사유");
    expect(can).toContain("f_x : 80% 이상 장해율 — 납입만 면제되는 사유");
    expect(main).toContain("l′_{x+t+1} = l′_{x+t} × ( 1 − Q_{x+t} − f_{x+t} + Q_{x+t}·f_{x+t}/2 )");
    // 면책은 보장금액의 배수 S 로 — 첫해만 (1 − 3/12) 배
    expect(f.find((x) => x.key === "benefit:b2")!.text).toContain("S_t = 1 × if( t = 0, 1 − 3/12, 1 )");
    const md = docToMarkdown(renderMethodDoc(withFormulas(spec)));
    expect(md).toContain("f_x : 80% 이상 장해율 · 암발생률");                     // 1.4 납입면제 사유
    expect(md).toContain("| 면책 | 90일 |");
    expect(md).toContain("유지자수·납입자수의 집단 2개");
  });

  it("산출방법서의 식을 그대로 읽어 계산해도 같은 보험료 (10만원당 261 · 162)", () => {
    const got = computeSpec(spec, { age: 40, sex: "M", payYears: 20, freq: 12 });
    expect(got.errors).toEqual([]);
    expect(got.benefits.map((b) => b.per100k)).toEqual([261, 162]);
    expect(got.premium).toBe(342000);
  });

  it(`${FILE} — 지금 조건·표와 같다 (VERIFY_UPDATE=1 로 다시 쓴다)`, () => {
    const json = JSON.stringify(spec, null, 2) + "\n";
    if (process.env.VERIFY_UPDATE || !existsSync(FILE)) writeFileSync(FILE, json);
    expect(readFileSync(FILE, "utf8")).toBe(json);
  });
});
