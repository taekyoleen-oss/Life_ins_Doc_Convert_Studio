import { formulaToTex, toTex } from "./methoddoc/tex";

/**
 * 산출방법서에 넣는 수식·기호·문서 요소 견본.
 * 식은 앱의 평문 수식 표기("l_{x+t+1} = l_{x+t} × ( 1 − q_{x+t} )")로 한 번만 적고,
 * LaTeX 탭에는 formulaToTex 로, Markdown 탭에는 코드 블록으로 바꿔 넣는다 — 산출방법서 화면과 같은 변환이다.
 */

export type SnippetMode = "latex" | "markdown" | "plain";

/** 기호 — tex.ts 의 SYMBOL 표가 LaTeX 명령으로 바꾸는 것만 둔다 */
export const SYMBOLS = ["α", "β", "γ", "δ", "θ", "Σ", "·", "×", "÷", "−", "≥", "≤", "′", "½", "→", "…", "Ā"];

/** 식의 조각 */
export const PIECES: { label: string; text: string }[] = [
  { label: "아래첨자", text: "x_{t}" },
  { label: "위첨자", text: "v^{t}" },
  { label: "연령 x+t", text: "_{x+t}" },
  { label: "합 Σ", text: "Σ_{t=0}^{n−1}" },
  { label: "min", text: "min( a, b )" },
  { label: "max", text: "max( a, b )" },
  { label: "나누기", text: "( a ) / ( b )" },
];

export interface FormulaSample { group: string; label: string; text: string }

/** 산출식 견본 — 모두 KaTeX 로 그려지는지 tests/snippets.test.ts 가 확인한다 */
export const FORMULA_SAMPLES: FormulaSample[] = [
  { group: "기초", label: "현가율", text: "v = 1/( 1 + i )" },
  { group: "기초", label: "연납 환산 납입기수", text: "N* = mm · [ ( N′_x − N′_{x+m} ) − ( mm−1 )/( 2·mm )·( D′_x − D′_{x+m} ) ]" },
  { group: "유지자수", label: "탈퇴 사유 1개", text: "l_{x+t+1} = l_{x+t} × ( 1 − q_{x+t} )" },
  { group: "유지자수", label: "탈퇴 사유 2개", text: "l_{x+t+1} = l_{x+t} × ( 1 − q_{x+t} − k_{x+t} + q_{x+t}·k_{x+t}/2 )" },
  { group: "유지자수", label: "납입자수 (추가 면제 f)", text: "l′_{x+t+1} = l′_{x+t} × ( 1 − Q_{x+t} − f_{x+t} + Q_{x+t}·f_{x+t}/2 )" },
  { group: "유지자수", label: "해지율 w 포함", text: "l_{x+t+1} = l_{x+t} × ( 1 − Q_{x+t} − w_{x+t} + Q_{x+t}·w_{x+t}/2 )" },
  { group: "계산기수", label: "D", text: "D_{x+t} = l_{x+t}·v^t" },
  { group: "계산기수", label: "C (진단·발생)", text: "C_{x+t} = l_{x+t}·k_{x+t}·v^{t+½}" },
  { group: "계산기수", label: "C (사망형)", text: "C_{x+t} = ( l_{x+t} − l_{x+t+1} )·v^{t+½}" },
  { group: "계산기수", label: "N", text: "N_{x+t} = Σ_{u≥t} D_{x+u}" },
  { group: "계산기수", label: "M", text: "M_{x+t} = Σ_{u≥t} C_{x+u}" },
  { group: "보험료", label: "순보험료", text: "P = ( M_x − M_{x+n} ) / ( N_x − N_{x+m} )" },
  { group: "보험료", label: "영업보험료 (3이원)", text: "G = [ P + α·D′_x/N* + β·( N_x − N_{x+n} )/N* ] / ( 1 − γ )" },
  { group: "보험료", label: "영업보험료 (산출방법서형)", text: "G = [ P + ( α_S + α_P·P_base )·D′_x/N* + β_S/mm + β′·( N_{x+m} − N_{x+n} )/N* ] / ( 1 − β_G − γ )" },
  { group: "준비금", label: "순보식 준비금", text: "V_t = ( M_{x+t} − M_{x+n} − P·( N_{x+t} − N_{x+m} ) ) / D_{x+t}" },
  { group: "해지환급금", label: "해약공제", text: "해약공제_t = α · max( min(m,7) − t, 0 ) / min(m,7)" },
  { group: "해지환급금", label: "해지환급금", text: "W_t = max( V_t − 해약공제_t, 0 )" },
  { group: "해지환급금", label: "환급률", text: "환급률_t = W_t / 납입누계_t" },
];

/** 견본을 조건의 식(formulas)으로 더할 때 넣을 절 — 자동 생성 식과 같은 절에 붙는다 */
export const SECTION_OF: Record<string, string> = {
  기초: "계산기수", 유지자수: "계산기수", 계산기수: "계산기수",
  보험료: "보험료의 계산", 준비금: "책임준비금의 계산", 해지환급금: "해지환급금의 계산",
};

/** 문서 요소 — 편집 탭에서만 */
export const DOC_PARTS: Record<"latex" | "markdown", { label: string; text: string }[]> = {
  latex: [
    { label: "절 제목", text: "\\subsection*{3.1. 제목}\n" },
    { label: "비고", text: "\\begin{quote}\\small\n비고를 적습니다.\n\\end{quote}\n" },
    { label: "표 (2열)", text: "\\begin{center}\\small\n\\begin{tabular}{|l|l|}\n\\hline\n\\textbf{구분} & \\textbf{값} \\\\\n\\hline\n항목 & 값 \\\\\n\\hline\n\\end{tabular}\n\\end{center}\n" },
    { label: "수식 블록", text: "\\begin{align*}\n& \n\\end{align*}\n" },
    { label: "글 속 수식", text: "$ $" },
  ],
  markdown: [
    { label: "절 제목", text: "## 제목\n" },
    { label: "비고", text: "> 비고를 적습니다.\n" },
    { label: "표 (2열)", text: "| 구분 | 값 |\n|---|---|\n| 항목 | 값 |\n" },
    { label: "수식 블록", text: "```\n\n```\n" },
  ],
};

/** 편집 탭에 넣을 글 — 식 한 덩어리 */
export function formulaSnippet(mode: SnippetMode, text: string): string {
  if (mode === "latex") return `${formulaToTex(text, "align*")}\n`;
  if (mode === "markdown") return `\`\`\`\n${text}\n\`\`\`\n`;
  return text;
}

/** 편집 탭에 넣을 글 — 기호·조각(식 안에 끼우는 것) */
export const inlineSnippet = (mode: SnippetMode, text: string) => (mode === "latex" ? toTex(text) : text);
