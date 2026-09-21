import { describe, expect, it } from "vitest";
import { SAMPLES } from "@/lib/samples";
import { mergeSpec, yamlToSpec, yamlView } from "@/lib/conditions/yaml";
import { withFormulas } from "@/lib/methoddoc/formulas";
import { docToMarkdown, renderMethodDoc, STANDARD_FORMAT } from "@/lib/methoddoc/render";
import { docToLatex, latexToDoc } from "@/lib/methoddoc/tex";
import { docToDocx, splitEquations, zipStore } from "@/lib/methoddoc/docx";
import { extractDocx, extractHwpx, extractText, hwpEquation, type ExtractedDoc } from "@/lib/methoddoc/extract";
import { parseMethodDoc } from "@/lib/methoddoc/parse";
import type { MethodSpec } from "@/lib/methoddoc/spec";

/**
 * 표준 산출방법서 왕복 — 조건 → (Word · Markdown · LaTeX) → 되읽기 → 같은 조건.
 * 수식은 자동으로 만든 것과 같으면 조건에 싣지 않고, 고친 식·새 식만 싣는다.
 */
const title = (s: MethodSpec) => `${s.meta.productName} 보험료 및 책임준비금 산출방법서`;
const FORMATS: [string, (s: MethodSpec) => Promise<ExtractedDoc>][] = [
  ["Word", async (s) => extractDocx(docToDocx(renderMethodDoc(withFormulas(s)), title(s)))],
  ["Markdown", async (s) => extractText(new TextEncoder().encode(docToMarkdown(renderMethodDoc(withFormulas(s)), title(s))))],
  ["LaTeX", async (s) => latexToDoc(docToLatex(renderMethodDoc(withFormulas(s)), title(s)))],
];
const WITH_EXTRAS = (base: MethodSpec): MethodSpec => ({
  ...base,
  meta: { ...base.meta, insurer: "가나다생명", version: "2026-1", note: "표준 양식 시험" },
  reserve: { notes: ["책임준비금은 표준이율로 계산한 금액 이상으로 적립한다."] },
  surrender: { deductionYears: 10, notes: ["해지환급금은 0 미만이 되지 않는다."] },
  // 문서 순서(절 순서)로 둔다 — 되읽으면 이 순서로 나온다
  formulas: [
    { section: "계산기수", label: "새 기수", text: "M_{x+t} = Σ_{u≥t} C_{x+u}" },
    { section: "보험료의 계산", label: "영업보험료", text: "G = [ P + α_S·D′_x/N* ] / ( 1 − β_G )", note: "사업비를 줄인 시험용 식" },
  ],
  sections: [{ title: "기타 사항", paragraphs: ["이 상품은 시험용이다.", "둘째 문단."] }],
});

const x = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
/** 읽은 문단·표로 HWPX(한글) 파일을 만든다. at 번째 문단은 한글 수식 편집기 식(hp:script)으로 바꾼다 */
function toHwpx(d: ExtractedDoc, at = -1, script = ""): Uint8Array {
  const p = (t: string, i: number) => `<hp:p><hp:run>${i === at ? `<hp:equation><hp:script>${x(script)}</hp:script></hp:equation>` : `<hp:t>${x(t)}</hp:t>`}</hp:run></hp:p>`;
  const tbl = (t: ExtractedDoc["tables"][number]) => `<hp:p><hp:run><hp:tbl>${[t.head, ...t.rows].map((r) => `<hp:tr>${r.map((c) => `<hp:tc><hp:subList><hp:p><hp:run><hp:t>${x(c)}</hp:t></hp:run></hp:p></hp:subList></hp:tc>`).join("")}</hp:tr>`).join("")}</hp:tbl></hp:run></hp:p>`;
  const xml = `<?xml version="1.0"?><hs:sec xmlns:hs="s" xmlns:hp="p">${d.paragraphs.map(p).join("")}${d.tables.map(tbl).join("")}</hs:sec>`;
  return zipStore([["mimetype", new TextEncoder().encode("application/hwp+zip")], ["Contents/section0.xml", new TextEncoder().encode(xml)]]);
}

