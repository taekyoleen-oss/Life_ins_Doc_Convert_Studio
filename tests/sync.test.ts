import { describe, expect, it } from "vitest";
import { BASE_RATES_CSV } from "@/lib/base-rates";
import { applyChanges, diffSpec, relinkSheet, renamedRates, renameRate, syncWarnings } from "@/lib/conditions/changes";
import { mergeSpec, patchYaml, specToYaml, yamlToSpec, yamlView } from "@/lib/conditions/yaml";
import { computeSpec } from "@/lib/methoddoc/calc";
import { docToDocx } from "@/lib/methoddoc/docx";
import { extractDocx, extractText } from "@/lib/methoddoc/extract";
import { combosOf, generateFormulas, withFormulas } from "@/lib/methoddoc/formulas";
import { parseMethodDoc } from "@/lib/methoddoc/parse";
import { docToMarkdown, renderMethodDoc } from "@/lib/methoddoc/render";
import type { MethodSpec } from "@/lib/methoddoc/spec";
import { SAMPLES } from "@/lib/samples";
import { attachTables, sampleSheet } from "@/lib/sheet";

/**
 * 고친 산출방법서 → 조건 반영의 정확도.
 *  ① 손대지 않은 문서는 바뀐 곳이 없다(샘플 전부, Word 왕복)
 *  ② 칸 하나를 고친 문서는 **그 칸만** 바뀐 것으로 나오고, 반영한 조건은 그 칸을 고친 조건과 같다
 *  ③ 항목을 골라 반영하면 고른 것만 바뀐다
 * "칸 하나를 고친 문서" = 그 칸을 고친 조건으로 만든 Word 문서 — 사람이 Word 에서 그 칸을 고친 것과 같은 글이다.
 */
const sample = (id: string) => yamlToSpec(SAMPLES.find((s) => s.id === id)!.yaml).spec;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const title = (s: MethodSpec) => `${s.meta.productName} 보험료 및 책임준비금 산출방법서`;
/** 문서(docSpec 으로 만든 Word)를 되읽어 지금 조건(cur)에 반영 */
async function reflect(cur: MethodSpec, docSpec: MethodSpec) {
  const doc = await extractDocx(docToDocx(renderMethodDoc(withFormulas(docSpec)), title(docSpec)));
  const back = parseMethodDoc(doc, { fallbackName: cur.meta.productName });
  return { back, ...mergeSpec(cur, back.spec, back.evidence, { standard: !!back.format }) };
}

describe("손대지 않은 산출방법서는 바뀐 곳이 없다", () => {
  for (const s of SAMPLES) {
    it(s.id, async () => {
      const spec = sample(s.id);
      const r = await reflect(spec, spec);
      expect(r.back.format).toBeTruthy();
      expect(r.changes).toEqual([]);
      expect(r.items).toEqual([]);
    });
  }
});

