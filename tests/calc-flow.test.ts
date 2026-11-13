import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFormulas } from "@/lib/methoddoc/formulas";
import { calcFlow, compareFlow, pythonCompare } from "@/lib/methoddoc/calc-flow";
import { calcPython } from "@/lib/methoddoc/calc-py";
import { calcSheets, computeSavings, computeSpec, SAVINGS_SCENARIOS } from "@/lib/methoddoc/calc";
import { calcWorkbook, workbookResults } from "@/lib/methoddoc/calc-xlsx";
import { yamlToSpec } from "@/lib/conditions/yaml";
import { SAMPLES } from "@/lib/samples";
import { attachTables, readXlsxAll, sampleSheet } from "@/lib/sheet";
import { BASE_RATES_CSV } from "@/lib/base-rates";

/**
 * 산출 흐름 — 보험료 산출을 이어진 모듈로 나눈 것. 새로 계산하지 않으므로 모듈의 값은 계산 표(calcSheets · computeSpec)와,
 * 모듈의 코드를 이은 것은 파이썬 일괄 산출(calcPython)과 **글자까지** 같아야 한다.
 */
const sample = (id: string) => { const sp = yamlToSpec(SAMPLES.find((s) => s.id === id)!.yaml).spec; return attachTables(sp, sampleSheet(sp.rates, BASE_RATES_CSV)); };
const contract = { sex: "M" as const, age: 40, payYears: 20, freq: 12, sumAssured: 1e8 };
const saveContract = { ...contract, payYears: 10, basePremium: 300000 };
const LANE = ["cond", "surv", "ben", "cover", "pay", "prem", "res"];

