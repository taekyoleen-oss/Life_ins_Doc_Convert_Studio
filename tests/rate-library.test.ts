import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { itemColumns, libraryItems, sanitizeLibrary, suggestTarget, virtualizeSources, virtualSource } from "@/lib/rate-library";
import { attachTables, mergeColumns, sheetFromText } from "@/lib/sheet";
import { yamlToSpec } from "@/lib/conditions/yaml";
import { SAMPLES } from "@/lib/samples";

/**
 * 기본 위험률 모음 — 공개 기본 위험률(앱에 든 표) + 사내 위험률 모음(이 PC 의 private/, 외부 반출 금지 — 있을 때만 시험).
 * 고른 항목 → 남·여 열로 표에 이어 붙이고(mergeColumns) 조건 위험률에 잇는다.
 */
describe("기본 위험률 모음", () => {
  it("공개 기본 위험률 — 사망률·80% 장해율·암·뇌출혈·급성심근경색증·암입원·암수술, 모두 남·여 한 항목 · 근거는 가상", () => {
    const items = libraryItems(null).filter((x) => !x.private);
    expect(items.map((x) => x.name)).toEqual(["사망률", "80% 이상 장해율", "암발생률", "뇌출혈 발생률", "급성심근경색증 발생률", "암입원율", "암수술률"]);
    for (const it of items) expect(it.source).toMatch(/경험생명표\(가상\)/);
    for (const it of items) { expect(it.M && it.F).toBeTruthy(); expect(itemColumns(it).map((c) => c.head)).toEqual([`${it.name}(남)`, `${it.name}(여)`]); }
  });

  it("모양이 어긋난 모음은 받지 않는다 · 남·여를 이름·회사로 묶는다", () => {
    expect(sanitizeLibrary({ rates: "x" })).toBeNull();
    const lib = sanitizeLibrary({ title: "t", rates: [
      { id: "A1", category: "암 발생", name: "X 발생률", sex: "M", company: "갑", ages: [40, 41], values: [0.1, 0.2] },
      { id: "A2", category: "암 발생", name: "X 발생률", sex: "F", company: "갑", ages: [40, 41], values: [0.3, 0.4] },
      { id: "B", category: "암 발생", name: "X 발생률", sex: "M", company: "을", ages: [40], values: [0.5] },
      { id: "bad", name: "깨짐", ages: [1, 2], values: [1] },
    ] })!;
    expect(lib.rates.map((r) => r.id)).toEqual(["A1", "A2", "B"]);
    const priv = libraryItems(lib).filter((x) => x.private);
    expect(priv.map((x) => [x.company, !!x.M, !!x.F])).toEqual([["갑", true, true], ["을", true, false]]);
  });

  it("표에 이어 붙이기 — 연령 합집합, 고른 위험률에 성별로 잇고, 기존 열·연결은 그대로", () => {
    const spec = yamlToSpec(SAMPLES.find((s) => s.id === "whole")!.yaml).spec;
    const sheet = sheetFromText("s", "연령\t사망률(남)\n40\t0.001\n41\t0.0011");
    const st0 = { sheet, map: [{ to: "age" as const }, { to: "rate" as const, rateId: "q", sex: "M" as const }] };
    const it = libraryItems(null).find((x) => x.name === "80% 이상 장해율")!;
    expect(suggestTarget(it, spec.rates)).toBe("r80");
    const st = mergeColumns(st0, itemColumns(it).map((c) => ({ ...c, target: "r80" })));
    expect(st.sheet.head).toEqual(["연령", "사망률(남)", "80% 이상 장해율(남)", "80% 이상 장해율(여)"]);
    expect(st.sheet.rows.length).toBe(111);                                   // 0~110세로 넓어진다
    expect(st.map.slice(2)).toEqual([{ to: "rate", rateId: "r80", sex: "M" }, { to: "rate", rateId: "r80", sex: "F" }]);
    const withT = attachTables(spec, st);
    expect(withT.rates.find((r) => r.id === "r80")!.tables!.F!.values[40]).toBeCloseTo(0.000167, 12);
    expect(withT.rates.find((r) => r.id === "q")!.table!.ages).toEqual([40, 41]);  // 기존 열은 그 나이만
    // 표가 없으면 연령 열부터
    expect(mergeColumns(null, itemColumns(it)).sheet.head).toEqual(["연령", "80% 이상 장해율(남)", "80% 이상 장해율(여)"]);
  });

  const PRIV = "private/rate-library.json";
  it.runIf(existsSync(PRIV))("이 PC 의 사내 위험률 모음(외부 반출 금지) — 142계열, 남·여로 묶임, 암 발생 분류가 있다", () => {
    const lib = sanitizeLibrary(JSON.parse(readFileSync(PRIV, "utf8")))!;
    expect(lib.rates.length).toBeGreaterThan(100);
    const items = libraryItems(lib).filter((x) => x.private);
    expect(items.some((x) => x.category === "암 발생" && x.M && x.F)).toBe(true);
    expect(lib.notice).toMatch(/외부 반출 금지/);
  });
});

describe("위험률 근거는 가상 이름으로", () => {
  // 실제 출처 모양만 흉내 낸 글귀(회차·호수는 지어낸 것)
  it("앞의 실제 출처(기관·회차·호수·무배당 예정 경험)를 떼고 경험생명표(가상) + 대상 위험률", () => {
    expect(virtualSource("보험개발원 제9회 경험생명표 사망률", "제9회 경험생명표 사망률")).toBe("경험생명표(가상) 사망률");
    expect(virtualSource("가나다 2099-1호 80%이상 재해장해 + 질병장해발생율", "80% 이상 장해율")).toBe("경험생명표(가상) 80%이상 재해장해 + 질병장해발생율");
    expect(virtualSource("보험개발원 생명장기제2099-1호 무배당 예정 경험 암발생률", "암발생률")).toBe("경험생명표(가상) 암발생률");
    expect(virtualSource("보험개발원 제9회 경험생명표(남자, 여자)의 사망률을 사용함", "사망률")).toBe("경험생명표(가상) 사망률");
    // 회사 이름 · 확인서처럼 대상 위험률이 남지 않으면 위험률 이름
    expect(virtualSource("가나다생명 · 확인서", "무배당 예정 뇌출혈 발생률")).toBe("경험생명표(가상) 무배당 예정 뇌출혈 발생률");
    expect(virtualSource("경험생명표(가상) 암발생률", "암발생률")).toBe("경험생명표(가상) 암발생률");
  });
  it("조건 파일의 근거만 고치고 주석·다른 칸은 그대로", () => {
    const y = [
      "rates:   # 위험률",
      "  - id: q",
      "    name: 사망률",
      "    role: death",
      "    source: 보험개발원 제9회 경험생명표 사망률   # 근거",
      "  - id: rc",
      "    name: 암발생률",
      "    source: 경험생명표(가상) 암발생률",
      "",
    ].join("\n");
    const out = virtualizeSources(y);
    expect(out).toContain("source: 경험생명표(가상) 사망률");
    expect(out).toContain("# 위험률");
    expect(yamlToSpec(out).spec.rates.map((r) => r.source)).toEqual(["경험생명표(가상) 사망률", "경험생명표(가상) 암발생률"]);
    expect(virtualizeSources(out)).toBe(out);
  });
});
