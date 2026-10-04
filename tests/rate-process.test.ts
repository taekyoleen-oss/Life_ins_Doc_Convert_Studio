import { describe, expect, it } from "vitest";
import { exprWithNames, firstRowIsHead, guessAgeColumn, guessImportCols, importColumns, importedColumns, parseRateExpr, processRates } from "@/lib/rate-process";
import { parseDelimited } from "@/lib/sheet";

describe("위험률 불러오기 — 첫 행이 제목인지 가리고 열을 나눈다", () => {
  const withHead = parseDelimited("연령,뇌졸중(남),뇌졸중(여),비고\n40,0.001,0.0008,가\n41,0.0012,0.0009,나");
  const noHead = parseDelimited("40\t0.001\n41\t0.0012\n42\t0.0013");

  it("제목 행 · 연령 열 · 성별 · 유형을 어림한다", () => {
    expect(firstRowIsHead(withHead)).toBe(true);
    const { heads, body } = importColumns(withHead, true);
    const age = guessAgeColumn(heads, body);
    expect(age).toBe(0);
    const cols = guessImportCols(heads, body, age);
    expect(cols.map((c) => [c.name, c.sex, c.role])).toEqual([["뇌졸중", "M", "incidence"], ["뇌졸중", "F", "incidence"]]);   // 글자 열(비고)은 뺀다
    const out = importedColumns(body, age, cols);
    expect(out.map((c) => [c.head, c.ages, c.values])).toEqual([["뇌졸중(남)", [40, 41], [0.001, 0.0012]], ["뇌졸중(여)", [40, 41], [0.0008, 0.0009]]]);
  });

  it("제목이 없으면 첫 행도 값이고, 늘어나는 정수 열이 연령이다", () => {
    expect(firstRowIsHead(noHead)).toBe(false);
    const { heads, body } = importColumns(noHead, false);
    expect(heads).toEqual(["A열", "B열"]);
    expect(body).toHaveLength(3);
    expect(guessAgeColumn(heads, body)).toBe(0);
  });
});

describe("위험률 가공 — 표 단위로 식을 계산해 새 위험률", () => {
  const tabs: Record<string, { M?: { ages: number[]; values: number[] }; F?: { ages: number[]; values: number[] }; any?: { ages: number[]; values: number[] } }> = {
    rc: { M: { ages: [40, 41], values: [0.002, 0.003] }, F: { ages: [40, 41], values: [0.001, 0.002] } },
    rs: { any: { ages: [40, 41, 42], values: [0.1, 0.2, 0.3] } },
  };
  const get = (id: string) => tabs[id];

  it("곱 · 덧셈 · 괄호 곱 · × − 기호", () => {
    expect(processRates("rc × 0.8", get)).toEqual([{ sex: "M", ages: [40, 41], values: [0.0016, 0.0024] }, { sex: "F", ages: [40, 41], values: [0.0008, 0.0016] }]);
    const [m] = processRates("1 − (1 − rc)(1 − rs)", get);                 // 남: 공통 표 rs 를 함께 쓴다 · 두 표에 다 있는 연령만
    expect(m.ages).toEqual([40, 41]);
    expect(m.values[0]).toBeCloseTo(1 - 0.998 * 0.9, 12);
    expect(processRates("rs * 365", get)).toEqual([{ sex: undefined, ages: [40, 41, 42], values: [36.5, 73, 109.5] }]);
  });

  it("못 읽는 식·없는 기호는 알린다 · 근거 글은 이름으로", () => {
    expect(() => parseRateExpr("rc ×")).toThrow(/식이 끝났습니다/);
    expect(() => parseRateExpr("(rc")).toThrow(/괄호/);
    expect(() => processRates("zz × 2", get)).toThrow(/"zz"/);
    expect(() => processRates("0.5", get)).toThrow(/기호를 하나 이상/);
    expect(exprWithNames("rc * 0.8", (id) => ({ rc: "암발생률" })[id])).toBe("암발생률 × 0.8");
  });
});
