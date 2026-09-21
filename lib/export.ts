import katex from "katex";
import { docToHtml, docToMarkdown, type DocSection } from "./methoddoc/render";
import { docToLatex, formulaToTex } from "./methoddoc/tex";
import type { MethodSpec } from "./methoddoc/spec";

/** 브라우저에서 파일로 내려받기 */
export function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

const safe = (s: string) => (s || "상품").replace(/[^\w가-힣]+/g, "_");
const KATEX_CSS = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.18.4/dist/katex.min.css">';

export const exporters = {
  yaml: (yaml: string, spec: MethodSpec) => download(`${safe(spec.meta.productName)}_조건.yaml`, yaml, "text/yaml"),
  /** 다른 앱에 넘기는 형식. 식은 조건에서 다시 만들 수 있어 사용자가 적은 것만 싣는다 */
  json: (spec: MethodSpec) => download(`${safe(spec.meta.productName)}_MethodSpec.json`, JSON.stringify(spec, null, 2), "application/json"),
  md: (sections: DocSection[], title: string, spec: MethodSpec) => download(`${safe(spec.meta.productName)}_산출방법서.md`, "﻿" + docToMarkdown(sections, title), "text/markdown"),
  tex: (sections: DocSection[], title: string, spec: MethodSpec) => download(`${safe(spec.meta.productName)}_산출방법서.tex`, docToLatex(sections, title), "application/x-tex"),
  html: (sections: DocSection[], title: string, spec: MethodSpec) => download(`${safe(spec.meta.productName)}_산출방법서.html`,
    docToHtml(sections, title, (t) => katex.renderToString(formulaToTex(t), { displayMode: true, throwOnError: false, strict: "ignore" }), KATEX_CSS), "text/html"),
};
