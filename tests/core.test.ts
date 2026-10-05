import { describe, expect, it } from "vitest";
import katex from "katex";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extractDoc, extractText } from "@/lib/methoddoc/extract";
import { parseMethodDoc } from "@/lib/methoddoc/parse";
import { docToMarkdown, renderMethodDoc } from "@/lib/methoddoc/render";
import { eventCauses, eventRate, generateFormulas, withFormulas } from "@/lib/methoddoc/formulas";
import { docToLatex, formulaToTex, latexToDoc, toTex } from "@/lib/methoddoc/tex";
import { jsonToSpec, mergeSpec, patchYaml, specToYaml, yamlToSpec } from "@/lib/conditions/yaml";
import { SAMPLES, SHARED_SAMPLE_IDS, START_SAMPLE_ID } from "@/lib/samples";

const sample = (id: string) => yamlToSpec(SAMPLES.find((s) => s.id === id)!.yaml);
const docOf = (spec: ReturnType<typeof sample>["spec"]) => renderMethodDoc(withFormulas(spec));

describe("조건 파일(YAML)", () => {
  it("샘플이 오류 없이 읽히고 실무 표기가 소수로 바뀐다", () => {
    for (const s of SAMPLES) expect(yamlToSpec(s.yaml).errors, s.id).toEqual([]);
    const { spec } = sample("whole");
    expect(spec.basis.interest).toBe(0.025);
    expect(spec.basis.standardInterest).toBe(0.0325);
    expect(spec.expenses.map((e) => e.rate ?? e.times)).toEqual([0.01, 1, 0.0015, 0.045, 0.001, 0.025]);
    expect(spec.benefits[0].exitRateIds).toEqual(["q"]);                                        // 종신: 보장은 사망만(대상자수 lx(2))
    expect(spec.survivors!.map((x) => [x.exitRateIds, x.payFor])).toEqual([[["q", "r80"], ["주계약"]], [["q"], undefined]]);   // 납입자 = 사망·80% 장해 아닌 유지자 lx(1)
    expect([spec.basis.waiver, spec.basis.waiverRateIds]).toEqual([true, ["r80"]]);
    expect(sample("cancer").spec.basis.lowRatio).toBe(0);
    // 샘플은 일곱 — 종신 둘 · 암진단 · 2대질병 · 입원특약 · 수술특약 · 보험료납입지원특약, 위험률 근거는 모두 가상
    expect(SAMPLES.map((x) => x.id)).toEqual(["whole", "wholeCancer", "cancer", "twoMajor", "hospital", "surgery", "support", "cancerPlan"]);
    // 공유용 [샘플] 메뉴는 종신보험 · 암보험 둘, 첫 화면은 종신보험
    expect(SHARED_SAMPLE_IDS).toEqual(["whole", "cancerPlan"]);
    expect(START_SAMPLE_ID).toBe("whole");
    for (const x of SAMPLES) for (const r of yamlToSpec(x.yaml).spec.rates) expect(r.source, `${x.id} ${r.name}`).toMatch(/^경험생명표\(가상\) /);
  });
  it("조건 경로마다 줄 번호를 안다 (양쪽 대응 위치의 바탕)", () => {
    const src = SAMPLES[0].yaml;
    const { ranges } = yamlToSpec(src);
    const lines = src.split("\n");
    const at = (p: string) => lines[ranges.get(p)![0] - 1];
    expect(at("basis.interest")).toMatch(/interest: 2\.5%/);
    expect(at("expenses[3]")).toMatch(/β_G/);
    expect(at("benefits[0]")).toMatch(/id: b1/);
    expect(ranges.get("benefits[0]")![1]).toBeGreaterThan(ranges.get("benefits[0]")![0]);   // 여러 줄 항목은 끝 줄까지
  });
  it("스펙 → YAML → 스펙이 같다 (모든 샘플)", () => {
    for (const s of SAMPLES) {
      const a = yamlToSpec(s.yaml).spec;
      const b = yamlToSpec(specToYaml(a)).spec;
      expect(b, s.id).toEqual(a);
    }
  });
  it("잘못된 값은 줄과 함께 알려준다", () => {
    const r = yamlToSpec("basis:\n  interest: 이상함\n");
    expect(r.errors.some((e) => /interest/.test(e.message))).toBe(true);
    expect(yamlToSpec("meta: [\n").errors[0].line).toBeGreaterThan(0);
  });
  it("다른 앱이 낸 MethodSpec JSON 을 그대로 받는다", () => {
    const a = sample("twoMajor").spec;
    expect(jsonToSpec(JSON.stringify(a))).toEqual(a);
  });
});