type Case = [name: string, sample: string, edit: (s: MethodSpec) => void, ids: (s: MethodSpec) => string[]];
const CASES: Case[] = [
  ["적용이율", "whole", (s) => { s.basis.interest = 0.03; }, () => ["basis.interest"]],
  ["표준이율", "wholeCancer", (s) => { s.basis.standardInterest = (s.basis.standardInterest ?? 0.02) + 0.0025; }, () => ["basis.standardInterest"]],
  ["사업비 한 칸", "whole", (s) => { s.expenses[0].rate = (s.expenses[0].rate ?? 0) * 2; }, (s) => [`expenses.${s.expenses[0].symbol}`]],
  ["보장 배수", "wholeCancer", (s) => { s.benefits[1].multiple = 0.3; }, (s) => [`benefits.${s.benefits[1].id}.multiple`]],
  ["면책 기간", "wholeCancer", (s) => { s.benefits[1].waitDays = 30; }, (s) => [`benefits.${s.benefits[1].id}.waitDays`]],
  ["면책 + 삭감", "wholeCancer", (s) => { Object.assign(s.benefits[1], { reduceDays: 730, reduceRatio: 0.5 }); }, (s) => [`benefits.${s.benefits[1].id}.waitDays`]],
  ["보장금액 기준 — 보험료의 배수", "cancerPlan", (s) => { const b = s.benefits[s.benefits.length - 1]; b.base = "premium"; b.multiple = 2; delete b.amount; }, (s) => [`benefits.${s.benefits[s.benefits.length - 1].id}.multiple`]],
  ["보장의 보험기간", "wholeCancer", (s) => { s.benefits[1].endAge = 90; }, (s) => [`benefits.${s.benefits[1].id}.endAge`]],
  ["보장 이름", "wholeCancer", (s) => { s.benefits[1].name = "암 진단급여금"; }, (s) => [`benefits.${s.benefits[1].id}.name`]],
  ["위험률 이름", "twoMajor", (s) => { s.rates[2].name = "급성심근경색 발생률(가칭)"; }, (s) => [`rates.${s.rates[2].id}.name`]],
  ["위험률 기호", "twoMajor", (s) => { renameRate(s, s.rates[2].id, "rm"); }, () => ["rates.rm.id"]],
  ["위험률 근거·출처", "whole", (s) => { s.rates[0].source = "경험생명표(가상) 사망률 2차"; }, (s) => [`rates.${s.rates[0].id}.source`]],
  ["위험률 합성 이름", "whole", (s) => { s.combos = combosOf(s).map((c, i) => (i ? c : { ...c, name: "사망·장해 결합(시험)" })); }, (s) => [`combos.${combosOf(s)[0].id}`]],
  ["식 한 줄", "whole", (s) => { const f = generateFormulas(s).find((x) => x.key === "premium:G")!; s.formulas = [{ section: f.section, label: f.label, text: f.text.replace("β_G", "β_G − 0.01") }]; },
    (s) => [`formulas.${s.formulas[0].section}|${s.formulas[0].label}`]],
  ["책임준비금 관련 사항", "whole", (s) => { s.reserve.notes = [...s.reserve.notes, "시험용으로 한 줄을 더한다."]; }, () => ["reserve.notes"]],
  // 유지자를 따로 적지 않은 조건 — 문서의 [납입] 유지자 대상 위험률이 곧 납입면제 사유다
  ["납입면제 사유 빼기", "wholeCancer", (s) => { s.basis.waiverRateIds = ["r80"]; }, () => ["basis.waiverRateIds"]],
  ["적립 — 공시이율", "savings", (s) => { s.savings!.credited = 0.03; }, () => ["savings.credited"]],
  ["적립 — α 기간", "savings", (s) => { s.savings!.alphaYears = 5; }, () => ["savings.alphaYears"]],
  ["적립 — 해약공제 비율", "savings", (s) => { s.savings!.deductRatio = s.savings!.deductRatio / 2; }, () => ["savings.deductRatio"]],
  ["적립 — 최저보증 구간", "savings", (s) => { s.savings!.guarantee = s.savings!.guarantee.map((g) => ({ ...g, rate: g.rate + 0.001 })); }, () => ["savings.guarantee"]],
];

describe("칸 하나를 고친 산출방법서 — 그 칸만 바뀐 것으로 나온다", () => {
  for (const [name, id, edit, ids] of CASES) {
    it(`${name} (${id})`, async () => {
      const cur = sample(id), next = clone(cur);
      edit(next);
      const r = await reflect(cur, next);
      expect(r.items.map((x) => x.id)).toEqual(ids(next));
      expect(r.changes.length).toBeGreaterThan(0);
      expect(yamlView(r.spec)).toEqual(yamlView(next));
      for (const x of r.items) expect(x.label && x.group && x.before !== x.after).toBeTruthy();
    });
  }

  it("유지자의 대상 위험률을 바꾸면 유지자 묶음으로 나오고 조건이 같다", async () => {
    const cur = sample("cancerPlan"), next = clone(cur);
    expect(next.benefits[1].exitRateIds ?? []).toEqual([]);                // 암입원 — 빠지는 사유 없음
    next.benefits[1].exitRateIds = [...next.benefits[0].exitRateIds!];     // → 암 진단과 같은 유지자(암 발생 시 탈퇴)
    const r = await reflect(cur, next);
    expect(r.items.length).toBeGreaterThan(0);
    expect(new Set(r.items.map((x) => x.group))).toEqual(new Set(["유지자"]));
    expect(yamlView(r.spec)).toEqual(yamlView(next));
  });
});

