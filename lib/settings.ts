/**
 * 앱 설정 — 이 브라우저에만 저장한다(localStorage). 조건 파일·패키지에는 싣지 않는다.
 * 문서 형식: 산출방법서를 Word(.docx)로 주고받을지 한글(.hwpx)로 주고받을지. 어느 쪽이든 두 형식 모두 쓸 수 있고,
 * 고른 형식이 내보내기·견본·패키지·안내 글에서 먼저 나온다.
 */
export type DocFormat = "word" | "hwp";
export interface Settings { docFormat: DocFormat }

export const SETTINGS_KEY = "life_ins_doc_convert_studio:settings";
export const SETTINGS0: Settings = { docFormat: "word" };

/** 형식마다 화면에 쓰는 이름 — 안내 글이 형식에 맞게 바뀐다 */
export const DOC_FORMATS: Record<DocFormat, { name: string; ext: string; editor: string; hint: string }> = {
  word: { name: "Word", ext: ".docx", editor: "Word 수식 편집기(Alt+=)", hint: "산출방법서를 Word(.docx)로 내려받고, Word 에서 고쳐 올립니다." },
  hwp: { name: "한글", ext: ".hwpx", editor: "한글 수식 편집기(Ctrl+N, M)", hint: "산출방법서를 한글(.hwpx)로 내려받고, 한글에서 고쳐 올립니다. 저장할 때 파일 형식은 \"한글 표준 문서 (*.hwpx)\". 한글 파일 만들기는 시험 중입니다 — 한글에서 열리지 않으면 Word(.docx)로 내려받아 한글에서 여세요." },
};

export function readSettings(): Settings {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<Settings> | null;
    return { docFormat: v?.docFormat === "hwp" ? "hwp" : "word" };
  } catch { return SETTINGS0; }
}

export function writeSettings(s: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* 저장소를 못 쓰면 이번 화면에서만 */ }
}
