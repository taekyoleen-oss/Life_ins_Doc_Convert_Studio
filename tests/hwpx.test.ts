import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { BASE_RATES_CSV } from "@/lib/base-rates";
import { mergeSpec, yamlToSpec, yamlView } from "@/lib/conditions/yaml";
import { loadFile } from "@/lib/load";
import { computeSpec } from "@/lib/methoddoc/calc";
import { docToDocx, richParts, zipStore } from "@/lib/methoddoc/docx";
import { extractDocx, extractHwpx, hwpEquation, unzip } from "@/lib/methoddoc/extract";
import { withFormulas } from "@/lib/methoddoc/formulas";
import { docToHwpx, hwpScript } from "@/lib/methoddoc/hwpx";
import { parseMethodDoc } from "@/lib/methoddoc/parse";
import { renderMethodDoc, STANDARD_FORMAT } from "@/lib/methoddoc/render";
import { buildPackage } from "@/lib/package";
import { DEFAULT_SAMPLE_ID, SAMPLES, SHARED_SAMPLE_IDS } from "@/lib/samples";
import { attachTables, sampleSheet } from "@/lib/sheet";
import { docTitle, STANDARD_DATE, toStandardHwpx } from "@/lib/standards";

/**
 * 한글(.hwpx) 산출방법서 — Word 와 같은 내용으로 쓰고, 되읽으면 Word 로 읽은 것과 글자까지 같다.
 * 실제 한글 프로그램에서 열리는지는 여기서 볼 수 없다(한글 COM 을 쓰지 않는다) — 구조만 한글이 만든 파일과 맞춘다.
 * `samples/11_한글양식_종신보험_산출방법서.hwpx` 는 사람이 한글에서 열어 볼 견본이다: `HWPX_UPDATE=1` 로 다시 쓴다.
 */
const HWPX = "samples/11_한글양식_종신보험_산출방법서.hwpx";
const IDS = [...new Set([...SHARED_SAMPLE_IDS, DEFAULT_SAMPLE_ID])];
const text = (b?: Uint8Array) => new TextDecoder().decode(b);

/** 조건 + 기본 위험률 표(별첨까지) */
const withTables = (id: string) => {
  const spec = yamlToSpec(SAMPLES.find((s) => s.id === id)!.yaml).spec;
  return { spec, full: attachTables(spec, sampleSheet(spec.rates, BASE_RATES_CSV, "기본 위험률 표")) };
};

/** XML 이 잘 닫혔는지 — 여닫는 꼬리표의 짝만 본다 */
function wellFormed(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.replace(/<\?[^?]*\?>/g, "").matchAll(/<(\/?)([A-Za-z0-9:_.-]+)(?:\s[^<>]*?)?(\/?)>/g)) {
    if (m[3]) continue;
    if (!m[1]) stack.push(m[2]);
    else if (stack.pop() !== m[2]) return false;
  }
  return stack.length === 0 && !/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/.test(xml);
}

