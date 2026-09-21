import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { extractDocx, type ExtractedDoc } from "@/lib/methoddoc/extract";
import { parseMethodDoc } from "@/lib/methoddoc/parse";
import { STANDARD_FORMAT } from "@/lib/methoddoc/render";
import { estimate, pagesToDoc, readPage, transcribe, type PageImage, type PageText, type VisionAsk } from "@/lib/methoddoc/vision";
import { yamlView } from "@/lib/conditions/yaml";
import { STANDARDS, standardSpec, toStandardDocx } from "@/lib/standards";

/**
 * 그림 → 글 → 조건. 실제 API 는 부르지 않는다 — 모델이 쪽을 제대로 옮겨 적었다고 치고(가짜 ask),
 * 그 글이 글자 있는 문서와 똑같이 조건이 되는지 본다. 모델은 옮겨 적기만, 해석은 규칙이.
 */
const file = (frag: string) => `samples/${readdirSync("samples").find((f) => f.normalize("NFC").includes(frag))!}`;

/** 추출 문서를 두 쪽으로 나눠 "모델이 옮겨 적은 결과" 모양으로 */
function asPages(d: ExtractedDoc): PageText[] {
  const half = Math.ceil(d.paragraphs.length / 2);
  const text = (ps: string[]) => ps.map((t) => ({ kind: "text" as const, text: t, rows: [] }));
  const tables = d.tables.map((t) => ({ kind: "table" as const, text: "", rows: [t.head, ...t.rows] }));
  return [
    { blocks: [...text(d.paragraphs.slice(0, half)), ...tables.slice(0, 1)], unreadable: "" },
    { blocks: [...text(d.paragraphs.slice(half)), ...tables.slice(1)], unreadable: "오른쪽 아래 도장" },
  ];
}
const img = (page: number): PageImage => ({ page, mediaType: "image/jpeg", base64: "", width: 1414, height: 2000 });
/** 쪽마다 늦게·빠르게 답하는 가짜 모델 — 순서가 섞여도 쪽 순서를 지키는지 */
const fakeAsk = (pages: PageText[]): VisionAsk => async (im) => {
  await new Promise((r) => setTimeout(r, im.page === 1 ? 30 : 1));
  return JSON.parse(JSON.stringify(pages[im.page - 1]));
};

describe("그림으로 읽기 (옮겨 적기 → 규칙)", () => {
  it("옮겨 적은 글은 글자 있는 문서와 같은 조건이 된다 — 02 실무양식", async () => {
    const d = await extractDocx(new Uint8Array(readFileSync(file("02_실무양식_든든건강보험_산출방법서.docx"))));
    const pages = asPages(d);
    const got = await transcribe([img(1), img(2)], fakeAsk(pages));
    expect(got.warnings).toContain("2쪽 읽지 못한 곳: 오른쪽 아래 도장");
    expect(yamlView(parseMethodDoc(got).spec)).toEqual(yamlView(parseMethodDoc(d).spec));
  });
  it("표준 산출방법서를 스캔한 것도 식까지 읽는다", async () => {
    const s = STANDARDS[0];
    const d = await extractDocx(toStandardDocx(standardSpec(s)));
    const r = parseMethodDoc(await transcribe([img(1), img(2)], fakeAsk(asPages(d))));
    expect(r.format).toBe(STANDARD_FORMAT);
    expect(yamlView(r.spec)).toEqual(yamlView(standardSpec(s)));
  });
  it("모양이 틀린 응답은 거르고, 빈 칸·빈 표는 버린다", () => {
    expect(() => readPage({ text: "x" })).toThrow(/blocks/);
    const p = readPage({ blocks: [{ kind: "text", text: "  ", rows: [] }, { kind: "table", text: "", rows: [] }, { kind: "weird", text: "가", rows: [] }, null], unreadable: 3 });
    expect(p).toEqual({ blocks: [{ kind: "text", text: "가", rows: [] }], unreadable: "" });
    // 칸 수가 다른 행은 빈 칸으로 맞춘다
    const doc = pagesToDoc([{ page: 1, text: { blocks: [{ kind: "table", text: "", rows: [["구분", "값"], ["이율"]] }], unreadable: "" } }]);
    expect(doc.tables[0]).toEqual({ head: ["구분", "값"], rows: [["이율", ""]] });
  });
  it("멈추면 더 보내지 않는다", async () => {
    const ac = new AbortController();
    let sent = 0;
    const ask: VisionAsk = async () => { sent++; ac.abort(); return { blocks: [], unreadable: "" }; };
    await expect(transcribe([img(1), img(2), img(3)], ask, { concurrency: 1, signal: ac.signal })).rejects.toThrow(/취소/);
    expect(sent).toBe(1);
  });
  it("비용 어림 — A4 한 쪽(긴 변 2000px)은 약 $0.07", () => {
    const e = estimate([{ width: 1414, height: 2000 }]);
    expect(e.usd).toBeGreaterThan(0.05);
    expect(e.usd).toBeLessThan(0.09);
  });
});