describe("조건 → 산출식", () => {
  /** 짝(key)으로 식 덩이를 집는다 — 조건 카드·계산(calc)이 쓰는 것과 같은 짝이다 */
  const byKey = (id: string, key: string) => generateFormulas(sample(id as never).spec).find((x) => x.key === key)!;

  it("종신: 유지자 둘 — lx(1) 사망·80% 장해(Q = min(1, q + r − q·r/2)) 는 납입(N*) · lx(2) 사망(q 그대로) 은 사망 보험금", () => {
    const g = byKey("whole", "surv:s1");
    expect(g.section).toBe("유지자");
    expect(g.label).toBe("유지자수 lx(1) — 사망, 80% 이상 장해 아닌 유지자");
    expect(g.path).toBe("survivors[0]|rates[0]|rates[1]|basis.waiver|basis.waiverRateIds|basis.interest");
    // 설명 한 줄 → 식 한 줄 (기존 산출방법서 모양)
    expect(g.text).toContain("Q^{(1)}_{x+t} = min( 1, q_{x+t} + r_{x+t} − q_{x+t}·r_{x+t}/2 )");
    expect(g.text).toContain("유지자수 — 탈퇴 사유가 생긴 사람을 뺀다\nl^{(1)}_{x+t+1} = l^{(1)}_{x+t} × ( 1 − Q^{(1)}_{x+t} )");
    expect(g.text).toContain("N^{(1)}_{x+t} = Σ_{u≥t} D^{(1)}_{x+u}");
    // 위험률이 하나뿐인 유지자는 결합 Q 없이 그 위험률 그대로(메모: 수식이 아니면 그 위험률)
    const g2 = byKey("whole", "surv:s2");
    expect(g2.text).toContain("l^{(2)}_{x+t+1} = l^{(2)}_{x+t} × ( 1 − q_{x+t} )");
    expect(g2.text).not.toContain("Q^{(2)}");
    // 보험금은 앞의 유지자 lx 를 대상자수로 가져다 쓴다 — 사망 보장은 대상자수 × 사망률
    const b = byKey("whole", "benefit:b1");
    expect(b.section).toBe("보험금");
    expect(b.label).toBe("보험금 — 사망");
    expect(b.text).toContain("l_{x+t} = l^{(2)}_{x+t}");
    expect(b.text).toContain("N′_{x+t} = N^{(1)}_{x+t}");                                  // 납입(N*)은 lx(1) — 80% 장해면 납입면제
    expect(b.text).toContain("C_{x+t} = l^{(2)}_{x+t}·q_{x+t}·v^{t+½}");
    expect(b.text).toContain("M_{x+t} = Σ_{u=t}^{n−1} S_u·C_{x+u}");
    expect(b.text).toContain("PVB = M_x");
  });
  it("사망 아닌 탈퇴 사유가 여럿인 진단형(3대질병)은 급부 발생률 R = 그 사유들의 결합 — 첫 사유 하나만 쓰지 않는다", () => {
    const spec = yamlToSpec(SAMPLES.find((x) => x.id === "support")!.yaml.replace(/formulas:[\s\S]*$/, "")).spec;
    const b = generateFormulas(spec).find((x) => x.key === "benefit:b1")!;
    // R 은 생존자 식에서 질병끼리 곱으로 묶은 것 — 사망과는 겹치는 부분 절반
    const g = generateFormulas(spec).find((x) => x.key === "surv:s1")!;
    expect(g.text).toContain("R^{(1)}_{x+t} = 1 − ( 1 − r^{(1)}_{x+t} )·( 1 − r^{(2)}_{x+t} )·( 1 − r^{(3)}_{x+t} )");
    expect(g.text).toContain("Q^{(1)}_{x+t} = min( 1, q_{x+t} + R^{(1)}_{x+t} − q_{x+t}·R^{(1)}_{x+t}/2 )");
    expect(b.text).toContain("C_{x+t} = l^{(1)}_{x+t}·R^{(1)}_{x+t}·v^{t+½}");
    expect(b.text).not.toContain("R^{(1)}_{x+t} =");
    expect(eventRate(spec, spec.benefits[0])).toBeUndefined();
    expect(eventCauses(spec, spec.benefits[0]).map((r) => r.id)).toEqual(["rc", "rs", "ra"]);
    // 하나뿐이면 그 위험률 그대로(기본 상품의 암 진단)
    const wc = sample("wholeCancer").spec;
    expect(eventRate(wc, wc.benefits[1])?.id).toBe("rc");
  });
  it("2대질병: 보험금 둘이 저마다 그 질병의 미발생 유지자, 납입(N*)은 뇌출혈·급성심근경색증을 곱으로 묶은 유지자", () => {
    const spec = sample("twoMajor").spec;
    const fs = withFormulas(spec).formulas;
    const surv = fs.filter((f) => f.key?.startsWith("surv:"));
    expect(surv.map((f) => f.label)).toEqual(["유지자수 lx(1) — 사망, 뇌출혈 아닌 유지자", "유지자수 lx(2) — 사망, 급성심근경색증 아닌 유지자", "유지자수 lx(3) — 사망, 뇌출혈, 급성심근경색증 아닌 유지자"]);
    expect(surv[2].text).toContain("R^{(3)}_{x+t} = 1 − ( 1 − r^{(1)}_{x+t} )·( 1 − r^{(2)}_{x+t} )");
    expect(surv[2].text).toContain("Q^{(3)}_{x+t} = min( 1, q_{x+t} + R^{(3)}_{x+t} − q_{x+t}·R^{(3)}_{x+t}/2 )");
  });
  it("진단형은 급부 = 진단율, 무해지는 해지율 w·CSV", () => {
    expect(byKey("twoMajor", "benefit:b1").text).toContain("C_{x+t} = l^{(1)}_{x+t}·r^{(1)}_{x+t}·v^{t+½}");
    expect(byKey("cancer", "surv:s1").text).toContain("l^{(1)}_{x+t+1} = l^{(1)}_{x+t} × ( 1 − r_{x+t} − w_{x+t} + r_{x+t}·w_{x+t}/2 )");   // 암 단일탈퇴 + 해지율
    // 납입주기는 k (mm 아님) — 연납 환산 납입기수·영업보험료·납입누계
    const all = generateFormulas(sample("whole").spec).map((x) => x.text).join("\n");
    expect(all).not.toMatch(/mm/);
    expect(all).toContain("N* = k · [");
    expect(all).toContain("β_S/k");
    const low = generateFormulas(sample("cancer").spec);
    expect(low[0].text).toContain("w_{x+t}");
    expect(low.some((x) => x.label === "저해지·무해지환급형")).toBe(true);
    // 기본 상품의 [납입] 생존자 = 사망·장해·암 — 질병끼리 곱, 사망과는 겹침 절반
    expect(byKey("wholeCancer", "surv:s3").text).toContain("R^{(3)}_{x+t} = 1 − ( 1 − r^{(1)}_{x+t} )·( 1 − r^{(2)}_{x+t} )");
    // 준비금·환급금 식도 계산할 수 있는 식이다
    const keys = generateFormulas(sample("whole").spec).map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(["reserve:P", "reserve:V", "surrender:alpha", "surrender:deduct", "surrender:W", "surrender:paid", "surrender:ratio", "premium:round"]));
  });
});

