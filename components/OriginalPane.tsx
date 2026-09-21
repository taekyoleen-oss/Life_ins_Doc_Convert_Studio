"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { anchorOf } from "@/lib/conditions/link";
import type { Original } from "@/lib/load";

const CONF = { high: "bg-emerald-100 text-emerald-800", medium: "bg-sky-100 text-sky-800", low: "bg-rose-100 text-rose-800" } as const;
const fmt = (v: unknown) => (typeof v === "number" ? (v > 0 && v < 1 ? `${+(v * 100).toFixed(4)}%` : v.toLocaleString("ko-KR")) : String(v));

interface Props {
  original: Original;
  highlight: Set<string>;
  follow: boolean;
  /** 원문에서 고른 자리들 (클릭이면 scroll=true) */
  onPick: (anchors: Set<string>, scroll: boolean) => void;
}

export default function OriginalPane({ original, highlight, follow, onPick }: Props) {
  const [view, setView] = useState<"text" | "pdf">("text");
  const box = useRef<HTMLDivElement | null>(null);
  const { doc, evidence } = original;

  // 자리 → 거기서 읽은 조건
  const byAnchor = useMemo(() => {
    const m = new Map<string, typeof evidence>();
    for (const e of evidence) { const a = anchorOf(e.source); if (a) m.set(a, [...(m.get(a) ?? []), e]); }
    return m;
  }, [evidence]);

  useEffect(() => {
    if (!follow || !highlight.size) return;
    box.current?.querySelector(".doc-hl")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight, follow]);

  const pick = (a: string) => onPick(new Set([a]), true);
  const badges = (a: string) => (byAnchor.get(a) ?? []).map((e, i) => (
    <span key={i} className={`ml-1 inline-block rounded px-1 font-mono text-[10.5px] ${CONF[e.confidence]}`} title={`${e.label} · ${e.raw}`}>
      {e.path} = {fmt(e.value)}
    </span>
  ));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/60 px-3 py-1.5 text-xs">
        <b className="truncate text-foreground">{original.name}</b>
        <span className="text-muted-foreground">문단 {doc.paragraphs.length} · 표 {doc.tables.length} · 읽은 항목 {evidence.length}</span>
        {original.missing.length > 0 && <span className="rounded bg-amber-100 px-1.5 text-amber-800">못 찾음: {original.missing.join(", ")}</span>}
        <span className="flex-1" />
        {original.pdfUrl && (
          <div className="flex overflow-hidden rounded border border-border">
            {(["text", "pdf"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`px-2 py-0.5 ${view === v ? "bg-primary text-white" : "bg-white"}`}>{v === "text" ? "추출 텍스트" : "PDF 원본"}</button>
            ))}
          </div>
        )}
      </div>
      {view === "pdf" && original.pdfUrl ? (
        <iframe src={original.pdfUrl} className="min-h-0 flex-1 bg-white" title={original.name} />
      ) : (
        <div ref={box} className="thin-scroll min-h-0 flex-1 overflow-auto bg-white px-4 py-3 text-[13px] leading-6">
          {doc.warnings.length > 0 && <p className="mb-2 rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{doc.warnings.join(" ")}</p>}
          <h3 className="mb-1 font-semibold">본문</h3>
          <ol className="orig-list">
            {doc.paragraphs.map((p, i) => {
              const a = `p-${i}`, has = byAnchor.has(a);
              return (
                <li key={i} data-anchor={a} onClick={() => has && pick(a)}
                  className={`${has ? "orig-linked" : ""} ${highlight.has(a) ? "doc-hl" : ""}`}>
                  <span className="orig-no">{i + 1}</span>{p}{badges(a)}
                </li>
              );
            })}
          </ol>
          {doc.tables.length > 0 && <h3 className="mb-1 mt-4 font-semibold">표</h3>}
          {doc.tables.map((t, i) => {
            const a = `t-${i}`, has = byAnchor.has(a);
            return (
              <div key={i} data-anchor={a} onClick={() => has && pick(a)} className={`mb-3 ${has ? "orig-linked" : ""} ${highlight.has(a) ? "doc-hl" : ""}`}>
                <p className="text-xs text-muted-foreground">표 {i + 1}{badges(a)}</p>
                <div className="overflow-x-auto">
                  <table className="orig-table">
                    <tbody>{[t.head, ...t.rows].map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{c}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
