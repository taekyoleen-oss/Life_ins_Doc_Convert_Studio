import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { calcSheets } from "@/lib/methoddoc/calc";
import { calcWorkbook } from "@/lib/methoddoc/calc-xlsx";
import { unzip } from "@/lib/methoddoc/extract";
import { jsonToSpec } from "@/lib/conditions/yaml";

/**
 * 보험료 계산 → 엑셀(.xlsx). 위험률과 계약·기초율만 값이고 현가율부터는 엑셀 수식이어야 한다 —
 * 그래야 내려받은 파일만으로 산출 과정을 따라가고 값을 바꿔 다시 계산할 수 있다.
 * 엑셀이 실제로 같은 값을 내는지는 scripts/check-verify-xlsx.ps1 과 같은 방식으로 따로 확인했다(차이 0).
 */
const spec = jsonToSpec(readFileSync("samples/09_종신보험(암진단포함)_MethodSpec.json", "utf8"));
const contract = { sex: "M" as const, age: 40, payYears: 20, freq: 12 };
const book = calcWorkbook(spec, contract);
const files = await unzip(book);
const text = (name: string) => new TextDecoder().decode(files.get(name)!);
const sheet1 = text("xl/worksheets/sheet2.xml");            // 1번은 합계, 2번이 첫 담보

/** 그 칸의 알맹이 — <f>…</f> 면 식, <v>…</v> 면 값 */
const cell = (xml: string, ref: string) => {
  const m = new RegExp(`<c r="${ref}"[^>]*>(.*?)</c>`).exec(xml);
  if (!m) return null;
  const f = /<f>(.*?)<\/f>/.exec(m[1]), v = /<v>(.*?)<\/v>/.exec(m[1]), s = /<t[^>]*>(.*?)<\/t>/.exec(m[1]);
  return f ? { f: f[1] } : v ? { v: Number(v[1]) } : s ? { s: s[1] } : null;
};