describe("LaTeX", () => {
  it("평문 수식 → LaTeX: 한글은 \\text, 첨자 뒤 한글도, 기호는 명령으로", () => {
    expect(toTex("유지자수  l_{x+t+1} = l_{x+t} × ( 1 − q_{x+t} )")).toBe("\\text{유지자수 } \\quad l_{x+t+1} = l_{x+t} \\times ( 1 - q_{x+t} )");
    expect(toTex("α^공제 = min( α, α^std )")).toContain("\\alpha^{\\text{공제}}");
    expect(toTex("P_base = PVB / N*")).toContain("P_{base} = \\mathrm{PVB} / N*");
    expect(toTex("80% 이상 장해율")).toContain("80\\%");
  });
  it("모든 샘플의 모든 수식이 KaTeX 로 오류 없이 그려진다", () => {
    for (const s of SAMPLES) for (const sec of docOf(yamlToSpec(s.yaml).spec)) for (const b of sec.blocks) {
      if (b.t !== "formula") continue;
      expect(() => katex.renderToString(formulaToTex(b.text), { displayMode: true, throwOnError: true }), `${s.id}: ${b.text}`).not.toThrow();
    }
  });
  it("조건 → LaTeX → 되읽기 → 조건이 그대로다 (모든 샘플)", () => {
    for (const s of SAMPLES) {
      const spec = yamlToSpec(s.yaml).spec;
      const tex = docToLatex(docOf(spec), spec.meta.productName);
      const back = parseMethodDoc(latexToDoc(tex));
      const { changes } = mergeSpec(spec, back.spec, back.evidence);
      expect(changes, s.id).toEqual([]);
      expect(back.spec.benefits.map((b) => b.name), s.id).toEqual(spec.benefits.map((b) => b.name));
    }
  });
  it("조건 → Markdown → 되읽기 → 조건이 그대로다 (모든 샘플)", () => {
    for (const s of SAMPLES) {
      const spec = yamlToSpec(s.yaml).spec;
      const md = docToMarkdown(docOf(spec), spec.meta.productName);
      const back = parseMethodDoc(extractText(new TextEncoder().encode(md)));
      expect(mergeSpec(spec, back.spec, back.evidence).changes, s.id).toEqual([]);
    }
  });
  it("LaTeX 에서 이율·보장금액 배수를 고치면 그 항목만 조건에 반영되고, 조건 파일의 주석은 남는다", () => {
    const src = SAMPLES[0].yaml;
    const spec = yamlToSpec(src).spec;
    const tex = docToLatex(docOf(spec), spec.meta.productName)
      .replace("적용이율 i & 2.500\\%", "적용이율 i & 3.000\\%")
      .replace(/사망 & 1 &/, "사망 & 0.5 &");                       // v8 — 마. 보장 표의 배수 칸
    const back = parseMethodDoc(latexToDoc(tex));
    const { spec: merged, changes } = mergeSpec(spec, back.spec, back.evidence);
    expect(merged.basis.interest).toBeCloseTo(0.03, 12);
    expect(merged.benefits[0].multiple).toBe(0.5);
    expect(changes.join("\n")).toMatch(/basis\.interest: 2\.5% → 3%/);
    const next = patchYaml(src, merged);
    expect(next).toContain("interest: 3%");
    expect(next).toContain("# 납입면제 — 80% 이상 장해 시");   // 고치지 않은 줄의 사용자 주석 유지
    expect(yamlToSpec(next).spec).toEqual(merged);
  });
});

