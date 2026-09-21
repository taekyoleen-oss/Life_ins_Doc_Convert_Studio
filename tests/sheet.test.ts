import { describe, expect, it } from "vitest";
import { attachTables, autoMap, baseName, cellNum, guessRole, parseDelimited, pickColumn, readXlsx, sanitizeSheet, sexOf, sheetFromSpec, sheetFromText } from "@/lib/sheet";
import { yamlToSpec } from "@/lib/conditions/yaml";
import { renderMethodDoc } from "@/lib/methoddoc/render";
import { SAMPLES } from "@/lib/samples";

const PASTE = "연령\t사망률(남)\t사망률(여)\t80% 이상 장해율\t암발생률_여\n40\t0.00100\t0.00050\t1.2‰\t0.3%\n41\t0.00110\t0.00060\t1.3‰\t0.31%\n";

describe("스프레드시트 읽기", () => {
  it("CSV 따옴표·쉼표·줄바꿈, Excel 붙여넣기(TSV)", () => {
    expect(parseDelimited('a,"b,c"\r\n1,"x ""y"""\n\n2,"줄\n바꿈"')).toEqual([["a", "b,c"], ["1", 'x "y"'], ["2", "줄\n바꿈"]]);
    const s = sheetFromText("붙여넣기", PASTE);
    expect(s.head).toEqual(["연령", "사망률(남)", "사망률(여)", "80% 이상 장해율", "암발생률_여"]);
    expect(s.rows).toHaveLength(2);
  });
  it("값 표기: 소수·%·‰·천 단위 쉼표·세", () => {
    expect(cellNum("0.00123")).toBe(0.00123);
    expect(cellNum("1.5%")).toBeCloseTo(0.015, 12);
    expect(cellNum("2‰")).toBe(0.002);
    expect(cellNum("1,234")).toBe(1234);
    expect(cellNum("40세")).toBe(40);
    expect(cellNum("1.2E-3")).toBe(0.0012);
    expect(cellNum("—")).toBeNull();
  });
  it("열 이름에서 성별·이름·유형을 읽는다", () => {
    expect([sexOf("사망률(남)"), sexOf("암발생률_여"), sexOf("q_M"), sexOf("f_x")]).toEqual(["M", "F", "M", undefined]);
    expect([baseName("사망률(남)"), baseName("암발생률_여"), baseName("남자 사망률"), baseName("q M")]).toEqual(["사망률", "암발생률", "사망률", "q"]);
    expect([guessRole("사망률"), guessRole("암입원 기대일수"), guessRole("납입면제율"), guessRole("암발생률")]).toEqual(["death", "recurring", "waiver", "incidence"]);
  });
  it("XLSX 첫 시트를 SheetJS 없이 읽는다 (공유 문자열·빈 칸)", async () => {
    const rows = await readXlsx(zipStored({
      "xl/workbook.xml": '<workbook><sheets><sheet name="위험률" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/sharedStrings.xml": "<sst><si><t>연령</t></si><si><r><t>사망률</t></r><r><t>(남)</t></r></si></sst>",
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
        + '<row r="2"><c r="A2"><v>40</v></c><c r="B2"><v>1.2E-3</v></c></row><row r="3"><c r="A3"><v>41</v></c><c r="B3" s="1"/><c r="C3" t="inlineStr"><is><t>a&amp;b</t></is></c></row></sheetData></worksheet>',
    }));
    expect(rows).toEqual([["연령", "사망률(남)"], ["40", "1.2E-3"], ["41", "", "a&b"]]);
  });
});