describe.each([["whole", contract], ["cancerPlan", contract], ["savings", saveContract]] as const)("산출 흐름 — %s", (id, c) => {
  const spec = sample(id), flow = calcFlow(spec, c), ids = flow.modules.map((m) => m.id);

  it("모듈 차례 = 산출방법서 절 차례, 끊긴 모듈이 없다", () => {
    expect(ids.slice(0, 3)).toEqual(["doc", "basis", "rates"]);
    expect(ids.at(-1)).toBe("total");
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of flow.calc.sheets) expect(flow.modules.filter((m) => m.lane === s.id).map((m) => m.kind), s.name).toEqual(spec.savings ? ["risk", "parts", "av", "refund"] : LANE);
    for (const m of flow.modules) {
      // 들어오는 모듈은 모두 앞에 있다 — 위에서 아래로만 흐른다
      for (const from of m.inputs) expect(ids.includes(from) && ids.indexOf(from) < ids.indexOf(m.id), `${from} → ${m.id}`).toBe(true);
      if (m.id !== "doc") expect(m.inputs.length, m.id).toBeGreaterThan(0);
      // 준비금·환급금과 합계 말고는 다음 단계로 이어진다
      if (m.kind !== "res" && m.id !== "total") expect(flow.links.some(([from]) => from === m.id), m.id).toBe(true);
      expect(m.status, `${m.id} ${m.notes.join()}`).toBe("ok");
      expect(m.desc && m.section).toBeTruthy();
    }
    expect(flow.links).toEqual(flow.modules.flatMap((m) => m.inputs.map((from) => [from, m.id])));
  });

  it("모듈의 코드를 차례로 이으면 파이썬 일괄 산출과 같다", () => {
    const coded = flow.modules.filter((m) => m.code);
    expect(coded.map((m) => m.code)).toEqual(calcPython(spec, c).map((x) => x.code));
    expect(coded.map((m) => m.cell)).toEqual(coded.map((_, i) => i));
    expect(flow.modules.filter((m) => !m.code).map((m) => m.id)).toEqual(["doc"]);
  });

  it("모듈의 값 = 계산 표 · 보험료 계산", () => {
    const calc = calcSheets(spec, c);
    for (const s of calc.sheets) {
      const mods = flow.modules.filter((m) => m.lane === s.id);
      // 열과 한 값은 계산 표의 것 그대로 — 어느 모듈엔가 한 번씩
      const cols = mods.flatMap((m) => m.cols.map((x) => x.sym));
      expect([...cols].sort()).toEqual(s.cols.map((x) => x.sym).sort());
      for (const m of mods) for (const col of m.cols) expect(col.values, `${m.id} ${col.sym}`).toEqual(s.cols.find((x) => x.sym === col.sym)!.values);
      for (const sc of s.scalars) expect(mods.flatMap((m) => m.values).find((v) => v.sym === sc.sym)?.value, sc.sym).toBe(sc.value);
    }
    const app = Object.fromEntries(flow.compare.map((r) => [r.key, r.app]));
    if (spec.savings) {
      for (const sc of SAVINGS_SCENARIOS) expect(app[`${sc.id}.만기환급금`], sc.id).toBe(computeSavings(spec, c, sc.id).rows.at(-1)!.w);
      return;
    }
    const res = computeSpec(spec, c);
    expect(app["합계.prem"]).toBe(res.premium);
    expect(flow.calc.sheets.map((s) => app[`${s.id}.prem`])).toEqual(calc.sheets.map((s) => s.premium));
    expect(flow.calc.sheets.reduce((a, s) => a + app[`${s.id}.prem`], 0)).toBe(res.premium);
  });

  it("엑셀 결과 읽기 — 방금 만든 파일은 값이 없고, 엑셀이 채운 값은 같은 열쇠로 읽는다", async () => {
    const book = await readXlsxAll(calcWorkbook(spec, c));
    const blank = workbookResults(flow.calc, book);
    expect(blank.empty).toBe(true);
    expect(blank.problems).toEqual([]);
    expect(flow.compare.filter((r) => r.key in blank.values)).toEqual([]);   // n · m · 배수처럼 값으로 적힌 칸만 읽힌다
    if (spec.savings) return;   // 적립형의 만기환급금은 표의 W 열 — 엑셀이 계산해야 생긴다(scripts/check-calc-xlsx.ps1 이 본다)
    // 엑셀이 계산해 저장한 것처럼 결과 칸을 채운다 — ① 줄 번호를 넣어 어느 줄이 어느 열쇠인지 알아내고 ② 그 자리에 앱 값을 넣는다
    const fill = (value: (unit: number, row: number, col: number) => string) => book.map((rows, ui) => {
      const rc = rows[0].indexOf("보험료 계산 · 결과 (담보마다)");
      return rows.map((row, ri) => (ri < 2 || !row[rc] ? row : Object.assign([...row], Object.fromEntries(Array.from({ length: 12 }, (_, k) => [rc + 1 + k, value(ui, ri, k)])))));
    });
    const where = workbookResults(flow.calc, fill((_u, ri, k) => String(ri * 100 + k))).values;
    const app = Object.fromEntries(flow.compare.map((r) => [r.key, r.app]));
    const at = new Map(Object.entries(where).filter(([k]) => k !== "합계.prem").map(([k, v]) => [`${k.split(".")[0]}|${Math.floor(v / 100)}|${v % 100}`, k]));
    const unitOf = (ui: number) => [...new Set(flow.calc.sheets.map((s) => s.unit))][ui];
    const got = workbookResults(flow.calc, fill((ui, ri, k) => {
      const key = [...at].find(([w]) => { const [sid, r, col] = w.split("|"); return flow.calc.sheets.find((s) => s.id === sid)!.unit === unitOf(ui) && Number(r) === ri && Number(col) === k; })?.[1];
      // 합계 열 — 그 단위 보장의 보험료 합
      const sheets = flow.calc.sheets.filter((s) => s.unit === unitOf(ui));
      return key ? String(app[key] ?? 0) : k === sheets.length ? String(sheets.reduce((a, s) => a + s.premium, 0)) : "";
    }));
    expect(got.problems).toEqual([]);
    const cmp = compareFlow(flow.compare, undefined, got.values);
    expect(cmp.rows.every((r) => r.xl !== undefined), JSON.stringify(cmp.rows.filter((r) => r.xl === undefined).map((r) => r.key))).toBe(true);
    expect(cmp.first).toBeUndefined();
  });
});