describe("가입 조건 (정보) — 시산 기준(계약)은 읽지 않는다", () => {
  const md = (spec: ReturnType<typeof sample>["spec"]) => docToMarkdown(docOf(spec), spec.meta.productName);
  it("조건 파일에서 읽고 산출방법서 개요에 두 표로 싣는다 — 남녀가 다르면 가입나이 두 칸", () => {
    const { spec } = sample("whole");
    expect(spec.product?.terms).toEqual([
      { term: "110세만기", pay: "10·15·20년납", age: "만15세 ~ 65세" },
      { term: "110세만기", pay: "30년납", age: "만15세 ~ 50세" },
    ]);
    const cover = docOf(spec)[0].blocks.filter((b) => b.t === "table").map((b) => (b.t === "table" ? b.head : []));
    expect(cover).toContainEqual(["가입 조건", "내용"]);
    expect(cover).toContainEqual(["보험기간", "보험료 납입기간", "가입나이"]);
    const low = docOf(sample("cancer").spec)[0].blocks.find((b) => b.t === "table" && b.head[0] === "보험기간");
    expect(low?.t === "table" && low.head).toEqual(["보험기간", "보험료 납입기간", "가입나이(남)", "가입나이(여)"]);
  });
  it("LaTeX·Markdown 으로 내고 되읽으면 가입 조건이 그대로이고, 시산 기준은 읽지 않는다(계산하는 앱의 계약정보)", () => {
    for (const s of SAMPLES) {
      const spec = yamlToSpec(s.yaml).spec;
      for (const back of [parseMethodDoc(latexToDoc(docToLatex(docOf(spec), spec.meta.productName))), parseMethodDoc(extractText(new TextEncoder().encode(md(spec))))]) {
        expect(back.spec.product, s.id).toEqual(spec.product);
        expect(back.spec.contract, s.id).toEqual({});
      }
    }
  });
  it("사업방법서 모양의 표(병합 칸·납입주기 칸)를 가입 조건으로 읽고, 계약으로 읽지 않는다", () => {
    const doc = extractText(new TextEncoder().encode([
      "무배당 알뜰건강보험", "",
      "| 구분 | 보험기간 | 보험료납입기간 | 보험가입나이 | 보험료납입주기 |", "|---|---|---|---|---|",
      "| 상해사망 | 80세만기 | 10년납 | 만15세 ~ (80-납입기간)세 | 월납 |",
      "|  |  | 20년납 |  | 연납 |",
      "| 뇌졸중진단비 | 100세만기 | 20년납 | 0세~60세 | 월납 |",
    ].join("\n")));
    const r = parseMethodDoc(doc);
    expect(r.spec.product).toEqual({
      terms: [
        { label: "상해사망", term: "80세만기", pay: "10년납", age: "만15세 ~ (80-납입기간)세" },
        { label: "상해사망", term: "80세만기", pay: "20년납", age: "만15세 ~ (80-납입기간)세" },
        { label: "뇌졸중진단비", term: "100세만기", pay: "20년납", age: "0세~60세" },
      ],
      payFreqs: ["월납", "연납"],
    });
    expect([r.spec.contract.age, r.spec.contract.termAge, r.spec.contract.payYears]).toEqual([undefined, undefined, undefined]);
  });
  it("산출방법서에서 가입 조건을 고치면 [조건에 반영]으로 그것만 들어간다", () => {
    const src = SAMPLES[0].yaml, spec = yamlToSpec(src).spec;
    const tex = docToLatex(docOf(spec), spec.meta.productName).replace("만15세 \\textasciitilde{} 50세", "만15세 \\textasciitilde{} 55세");
    const back = parseMethodDoc(latexToDoc(tex));
    const { spec: merged, changes } = mergeSpec(spec, back.spec, back.evidence);
    expect(changes).toEqual(["product: 가입 조건 2행 → 2행 갱신"]);
    expect(merged.product?.terms?.[1].age).toBe("만15세 ~ 55세");
    expect(patchYaml(src, merged)).toContain("# 적용(예정)이율");
  });
});

