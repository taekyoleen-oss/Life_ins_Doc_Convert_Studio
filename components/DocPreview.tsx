"use client";

import { useEffect, useMemo, useRef } from "react";
import katex from "katex";
import { isNumericCell, subSup, type DocSection } from "@/lib/methoddoc/render";
import { formulaToTex } from "@/lib/methoddoc/tex";
import { matchBlocks, splitPaths } from "@/lib/conditions/link";

/** 평문 수식 → KaTeX HTML. 실패하면 첨자만 살린 평문 */
const texCache = new Map<string, string>();
export function formulaHtml(text: string): string {
  let html = texCache.get(text);
  if (html === undefined) {
    try { html = katex.renderToString(formulaToTex(text), { displayMode: true, throwOnError: true, strict: "ignore" }); }
    catch { html = `<pre>${subSup(text)}</pre>`; }
    if (texCache.size > 500) texCache.clear();
    texCache.set(text, html);
  }
  return html;
}

type Item =
  | { kind: "p" | "note" | "formula"; text: string; path?: string }
  | { kind: "row"; cells: (string | number)[]; path?: string };

interface Props {
  sections: DocSection[];
  title: string;
  /** 왼쪽에서 고른 조건 경로 */
  highlight: string[];
  /** 마지막으로 연 조건과 다른 경로 → 그 조건이 만든 블록에 "바뀜" 표시 */
  changed?: string[];
  /** 왼쪽에서 고른 경우 강조된 곳으로 스크롤 */
  follow: boolean;
  /** 미리보기에서 고른 블록의 조건 경로 (클릭이면 scroll=true) */
  onPick: (paths: string[], scroll: boolean) => void;
}

export default function DocPreview({ sections, title, highlight, changed = [], follow, onPick }: Props) {
  const body = useRef<HTMLDivElement | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  // 블록·표 행을 한 줄로 늘어놓아 번호를 매긴다(강조 계산 단위)
  const { items, layout } = useMemo(() => {
    const items: Item[] = [];
    const layout = sections.map((sec) => ({
      sec,
      blocks: sec.blocks.map((b) => {
        if (b.t !== "table") { items.push({ kind: b.t, text: b.text, path: b.path }); return { b, first: items.length - 1 }; }
        const first = items.length;
        b.rows.forEach((cells, i) => items.push({ kind: "row", cells, path: b.rowPaths?.[i] }));
        return { b, first };
      }),
    }));
    return { items, layout };
  }, [sections]);

  const hl = useMemo(() => matchBlocks(items.map((it) => splitPaths(it.path)), highlight), [items, highlight]);
  const ch = useMemo(() => matchBlocks(items.map((it) => splitPaths(it.path)), changed), [items, changed]);

  useEffect(() => {
    if (!follow || !hl.size) return;
    body.current?.querySelector(".doc-hl")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [hl, follow]);

  // 끌어서 고른 범위 → 걸친 블록들의 경로
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      const root = body.current;
      if (!sel || sel.isCollapsed || !sel.rangeCount || !root) return;
      const r = sel.getRangeAt(0);
      if (!root.contains(r.commonAncestorContainer)) return;
      const paths = new Set<string>();
      root.querySelectorAll<HTMLElement>("[data-path]").forEach((el) => { if (r.intersectsNode(el)) splitPaths(el.dataset.path).forEach((p) => paths.add(p)); });
      if (paths.size) onPickRef.current([...paths], false);
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const down = useRef<{ x: number; y: number } | null>(null);
  const onClick = (e: React.MouseEvent) => {
    const d = down.current;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;      // 끌기는 선택으로 처리
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-path]");
    if (el) onPickRef.current(splitPaths(el.dataset.path), true);
  };

  const cls = (i: number, base = "") => `${base} ${items[i].path ? "doc-linked" : ""} ${hl.has(i) ? "doc-hl" : ""} ${ch.has(i) ? "doc-changed" : ""}`.trim();

  return (
    <div ref={body} id="print-area" className="doc-body mx-auto max-w-[860px] px-8 py-6"
      onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY }; }} onClick={onClick}>
      <h1>{title}</h1>
      {layout.map(({ sec, blocks }) => (
        <section key={sec.id}>
          <h2>{sec.title}</h2>
          {blocks.map(({ b, first }, bi) => {
            const path = b.t === "table" ? undefined : b.path;
            if (b.t === "p") return <p key={bi} data-path={path} className={cls(first, b.kind === "label" ? "doc-label" : "")} dangerouslySetInnerHTML={{ __html: subSup(b.text) }} />;
            if (b.t === "note") return <blockquote key={bi} data-path={path} className={cls(first)} dangerouslySetInnerHTML={{ __html: subSup(b.text) }} />;
            if (b.t === "formula") return <div key={bi} data-path={path} className={cls(first, "formula")} dangerouslySetInnerHTML={{ __html: formulaHtml(b.text) }} />;
            return (
              <div key={bi} className="table-wrap">
                <table className={b.head.length >= 8 ? "wide" : ""}>
                  <thead><tr>{b.head.map((h, i) => <th key={i} dangerouslySetInnerHTML={{ __html: subSup(h) }} />)}</tr></thead>
                  <tbody>
                    {b.rows.map((r, ri) => (
                      <tr key={ri} data-path={b.rowPaths?.[ri]} className={cls(first + ri)}>
                        {r.map((c, ci) => <td key={ci} className={ci && isNumericCell(c) ? "num" : ""} dangerouslySetInnerHTML={{ __html: subSup(String(c)) }} />)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
