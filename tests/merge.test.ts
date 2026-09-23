import { describe, expect, it } from "vitest";
import { mergeSpec, yamlToSpec } from "@/lib/conditions/yaml";
import { extractText } from "@/lib/methoddoc/extract";
import { withFormulas } from "@/lib/methoddoc/formulas";
import { parseMethodDoc } from "@/lib/methoddoc/parse";
import { docToMarkdown, renderMethodDoc } from "@/lib/methoddoc/render";
import { SAMPLES } from "@/lib/samples";
import { attachTables, autoMap, newRateId, sheetFromDoc, sheetFromSpec, sheetFromText } from "@/lib/sheet";

/**
 * 산출방법서를 고쳐 올릴 때 "문서에서 지운 것"도 조건에서 빠지는지, 위험률 값 표가 문서를 거쳐 돌아오는지.
 * (Word·Markdown 은 같은 블록에서 나오므로 Markdown 으로 왕복한다)
 */
const roundtrip = (spec: ReturnType<typeof yamlToSpec>["spec"], edit: (md: string) => string) => {
  const md = edit(docToMarkdown(renderMethodDoc(withFormulas(spec))));
  const doc = extractText(new TextEncoder().encode(md));
  const back = parseMethodDoc(doc, { fallbackName: spec.meta.productName });
  return { doc, back, ...mergeSpec(spec, back.spec, back.evidence, { standard: !!back.format }) };
};

describe("고친 산출방법서 → 조건 (지운 것도 반영)", () => {
  it("담보 표의 면책을 '없음' 으로, 연령 구간 주석을 지우면 조건에서도 빠진다", () => {
    const { spec } = yamlToSpec(SAMPLES[1].yaml);
    spec.benefits[0].waitDays = 90;
    spec.benefits[0].steps = [{ fromAge: 40, toAge: 59, multiple: 1 }, { fromAge: 60, toAge: 80, multiple: 0.5 }];
    const { spec: out, changes } = roundtrip(spec, (md) => md.replace("| 면책 | 90일 |", "| 면책 | 없음 |").replace(/^> ※ .*연령 구간 배수.*$/m, ""));
    expect(changes).toEqual(["benefits: 1개 → 1개 갱신"]);
    expect(out.benefits[0].waitDays).toBeUndefined();
    expect(out.benefits[0].steps).toBeUndefined();
    expect(out.benefits[0]).toMatchObject({ id: spec.benefits[0].id, amount: 30000000, endAge: 80, rateId: "r2", exitRateIds: ["q", "r2"] });
  });

  it("위험률 표에서 담보가 쓰지 않는 행을 지우면 조건에서 빠지고, 쓰는 행은 남는다", () => {
    const { spec } = yamlToSpec(SAMPLES[1].yaml);
    spec.rates.push({ id: "z", name: "안 쓰는 발생률", role: "incidence" });
    const { spec: out, changes } = roundtrip(spec, (md) => md.replace(/^\| 안 쓰는 발생률 \|.*$\n/m, ""));
    expect(changes).toEqual(['rates: "안 쓰는 발생률" 삭제']);
    expect(out.rates.map((r) => r.id)).toEqual(["q", "r2"]);
    // 담보가 쓰는 행을 지워도(문서 실수) 담보가 가리키므로 남는다
    const kept = roundtrip(spec, (md) => md.replace(/^\| 2대질병 발생률 \|.*$\n/m, ""));
    expect(kept.spec.rates.some((r) => r.id === "r2")).toBe(true);
  });

  it("담보 표에만 적은 위험률은 계열로 더해 잇고 경고한다", () => {
    const { spec } = yamlToSpec(SAMPLES[1].yaml);
    const { back, spec: out, changes } = roundtrip(spec, (md) => md.replace("| 급부 위험률 | 2대질병 발생률 |", "| 급부 위험률 | 3대질병 발생률 |"));
    expect(back.warnings.some((w) => /"3대질병 발생률".*위험률 표에 없어.*더했습니다/.test(w))).toBe(true);
    const added = out.rates.find((r) => r.name === "3대질병 발생률")!;
    expect(added.role).toBe("incidence");
    expect(out.benefits[0].rateId).toBe(added.id);
    // 담보의 위험률이 바뀌어 문서의 옛 자동 식(유지자수·납입자수)이 새 자동 식과 달라졌어도, 그것은 사람이 고친 식이 아니다 — 조건의 식으로 남지 않는다
    expect(changes).toEqual(['rates: "3대질병 발생률" 추가', "benefits: 1개 → 1개 갱신"]);
    expect(out.formulas).toEqual([]);
  });

  it("새 위험률 id 는 산출식 기호(q · r · g · f · w)를 따른다", () => {
    expect([newRateId("death", []), newRateId("incidence", ["r"]), newRateId("recurring", []), newRateId("waiver", []), newRateId("lapse", []), newRateId("other", [])])
      .toEqual(["q", "r2", "g", "f", "w", "o"]);
  });
});

