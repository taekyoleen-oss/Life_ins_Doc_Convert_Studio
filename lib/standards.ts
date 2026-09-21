import { SAMPLES } from "./samples";
import { yamlToSpec } from "./conditions/yaml";
import { withFormulas } from "./methoddoc/formulas";
import { renderMethodDoc, STANDARD_FORMAT } from "./methoddoc/render";
import { docToDocx } from "./methoddoc/docx";
import type { MethodSpec } from "./methoddoc/spec";

/**
 * 표준 산출방법서 — 상품별 견본 문서(Word · 한글). 사람은 이 문서를 고쳐 올리고, 앱은 정해진 순서대로 되읽는다.
 * 새 상품을 더하려면 아래 목록에 한 줄(이름 + 조건 YAML)을 넣고 `STANDARDS_UPDATE=1` 로 시험을 돌려 파일을 다시 만든다.
 * 파일 이름은 늘 "표준_산출방법서_<이름>".
 */
export interface Standard { id: string; name: string; hint: string; yaml: string }

const sample = (id: string) => SAMPLES.find((s) => s.id === id)!.yaml;

export const STANDARDS: Standard[] = [
  { id: "whole", name: "종신보험", hint: "사망·80% 이상 장해 — 탈퇴 사유 둘, 종신", yaml: sample("whole") },
  { id: "disease", name: "질병보험", hint: "2대질병 진단 — 진단하면 소멸, 80세 만기", yaml: sample("twoMajor") },
  { id: "cancer", name: "암보험", hint: "무해지환급형 — 적용해지율·환급률", yaml: sample("noRefund") },
];

export const standardFile = (s: Standard) => `표준_산출방법서_${s.name}`;
/** 견본 파일의 작성일 — 비워 두면 매번 오늘 날짜가 찍혀 파일이 달라진다 */
export const STANDARD_DATE = "2026. 9. 21.";

/** 표준 양식 맨 앞의 "작성 안내" 표 — parse 는 읽지 않는다 */
export const STANDARD_GUIDE = [
  `이 문서는 ${STANDARD_FORMAT} 양식입니다. 개요 표의 "양식" 행을 지우지 마세요 — 앱은 이 행을 보고 정해진 순서대로 읽습니다.`,
  "표의 머리글(첫 행)과 절 제목(1. 기초율에 관한 사항 …)은 그대로 두고 값 칸을 고칩니다. 표에 행을 더하면 조건에도 더해집니다(위험률 · 사업비 · 담보 · 가입 조건).",
  "수식은 [식] 으로 시작하는 제목 줄 아래에 한 줄씩 적습니다. 아래첨자는 _{x+t}, 위첨자는 ^{t}, 곱은 × 또는 · 로 씁니다. Word·한글 수식 편집기로 넣은 식도 읽습니다.",
  "식을 더하려면 알맞은 절(계산기수 · 보험료의 계산 · 책임준비금의 계산 · 해지환급금의 계산)에 [식] 제목 줄과 식 줄을 넣습니다. ※ 로 시작하는 줄은 바로 위 식의 설명입니다.",
  "앱이 조건으로 만드는 식과 같은 식은 조건에 따로 싣지 않고, 고친 식과 새 식만 조건(M08 수식)에 들어갑니다. 자동 식을 지워도 조건에서 다시 만들어집니다.",
  "책임준비금 · 해지환급금 관련 사항 절에는 ※ 로 시작하는 줄로 사항을 더합니다. 번호를 붙인 새 절(예: 9. 기타 사항)을 더하면 원문 절로 보존됩니다.",
  "한글(HWPX)로 고치려면 이 파일을 한글에서 열어 [다른 이름으로 저장 → HWPX 문서] 로 저장한 뒤 고칩니다. 이 안내 표는 지워도 됩니다.",
];

export const docTitle = (spec: MethodSpec) => `${spec.meta.productName || "상품"} 보험료 및 책임준비금 산출방법서`;

/** 조건 → 표준 산출방법서 Word 파일 */
export function toStandardDocx(spec: MethodSpec, guide = true): Uint8Array {
  return docToDocx(renderMethodDoc(withFormulas(spec)), docTitle(spec), guide ? { guide: STANDARD_GUIDE } : {});
}

/** 견본 조건 — 작성일을 박아 파일이 늘 같게 */
export const standardSpec = (s: Standard): MethodSpec => {
  const spec = yamlToSpec(s.yaml).spec;
  return { ...spec, meta: { ...spec.meta, date: spec.meta.date ?? STANDARD_DATE } };
};