describe("열 → 조건 → 산출방법서", () => {
  const { spec } = yamlToSpec(SAMPLES[0].yaml);   // 종신: q(사망률) · k80(80% 이상 장해율), 남자
  const sheet = sheetFromText("붙여넣기", PASTE);
  const map = autoMap(sheet, spec.rates);

  it("연령 열과 이름이 겹치는 위험률을 먼저 잇고, 없는 것은 비워 둔다", () => {
    expect(map).toEqual([
      { to: "age" },
      { to: "rate", rateId: "q", sex: "M" },
      { to: "rate", rateId: "q", sex: "F" },
      { to: "rate", rateId: "k80" },
      { to: "skip" },
    ]);
  });
  it("계약 성별의 열을 RateRef.table 로 붙인다 — 자유설계보험 위험률 시트가 받는 모양", () => {
    const st = { sheet, map };
    expect(pickColumn(st, "q", "F")).toBe(2);
    const m = attachTables(spec, st);
    expect(m.rates[0].table).toEqual({ ages: [40, 41], values: [0.001, 0.0011], sex: "M" });
    expect(m.rates[1].table?.values[0]).toBeCloseTo(0.0012, 12);
    const f = attachTables({ ...spec, contract: { ...spec.contract, sex: "F" } }, st);
    expect(f.rates[0].table?.values).toEqual([0.0005, 0.0006]);
    const rows = renderMethodDoc(m).flatMap((s) => s.blocks).flatMap((b) => (b.t === "table" ? b.rows : []));
    expect(rows.some((r) => r[0] === "제7회 경험생명표 사망률" && r[3] === "40~41세 2행")).toBe(true);
  });
  it("JSON 의 위험률 표 → 위험률 표 창 → 다시 붙이면 같은 표 (자유설계보험 JSON 을 열 때)", () => {
    const withT = { ...spec, rates: [
      { ...spec.rates[0], id: "t1:r1", table: { ages: [40, 41, 42], values: [0.00103, 0.00112, 1.2e-7], sex: "M" as const } },
      { ...spec.rates[1], id: "t1:r2", table: { ages: [41, 42], values: [0.0013, 0.0014] } },
    ] };
    const st = sheetFromSpec(withT, "a.json")!;
    expect(st.sheet.head).toEqual(["연령", "제7회 경험생명표 사망률(남)", "80% 이상 장해율"]);
    expect(st.sheet.rows[0]).toEqual(["40", "0.00103", ""]);
    const bare = { ...withT, rates: withT.rates.map((r) => ({ ...r, table: undefined })) };
    expect(attachTables(bare, st).rates.map((r) => r.table)).toEqual(withT.rates.map((r) => r.table));
    expect(sheetFromSpec(spec, "x")).toBeNull();
  });
  it("연령 열이 없거나 저장본이 어긋나면 표를 붙이지 않는다", () => {
    expect(attachTables(spec, { sheet, map: map.map(() => ({ to: "skip" as const })) })).toBe(spec);
    expect(sanitizeSheet({ sheet: { head: ["a"], rows: "x" }, map: [] })).toBeNull();
    expect(sanitizeSheet({ sheet, map: [{ to: "rate" }] })?.map).toEqual(sheet.head.map(() => ({ to: "skip" })));
  });
});

/** 압축하지 않은(stored) ZIP — 시험용 XLSX 를 손으로 만든다 */
function zipStored(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder(), local: number[] = [], central: number[] = [];
  const u16 = (a: number[], v: number) => a.push(v & 255, (v >> 8) & 255);
  const u32 = (a: number[], v: number) => { u16(a, v & 0xffff); u16(a, v >>> 16); };
  let count = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name), d = enc.encode(text), at = local.length;
    u32(local, 0x04034b50); u16(local, 20); u16(local, 0); u16(local, 0); u32(local, 0); u32(local, 0);
    u32(local, d.length); u32(local, d.length); u16(local, n.length); u16(local, 0); local.push(...n, ...d);
    u32(central, 0x02014b50); u16(central, 20); u16(central, 20); u16(central, 0); u16(central, 0); u32(central, 0); u32(central, 0);
    u32(central, d.length); u32(central, d.length); u16(central, n.length); u16(central, 0); u16(central, 0); u16(central, 0); u16(central, 0);
    u32(central, 0); u32(central, at); central.push(...n);
    count++;
  }
  const end: number[] = [];
  u32(end, 0x06054b50); u16(end, 0); u16(end, 0); u16(end, count); u16(end, count); u32(end, central.length); u32(end, local.length); u16(end, 0);
  return new Uint8Array([...local, ...central, ...end]);
}