describe("납입면제 · 다른 상품 문서", () => {
  const premium = (s: MethodSpec) => { const y = yamlToSpec(specToYaml(s)).spec; return computeSpec(attachTables(y, sampleSheet(y.rates, BASE_RATES_CSV)), { sex: "M", age: 40, payYears: 20, freq: 12 }).premium; };

  it("문서에 납입면제 사유가 더 있으면 더한다 (유지자를 적지 않은 조건)", async () => {
    const doc = sample("wholeCancer"), cur = clone(doc);
    cur.basis.waiverRateIds = ["r80"];
    const r = await reflect(cur, doc);
    expect(r.items.map((x) => [x.id, x.kind])).toEqual([["basis.waiverRateIds", "고침"]]);
    expect(premium(cur)).toBe(332000);
    expect(premium(r.spec)).toBe(342500);
  });

  it("다른 상품의 문서를 모두 반영하면 그 문서의 조건과 같은 보험료다", async () => {
    const whole = sample("whole"), cancer = sample("wholeCancer");
    expect(premium((await reflect(whole, cancer)).spec)).toBe(premium(cancer));
    expect(premium((await reflect(cancer, whole)).spec)).toBe(premium(whole));
    expect([premium(whole), premium(cancer)]).toEqual([250000, 342500]);
  });
});

describe("못 읽은 칸은 조용히 사라지지 않는다", () => {
  /** 표준 양식 Markdown 의 글자를 바꿔(from → to) 되읽는다 */
  const edited = (cur: MethodSpec, from: string | RegExp, to: string) => {
    const md = docToMarkdown(renderMethodDoc(withFormulas(cur)), title(cur));
    expect(md.replace(from, to)).not.toBe(md);
    const back = parseMethodDoc(extractText(new TextEncoder().encode(md.replace(from, to))), { fallbackName: cur.meta.productName });
    return { back, ...mergeSpec(cur, back.spec, back.evidence, { standard: !!back.format }), warn: syncWarnings(cur, back) };
  };
  const cur = sample("wholeCancer");

  it("손대지 않은 Markdown 은 경고가 없다", () => {
    for (const s of SAMPLES) {
      const spec = sample(s.id), md = docToMarkdown(renderMethodDoc(withFormulas(spec)), title(spec));
      const back = parseMethodDoc(extractText(new TextEncoder().encode(md)), { fallbackName: spec.meta.productName });
      expect(syncWarnings(spec, back).filter((w) => /읽지 못|찾지 못/.test(w)), s.id).toEqual([]);
    }
  });

  it("적용이율을 글자로 고치면 찾지 못했다고 알린다", () => {
    const r = edited(cur, /2\.500%/, "이점오");
    expect(r.items).toEqual([]);
    expect(r.warn.join("\n")).toContain("적용이율");
  });

  it("보장금액 배수 · 면책 칸의 글을 읽지 못하면 알리고 지금 값을 둔다", () => {
    const mult = edited(cur, /\| 0\.5 \| 90일 \|/, "| 반 | 90일 |");
    expect(mult.items).toEqual([]);
    expect(mult.warn.join("\n")).toMatch(/보장금액 배수.*"반"/);
    const wait = edited(cur, /\| 0\.5 \| 90일 \|/, "| 0.5 | 3개월 |");
    expect(wait.items).toEqual([]);
    expect(wait.warn.join("\n")).toMatch(/면책.*"3개월"/);
    // 일부러 지운 것("없음")은 지운 것이다
    expect(edited(cur, /\| 0\.5 \| 90일 \|/, "| 0.5 | 없음 |").items.map((x) => x.id)).toEqual([`benefits.${cur.benefits[1].id}.waitDays`]);
  });

  it("사업비 값을 읽지 못하면 알리고 지금 값을 둔다", () => {
    const e = cur.expenses[0];
    const r = edited(cur, new RegExp(`(\\| ${e.symbol.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")} \\| [^|]* \\| )[^|]*\\|`), "$1일퍼센트 |");
    expect(r.items).toEqual([]);
    expect(r.warn.join("\n")).toMatch(/사업비.*"일퍼센트"/);
  });
});