const python = spawnSync("python", ["--version"]).status === 0;
const runPy = (code: string) => {
  const file = join(mkdtempSync(join(tmpdir(), "calc-flow-")), "calc.py");
  writeFileSync(file, code);
  return spawnSync("python", [file], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
};

describe("산출 흐름 — 다시 실행 · 깨진 식", () => {
  it.skipIf(!python)("보험료 단계를 다시 실행해도 합계가 더해지지 않는다", () => {
    const flow = calcFlow(sample("cancerPlan"), contract);
    const total = flow.cells.length - 1, prem = flow.cells.findLastIndex((c) => c.module.endsWith(":prem"));
    // 모두 실행 → 마지막 보장의 보험료 셀만 한 번 더 → 합계 셀. (앞 보장의 셀만 따로 다시 돌리는 것은 뜻이 없다 —
    // n · PVB 같은 이름을 보장마다 다시 쓰므로. 그래서 화면은 늘 처음 셀부터 돌린다)
    const r = runPy([...flow.cells, flow.cells[prem], flow.cells[total]].map((c) => c.code).join("\n"));
    expect(r.status, r.stderr).toBe(0);
    const again = pythonCompare(r.stdout.slice(r.stdout.lastIndexOf("COMPARE ")))!;
    expect(again["합계.prem"]).toBe(flow.calc.premium);
    expect(compareFlow(flow.compare, again).first).toBeUndefined();
  }, 60000);

  it("준비금 식이 깨져도 파이썬이 끝까지 돌고, 경고는 준비금 상자에 붙는다", () => {
    const base = sample("whole");
    const v = withFormulas(base).formulas.find((f) => f.key === "reserve:V")!;
    const spec = { ...base, formulas: [...base.formulas, { section: v.section, label: v.label, text: v.text.replace("V_t = ", "V_t = zzz_{x+t} + ") }] };
    const flow = calcFlow(spec, contract);
    const res = flow.modules.find((m) => m.kind === "res")!;
    expect(res.status).toBe("warn");
    expect(res.notes.join()).toContain("V:");
    expect(flow.modules.filter((m) => m.kind !== "res").every((m) => m.status === "ok")).toBe(true);
    expect(flow.calc.premium).toBe(computeSpec(base, contract).premium);   // 보험료는 그대로
    expect(flow.cells[res.cell].code).not.toContain("V_100k[t]");
    if (!python) return;
    const r = runPy(flow.cells.map((c) => c.code).join("\n"));
    expect(r.status, r.stderr).toBe(0);
    expect(compareFlow(flow.compare, pythonCompare(r.stdout.slice(r.stdout.lastIndexOf("COMPARE ")))).first).toBeUndefined();
  }, 60000);
});

describe("산출 흐름 — 갈래와 비교", () => {
  it("암보험 — 계약 단위 셋, 보장마다 갈래 하나", () => {
    const flow = calcFlow(sample("cancerPlan"), contract);
    expect(new Set(flow.modules.filter((m) => m.lane).map((m) => m.unit)).size).toBe(3);
    expect(flow.modules.find((m) => m.id === "total")!.inputs).toEqual(flow.calc.sheets.map((s) => `${s.id}:prem`));
  });

  it("저축보험 — 예시 셋이 갈래, 대표 값은 만기환급금", () => {
    const flow = calcFlow(sample("savings"), saveContract);
    expect(flow.savings).toBe(true);
    expect(flow.modules.filter((m) => m.kind === "refund").map((m) => m.lane)).toEqual(SAVINGS_SCENARIOS.map((s) => s.id));
    expect(flow.modules.find((m) => m.id === "credited:refund")!.headline).toContain("107.2%");
  });

  it("비교 — 파이썬·엑셀이 없으면 빈 칸, 처음 갈리는 값과 그 모듈을 짚는다", () => {
    const flow = calcFlow(sample("whole"), contract);
    const app = Object.fromEntries(flow.compare.map((r) => [r.key, r.app]));
    expect(compareFlow(flow.compare).rows.every((r) => r.ok && r.py === undefined && r.xl === undefined && r.diff === undefined)).toBe(true);
    expect(compareFlow(flow.compare, app, app).first).toBeUndefined();
    // 엑셀의 끝자리 오차는 같은 값으로 본다
    const pvb = flow.compare.find((r) => r.key.endsWith(".PVB"))!;
    expect(compareFlow(flow.compare, undefined, { ...app, [pvb.key]: pvb.app * (1 + 1e-13) }).first).toBeUndefined();
    const off = compareFlow(flow.compare, { ...app, [pvb.key]: pvb.app * 1.01, "합계.prem": 1 }, app);
    expect(off.first?.key).toBe(pvb.key);
    expect(off.first?.module).toBe(`${pvb.key.split(".")[0]}:cover`);
    expect(off.rows.filter((r) => !r.ok).map((r) => r.key)).toEqual([pvb.key, "합계.prem"]);
    expect(pythonCompare(`=== 견줄 값 ===\nRESULT []\nCOMPARE ${JSON.stringify(app)}\n`)).toEqual(app);
    expect(pythonCompare("오류")).toBeUndefined();
  });
});
