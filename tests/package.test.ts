import { describe, expect, it } from "vitest";
import { yamlToSpec } from "@/lib/conditions/yaml";
import { unzip } from "@/lib/methoddoc/extract";
import { buildPackage, isPackage, PACKAGE_FORMAT, readPackage } from "@/lib/package";
import { RATE_SAMPLE_CSV } from "@/lib/rate-sample";
import { SAMPLES } from "@/lib/samples";
import { attachTables, sampleSheet } from "@/lib/sheet";

/** 패키지(.lidpkg): 조건 · 산출방법서 · 위험률 표 한 파일 — 저장 → 열기 왕복, 위험률 표 없는 패키지, 샘플 세트 */
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe("패키지 저장 → 열기", () => {
  const yaml = SAMPLES[0].yaml;                                    // 종신: q · r80
  const sheet = sampleSheet(yamlToSpec(yaml).spec.rates, RATE_SAMPLE_CSV)!;
  const spec = attachTables(yamlToSpec(yaml).spec, sheet);

  it("든 것: package.json · 조건.yaml · 위험률표.csv · MethodSpec.json · 산출방법서.md · .docx — 조건 원문과 표가 그대로 돌아온다", async () => {
    const buf = buildPackage({ yaml, sheet, spec, now: new Date("2026-09-25T09:00:00Z") });
    expect(isPackage(buf)).toBe(true);
    const files = await unzip(buf);
    expect([...files.keys()]).toEqual(["package.json", "조건.yaml", "위험률표.csv", "MethodSpec.json", "산출방법서.md", "산출방법서.docx"]);
    expect(dec(files.get("조건.yaml")!)).toBe(yaml);                                // 주석까지 원문 그대로
    expect(files.get("위험률표.csv")!.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));                       // Excel 용 BOM
    expect(dec(files.get("위험률표.csv")!)).toMatch(/^연령,사망률\(남\),사망률\(여\),80% 이상 장해율\n15,/);
    const q = JSON.parse(dec(files.get("MethodSpec.json")!)).rates[0].tables.F;
    expect(q.values[q.ages.indexOf(40)]).toBeCloseTo(0.00051, 12);                    // 40세 여자 사망률
    expect(dec(files.get("산출방법서.md")!)).toContain("별첨 — 위험률 표");
    expect(files.get("산출방법서.docx")!.length).toBeGreaterThan(5000);
    const r = await readPackage(buf);
    expect(r.meta).toMatchObject({ format: PACKAGE_FORMAT, product: "종신보험", rates: 2, tables: 2, savedAt: "2026-09-25T09:00:00.000Z" });
    expect(r.yaml).toBe(yaml);
    expect(r.sheet).toEqual(sheet);
    expect(attachTables(yamlToSpec(r.yaml!).spec, r.sheet!).rates).toEqual(spec.rates);   // 다시 붙여도 같은 표
  });

  it("위험률 표가 없어도 패키지가 된다 — 열면 표 없음", async () => {
    const buf = buildPackage({ yaml, sheet: null, spec: yamlToSpec(yaml).spec });
    const files = await unzip(buf);
    expect(files.has("위험률표.csv")).toBe(false);
    const r = await readPackage(buf);
    expect([r.yaml, r.sheet, r.meta.tables]).toEqual([yaml, undefined, 0]);
  });

  it("조건.yaml 이 없고 MethodSpec.json 만 있으면 거기서 조건을 만든다 · 패키지가 아니면 오류", async () => {
    const buf = buildPackage({ yaml, sheet, spec });
    const files = await unzip(buf);
    files.delete("조건.yaml");
    const { zipStore } = await import("@/lib/methoddoc/docx");
    const r = await readPackage(zipStore([...files]));
    expect(yamlToSpec(r.yaml!).spec.meta.productName).toBe("종신보험");
    await expect(readPackage(zipStore([["a.txt", new TextEncoder().encode("x")]]))).rejects.toThrow(/패키지.*아닙니다/);
    expect(isPackage(new TextEncoder().encode("meta:"))).toBe(false);
  });
});

describe("샘플 세트 — 조건마다 견본 표에서 이름이 맞는 열만", () => {
  it.each(SAMPLES.map((s) => s.id))("%s: 연령 + 그 조건의 위험률 열, 조건에 없는 열은 없다", (id) => {
    const spec = yamlToSpec(SAMPLES.find((s) => s.id === id)!.yaml).spec;
    const st = sampleSheet(spec.rates, RATE_SAMPLE_CSV)!;
    expect(st.map[0]).toEqual({ to: "age" });
    expect(st.map.slice(1).every((m) => m.to === "rate")).toBe(true);
    const linked = new Set(st.map.flatMap((m) => (m.to === "rate" ? [m.rateId] : [])));
    for (const r of spec.rates) expect(linked.has(r.id)).toBe(true);           // 샘플의 위험률은 모두 표가 있다
    expect(st.sheet.rows.length).toBe(66);
  });
});