describe("고른 항목만 반영한다", () => {
  it("둘을 고친 문서에서 하나만 고르면 그 칸만 바뀌고, 조건 파일의 주석은 남는다", async () => {
    const yaml = SAMPLES.find((s) => s.id === "wholeCancer")!.yaml;
    const cur = yamlToSpec(yaml).spec, next = clone(cur);
    next.basis.interest = 0.03;
    next.benefits[1].multiple = 0.3;
    const r = await reflect(cur, next);
    const [rate, mult] = ["basis.interest", `benefits.${cur.benefits[1].id}.multiple`];
    expect(r.items.map((x) => x.id)).toEqual([rate, mult]);
    expect(r.items[0]).toMatchObject({ group: "이율", kind: "고침", before: "2.5%", after: "3%" });
    expect(yamlView(applyChanges(cur, r.spec, []))).toEqual(yamlView(cur));
    expect(applyChanges(cur, r.spec, [rate, mult])).toBe(r.spec);
    const one = applyChanges(cur, r.spec, [mult]);
    expect(one.basis.interest).toBe(cur.basis.interest);
    expect(one.benefits[1].multiple).toBe(0.3);
    expect(diffSpec(cur, one).map((x) => x.id)).toEqual([mult]);
    const out = patchYaml(`# 내가 적은 주석\n${yaml}`, one);
    expect(out).toContain("# 내가 적은 주석");
    expect(yamlToSpec(out).spec.benefits[1].multiple).toBe(0.3);
  });

  it("새 위험률을 가리키는 보장만 골라도 그 위험률이 함께 들어오고, 쓰이는 위험률은 빼지 않는다", () => {
    const cur = sample("twoMajor"), next = clone(cur);
    next.rates.push({ id: "rx", name: "새 발생률", role: "incidence" });
    next.benefits[0].rateId = "rx";
    const items = diffSpec(cur, next);
    expect(items.map((x) => [x.id, x.kind])).toEqual([["rates.rx", "더함"], [`benefits.${cur.benefits[0].id}.rateId`, "고침"]]);
    const one = applyChanges(cur, next, [items[1].id]);
    expect(one.rates.map((x) => x.id)).toContain("rx");
    // 거꾸로 — 위험률 빼기만 골랐는데 보장이 아직 쓰면 그대로 둔다
    const back = diffSpec(next, cur);
    expect(back.map((x) => [x.id, x.kind])).toEqual([[`benefits.${cur.benefits[0].id}.rateId`, "고침"], ["rates.rx", "뺌"]].sort((a, b) => (a[0] === "rates.rx" ? -1 : 1) - (b[0] === "rates.rx" ? -1 : 1)));
    expect(applyChanges(next, cur, ["rates.rx"]).rates.map((x) => x.id)).toContain("rx");
  });

  it("기호만 바꾼 위험률은 한 줄 — 고르지 않으면 옛 기호가 그대로다", () => {
    const cur = sample("twoMajor"), next = clone(cur);
    renameRate(next, "rs", "rb");
    next.basis.interest = 0.03;
    expect(diffSpec(cur, next).map((x) => x.id)).toEqual(["basis.interest", "rates.rb.id"]);
    const one = applyChanges(cur, next, ["basis.interest"]);
    expect(one.rates.map((x) => x.id)).toEqual(cur.rates.map((x) => x.id));
    expect(one.benefits.map((b) => b.exitRateIds)).toEqual(cur.benefits.map((b) => b.exitRateIds));
    expect(yamlView(applyChanges(cur, next, ["rates.rb.id"])).rates).toEqual(yamlView(next).rates);
  });

  it("기호만 바꾸면 위험률 표의 열 잇기도 따라가 보험료가 그대로다 (반영 확인 창의 '반영 뒤')", () => {
    const cur = sample("twoMajor"), next = clone(cur);
    renameRate(next, "rs", "rb");
    const st = sampleSheet(cur.rates, BASE_RATES_CSV), c = { sex: "M", age: 40, payYears: 20, freq: 12 } as const;
    const moved = renamedRates(cur.rates, next.rates);
    expect(moved).toEqual([["rs", "rb"]]);
    const was = computeSpec(attachTables(cur, st), c);
    expect(computeSpec(attachTables(next, relinkSheet(st, moved)), c).premium).toBe(was.premium);
    expect(computeSpec(attachTables(next, st), c).premium).not.toBe(was.premium);
  });
});