describe("위험률 값 표 — 별첨으로 문서에 실리고 되읽으면 위험률 표 창으로", () => {
  const { spec } = yamlToSpec(SAMPLES[0].yaml);     // 종신: q · r80
  const sheet = sheetFromText("표", "연령\t사망률(남)\t사망률(여)\t80% 이상 장해율\n40\t0.001\t0.0005\t0.0012\n41\t0.0011\t0.0006\t0.0013");
  const map = autoMap(sheet, [{ id: "q", name: "사망률" }, ...spec.rates.slice(1)]);
  const withT = attachTables(spec, { sheet, map: map.map((m) => (m.to === "rate" && m.rateId === "q" ? { ...m, rateId: "q" } : m)) });

  it("표가 있으면 맨 뒤에 '별첨 — 위험률 표' 절(연령 × 열), 없으면 절이 없다", () => {
    const secs = renderMethodDoc(withFormulas(withT));
    const last = secs[secs.length - 1];
    expect(last.title).toMatch(/^\d+\. 별첨 — 위험률 표$/);
    const t = last.blocks.find((b) => b.t === "table");
    expect(t && t.t === "table" ? [t.head, t.rows] : null).toEqual([
      ["연령", "제7회 경험생명표 사망률(남)", "제7회 경험생명표 사망률(여)", "80% 이상 장해율"],
      [[40, 0.001, 0.0005, 0.0012], [41, 0.0011, 0.0006, 0.0013]],
    ]);
    expect(renderMethodDoc(withFormulas(spec)).some((s) => /별첨/.test(s.title))).toBe(false);
  });

  it("Markdown 으로 내고 되읽으면 조건은 같고, 별첨 표는 위험률 표 창이 되어 같은 열에 이어진다", () => {
    const { doc, back, changes } = roundtrip(withT, (md) => md);
    expect(changes).toEqual([]);
    const sh = sheetFromDoc(doc, "되읽기")!;
    expect(sh.head).toEqual(sheetFromSpec(withT, "")!.sheet.head);
    expect(sh.rows).toEqual([["40", "0.001", "0.0005", "0.0012"], ["41", "0.0011", "0.0006", "0.0013"]]);
    expect(autoMap(sh, back.spec.rates)).toEqual([{ to: "age" }, { to: "rate", rateId: "q", sex: "M" }, { to: "rate", rateId: "q", sex: "F" }, { to: "rate", rateId: "r80" }]);
    expect(attachTables(spec, { sheet: sh, map: autoMap(sh, back.spec.rates) }).rates.map((r) => r.tables ?? r.table)).toEqual(withT.rates.map((r) => r.tables ?? r.table));
  });

  it("쪽마다 나뉜 표(같은 열 이름)는 하나로 잇고, 연령 표가 아니면 null", () => {
    const doc = extractText(new TextEncoder().encode(["| 연령 | 암발생률 |", "|---|---|", "| 40세 | 0.001 |", "| 41세 | 0.002 |", "", "| 연령 | 암발생률 |", "|---|---|", "| 42세 | 0.003 |", "| 43세 | — |", "",
      "| 구분 | 값 |", "|---|---|", "| 적용이율 i | 2.5% |", "| 표준이율 | 3% |"].join("\n")));
    const sh = sheetFromDoc(doc, "x")!;
    expect(sh.head).toEqual(["연령", "암발생률"]);
    expect(sh.rows).toEqual([["40", "0.001"], ["41", "0.002"], ["42", "0.003"], ["43", ""]]);
    expect(sheetFromDoc(extractText(new TextEncoder().encode("| 구분 | 값 |\n|---|---|\n| 적용이율 i | 2.5% |")), "x")).toBeNull();
  });
});
