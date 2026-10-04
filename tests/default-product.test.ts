import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { yamlToSpec } from "@/lib/conditions/yaml";
import { BASE_RATES_CSV } from "@/lib/base-rates";
import { eventRate, withFormulas } from "@/lib/methoddoc/formulas";
import { computeByPayMethod, computeSpec } from "@/lib/methoddoc/calc";
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
  it("조건: 오류 없음 · 담보 둘 · 사망 1배 · 암 진단 0.5배(사망보험금의 50%), 90일 면책 · 납입면제 사유 = 80% 장해·암", () => {
    expect(cond.errors).toEqual([]);
    expect(spec.meta.productName).toBe("종신보험(암진단 포함)");
    const [death, cancer] = spec.benefits;
    expect([death.role, death.multiple, death.exitRateIds]).toEqual(["death", 1, ["q", "r80"]]);
    // 급부 위험률은 따로 적지 않는다 — 탈퇴 사유 가운데 사망이 아닌 것(암발생률)
    expect([cancer.role, cancer.multiple, cancer.waitDays, cancer.rateId, eventRate(spec, cancer)?.id, cancer.exitRateIds, cancer.endAge]).toEqual(["incidence", 0.5, 90, undefined, "rc", ["q", "rc"], 100]);
    expect(waiverRates(spec).map((r) => r.id)).toEqual(["r80", "rc"]);
  });

  it("위험률은 모두 남·여 두 벌(장해율 포함) — 계산 앱이 계약 성별로 고른다", () => {
    for (const r of spec.rates) expect(Object.keys(r.tables ?? {}).sort()).toEqual(["F", "M"]);
    const r80 = spec.rates.find((r) => r.id === "r80")!;
    expect(r80.tables!.M!.values[40]).toBeCloseTo(0.000147, 12);
    expect(r80.tables!.F!.values[40]).toBeCloseTo(0.000167, 12);
  });

  it("산출식: 생존자 셋 — lx(1) 사망·장해 · lx(2) 사망·암 (보험금마다) · lx(3) 사망·장해·암 [납입] · 암 진단은 첫해 (1 − 3/12)", () => {
    const f = withFormulas(spec).formulas;
    const surv = f.filter((x) => x.key?.startsWith("surv:"));
    expect(surv.map((x) => x.label)).toEqual(["생존자수 lx(1) — 생존자(사망X, 80% 이상 장해X)", "생존자수 lx(2) — 생존자(사망X, 암X)", "생존자수 lx(3) — 생존자(사망X, 80% 이상 장해X, 암X)"]);
    const main = surv[2].text;
    expect(main).toContain("r^{(1)}_x : 80% 이상 장해율");
    expect(main).toContain("r^{(2)}_x : 암발생률");
    // 질병(장해 · 암)은 곱으로, 사망과는 겹치는 부분 절반
    expect(main).toContain("R^{(3)}_{x+t} = 1 − ( 1 − r^{(1)}_{x+t} )·( 1 − r^{(2)}_{x+t} )");
    expect(main).toContain("Q^{(3)}_{x+t} = min( 1, q_{x+t} + R^{(3)}_{x+t} − q_{x+t}·R^{(3)}_{x+t}/2 )");
    expect(main).toContain("l^{(3)}_{x+t+1} = l^{(3)}_{x+t} × ( 1 − Q^{(3)}_{x+t} )");
    expect(f.find((x) => x.key === "benefit:b1")!.text).toContain("N′_{x+t} = N^{(3)}_{x+t}");
    // 면책은 보장금액의 배수 S 로 — 첫해만 (1 − 3/12) 배
    expect(f.find((x) => x.key === "benefit:b2")!.text).toContain("S_t = 1 × if( t = 0, 1 − 3/12, 1 )");
    const md = docToMarkdown(renderMethodDoc(withFormulas(spec)));
    // v7 — 납입면제는 따로 적지 않는다: [납입] 생존자의 탈퇴 위험률이 곧 납입을 멈추는 사유다
    expect(md).toContain("| 탈퇴 위험률 | 사망률 및 80% 이상 장해율 및 암발생률 |\n| 납입(N*) | 주계약 |");
    expect(md).toContain("| 면책·삭감 | 90일 면책 |");
    expect(md).toContain("| 보장금액 | 가입금액의 0.5배 |");
    expect(md).toContain("| 보험기간 | 100세 만기 |");
    // v7 — 다. 생존자 · 라. 보험금, 보험금 표는 그 보험금 식 바로 위에
    expect(md).toContain("### 다. 생존자");
    expect(md).toContain("### 라. 보험금");
    expect(md).toMatch(/\| 생존자 \| lx\(2\) — 생존자\(사망X, 암X\) \|\n\| 급부 위험률 \| 탈퇴 사유에서 — 암발생률 \|\n\| 계산기수 \| Cx · Mx \|\n\n\[식\] 보험금 — 암 진단/);
  });

  it("산출방법서의 식을 그대로 읽어 계산해도 같은 보험료 (1원당 6자리 → 10만원당 261 · 162 · 가입금액 1억 기준 월 342,000원)", () => {
    const got = computeSpec(spec, { age: 40, sex: "M", payYears: 20, freq: 12, sumAssured: 1e8 });
    expect(got.errors).toEqual([]);
    expect(got.benefits.map((b) => [b.gross6, b.per100k, b.amount])).toEqual([[0.002606, 261, 1e8], [0.001624, 162, 5e7]]);
    expect(got.premium).toBe(342000);
    // 가입금액을 바꾸면 담보 보험료만 비례해 바뀐다(10만원당은 그대로) · 납입방법마다 N* 만 다르다
    expect(computeSpec(spec, { age: 40, sex: "M", payYears: 20, freq: 12, sumAssured: 5e7 }).premium).toBe(171000);
    const byPay = computeByPayMethod(spec, { age: 40, sex: "M", payYears: 20, freq: 12, sumAssured: 1e8 });
    expect(byPay.map((r) => r.label)).toEqual(["월납", "3개월납", "6개월납", "연납"]);
    expect(byPay[3].premium).toBeGreaterThan(byPay[0].premium * 11);
  });

  it(`${FILE} — 지금 조건·표와 같다 (VERIFY_UPDATE=1 로 다시 쓴다)`, () => {
    const json = JSON.stringify(spec, null, 2) + "\n";
    if (process.env.VERIFY_UPDATE || !existsSync(FILE)) writeFileSync(FILE, json);
    expect(readFileSync(FILE, "utf8")).toBe(json);
  });
});