// ── 실제 산출방법서 PDF → 조건 ──────────────────────────────────────────────
const ROOT = "C:/Users/tklee/OneDrive - 코리안리재보험/0. 보험료 산출 방법서";
function find(dirFrag: string, fileFrag: string): string {
  try {
    const dir = readdirSync(ROOT).find((d) => d.normalize("NFC").includes(dirFrag));
    const f = dir && readdirSync(`${ROOT}/${dir}`).find((x) => /\.pdf$/i.test(x) && x.normalize("NFC").includes(fileFrag));
    return f ? `${ROOT}/${dir}/${f}` : "";
  } catch { return ""; }
}
const GONGJE = find("교직원 공제", "실속건강공제");

describe.runIf(!!GONGJE && existsSync(GONGJE))("PDF → 조건 파일", () => {
  it("값마다 출처를 주석으로 달고, 다시 읽어도 같은 값이다", async () => {
    const r = parseMethodDoc(await extractDoc("a.pdf", new Uint8Array(readFileSync(GONGJE))), { fallbackName: "공제" });
    const yaml = specToYaml(r.spec, r.evidence);
    expect(yaml).toMatch(/interest: 4\.25% # 본문 55줄 · 본문 규칙/);
    const back = yamlToSpec(yaml);
    expect(back.spec.basis.interest).toBeCloseTo(0.0425, 12);
    expect(back.spec.expenses.length).toBe(r.spec.expenses.length);
  }, 120000);
});
