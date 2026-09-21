import { describe, expect, it } from "vitest";
import katex from "katex";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extractDoc, extractText } from "@/lib/methoddoc/extract";
import { parseMethodDoc } from "@/lib/methoddoc/parse";
import { docToMarkdown, renderMethodDoc } from "@/lib/methoddoc/render";
import { generateFormulas, withFormulas } from "@/lib/methoddoc/formulas";
import { docToLatex, formulaToTex, latexToDoc, toTex } from "@/lib/methoddoc/tex";
import { jsonToSpec, mergeSpec, patchYaml, specToYaml, yamlToSpec } from "@/lib/conditions/yaml";
import { SAMPLES } from "@/lib/samples";

const sample = (id: string) => yamlToSpec(SAMPLES.find((s) => s.id === id)!.yaml);
const docOf = (spec: ReturnType<typeof sample>["spec"]) => renderMethodDoc(withFormulas(spec), { today: new Date("2026-09-21") });

describe("조건 파일(YAML)", () => {
  it("샘플이 오류 없이 읽히고 실무 표기가 소수로 바뀐다", () => {
    for (const s of SAMPLES) expect(yamlToSpec(s.yaml).errors, s.id).toEqual([]);
    const { spec } = sample("whole");
    expect(spec.basis.interest).toBe(0.025);
    expect(spec.basis.standardInterest).toBe(0.0325);
    expect(spec.expenses.map((e) => e.rate ?? e.times)).toEqual([0.01, 1, 0.0015, 0.045, 0.001, 0.025]);
    expect(spec.benefits[0].exitRateIds).toEqual(["q", "k80"]);
    expect(sample("noRefund").spec.basis.lowRatio).toBe(0);
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
  it("종신: 사망·80% 장해를 한 담보로 — 유지자수·납입자수 = 1 − q − k + q·k/2, 급부 = 탈퇴 전부", () => {
    const f = generateFormulas(sample("whole").spec).find((x) => x.path?.split("|")[0] === "benefits[0]")!;
    expect(f.path).toBe("benefits[0]|rates[0]|rates[1]");        // 담보·두 탈퇴 위험률 어느 것을 골라도 이 식이 표시된다
    expect(f.text).toContain("유지자수  l_{x+t+1} = l_{x+t} × ( 1 − q_{x+t} − k_{x+t} + q_{x+t}·k_{x+t}/2 )");
    expect(f.text).toContain("납입자수  l′_{x+t+1} = l′_{x+t} × ( 1 − q_{x+t} − k_{x+t} + q_{x+t}·k_{x+t}/2 )");
    expect(f.text).toContain("C_{x+t} = ( l_{x+t} − l_{x+t+1} )·v^{t+½}");
  });
  it("진단형은 급부 = 진단율, 무해지는 해지율 w·CSV, 납입지원은 추가 사유 f", () => {
    expect(generateFormulas(sample("twoMajor").spec)[0].text).toContain("C_{x+t} = l_{x+t}·k_{x+t}·v^{t+½}");
    const low = generateFormulas(sample("noRefund").spec);
    expect(low[0].text).toContain("w_{x+t}");
    expect(low.some((x) => x.label === "저해지·무해지환급형")).toBe(true);
    expect(generateFormulas(sample("waiverSupport").spec)[0].text).toContain("− f_{x+t} + Q_{x+t}·f_{x+t}/2");
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
  it("LaTeX 에서 이율·보장금액을 고치면 그 항목만 조건에 반영되고, 조건 파일의 주석은 남는다", () => {
    const src = SAMPLES[0].yaml;
    const spec = yamlToSpec(src).spec;
    const tex = docToLatex(docOf(spec), spec.meta.productName)
      .replace("적용이율 i & 2.500\\%", "적용이율 i & 3.000\\%")
      .replace("100,000,000원", "50,000,000원");
    const back = parseMethodDoc(latexToDoc(tex));
    const { spec: merged, changes } = mergeSpec(spec, back.spec, back.evidence);
    expect(merged.basis.interest).toBeCloseTo(0.03, 12);
    expect(merged.benefits[0].amount).toBe(5e7);
    expect(changes.join("\n")).toMatch(/basis\.interest: 2\.5% → 3%/);
    const next = patchYaml(src, merged);
    expect(next).toContain("interest: 3%");
    expect(next).toContain("# 가입나이");                 // 사용자 주석 유지
    expect(yamlToSpec(next).spec).toEqual(merged);
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
