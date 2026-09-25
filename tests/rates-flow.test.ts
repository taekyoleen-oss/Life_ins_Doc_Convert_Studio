import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mergeSpec, yamlToSpec } from "@/lib/conditions/yaml";
import { extractText } from "@/lib/methoddoc/extract";
import { withFormulas } from "@/lib/methoddoc/formulas";
import { parseMethodDoc } from "@/lib/methoddoc/parse";
import { docToMarkdown, renderMethodDoc } from "@/lib/methoddoc/render";
import { rateTable } from "@/lib/methoddoc/spec";
import { SAMPLES } from "@/lib/samples";
import { addEmptyColumn, attachTables, autoMap, linkGroups, linkNote, newRateId, ratesWithoutTable, sheetFromDoc, sheetFromText, unlinkRate, unlinkedGroups, type SheetState } from "@/lib/sheet";

/**
 * 위험률 표 ↔ 조건(M04) ↔ 산출방법서 ↔ 계산 앱(JSON) 이 하나로 움직이는지 — samples/08_위험률표_종합_남녀.csv 로.
 *  표를 올리면: 같은 이름은 잇고, 없는 이름은 새 위험률로 조건에 더한다 (Studio.loadSheet = autoMap + unlinkedGroups + linkGroups)
 *  조건에 더하면: 표에 빈 열 (addEmptyColumn) · 지우면 연결 해제 (unlinkRate)
 *  산출방법서에 더하면: mergeSpec 이 조건에 더하고 → 빈 열
 *  JSON: 이은 표 전부(남·여) — 표 없는 위험률은 ratesWithoutTable 이 알려 준다
 */
const csv = readFileSync("samples/08_위험률표_종합_남녀.csv", "utf8");
const sample = (id: string) => yamlToSpec(SAMPLES.find((s) => s.id === id)!.yaml).spec;
const ids = (st: SheetState) => st.map.map((m) => (m.to === "rate" ? `${m.rateId}${m.sex ?? ""}` : m.to));

describe("표를 올리면 — 이름으로 잇고, 없는 이름은 새 위험률로", () => {
  it("2대질병 샘플: 사망률(남·여)→q, 2대질병 발생률→r2, 나머지 3계열은 새 위험률(남·여 열은 한 계열)", () => {
    const spec = sample("twoMajor");
    const sheet = sheetFromText("08.csv", csv);
    let st: SheetState = { sheet, map: autoMap(sheet, spec.rates) };
    expect(ids(st)).toEqual(["age", "qM", "qF", "r2", "skip", "skip", "skip", "skip"]);
    const groups = unlinkedGroups(st, spec.rates);
    expect(groups.map((g) => [g.name, g.role, g.cols])).toEqual([["3대질병 발생률", "incidence", [4]], ["암발생률", "incidence", [5, 6]], ["80% 이상 장해율", "incidence", [7]]]);
    const taken = spec.rates.map((r) => r.id), newIds: string[] = [];
    for (const g of groups) newIds.push(newRateId(g.role, [...taken, ...newIds]));
    expect(newIds).toEqual(["r", "r3", "r4"]);
    st = linkGroups(st, groups, newIds);
    expect(ids(st)).toEqual(["age", "qM", "qF", "r2", "r", "r3M", "r3F", "r4"]);
    // 조건에 더한 뒤 표를 붙이면 다섯 계열 모두 값 표가 있고, JSON 에 남·여 두 벌이 실린다
    const rates = [...spec.rates, ...groups.map((g, k) => ({ id: newIds[k], name: g.name, role: g.role }))];
    const withT = attachTables({ ...spec, rates }, st);
    expect(ratesWithoutTable(withT)).toEqual([]);
    expect(rateTable(withT.rates[0], "F")!.values[25]).toBeCloseTo(0.00051, 12);      // 40세 여자 사망률
    expect(withT.rates.find((r) => r.name === "암발생률")!.tables).toMatchObject({ M: { ages: expect.any(Array) }, F: { ages: expect.any(Array) } });
    expect(linkNote(st, withT, "r3")).toBe("표: F(남)·G(여)열 → 15~80세 66행 · 남·여");
    // 산출방법서 별첨에 66행 × 8열(남·여 따로) — 되읽으면 같은 표
    const secs = renderMethodDoc(withFormulas(withT));
    const t = secs.at(-1)!.blocks.find((b) => b.t === "table");
    expect(secs.at(-1)!.title).toMatch(/별첨/);
    expect(t && t.t === "table" ? [t.head.length, t.rows.length] : null).toEqual([8, 66]);
    const back = sheetFromDoc(extractText(new TextEncoder().encode(docToMarkdown(secs))), "x")!;
    expect(back.rows.length).toBe(66);
    expect(autoMap(back, withT.rates).map((m) => (m.to === "rate" ? m.rateId : m.to))).toEqual(["age", "q", "q", "r2", "r", "r3", "r3", "r4"]);
  });

  it("종신 샘플: '사망률(남)' 이 '제7회 경험생명표 사망률' 에 이어진다(이름 포함) · 장해율은 정확히", () => {
    const spec = sample("whole");
    const sheet = sheetFromText("08.csv", csv);
    const st = { sheet, map: autoMap(sheet, spec.rates) };
    expect(ids(st).slice(0, 4)).toEqual(["age", "qM", "qF", "skip"]);
    expect(ids(st)[7]).toBe("r80");
    expect(unlinkedGroups(st, spec.rates).map((g) => g.name)).toEqual(["2대질병 발생률", "3대질병 발생률", "암발생률"]);
  });
});