describe("수식 편집기로 적은 식", () => {
  it("Word 수식(OMML)과 글자 서식 첨자를 평문 표기로 읽는다", async () => {
    const W = `<w:document xmlns:w="w" xmlns:m="m"><w:body>` +
      `<w:p><w:r><w:t xml:space="preserve">P = </w:t></w:r><m:oMath><m:f><m:num><m:r><m:t>PVB</m:t></m:r></m:num><m:den><m:sSub><m:e><m:r><m:t>N</m:t></m:r></m:e><m:sub><m:r><m:t>x</m:t></m:r></m:sub></m:sSub></m:den></m:f></m:oMath></w:p>` +
      `<w:p><m:oMath><m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub><m:r><m:t>u≥t</m:t></m:r></m:sub><m:sup/><m:e><m:r><m:t>D</m:t></m:r></m:e></m:nary></m:oMath></w:p>` +
      // 한 첨자 "x+t" 가 두 런으로 쪼개진 경우
      `<w:p><w:r><w:t>l</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>x</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>+t</w:t></w:r><w:r><w:t xml:space="preserve"> v</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>t</w:t></w:r></w:p>` +
      `</w:body></w:document>`;
    const d = await extractDocx(zipStore([["word/document.xml", new TextEncoder().encode(W)]]));
    expect(d.paragraphs).toEqual(["P = (PVB)/(N_{x})", "∑_{u≥t}D", "l_{x+t} v^{t}"]);
  });
  it("Word 에서는 한 줄의 식 둘을 두 줄로 쓴다 (제목 낱말은 그대로)", () => {
    expect(splitEquations("P = PVB / N*        P_base = PVB / N′")).toEqual(["P = PVB / N*", "P_base = PVB / N′"]);
    expect(splitEquations("유지자수  l_{x+t+1} = l_{x+t}")).toEqual(["유지자수  l_{x+t+1} = l_{x+t}"]);
    expect(splitEquations("급부  C = l·g        (g : 입원일수)")).toEqual(["급부  C = l·g  (g : 입원일수)"]);
  });
  it("한글 수식 스크립트를 평문 표기로 읽는다", () => {
    expect(hwpEquation("l _{x+t+1} = l _{x+t} TIMES LEFT ( 1 - q _{x+t} RIGHT )")).toBe("l_{x+t+1} = l_{x+t} × ( 1 - q_{x+t} )");
    expect(hwpEquation("P = {PVB} over {N prime _{x}}")).toBe("P = (PVB)/(N′_{x})");
  });
});

describe("표준 산출방법서 왕복", () => {
  for (const sample of SAMPLES) {
    const spec = yamlToSpec(sample.yaml).spec;
    for (const [fmt, make] of FORMATS) {
      it(`${sample.label} — ${fmt}`, async () => {
        const r = parseMethodDoc(await make(spec));
        expect(r.format).toBe(STANDARD_FORMAT);
        expect(yamlView(r.spec)).toEqual(yamlView(spec));
      });
    }
  }
  const extra = WITH_EXTRAS(yamlToSpec(SAMPLES[0].yaml).spec);
  for (const [fmt, make] of FORMATS) {
    it(`고친 식 · 새 식 · 준비금·환급금 주석 · 회사·판·비고 · 원문 절 — ${fmt}`, async () => {
      const r = parseMethodDoc(await make(extra));
      expect(yamlView(r.spec)).toEqual(yamlView(extra));
    });
  }
  it("한글(HWPX) — 식 한 줄을 한글 수식 편집기로 고쳐도 읽는다", async () => {
    const d = await FORMATS[0][1](extra);
    const at = d.paragraphs.findIndex((p) => p.startsWith("G = [ P + α_S"));
    const hwpx = toHwpx(d, at, "G = LEFT [ P + alpha _{S} CDOT D prime _{x} / N* RIGHT ] / LEFT ( 1 - beta _{G} - gamma RIGHT )");
    const r = parseMethodDoc(await extractHwpx(hwpx));
    expect(r.format).toBe(STANDARD_FORMAT);
    const flat = (s?: string) => s?.replace(/\s/g, "");
    expect(flat(r.spec.formulas.find((f) => f.label === "영업보험료")?.text)).toBe("G=[P+α_{S}·D′_{x}/N*]/(1-β_{G}-γ)");
    expect(yamlView({ ...r.spec, formulas: extra.formulas })).toEqual(yamlView(extra));
  });
  it("[조건에 반영] 은 식·주석까지 옮긴다", async () => {
    const base = yamlToSpec(SAMPLES[0].yaml).spec;
    const r = parseMethodDoc(await FORMATS[0][1](extra));
    const { spec, changes } = mergeSpec(base, r.spec, r.evidence);
    expect(yamlView(spec)).toEqual(yamlView(extra));
    expect(changes.join(" ")).toMatch(/formulas/);
  });
});
