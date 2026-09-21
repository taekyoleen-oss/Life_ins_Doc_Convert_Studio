import { extractDoc, extractText, type ExtractedDoc } from "./methoddoc/extract";
import { parseMethodDoc } from "./methoddoc/parse";
import type { Evidence } from "./methoddoc/spec";
import { latexToDoc } from "./methoddoc/tex";
import { jsonToSpec, specToYaml } from "./conditions/yaml";
import { sheetFromSpec, type SheetState } from "./sheet";

/** 불러온 산출방법서 원문 — 원문 탭과 근거 연결에 쓴다 */
export interface Original {
  name: string;
  doc: ExtractedDoc;
  evidence: Evidence[];
  missing: string[];
  /** PDF 는 원본 보기용 주소 (다 쓰면 revokeObjectURL) */
  pdfUrl?: string;
}

export interface Loaded {
  yaml: string;
  original?: Original;
  /** LaTeX·Markdown 으로 받은 산출방법서는 그 원문을 편집 탭에 그대로 올린다 */
  source?: { kind: "latex" | "markdown"; text: string };
  /** MethodSpec JSON 에 실려 온 위험률 표 — 위험률 표 창으로 */
  sheet?: SheetState;
  message: string;
}

export const ACCEPT = ".pdf,.docx,.hwp,.hwpx,.tex,.md,.txt,.yaml,.yml,.json";

const ext = (name: string) => (name.split(".").pop() ?? "").toLowerCase();

/** 산출방법서 문서 → 조건. 값마다 출처를 주석으로 달고, 못 찾은 항목을 머리말에 적는다 */
function fromDoc(name: string, doc: ExtractedDoc): { yaml: string; original: Original } {
  const r = parseMethodDoc(doc, { fallbackName: name.replace(/\.[^.]+$/, "") });
  // 원문 절(번호 체계로 자른 문단 묶음)은 PDF 에서 날짜·쪽번호가 제목으로 잡히는 잡음이 많다 — 원문은 [원문] 탭에 그대로 있으니 조건에는 싣지 않는다
  r.spec.sections = [];
  const header = [
    ` ${name} 에서 읽은 조건 — 값 옆 주석이 원문 위치와 확신도입니다(원문 탭에서 확인).`,
    r.missing.length ? ` 못 찾은 항목: ${r.missing.join(", ")} — 직접 채워 주세요.` : "",
    r.evidence.some((e) => e.confidence === "low") ? " ⚠ 추정 값은 반드시 확인하세요." : "",
  ].filter(Boolean).join("\n");
  return { yaml: specToYaml(r.spec, r.evidence, header), original: { name, doc, evidence: r.evidence, missing: r.missing } };
}

export async function loadFile(file: File): Promise<Loaded> {
  const e = ext(file.name);
  if (e === "yaml" || e === "yml") return { yaml: await file.text(), message: `${file.name} — 조건 파일을 열었습니다` };
  if (e === "json") {
    const spec = jsonToSpec(await file.text());
    const sheet = sheetFromSpec(spec, file.name) ?? undefined;
    return { yaml: specToYaml(spec, [], ` ${file.name} (MethodSpec JSON) 에서 불러온 조건`), sheet,
      message: `${file.name} — MethodSpec 을 조건으로 옮겼습니다${sheet ? ` (위험률 표 ${sheet.map.length - 1}개는 아래 위험률 표로)` : ""}` };
  }
  if (e === "tex") {
    const text = await file.text();
    const { yaml, original } = fromDoc(file.name, latexToDoc(text));
    return { yaml, original, source: { kind: "latex", text }, message: `${file.name} — LaTeX 산출방법서를 읽어 조건으로 옮겼습니다` };
  }
  if (e === "md" || e === "txt") {
    const text = await file.text();
    const { yaml, original } = fromDoc(file.name, extractText(new TextEncoder().encode(text)));
    return { yaml, original, source: e === "md" ? { kind: "markdown", text } : undefined, message: `${file.name} — 산출방법서를 읽어 조건으로 옮겼습니다` };
  }
  const doc = await extractDoc(file.name, new Uint8Array(await file.arrayBuffer()));
  const { yaml, original } = fromDoc(file.name, doc);
  if (e === "pdf") original.pdfUrl = URL.createObjectURL(file);
  return { yaml, original, message: `${file.name} — 문단 ${doc.paragraphs.length}·표 ${doc.tables.length}에서 조건 ${original.evidence.length}개를 읽었습니다` };
}