describe("조건에 더하면 표에 빈 열, 지우면 연결 해제", () => {
  const spec = sample("twoMajor");
  const sheet = sheetFromText("s", "연령\t제7회 경험생명표 사망률\t2대질병 발생률\n40\t0.001\t0.002\n41\t0.0011\t0.0021");
  const st0: SheetState = { sheet, map: autoMap(sheet, spec.rates) };

  it("빈 열은 그 위험률에 이어지되 값 표는 아직 없다 — 값을 채우면 붙는다", () => {
    const st = addEmptyColumn(st0, { id: "r3", name: "3대질병 발생률" })!;
    expect(st.sheet.head).toEqual(["연령", "제7회 경험생명표 사망률", "2대질병 발생률", "3대질병 발생률"]);
    expect(st.sheet.rows.map((r) => r[3])).toEqual(["", ""]);
    expect(ids(st)).toEqual(["age", "q", "r2", "r3"]);
    const rates = [...spec.rates, { id: "r3", name: "3대질병 발생률", role: "incidence" as const }];
    expect(ratesWithoutTable(attachTables({ ...spec, rates }, st)).map((r) => r.id)).toEqual(["r3"]);
    expect(linkNote(st, attachTables({ ...spec, rates }, st), "r3")).toBe("표: D열 → 값이 비어 있습니다 — 아래 표에 붙여넣으세요");
    const filled = { ...st, sheet: { ...st.sheet, rows: st.sheet.rows.map((r, i) => [...r.slice(0, 3), String(0.003 + i / 1000)]) } };
    expect(attachTables({ ...spec, rates }, filled).rates[2].table).toEqual({ ages: [40, 41], values: [0.003, 0.004] });
    // 같은 위험률의 열이 이미 있거나 연령 열이 없으면 만들지 않는다
    expect(addEmptyColumn(st, { id: "r3", name: "x" })).toBe(st);
    expect(addEmptyColumn({ ...st0, map: st0.map.map(() => ({ to: "skip" as const })) }, { id: "z", name: "z" })?.sheet.head.length).toBe(3);
    expect(addEmptyColumn(null, { id: "z", name: "z" })).toBeNull();
  });

  it("지우면 그 열은 '쓰지 않음' — 값은 남아 다시 이을 수 있다", () => {
    const st = unlinkRate(st0, "r2")!;
    expect(ids(st)).toEqual(["age", "q", "skip"]);
    expect(st.sheet.rows[0][2]).toBe("0.002");
    expect(unlinkRate(st, "없음")).toBe(st);
  });
});

describe("산출방법서에 위험률을 더해 올리면 — 조건에 더해지고, 담보가 쓰면 식에도", () => {
  it("1.2 표에 행을 더하고 담보의 탈퇴 위험률에 적으면 mergeSpec 이 조건에 더한다 → 표에는 빈 열(addEmptyColumn) → 값을 채우면 JSON 에", () => {
    const spec = sample("twoMajor");
    let md = docToMarkdown(renderMethodDoc(withFormulas(spec)));
    md = md.replace(/^(\| 2대질병 발생률 \|.*)$/m, "$1\n| 뇌졸중 발생률 | r9 | 최초발생 | 가상 | 별첨 |")
      .replace("| 탈퇴 위험률 | 제7회 경험생명표 사망률 및 2대질병 발생률 |", "| 탈퇴 위험률 | 제7회 경험생명표 사망률 및 2대질병 발생률 및 뇌졸중 발생률 |");
    const back = parseMethodDoc(extractText(new TextEncoder().encode(md)), { fallbackName: spec.meta.productName });
    const { spec: out, changes } = mergeSpec(spec, back.spec, back.evidence, { standard: true });
    expect(changes).toEqual(['rates: "뇌졸중 발생률" 추가', "benefits: 1개 → 1개 갱신"]);
    const added = out.rates.find((r) => r.name === "뇌졸중 발생률")!;
    expect(out.benefits[0].exitRateIds).toEqual(["q", "r2", added.id]);
    expect(withFormulas(out).formulas[0].text).toContain("r^{(2)}_x : 뇌졸중 발생률");
    const sheet = sheetFromText("s", "연령\t제7회 경험생명표 사망률\t2대질병 발생률\n40\t0.001\t0.002");
    const st = addEmptyColumn({ sheet, map: autoMap(sheet, spec.rates) }, added)!;
    expect(st.sheet.head.at(-1)).toBe("뇌졸중 발생률");
    expect(ratesWithoutTable(attachTables(out, st)).map((r) => r.name)).toEqual(["뇌졸중 발생률"]);
  });
});
