import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calcPython, pyName, pythonScript, toPython } from "@/lib/methoddoc/calc-py";
import { computeSpec, parseEquation } from "@/lib/methoddoc/calc";
import { jsonToSpec } from "@/lib/conditions/yaml";

/**
 * 보험료 계산 → 파이썬 셀. 산출방법서의 식을 그대로 옮긴 코드라, 파이썬이 돌려 낸 값이 앱의 값과 같아야 한다.
 * 이 PC 에 python 이 있으면 실제로 돌려 본다(없으면 코드 모양만).
 */
const spec = jsonToSpec(readFileSync("samples/09_종신보험(암진단포함)_MethodSpec.json", "utf8"));
const contract = { sex: "M" as const, age: 40, payYears: 20, freq: 12, sumAssured: 1e8 };
const cells = calcPython(spec, contract);
const script = pythonScript(cells);
const py = (() => { const r = spawnSync("python", ["--version"], { encoding: "utf8" }); return r.status === 0 ? "python" : null; })();

describe("보험료 계산 → 파이썬", () => {
  it("기호 → 파이썬 이름 · 식 → 파이썬 식", () => {
    expect(["l′", "N*", "G_10만", "W^{표준}", "α_S", "q^{(1)}", "환급률"].map(pyName)).toEqual(["lp", "Nstar", "G_100k", "W_std", "alpha_S", "q_1", "refund_rate"]);
    const c = { series: new Set(["l", "Q", "D"]), scalars: new Set<string>(), known: new Set<string>() };
    expect(toPython(parseEquation("l_{x+t+1} = l_{x+t} × ( 1 − Q_{x+t} )").expr, c)).toBe("(l[t]*(1-Q[t]))");
    expect(toPython(parseEquation("N_{x+t} = Σ_{u≥t} D_{x+u}").expr, c)).toBe("sum(D[u] for u in range(t, n + 1))");
    expect(toPython(parseEquation("S_t = if( t = 0, 1 − 3/12, 1 )").expr, c)).toBe("(1 if (1 if t == 0 else 0) else 1)".replace("(1 if (1 if t == 0 else 0) else 1)", "((1-div(3, 12)) if (1 if t == 0 else 0) else 1)"));
    expect(toPython(parseEquation("G₁ = round₆( G )").expr, c)).toBe("rnd(G, 6)");
  });

  it("셀 — 계약·기초율 · 위험률 표 · 담보마다 조건/유지자수/현가/보험료/준비금 · 합계, 단계마다 주석", () => {
    expect(cells.map((c) => c.title)).toEqual([
      "계약·기초율", "위험률 표",
      "담보 1. 사망·80% 이상 장해 — 조건과 위험률 계열", "담보 1. 사망·80% 이상 장해 — 유지자수·납입자수", "담보 1. 사망·80% 이상 장해 — 현가·누계와 보험금의 현가", "담보 1. 사망·80% 이상 장해 — 보험료", "담보 1. 사망·80% 이상 장해 — 책임준비금·해지환급금",
      "담보 2. 암 진단 — 조건과 위험률 계열", "담보 2. 암 진단 — 유지자수·납입자수", "담보 2. 암 진단 — 현가·누계와 보험금의 현가", "담보 2. 암 진단 — 보험료", "담보 2. 암 진단 — 책임준비금·해지환급금",
      "합계",
    ]);
    expect(script).toContain("# l_{x+t+1} = l_{x+t} × ( 1 − Q_{x+t} )");
    expect(script).toContain("l[t + 1] = (l[t]*(1-Q[t]))");
    expect(script).toContain("Nstar = ");
    expect(script).toContain("G1 = rnd(G, 6)");
    expect(script).toContain("def rnd(x, d=0):");     // .5 는 올린다 — 파이썬 round() 는 짝수로 간다
    expect(script).toContain("# V_t = [ M_{x+t}");
    expect(script).toContain('"사망률": {0: ');
  });

  it.skipIf(!py)("파이썬으로 실제로 돌리면 앱과 같은 10만원당·담보 보험료", () => {
    const dir = mkdtempSync(join(tmpdir(), "calc-py-"));
    const file = join(dir, "calc.py");
    writeFileSync(file, script);
    const r = spawnSync(py!, [file], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    expect(r.status, r.stderr).toBe(0);
    const line = r.stdout.split("\n").find((l) => l.startsWith("RESULT "));
    expect(line).toBeDefined();
    const got = JSON.parse(line!.slice(7)) as { name: string; per100k: number; premium: number }[];
    const want = computeSpec(spec, contract);
    expect(got.map((g) => [g.name, g.per100k, g.premium])).toEqual(want.benefits.map((b) => [b.name, b.per100k, b.premium]));
    // 준비금도 찍힌다
    expect(r.stdout).toContain("t, V(10만원당), W(10만원당), 환급률");
  }, 60000);
});