describe("한글 수식 스크립트 — 쓴 것을 읽으면 원래 평문 식", () => {
  const eqs = [
    "l_{x+t+1} = l_{x+t} × ( 1 − Q_{x+t} )",
    "Q^{(1)}_{x+t} = min( 1, q_{x+t} + r^{(1)}_{x+t} − q_{x+t}·r^{(1)}_{x+t}/2 )",
    "M_{x+t} = Σ_{u=t}^{n−1} S_u·C_{x+u}",
    "C_{x+t} = d_{x+t}·v^{t+½}",
    "P_base = PVB / ( N′_x − N′_{x+min(n,20)} )",
    "해약공제_t = α^{공제} · max( min(m,7) − t, 0 ) / min(m,7)",
    "G_{10만} = round( G₁ × 100,000 )",
    "E^{체결}_t = if( t < 7, α, α′ )",
    "V_t = [ M_{x+t} − P_β·( N′_{x+t} − N′_{x+m} )·[t≤m] ] / D_{x+t}",
  ];
  for (const eq of eqs) {
    it(eq, () => {
      const script = hwpScript(eq);
      expect(script).not.toMatch(/ /);                                // 빈칸은 모두 ~
      expect(script).not.toMatch(/(^|[^"A-Za-z])[A-Za-z]{2,}(?!")/);    // 두 글자 이상 이름은 따옴표 안에만
      // 읽는 쪽은 한 토막 첨자의 묶음을 뗀다(α_{S} → α_S) — 원문도 같은 모양으로 견준다
      expect(hwpEquation(script).replace(/([_^])\{([A-Za-z0-9가-힣α-ω′*]+)\}/g, "$1$2")).toBe(eq.replace(/([_^])\{([A-Za-z0-9가-힣α-ω′*]+)\}/g, "$1$2"));
    });
  }
  it("한글이 Word 수식을 받아 만든 모양 · 사람이 수식 편집기로 적은 모양도 읽는다", () => {
    expect(hwpEquation(' {{P}} _  {"base"} {~=~}"PVB"{~/~ LEFT (~} {{N′}} _  {{x}} {~−~} {{N′}} _  {{x}{+}{min}{ LEFT (}{n}{,}{20}{ RIGHT )}} {~ RIGHT )}'))
      .toBe("P_{base} = PVB / ( N′_{x} − N′_{x+min (n,20 )} )");      // 빈칸은 식을 견줄 때 무시한다(normFormula)
    expect(hwpEquation(' {"해약공제"} _  {{t}} {~=~} {{α}} ^  {"공제"} {~·~}{max}{ LEFT (~}{0}{~ RIGHT )}')).toBe("해약공제_{t} = α^{공제} · max ( 0 )");
    expect(hwpEquation("N _{x} = sum _{u=0} ^{n-1} D _{x+u} times left ( 1 - lambda right )")).toBe("N_{x} = Σ_{u=0}^{n-1} D_{x+u} × ( 1 - λ )");
    expect(hwpEquation('"sum" + "it" + alpha')).toBe("sum + it + α");   // 따옴표 안은 글자 그대로
  });
  it("표 칸 글의 여러 글자 기호도 첨자로 — r80_{x+t} (한글에서 연 위험률 합성 표에서 글자 그대로 보였다)", () => {
    expect(richParts("q_{x+t} + r80_{x+t} · rc_x")).toEqual([
      { t: "q" }, { t: "x+t", v: "sub" }, { t: " + " }, { t: "r80" }, { t: "x+t", v: "sub" }, { t: " · " }, { t: "rc" }, { t: "x", v: "sub" },
    ]);
    expect(richParts("α_P는 그대로")).toEqual([{ t: "α" }, { t: "P", v: "sub" }, { t: "는 그대로" }]);
  });
});

describe("한글(.hwpx) 산출방법서 — 쓰기 · 되읽기", () => {
  for (const id of IDS) {
    const { spec, full } = withTables(id);
    const sections = renderMethodDoc(withFormulas(full));
    const bytes = docToHwpx(sections, docTitle(full), { guide: ["작성 안내 한 줄"] });

    it(`${id} — 묶음 구조: mimetype 이 첫 항목(무압축) · 필수 파일 · XML 이 잘 닫힘`, async () => {
      expect(text(bytes.subarray(30, 38))).toBe("mimetype");
      expect(bytes[8] | (bytes[9] << 8)).toBe(0);                       // 압축 방식 0 = 그대로
      expect(bytes[6] | (bytes[7] << 8)).toBe(0);                       // 일반 표시 0 — 한글이 만든 파일과 같게(UTF-8 이름 표시 없음)
      expect(text(bytes.subarray(38, 38 + 19))).toBe("application/hwp+zip");
      const files = await unzip(bytes);
      for (const f of ["mimetype", "version.xml", "settings.xml", "Contents/header.xml", "Contents/section0.xml", "Contents/content.hpf", "META-INF/container.xml", "META-INF/container.rdf", "META-INF/manifest.xml", "Preview/PrvText.txt"])
        expect(files.has(f), f).toBe(true);
      for (const [name, data] of files) if (name.endsWith(".xml") || name.endsWith(".hpf") || name.endsWith(".rdf")) expect(wellFormed(text(data)), name).toBe(true);
      const sec = text(files.get("Contents/section0.xml")), head = text(files.get("Contents/header.xml"));
      // 가리키는 글자 모양 · 문단 모양 · 테두리가 모두 header.xml 에 있다
      const has = (tag: string, n: string) => new RegExp(`<hh:${tag}\\b[^>]*\\bid="${n}"`).test(head);
      for (const m of sec.matchAll(/charPrIDRef="(\d+)"/g)) expect(has("charPr", m[1]), `charPr ${m[1]}`).toBe(true);
      for (const m of sec.matchAll(/paraPrIDRef="(\d+)"/g)) expect(has("paraPr", m[1]), `paraPr ${m[1]}`).toBe(true);
      for (const m of sec.matchAll(/borderFillIDRef="(\d+)"/g)) expect(has("borderFill", m[1]), `borderFill ${m[1]}`).toBe(true);
      // 표마다 줄·칸 수가 실제 칸과 맞다
      for (const t of sec.matchAll(/<hp:tbl\b[^>]*rowCnt="(\d+)" colCnt="(\d+)"[\s\S]*?<\/hp:tbl>/g)) {
        expect(t[0].split("<hp:tr>").length - 1).toBe(Number(t[1]));
        expect(t[0].split("<hp:tc ").length - 1).toBe(Number(t[1]) * Number(t[2]));
      }
      expect(sec).toMatch(/<hp:equation\b[^>]*>[\s\S]*?<hp:script[^>]*>[^<]+<\/hp:script>/);   // 식 줄은 한글 수식 개체
    });

    it(`${id} — 되읽으면 Word 로 읽은 것과 문단 · 표가 글자까지 같다`, async () => {
      const h = await extractHwpx(bytes), w = await extractDocx(docToDocx(sections, docTitle(full), { guide: ["작성 안내 한 줄"] }));
      expect(h.kind).toBe("hwpx");
      expect(h.paragraphs).toEqual(w.paragraphs);
      expect(h.tables).toEqual(w.tables);
    });

    it(`${id} — 한글로 읽은 조건 = Word 로 읽은 조건 = 원래 조건, 반영할 것이 없다`, async () => {
      const h = parseMethodDoc(await extractHwpx(bytes)), w = parseMethodDoc(await extractDocx(docToDocx(sections, docTitle(full))));
      expect(h.format).toBe(STANDARD_FORMAT);
      expect(h.warnings).toEqual(w.warnings);
      expect(yamlView(h.spec)).toEqual(yamlView(w.spec));
      expect(yamlView(h.spec)).toEqual(yamlView(spec));
      expect(mergeSpec(spec, h.spec, h.evidence, { standard: true }).changes).toEqual([]);
    });
  }

  it("칸 하나(예정이율)를 한글에서 고치면 그 칸만 바뀐다", async () => {
    const { spec, full } = withTables("whole");
    const files = await unzip(toStandardHwpx(full));
    const was = `${(spec.basis.interest! * 100).toFixed(3)}%`;
    const sec = text(files.get("Contents/section0.xml"));
    expect(sec.split(`<hp:t>${was}</hp:t>`).length - 1).toBe(1);
    const edited = zipStore([...files].map(([n, d]) => [n, n === "Contents/section0.xml" ? new TextEncoder().encode(sec.replace(`<hp:t>${was}</hp:t>`, "<hp:t>3.125%</hp:t>")) : d]));
    const r = parseMethodDoc(await extractHwpx(edited));
    const m = mergeSpec(spec, r.spec, r.evidence, { standard: true });
    expect(m.changes).toHaveLength(1);
    expect(m.changes[0]).toMatch(/3\.125/);
    expect(m.spec.basis.interest).toBeCloseTo(0.03125, 10);
    expect(yamlView({ ...m.spec, basis: { ...m.spec.basis, interest: spec.basis.interest } })).toEqual(yamlView(spec));
  });

  it("식 한 줄을 한글 수식 편집기로 고치면 그 식만 조건에 들어간다", async () => {
    const { spec, full } = withTables("whole");
    const files = await unzip(toStandardHwpx(full));
    const sec = text(files.get("Contents/section0.xml"));
    const script = [...sec.matchAll(/<hp:script[^>]*>([^<]*)<\/hp:script>/g)].map((m) => m[1]).find((s) => s.startsWith("P~=~"))!;
    expect(script).toBeTruthy();
    // 사람이 수식 편집기에서 다시 적은 모양 — 빈칸 · TIMES · LEFT/RIGHT
    const edited = zipStore([...files].map(([n, d]) => [n, n === "Contents/section0.xml" ? new TextEncoder().encode(sec.replace(`>${script}<`, ">P = 1.01 TIMES LEFT ( PVB / N* RIGHT )<")) : d]));
    const r = parseMethodDoc(await extractHwpx(edited));
    const m = mergeSpec(spec, r.spec, r.evidence, { standard: true });
    expect(m.changes.join(" ")).toMatch(/formulas/);
    expect(m.spec.formulas.map((f) => f.text.replace(/\s/g, ""))).toContain("P=1.01×(PVB/N*)");
  });

  it("[불러오기] 로 연 한글 파일 — 표준 양식 · 별첨 위험률 표 · 종신보험 월 250,000원", async () => {
    const { full } = withTables("whole");
    const r = await loadFile(new File([toStandardHwpx(full) as BlobPart], "종신보험_산출방법서.hwpx"));
    expect(r.original?.doc.kind).toBe("hwpx");
    expect(r.message).toContain(STANDARD_FORMAT);
    const back = yamlToSpec(r.yaml);
    expect(back.errors).toEqual([]);
    const calc = computeSpec(attachTables(back.spec, r.sheet ?? null), { age: 40, sex: "M", payYears: 20, freq: 12, sumAssured: 1e8 });
    expect(calc.errors).toEqual([]);
    expect(calc.missingRates).toEqual([]);
    expect(calc.premium).toBe(250000);
  }, 60000);

  it("패키지 — 설정이 한글 중심이면 산출방법서.hwpx, 아니면 .docx", async () => {
    const { spec, full } = withTables("whole");
    const yaml = SAMPLES.find((s) => s.id === "whole")!.yaml;
    const names = async (docFormat?: "word" | "hwp") => [...(await unzip(buildPackage({ yaml, sheet: null, spec: full, docFormat }))).keys()];
    expect(await names("hwp")).toEqual(["package.json", "조건.yaml", "MethodSpec.json", "산출방법서.md", "산출방법서.hwpx"]);
    expect(await names()).toContain("산출방법서.docx");
    const inner = (await unzip(buildPackage({ yaml, sheet: null, spec: full, docFormat: "hwp" }))).get("산출방법서.hwpx")!;
    expect(yamlView(parseMethodDoc(await extractHwpx(inner)).spec)).toEqual(yamlView(spec));
  });
});

describe(`견본 ${HWPX}`, () => {
  const { spec, full } = withTables("whole");
  const dated = { ...full, meta: { ...full.meta, date: full.meta.date ?? STANDARD_DATE } };
  const bytes = toStandardHwpx(dated, true, new Date("2026-11-13T00:00:00Z"));
  if (process.env.HWPX_UPDATE) writeFileSync(HWPX, bytes);

  it.runIf(existsSync(HWPX))("지금 양식으로 만든 것과 같고(HWPX_UPDATE=1 로 다시 쓴다), 되읽으면 종신보험 조건", async () => {
    const file = new Uint8Array(readFileSync(HWPX));
    expect(Buffer.from(file).equals(Buffer.from(bytes))).toBe(true);
    const r = parseMethodDoc(await extractHwpx(file));
    expect(r.format).toBe(STANDARD_FORMAT);
    expect(yamlView(r.spec)).toEqual(yamlView({ ...spec, meta: { ...spec.meta, date: dated.meta.date } }));
  });
});
