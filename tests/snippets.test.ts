import { describe, expect, it } from "vitest";
import katex from "katex";
import { formulaToTex, latexToDoc } from "@/lib/methoddoc/tex";
import { FORMULA_SAMPLES, PIECES, SYMBOLS, formulaSnippet, inlineSnippet } from "@/lib/snippets";

const render = (tex: string) => katex.renderToString(tex, { displayMode: true, throwOnError: true, strict: "ignore" });

describe("수식·기호 견본", () => {
  it("모든 산출식 견본이 KaTeX 로 그려진다", () => {
    for (const f of FORMULA_SAMPLES) expect(() => render(formulaToTex(f.text)), f.label).not.toThrow();
  });
  it("기호·조각은 LaTeX 명령으로 바뀌고 그려진다", () => {
    expect(inlineSnippet("latex", "α")).toBe("\\alpha");
    expect(inlineSnippet("markdown", "α")).toBe("α");
    for (const s of [...SYMBOLS, ...PIECES.map((p) => p.text)]) expect(() => render(`x ${inlineSnippet("latex", s)} y`), s).not.toThrow();
  });
  it("LaTeX 탭에는 align* 블록, Markdown 탭에는 코드 블록 — 되읽으면 같은 식이다", () => {
    const f = FORMULA_SAMPLES.find((x) => x.label === "탈퇴 사유 2개")!;
    const tex = formulaSnippet("latex", f.text);
    expect(tex).toMatch(/^\\begin\{align\*\}/);
    const bare = (s: string) => s.replace(/\s+/g, "");      // 되읽기는 × 뒤 공백을 붙인다
    expect(latexToDoc(`\\begin{document}\n${tex}\\end{document}`).paragraphs.map(bare)).toContain(bare(f.text));
    expect(formulaSnippet("markdown", f.text)).toBe(`\`\`\`\n${f.text}\n\`\`\`\n`);
  });
});
