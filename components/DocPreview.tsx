"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import katex from "katex";
import { isNumericCell, subSup, type DocBlock, type DocSection } from "@/lib/methoddoc/render";
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
  /** 조건에서 고른 계약 단위(탭) — 주계약과 특약이 같은 조건(이율·사업비·식)을 써도 그 부만 비춘다 */
  part?: string;
  /** 다른 부(특약)의 블록을 눌렀을 때 — 조건의 탭을 그 부로 */
  onPart?: (part: string) => void;
}

/**
 * 블록 하나. **내용과 강조가 그대로면 다시 그리지 않는다.**
 * 산출방법서는 원소 6천 개가 넘어(별첨 위험률 표만 700칸) 한 번 다시 그릴 때마다 몇 백 ms 가 든다 —
 * 조건을 한 글자 고치거나 산출방법서 한 줄을 골랐을 때 **바뀐 블록만** 그린다.
 * 강조는 표 안에서 몇 번째 줄인지를 글자로 받는다("0,3") — 원시값이라 memo 가 듣는다.
 */
const Block = memo(function Block({ b, hlKey, chKey }: { b: DocBlock; hlKey: string; chKey: string }) {
  const cls = (on: boolean, off: boolean, path: string | undefined, base = "") =>
    `${base} ${path ? "doc-linked" : ""} ${on ? "doc-hl" : ""} ${off ? "doc-changed" : ""}`.trim();
  if (b.t !== "table") {
    const c = (base = "") => cls(hlKey === "0", chKey === "0", b.path, base);
    if (b.t === "p" && b.kind === "sub") return <h3 data-path={b.path} className={c("doc-sub")} dangerouslySetInnerHTML={{ __html: subSup(b.text) }} />;
    if (b.t === "p") return <p data-path={b.path} className={c(b.kind === "label" ? "doc-label" : "")} dangerouslySetInnerHTML={{ __html: subSup(b.text) }} />;
    if (b.t === "note") return <blockquote data-path={b.path} className={c()} dangerouslySetInnerHTML={{ __html: subSup(b.text) }} />;
    return <div data-path={b.path} className={c("formula")} dangerouslySetInnerHTML={{ __html: formulaHtml(b.text) }} />;
  }
  const hl = new Set(hlKey ? hlKey.split(",") : []), ch = new Set(chKey ? chKey.split(",") : []);
  return (
    <div className="table-wrap">
      <table className={b.head.length >= 8 ? "wide" : ""}>
        <thead><tr>{b.head.map((h, i) => <th key={i} dangerouslySetInnerHTML={{ __html: subSup(h) }} />)}</tr></thead>
        <tbody>
          {b.rows.map((r, ri) => (
            <tr key={ri} data-path={b.rowPaths?.[ri]} className={cls(hl.has(String(ri)), ch.has(String(ri)), b.rowPaths?.[ri])}>
              {r.map((c, ci) => <td key={ci} className={ci && isNumericCell(c) ? "num" : ""} dangerouslySetInnerHTML={{ __html: subSup(String(c)) }} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

/** 그 블록이 차지하는 항목 수 (강조 번호 단위 — 표는 줄 수만큼) */
const countOf = (b: DocBlock) => (b.t === "table" ? b.rows.length : 1);

function DocPreview({ sections, title, highlight, changed = [], follow, onPick, part, onPart }: Props) {
  const body = useRef<HTMLDivElement | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  // 내용이 그대로인 블록은 앞의 객체를 다시 쓴다 — 그러면 Block 의 memo 가 듣고 React 가 그 블록을 건너뛴다
  const kept = useRef(new Map<string, DocBlock>());
  const stable = useMemo(() => {
    const next = new Map<string, DocBlock>();
    const out = sections.map((sec) => ({
      ...sec,
      blocks: sec.blocks.map((b) => {
        const sig = JSON.stringify(b);
        const old = kept.current.get(sig) ?? b;
        next.set(sig, old);
        return old;
      }),
    }));
    kept.current = next;
    return out;
  }, [sections]);

  // 블록·표 행을 한 줄로 늘어놓아 번호를 매긴다(강조 계산 단위)
  const { items, firsts, parts } = useMemo(() => {
    const items: Item[] = [], firsts: number[][] = [], parts: (string | undefined)[] = [];
    for (const sec of stable) {
      const mine: number[] = [];
      for (const b of sec.blocks) {
        mine.push(items.length);
        if (b.t !== "table") { items.push({ kind: b.t, text: b.text, path: b.path }); parts.push(sec.part); }
        else b.rows.forEach((cells, i) => { items.push({ kind: "row", cells, path: b.rowPaths?.[i] }); parts.push(sec.part); });
      }
      firsts.push(mine);
    }
    return { items, firsts, parts };
  }, [stable]);

  const paths = useMemo(() => items.map((it) => splitPaths(it.path)), [items]);
  // 고른 부 밖(다른 계약 단위의 부)은 비추지 않는다 — 부가 없는 절(개요 · 별첨)은 그대로
  const hl = useMemo(() => {
    const all = matchBlocks(paths, highlight);
    if (!part || !parts.some((p) => p && p !== part)) return all;
    return new Set([...all].filter((i) => !parts[i] || parts[i] === part));
  }, [paths, highlight, part, parts]);
  const ch = useMemo(() => matchBlocks(paths, changed), [paths, changed]);
  /** 블록마다 "몇 번째 줄이 강조인가" 를 글자로 — 바뀐 블록만 다시 그리게 한다 */
  const keys = useMemo(() => stable.map((sec, si) => sec.blocks.map((b, bi) => {
    const from = firsts[si][bi], n = countOf(b);
    const pick = (s: Set<number>) => {
      if (!s.size) return "";
      const out: string[] = [];
      for (let i = 0; i < n; i++) if (s.has(from + i)) out.push(String(i));
      return out.join(",");
    };
    return { hlKey: pick(hl), chKey: pick(ch) };
  })), [stable, firsts, hl, ch]);

  useEffect(() => {
    if (!follow || !hl.size) return;
    body.current?.querySelector(".doc-hl")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [hl, follow]);

  // 끌어서 고른 범위 → 걸친 블록들의 경로
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !body.current) return;
      const r = sel.getRangeAt(0);
      if (!body.current.contains(r.commonAncestorContainer)) return;
      const got = [...body.current.querySelectorAll<HTMLElement>("[data-path]")]
        .filter((el) => r.intersectsNode(el)).flatMap((el) => splitPaths(el.dataset.path));
      if (got.length) onPickRef.current([...new Set(got)], false);
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const down = useRef<{ x: number; y: number } | null>(null);
  const onClick = (e: React.MouseEvent) => {
    const d = down.current;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;      // 끌기는 선택으로 처리
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-path]");
    const sp = (e.target as HTMLElement).closest<HTMLElement>("section[data-part]")?.dataset.part;
    if (sp && sp !== part) onPart?.(sp);
    if (el) onPickRef.current(splitPaths(el.dataset.path), true);
  };

  return (
    <div ref={body} id="print-area" className="doc-body mx-auto max-w-[860px] px-8 py-6"
      onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY }; }} onClick={onClick}>
      <h1>{title}</h1>
      {stable.map((sec, si) => (
        <section key={sec.id} data-part={sec.part}>
          <h2>{sec.title}</h2>
          {sec.blocks.map((b, bi) => <Block key={bi} b={b} hlKey={keys[si][bi].hlKey} chKey={keys[si][bi].chKey} />)}
        </section>
      ))}
    </div>
  );
}

export default memo(DocPreview);
