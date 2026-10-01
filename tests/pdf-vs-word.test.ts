import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadFile } from "@/lib/load";
import { yamlToSpec, yamlView } from "@/lib/conditions/yaml";
import { computeSpec } from "@/lib/methoddoc/calc";
import { STANDARD_FORMAT } from "@/lib/methoddoc/render";
import { BASE_RATES_CSV } from "@/lib/base-rates";
import { DEFAULT_SAMPLE_ID, SAMPLES } from "@/lib/samples";
import { attachTables, sampleSheet } from "@/lib/sheet";
import { toStandardDocx } from "@/lib/standards";
import type { MethodSpec } from "@/lib/methoddoc/spec";

/**
 * PDF 로 가져와도 Word 와 똑같이 조건이 되고 보험료까지 나오는지.
 *
 * `samples/10_기본상품_종신보험(암진단포함)_산출방법서.docx` 는 기본 상품의 표준 산출방법서(별첨 위험률 표 포함)이고,
 * `.pdf` 는 **같은 .docx 를 Word 로 PDF 내보낸 것**이다 — 한 문서를 두 양식으로 둔 셈이라 읽은 결과가 같아야 한다.
 * 다시 만들 때: `DOCS_UPDATE=1 node node_modules/vitest/vitest.mjs run tests/pdf-vs-word.test.ts` 로 .docx 를 쓰고,
 * `powershell -File scripts/make-sample-pdf.ps1` 로 .pdf 를 만든다(Word COM).
 */
const DOCX = "samples/10_기본상품_종신보험(암진단포함)_산출방법서.docx";
const PDF = "samples/10_기본상품_종신보험(암진단포함)_산출방법서.pdf";

const sample = SAMPLES.find((s) => s.id === DEFAULT_SAMPLE_ID)!;
const cond = yamlToSpec(sample.yaml);
const base = attachTables(cond.spec, sampleSheet(cond.spec.rates, BASE_RATES_CSV, "기본 위험률 표"));
const bytes = toStandardDocx(base, false);              // 작성 안내 없이 — 문서 자체만
if (process.env.DOCS_UPDATE || !existsSync(DOCX)) writeFileSync(DOCX, bytes);

/** [열기] 와 같은 길로 읽고, 별첨 위험률 표를 조건에 붙여 보험료까지 낸다 */
async function open(path: string) {
  const r = await loadFile(new File([readFileSync(path)], path.split("/").pop()!));
  const { spec, errors } = yamlToSpec(r.yaml);
  const withTables = attachTables(spec, r.sheet ?? null);
  return { ...r, spec, errors, withTables, calc: computeSpec(withTables, { age: 40, sex: "M" as const, payYears: 20, freq: 12, sumAssured: 1e8 }) };
}

/** 보험료에 쓰이는 값만 — 표 없는 조건끼리 견주려고 */
const premiumInputs = (s: MethodSpec) => ({
  interest: s.basis.interest,
  waiverRateIds: s.basis.waiverRateIds,
  rates: s.rates.map((r) => [r.id, r.name, r.role]),
  benefits: s.benefits.map((b) => [b.name, b.role, b.multiple, b.amount, b.endAge, b.waitDays, b.waitPayRatio, b.rateId, b.exitRateIds]),
  expenses: s.expenses.map((e) => [e.symbol, e.basis, e.rate, e.times, e.phase]),
});

describe("PDF 로 가져오기 = Word 로 가져오기 (기본 상품 표준 산출방법서)", () => {
  it(`${DOCX} — 지금 양식으로 만든 것과 같다 (DOCS_UPDATE=1 로 다시 쓴다)`, () => {
    expect(Buffer.from(readFileSync(DOCX)).equals(Buffer.from(bytes))).toBe(true);
  });

  it("Word: 표준 양식으로 읽고, 별첨 위험률 표를 붙여 10만원당 261·162 · 월 342,000원", async () => {
    const w = await open(DOCX);
    expect(w.original?.doc.kind).toBe("docx");
    expect(w.message).toContain(STANDARD_FORMAT);
    expect(w.errors).toEqual([]);
    expect(w.sheet!.sheet.head).toEqual(["연령", "사망률(남)", "사망률(여)", "80% 이상 장해율(남)", "80% 이상 장해율(여)", "암발생률(남)", "암발생률(여)"]);
    expect(w.calc.errors).toEqual([]);
    expect(w.calc.missingRates).toEqual([]);
    expect(w.calc.benefits.map((b) => b.per100k)).toEqual([261, 162]);
    expect(w.calc.premium).toBe(342000);
  }, 60000);

  it.runIf(existsSync(PDF))("PDF: 같은 문서를 PDF 로 가져와도 같은 조건 · 같은 보험료", async () => {
    const [w, p] = [await open(DOCX), await open(PDF)];
    expect(p.original?.doc.kind).toBe("pdf");
    expect(p.message).toContain(STANDARD_FORMAT);                  // 표준 양식으로 알아본다
    expect(p.errors).toEqual([]);
    expect(premiumInputs(p.withTables)).toEqual(premiumInputs(w.withTables));
    expect(p.sheet!.sheet.head).toEqual(w.sheet!.sheet.head);      // 별첨 위험률 표도 그대로
    expect(p.sheet!.sheet.rows).toEqual(w.sheet!.sheet.rows);
    expect(p.calc.errors).toEqual([]);
    expect(p.calc.missingRates).toEqual([]);
    expect(p.calc.benefits.map((b) => b.per100k)).toEqual([261, 162]);
    expect(p.calc.premium).toBe(342000);
  }, 120000);

  it.runIf(existsSync(PDF))("PDF 와 Word 의 조건이 글자까지 같다 (식·절·주석 포함)", async () => {
    const [w, p] = [await open(DOCX), await open(PDF)];
    expect(yamlView(p.spec)).toEqual(yamlView(w.spec));
  }, 120000);
});