describe("보험료 계산 → 엑셀 수식", () => {
  it("파일 모양 — 장마다 xml · 합계 장 + 담보 장", () => {
    expect([...files.keys()].sort()).toEqual([
      "[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml",
      "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml",
    ]);
    const wb = text("xl/workbook.xml");
    expect(wb).toContain('<sheet name="보험료"');
    expect(wb).toContain('<sheet name="사망·80% 이상 장해"');
    // 장마다 기간·보장금액이 다르므로 이름은 그 장에서만 쓴다
    expect(wb).toMatch(/<definedName name="S_amt" localSheetId="1">'사망·80% 이상 장해'!\$B\$9<\/definedName>/);
    expect(wb).toMatch(/<definedName name="S_amt" localSheetId="2">'암 진단'!\$B\$9<\/definedName>/);
    expect(wb).toContain('<calcPr fullCalcOnLoad="1"/>');     // 열 때 다시 계산한다
  });

  it("왼쪽 A·B — 계약·기초율은 값, 현가율만 이율에서 나오는 식", () => {
    expect(cell(sheet1, "A2")?.s).toContain("가입나이 x");
    expect(cell(sheet1, "B2")).toEqual({ v: 40 });
    expect(cell(sheet1, "B4")).toEqual({ v: 71 });            // 보장기간 n
    expect(cell(sheet1, "B5")).toEqual({ v: 20 });            // 납입기간 m
    expect(cell(sheet1, "B6")).toEqual({ v: 12 });            // 납입주기 k
    expect(cell(sheet1, "B7")).toEqual({ v: 0.025 });         // 적용이율 i
    expect(cell(sheet1, "B8")).toEqual({ f: "1/(1+i_rate)" }); // 현가율 v
    expect(cell(sheet1, "B9")).toEqual({ v: 1e8 });           // 보장금액
  });

  it("표 — 위험률만 값이고 현가율·유지자수·납입자수·기수는 모두 수식", () => {
    // 머리: t · 연령 · 위험률 3 · 현가율 2 · 계산기수 …
    expect(cell(sheet1, "D1")?.s).toBe("t (경과)");
    expect(cell(sheet1, "F1")?.s).toContain("q 제7회 경험생명표 사망률");
    expect(cell(sheet1, "I1")?.s).toBe("v^t 현가율");
    expect(cell(sheet1, "J1")?.s).toBe("v^{t+½} 현가율");
    expect(cell(sheet1, "K1")?.s).toBe("Q 탈퇴율");
    expect(cell(sheet1, "L1")?.s).toBe("l 유지자수");
    // 값: 위험률만
    expect(cell(sheet1, "F3")).toEqual({ v: 0.00094 });
    // 식: 현가율 · 탈퇴율 · 유지자수(점화식) · 지급자수 · 현가 · 누계
    expect(cell(sheet1, "I3")).toEqual({ f: "v_disc^(D3)" });
    expect(cell(sheet1, "J3")).toEqual({ f: "v_disc^(D3+0.5)" });
    expect(cell(sheet1, "K3")?.f).toBe("((F3+G3)-((F3*G3)/2))");
    expect(cell(sheet1, "L2")).toEqual({ v: 100000 });                 // 기준 인원은 값
    expect(cell(sheet1, "L3")).toEqual({ f: "(L2*(1-K2))" });          // l_{x+t+1} = l_{x+t} × (1 − Q_{x+t})
    expect(cell(sheet1, "N3")?.f).toBe("(L3*K3)");                     // 지급자수 d = l × Q
    expect(cell(sheet1, "O3")).toEqual({ f: "(L3*I3)" });              // D = l·v^t
    expect(cell(sheet1, "Q3")?.f).toBe("SUM(O3:O73)");                 // N = Σ_{u≥t} D
    expect(cell(sheet1, "U3")?.f).toBe("SUMPRODUCT(S3:S72,T3:T72)");   // M = Σ S·C
  });

  it("보험료 — N* · PVB · P · 기준연납 · G 가 수식이고 10만원당·담보 보험료로 이어진다", () => {
    // 보험료 덩이는 왼쪽 계약·기초율 아래에 붙는다 — 담보마다 줄 수가 다르므로 "보험료" 줄을 찾아 센다
    const top = [...sheet1.matchAll(/<c r="A(\d+)"[^>]*><is><t[^>]*>보험료<\/t>/g)].map((m) => Number(m[1]))[0];
    expect(top).toBeGreaterThan(10);
    const at = (d: number) => cell(sheet1, `B${top + d}`)?.f ?? "";
    const lab = (d: number) => cell(sheet1, `A${top + d}`)?.s ?? "";
    expect([lab(1), lab(2), lab(3), lab(4), lab(5)]).toEqual(
      ["N* 연납 환산 납입기수", "PVB 보험금의 현가", "P 순보험료 (1원당)", "P_base 기준연납순보험료", "G 영업보험료 (1원당)"]);
    expect(at(1)).toMatch(/^\(k_freq\*\(\(R2-R22\)/);                           // N* — 납입자수 현가·누계 칸
    expect(at(2)).toBe("U2");                                                   // PVB = M_x
    expect(at(3)).toBe(`($B$${top + 2}/$B$${top + 1})`);                        // P = PVB / N*
    expect(at(5)).toContain("alphaS");                                          // G 에 사업비
    expect(lab(6)).toBe("10만원당 보험료 (원)");
    expect(at(6)).toBe(`ROUND($B$${top + 5}*100000,0)`);
    expect(lab(7)).toBe("담보 보험료 (원)");
    expect(at(7)).toBe(`$B$${top + 6}*(S_amt/100000)`);
  });

  it("첫 장 — 담보마다 10만원당·보험료, 그 합계", () => {
    const sum = text("xl/worksheets/sheet1.xml");
    expect(cell(sum, "A6")?.s).toBe("사망·80% 이상 장해");
    expect(cell(sum, "E6")).toEqual({ f: "per100k_1" });
    expect(cell(sum, "F6")).toEqual({ f: "prem_1" });
    expect(cell(sum, "F9")).toEqual({ f: "SUM(F6:F7)" });
    // 앱이 낸 값(엑셀이 다시 계산하면 같아야 한다)
    const got = calcSheets(spec, contract);
    expect([got.per100k, got.premium]).toEqual([423, 342000]);
  });
});
