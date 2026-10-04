import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { calcSheets } from "@/lib/methoddoc/calc";
import { calcWorkbook } from "@/lib/methoddoc/calc-xlsx";
import { unzip } from "@/lib/methoddoc/extract";
import { jsonToSpec } from "@/lib/conditions/yaml";

/**
 * 보험료 계산 → 엑셀(.xlsx). 계약 단위(주계약·특약)마다 한 장이고, 그 단위의 담보가 모두 한 장에 나란히 들어가며 맨 오른쪽에 결과가 있다.
 * 위험률과 계약·기초율만 값이고 현가율부터는 엑셀 수식이어야 한다 — 그래야 내려받은 파일만으로 산출 과정을 따라가고 값을 바꿔 다시 계산할 수 있다.
 * 엑셀이 실제로 같은 값을 내는지는 scripts/check-calc-xlsx.ps1 (Excel COM) 로 따로 확인한다(차이 0).
 */
const spec = jsonToSpec(readFileSync("samples/09_종신보험(암진단포함)_MethodSpec.json", "utf8"));
const contract = { sex: "M" as const, age: 40, payYears: 20, freq: 12, sumAssured: 1e8 };
const book = calcWorkbook(spec, contract);
// 엑셀로 다시 계산해 보는 파일 — scripts/check-calc-xlsx.ps1 (Excel COM) 이 앱·엔진 값과 맞대어 본다
if (process.env.XLSX_UPDATE) writeFileSync("samples/09_종신보험(암진단포함)_보험료계산.xlsx", book);
const files = await unzip(book);
const text = (name: string) => new TextDecoder().decode(files.get(name)!);
const sheet1 = text("xl/worksheets/sheet1.xml");            // 주계약 한 장

