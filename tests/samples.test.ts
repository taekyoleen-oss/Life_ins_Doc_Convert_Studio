import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadFile } from "@/lib/load";
import { yamlToSpec } from "@/lib/conditions/yaml";
import { ExtractError } from "@/lib/methoddoc/extract";
import { autoMap, sheetFromFile } from "@/lib/sheet";
import { SAMPLES } from "@/lib/samples";

/**
 * samples/ 의 올려 볼 파일들 — [열기] 와 같은 길(loadFile)로 읽어 무엇이 조건이 되는지 고정한다.
 * samples/README.md 의 "읽히는 것" 표가 이 시험과 같아야 한다.
 */
const file = (name: string) => new File([readFileSync(`samples/${name}`)], name);
const open = async (name: string) => { const r = await loadFile(file(name)); return { ...r, ...yamlToSpec(r.yaml) }; };
const syms = (s: Awaited<ReturnType<typeof open>>["spec"]) => s.expenses.map((e) => `${e.symbol}=${e.rate ?? `${e.times}배`}`);

describe("01 앱 양식 (종신보험) — 이 앱이 낸 산출방법서", () => {
  it.each(["md", "tex", "docx"])(".%s 는 조건이 통째로 돌아온다(가입 조건·담보 포함)", async (ext) => {
    const { spec, errors } = await open(`01_앱양식_종신보험_산출방법서.${ext}`);
    const want = yamlToSpec(SAMPLES[0].yaml).spec;
    expect(errors).toEqual([]);
    expect([spec.meta.productName, spec.basis.interest, spec.basis.standardInterest]).toEqual(["종신보험", 0.025, 0.0325]);
    expect(spec.contract).toEqual({});                  // 옛 문서의 "시산 기준" 표는 읽지 않는다
    expect(syms(spec)).toEqual(syms(want));
    expect(spec.benefits.map((b) => [b.name, b.amount, b.exitRateIds?.length])).toEqual([["사망·80% 이상 장해", 1e8, 2]]);
    expect(spec.product).toEqual(want.product);
  });
  it(".pdf 는 기초율·사업비는 읽고, 넓은 표(담보 9칸·가입 조건)는 표로 되살리지 못한다", async () => {
    const { spec } = await open("01_앱양식_종신보험_산출방법서.pdf");
    expect([spec.basis.interest, spec.basis.standardInterest]).toEqual([0.025, 0.0325]);
    expect(spec.expenses).toHaveLength(6);
    expect(spec.benefits).toHaveLength(0);
    expect(spec.product?.terms).toBeUndefined();
  }, 60000);
});

describe("02 실무 양식 (든든건강보험) — 회사 산출방법서 모양", () => {
  it.each(["md", "docx", "pdf"])(".%s: 이율·해지율·위험률·사업비를 읽고, 담보는 비워 둔다 — 가입나이·기간(시산 기준)은 읽지 않는다", async (ext) => {
    const { spec, original } = await open(`02_실무양식_든든건강보험_산출방법서.${ext}`);
    expect(spec.meta.productName).toBe("무배당 든든건강보험");
    expect([spec.basis.interest, spec.basis.standardInterest, spec.basis.lapse?.[0].rate, spec.basis.lowRatio]).toEqual([0.0275, 0.0225, 0.03, 0]);
    expect(spec.rates.map((r) => r.name)).toEqual(["경험생명표 사망률", "무배당 예정 암발생률", "무배당 예정 뇌출혈발생률"]);
    expect(syms(spec)).toEqual(["α_S=0.008", "α_P=2.4배", "β_S=0.0005", "β_G=0.075", "β_S=0.0003", "β_기타=0.025"]);
    expect(spec.contract).toEqual({});
    expect(spec.benefits).toHaveLength(0);
    expect(original?.missing).toEqual([]);
  }, 60000);
});

describe("03 사업방법서 발췌 — 판매 범위 표 → M01 가입 조건", () => {
  it.each(["md", "docx"])(".%s: 병합 칸을 이어 읽어 3행, 납입주기 월납·연납", async (ext) => {
    const { spec } = await open(`03_실무양식_든든건강보험_사업방법서_발췌.${ext}`);
    expect(spec.product?.terms?.map((r) => [r.label, r.term, r.pay, r.age])).toEqual([
      ["1종(무해지환급형)", "100세만기", "10년납", "만15세 ~ 70세"],
      ["1종(무해지환급형)", "100세만기", "20년납", "만15세 ~ 65세"],
      ["2종(표준형)", "100세만기", "20년납", "만15세 ~ 65세"],
    ]);
    expect(spec.product?.payFreqs).toEqual(["월납", "연납"]);
    expect(spec.contract).toEqual({});                  // 판매 범위는 시산 기준이 아니다
  });
});

describe("04·05·06 조건 파일 · 자유설계보험 JSON · 위험률 표", () => {
  it("04 YAML 은 그대로 조건이 된다", async () => {
    const { spec, errors } = await open("04_조건파일_무해지암보험.yaml");
    expect(errors).toEqual([]);
    expect(spec).toEqual(yamlToSpec(SAMPLES[2].yaml).spec);
  });
  it("05 자유설계보험 JSON: 주계약·특약 담보와 위험률 표 4개(위험률 표 창으로)", async () => {
    const { spec, sheet } = await open("05_자유설계보험_암보험_MethodSpec.json");
    expect(spec.benefits.map((b) => [b.name, b.unit])).toEqual([["암 진단", "주계약"], ["암 입원", "특약1 암입원"]]);
    expect(sheet?.map.filter((m) => m.to === "rate")).toHaveLength(4);
    expect(sheet?.sheet.rows).toHaveLength(61);
  });
  it.each(["csv", "xlsx"])("06 위험률 표 .%s: 첫 행 열 이름, 종신 샘플 위험률에 남·여로 이어진다", async (ext) => {
    const sh = await sheetFromFile(file(`06_위험률표_종신_남녀.${ext}`));
    expect(sh.head).toEqual(["연령", "사망률(남)", "사망률(여)", "80% 이상 장해율(남)", "80% 이상 장해율(여)"]);
    expect(sh.rows).toHaveLength(71);
    expect(autoMap(sh, yamlToSpec(SAMPLES[0].yaml).spec.rates)).toEqual([
      { to: "age" }, { to: "rate", rateId: "q", sex: "M" }, { to: "rate", rateId: "q", sex: "F" },
      { to: "rate", rateId: "r80", sex: "M" }, { to: "rate", rateId: "r80", sex: "F" },
    ]);
  });
});

describe("07 스캔본 — 지금은 막고 이유를 알려 준다(그림 → 조건은 docs/이미지-PDF-변환-설계.md)", () => {
  it("글자 층이 없는 PDF 는 why=scanned", async () => {
    await expect(loadFile(file("07_스캔본_든든건강보험.pdf"))).rejects.toSatisfy((e: unknown) => e instanceof ExtractError && e.why === "scanned");
  }, 60000);
});