/** 그 칸의 알맹이 — <f>…</f> 면 식, <v>…</v> 면 값 */
const cell = (xml: string, ref: string) => {
  const m = new RegExp(`<c r="${ref}"[^>]*>(.*?)</c>`).exec(xml);
  if (!m) return null;
  const f = /<f>(.*?)<\/f>/.exec(m[1]), v = /<v>(.*?)<\/v>/.exec(m[1]), s = /<t[^>]*>(.*?)<\/t>/.exec(m[1]);
  return f ? { f: f[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") } : v ? { v: Number(v[1]) } : s ? { s: s[1] } : null;
};
/** 2행(열 제목)에서 제목이 이 글자로 시작하는 열의 글자 — 담보 구역 안에서 몇 번째인지로 찾는다 */
const colsOf = (xml: string, row: number) => [...xml.matchAll(new RegExp(`<c r="([A-Z]+)${row}"[^>]*><is><t[^>]*>(.*?)</t>`, "g"))].map((m) => [m[1], m[2]] as const).filter(([c]) => c !== "A" && c !== "B");
const head = colsOf(sheet1, 2);
const colOf = (label: string, nth = 0) => head.filter(([, t]) => t.startsWith(label))[nth][0];

describe("보험료 계산 → 엑셀 수식", () => {
  it("파일 모양 — 계약 단위(주계약)마다 한 장, 이름은 그 장에서만", () => {
    expect([...files.keys()].sort()).toEqual([
      "[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml",
    ]);
    const wb = text("xl/workbook.xml");
    expect(wb).toContain('<sheet name="주계약"');
    expect(wb).toMatch(/<definedName name="x_age" localSheetId="0">'주계약'!\$B\$2<\/definedName>/);
    expect(wb).toMatch(/<definedName name="sum_assured" localSheetId="0">'주계약'!\$B\$4<\/definedName>/);
    expect(wb).toContain('<calcPr fullCalcOnLoad="1"/>');     // 열 때 다시 계산한다
  });

  it("왼쪽 A·B — 공통 계약·기초율은 값, 현가율만 이율에서 나오는 식 (담보마다 다른 기간·배수는 오른쪽 결과 칸)", () => {
    expect(cell(sheet1, "A2")?.s).toContain("가입나이 x");
    expect(cell(sheet1, "B2")).toEqual({ v: 40 });
    expect(cell(sheet1, "B4")).toEqual({ v: 1e8 });           // 보험가입금액
    expect(cell(sheet1, "B5")).toEqual({ v: 12 });            // 납입주기 k
    expect(cell(sheet1, "B6")).toEqual({ v: 0.025 });         // 적용이율 i
    expect(cell(sheet1, "B7")).toEqual({ f: "1/(1+i_rate)" }); // 현가율 v
    expect(cell(sheet1, "B8")).toEqual({ v: 0.0325 });        // 표준이율
    expect(colsOf(sheet1, 2).map(([, t]) => t).slice(0, 8)).toEqual(["t (경과)", "연령 x+t", "사망률", "80% 이상 장해율", "암발생률", "v^t 현가율", "v^{t+½} 현가율", "Q^{(1)} 결합 탈퇴율 lx(1)"]);
  });

  it("표 — 위험률(공통 열)만 값이고 현가율·생존자 lx·기수·준비금·환급금은 모두 수식, 담보 둘이 한 장에", () => {
    expect(cell(sheet1, "D2")?.s).toBe("t (경과)");
    expect(cell(sheet1, "D3")).toEqual({ v: 0 });
    expect(cell(sheet1, "E3")).toEqual({ f: "x_age+D3" });
    expect(cell(sheet1, "F4")).toEqual({ v: 0.00094 });                     // 사망률 41세 — 값
    expect(cell(sheet1, "I3")).toEqual({ f: "v_disc^(D3)" });
    expect(cell(sheet1, "J3")).toEqual({ f: "v_disc^(D3+0.5)" });
    expect(cell(sheet1, "K1")?.s).toContain("담보 1: 사망·80% 이상 장해 (생존자 lx(1)");
    const Q1 = colOf("Q^{(1)} "), l1 = colOf("l^{(1)} "), D1 = colOf("D^{(1)} "), N1 = colOf("N^{(1)} ");
    const l = colOf("l "), d = colOf("d "), D = colOf("D "), N = colOf("N "), M = colOf("M "), V = colOf("V "), V100k = colOf("V^{10만}"), W = colOf("W "), R = colOf("환급률");
    expect(cell(sheet1, `${Q1}3`)?.f).toBe("MIN(1,((F3+G3)-((F3*G3)/2)))");    // Q⁽¹⁾ = min(1, q + r − q·r/2)
    expect(cell(sheet1, `${l1}3`)).toEqual({ v: 100000 });                // 기준 인원은 값
    expect(cell(sheet1, `${l1}4`)).toEqual({ f: `(${l1}3*(1-${Q1}3))` });  // l⁽¹⁾_{x+t+1} = l⁽¹⁾_{x+t} × (1 − Q⁽¹⁾_{x+t})
    expect(cell(sheet1, `${D1}3`)).toEqual({ f: `(${l1}3*I3)` });          // D⁽¹⁾ = l⁽¹⁾·v^t
    expect(cell(sheet1, `${N1}3`)?.f).toBe(`SUM(${D1}3:${D1}74)`);         // N⁽¹⁾ = Σ_{u≥t} D⁽¹⁾ (n = 71 → 3~74행)
    // [납입] 생존자 lx(3) — 질병(장해 G · 암 H)을 곱으로 묶은 R⁽³⁾, 사망(F 열)과는 겹치는 부분 절반인 Q⁽³⁾
    const R3 = colOf("R^{(3)} "), Q3 = colOf("Q^{(3)} "), l3 = colOf("l^{(3)} ");
    expect(cell(sheet1, `${R3}3`)?.f).toBe("(1-((1-G3)*(1-H3)))");
    expect(cell(sheet1, `${Q3}3`)?.f).toBe(`MIN(1,((F3+${R3}3)-((F3*${R3}3)/2)))`);
    expect(cell(sheet1, `${l3}4`)).toEqual({ f: `(${l3}3*(1-${Q3}3))` });
    // 보험금은 앞의 생존자 lx 를 가져다 쓴다 — 이 담보의 l · D · N 은 lx(1) 의 칸
    expect(cell(sheet1, `${l}3`)).toEqual({ f: `${l1}3` });
    expect(cell(sheet1, `${D}3`)).toEqual({ f: `${D1}3` });
    expect(cell(sheet1, `${N}3`)).toEqual({ f: `${N1}3` });
    expect(cell(sheet1, `${d}3`)?.f).toBe(`(${l1}3*${Q1}3)`);              // 지급자수 d = l⁽¹⁾ × Q⁽¹⁾    expect(cell(sheet1, `${M}3`)?.f).toMatch(/^SUMPRODUCT\(/);              // M = Σ S·C
    // 준비금 V: 0 으로 나누면 0 (D_{x+n} = 0) · 10만원당은 ROUND · 환급금은 MAX(V − 해약공제, 0) · 환급률은 납입누계로
    expect(cell(sheet1, `${V}3`)?.f).toMatch(new RegExp(`^IF\\(${D}3=0,0,\\(\\(${M}3\\+\\(betaPrime`));
    expect(cell(sheet1, `${V100k}3`)?.f).toBe(`ROUND((${V}3*100000),0)`);
    expect(cell(sheet1, `${colOf("W^{표준}")}3`)?.f).toMatch(/^MAX\(/);        // W^표준 = max(V − 해약공제, 0)
    expect(cell(sheet1, `${W}3`)?.f).toBe(`${colOf("W^{표준}")}3`);              // 표준형은 W = W^표준
    expect(cell(sheet1, `${R}3`)?.f).toMatch(/^IF\(.*=0,0,/);
    // 둘째 담보(암 진단)의 구역 — 같은 위험률 열(사망률 F · 암발생률 H)을 쓴다
    const Q2 = colOf("Q^{(2)} ");
    expect(cell(sheet1, `${Q2}3`)?.f).toBe("MIN(1,((F3+H3)-((F3*H3)/2)))");
    expect(cell(sheet1, `${Q2}63`)).not.toBeNull();                          // 100세 만기 → n = 60 → 3~63행
    expect(cell(sheet1, `${Q2}64`)).toBeNull();
  });

  it("맨 오른쪽 결과 — 담보마다 n · m · 배수 · N* · PVB · P · G · G₁ · 10만원당 · 담보 보험료 · P_β 가 수식이고, 합계", () => {
    const labels = [...sheet1.matchAll(/<c r="([A-Z]+)(\d+)"[^>]*><is><t[^>]*>보장기간 n \(년\)<\/t>/g)].map((m) => [m[1], Number(m[2])] as const);
    expect(labels).toHaveLength(1);
    const [L, r0] = labels[0];
    const col = (s: string) => String.fromCharCode(s.charCodeAt(0) + 1);   // 결과 칸은 한 글자 열 이름 안에 든다고 보지 않는다 — 아래에서 정확히 센다
    const next = (c: string, k = 1) => { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; n += k; let s = ""; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };
    void col;
    const v1 = next(L), v2 = next(L, 2), sum = next(L, 3);
    const lab = (d: number) => cell(sheet1, `${L}${r0 + d}`)?.s ?? "";
    expect([lab(0), lab(1), lab(2), lab(3)]).toEqual(["보장기간 n (년)", "납입기간 m (년)", "보장금액 배수", "보장금액 (원) = 가입금액 × 배수"]);
    expect(cell(sheet1, `${v1}${r0 - 1}`)?.s).toBe("사망·80% 이상 장해");
    expect(cell(sheet1, `${v2}${r0 - 1}`)?.s).toBe("암 진단");
    expect(cell(sheet1, `${sum}${r0 - 1}`)?.s).toBe("합계");
    expect(cell(sheet1, `${v1}${r0}`)).toEqual({ v: 71 });
    expect(cell(sheet1, `${v2}${r0}`)).toEqual({ v: 60 });
    expect(cell(sheet1, `${v1}${r0 + 2}`)).toEqual({ v: 1 });
    expect(cell(sheet1, `${v2}${r0 + 2}`)).toEqual({ v: 0.5 });
    expect(cell(sheet1, `${v2}${r0 + 3}`)?.f).toBe(`sum_assured*$${v2}$${r0 + 2}`);
    const rowOf = (label: string) => Number(/<c r="[A-Z]+(\d+)"[^>]*><is><t[^>]*>LABEL<\/t>/.source && [...sheet1.matchAll(new RegExp(`<c r="${L}(\\d+)"[^>]*><is><t[^>]*>${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"))][0][1]);
    const at = (v: string, label: string) => cell(sheet1, `${v}${rowOf(label)}`);
    expect(at(v1, "N* 연납")?.f).toMatch(/^\(k_freq\*\(\(/);                      // N* — 납입자수 현가·누계 칸
    expect(at(v1, "P 순보험료")?.f).toBe(`($${v1}$${rowOf("PVB 보험금")}/$${v1}$${rowOf("N* 연납")})`);   // P = PVB / N*
    expect(at(v1, "G 영업보험료")?.f).toContain("alphaS");
    expect(at(v1, "G₁ 1원당")?.f).toBe(`ROUND($${v1}$${rowOf("G 영업보험료")},6)`);
    expect(at(v1, "10만원당 보험료")?.f).toBe(`ROUND(($${v1}$${rowOf("G₁ 1원당")}*100000),0)`);
    expect(at(v1, "담보 보험료")?.f).toBe(`ROUNDDOWN($${v1}$${rowOf("10만원당 보험료")}*$${v1}$${rowOf("보장금액 (원)")}/100000,-1)`);   // 10원 미만 버림
    expect(at(v1, "P_β 준비금")?.f).toMatch(/^\(\(\$/);
    expect(at(v1, "α^공제")?.f).toMatch(/^MIN\(/);
    expect(at(sum, "담보 보험료")?.f).toBe(`SUM(${v1}${rowOf("담보 보험료")}:${v2}${rowOf("담보 보험료")})`);
    // 앱이 낸 값(엑셀이 다시 계산하면 같아야 한다 — scripts/check-calc-xlsx.ps1)
    const got = calcSheets(spec, contract);
    expect([got.per100k, got.premium]).toEqual([423, 342000]);
  });
});
