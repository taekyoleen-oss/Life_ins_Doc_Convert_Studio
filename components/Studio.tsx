"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeEditor, { type EditorApi } from "./CodeEditor";
import DocPreview from "./DocPreview";
import OriginalPane from "./OriginalPane";
import { SAMPLES } from "@/lib/samples";
import { mergeSpec, patchYaml, yamlToSpec } from "@/lib/conditions/yaml";
import { anchorsForPaths, linesOfPaths, pathsAtLines, pathsForAnchors } from "@/lib/conditions/link";
import { withFormulas } from "@/lib/methoddoc/formulas";
import { docToMarkdown, renderMethodDoc } from "@/lib/methoddoc/render";
import { docToLatex, latexToDoc } from "@/lib/methoddoc/tex";
import { extractText } from "@/lib/methoddoc/extract";
import { parseMethodDoc } from "@/lib/methoddoc/parse";
import { ACCEPT, loadFile, type Original } from "@/lib/load";
import { exporters } from "@/lib/export";

type Tab = "doc" | "latex" | "markdown" | "original";
interface Buf { text: string; dirty: boolean }
type Toast = { text: string; kind: "ok" | "warn" | "err" } | null;

const STORE = "methoddoc:yaml";
const readStore = () => { try { return localStorage.getItem(STORE); } catch { return null; } };
const writeStore = (v: string) => { try { localStorage.setItem(STORE, v); } catch { /* 사생활 모드 등 — 자동 저장만 빠진다 */ } };

/** 메뉴 항목을 고르면 <details> 를 닫는다 (그대로 두면 열린 목록이 편집기를 가린다) */
const closeMenu = (e: React.MouseEvent<HTMLElement>) => {
  if ((e.target as HTMLElement).closest("button")) e.currentTarget.closest("details")?.removeAttribute("open");
};

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function Studio() {
  const [yaml, setYaml] = useState(SAMPLES[0].yaml);
  const [saved, setSaved] = useState(SAMPLES[0].yaml);            // 마지막으로 연 내용 — 덮어쓰기 확인용
  useEffect(() => { const s = readStore(); if (s) { setYaml(s); setSaved(s); } }, []);
  useEffect(() => { const t = setTimeout(() => writeStore(yaml), 500); return () => clearTimeout(t); }, [yaml]);

  const deferred = useDebounced(yaml, 200);
  const parsed = useMemo(() => yamlToSpec(deferred), [deferred]);
  const sections = useMemo(() => renderMethodDoc(withFormulas(parsed.spec)), [parsed]);
  const title = `${parsed.spec.meta.productName || "상품"} 보험료 및 책임준비금 산출방법서`;
  const syntaxErrors = parsed.errors.filter((e) => e.line > 0);

  const [tab, setTab] = useState<Tab>("doc");
  const [original, setOriginal] = useState<Original | null>(null);
  const [leftSel, setLeftSel] = useState<string[]>([]);    // 왼쪽(조건)에서 고른 경로 → 오른쪽 강조
  const [rightSel, setRightSel] = useState<string[]>([]);  // 오른쪽에서 고른 경로 → 왼쪽 줄 강조
  const [follow, setFollow] = useState(false);
  const editor = useRef<EditorApi | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [help, setHelp] = useState(false);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.kind === "err" ? 9000 : 6000); return () => clearTimeout(t); }, [toast]);

  // LaTeX·Markdown 편집 버퍼 — 고치지 않았으면 조건에서 늘 새로 만든다
  const [latex, setLatex] = useState<Buf>({ text: "", dirty: false });
  const [md, setMd] = useState<Buf>({ text: "", dirty: false });
  const genLatex = useMemo(() => docToLatex(sections, title), [sections, title]);
  const genMd = useMemo(() => docToMarkdown(sections, title), [sections, title]);

  const mirror = useMemo(() => linesOfPaths(parsed.ranges, rightSel), [parsed, rightSel]);
  const errorLines = useMemo(() => syntaxErrors.map((e) => e.line), [syntaxErrors]);
  const origHl = useMemo(() => (original ? anchorsForPaths(original.evidence, leftSel) : new Set<string>()), [original, leftSel]);

  // ── 선택 연결 ────────────────────────────────────────────────────────────
  const onSelectLines = useCallback((from: number, to: number) => {
    setLeftSel(pathsAtLines(parsed.ranges, from, to));
    setRightSel([]);
    setFollow(true);
  }, [parsed]);

  const pickPaths = useCallback((paths: string[], scroll: boolean) => {
    setRightSel(paths);
    setLeftSel(paths);            // 오른쪽에서도 같은 조건이 만든 곳을 함께 비춘다
    setFollow(false);
    if (scroll) {
      const lines = linesOfPaths(parsed.ranges, paths);
      if (lines.length) editor.current?.scrollToLine(lines[0][0]);
    }
  }, [parsed]);

  const pickAnchors = useCallback((anchors: Set<string>, scroll: boolean) => {
    if (original) pickPaths(pathsForAnchors(original.evidence, anchors), scroll);
  }, [original, pickPaths]);

  // ── 열기 ─────────────────────────────────────────────────────────────────
  const open = useCallback(async (file: File) => {
    if (yaml !== saved && !window.confirm("지금 조건에 고친 내용이 있습니다. 새 파일로 바꿀까요?")) return;
    try {
      setToast({ text: `${file.name} 읽는 중…`, kind: "ok" });
      const r = await loadFile(file);
      if (original?.pdfUrl) URL.revokeObjectURL(original.pdfUrl);
      setYaml(r.yaml); setSaved(r.yaml);
      setOriginal(r.original ?? null);
      setLatex(r.source?.kind === "latex" ? { text: r.source.text, dirty: true } : { text: "", dirty: false });
      setMd(r.source?.kind === "markdown" ? { text: r.source.text, dirty: true } : { text: "", dirty: false });
      setTab(r.original ? "original" : "doc");
      setLeftSel([]); setRightSel([]);
      setToast({ text: r.message, kind: "ok" });
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : String(e), kind: "err" });
    }
  }, [yaml, saved, original]);
  const openRef = useRef(open);
  openRef.current = open;
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [drag, setDrag] = useState(false);
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); setDrag(true); } };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDrag(false); };
    const drop = (e: DragEvent) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer?.files?.[0]; if (f) void openRef.current(f); };
    window.addEventListener("dragover", over); window.addEventListener("dragleave", leave); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); };
  }, []);

  const loadSample = (y: string, to: Tab = "doc") => {
    if (yaml !== saved && !window.confirm("지금 조건에 고친 내용이 있습니다. 샘플로 바꿀까요?")) return;
    setYaml(y); setSaved(y); setOriginal(null);
    setLatex({ text: "", dirty: false }); setMd({ text: "", dirty: false });
    setLeftSel([]); setRightSel([]); setTab(to);
    setToast({ text: to === "doc" ? "샘플 조건을 열었습니다 — 왼쪽을 고쳐 보세요" : `샘플 산출방법서(${to === "latex" ? "LaTeX" : "Markdown"})를 열었습니다 — 값을 고친 뒤 [조건에 반영]`, kind: "ok" });
  };

  // ── LaTeX·Markdown 을 고쳐 조건에 반영 ───────────────────────────────────
  const applySource = (kind: "latex" | "markdown") => {
    if (syntaxErrors.length) { setToast({ text: `조건 파일 ${syntaxErrors[0].line}번째 줄 오류를 먼저 고쳐 주세요`, kind: "err" }); return; }
    const text = kind === "latex" ? (latex.dirty ? latex.text : genLatex) : (md.dirty ? md.text : genMd);
    const doc = kind === "latex" ? latexToDoc(text) : extractText(new TextEncoder().encode(text));
    const back = parseMethodDoc(doc, { fallbackName: parsed.spec.meta.productName });
    const { spec, changes } = mergeSpec(parsed.spec, back.spec, back.evidence);
    if (!changes.length) { setToast({ text: "조건으로 옮길 바뀐 값이 없습니다 — 문장 수정은 조건에 들어가지 않습니다(내려받아 보관하세요)", kind: "warn" }); return; }
    setYaml(patchYaml(yaml, spec));
    (kind === "latex" ? setLatex : setMd)({ text: "", dirty: false });
    setToast({ text: `조건 ${changes.length}건 반영 — ${changes.slice(0, 3).join(" · ")}${changes.length > 3 ? " …" : ""}`, kind: "ok" });
  };

  const print = () => { setTab("doc"); setTimeout(() => window.print(), 150); };

  const s = parsed.spec;
  const tabs: [Tab, string][] = [["doc", "산출방법서"], ["latex", `LaTeX${latex.dirty ? " ●" : ""}`], ["markdown", `Markdown${md.dirty ? " ●" : ""}`],
    ...(original ? [["original", `원문 · ${original.name}`] as [Tab, string]] : [])];

  return (
    <div className="flex h-screen flex-col">
      {/* ── 머리 ── */}
      <header className="no-print flex items-center gap-2 border-b border-border bg-white px-4 py-2">
        <h1 className="mr-2 font-title text-lg font-bold text-foreground">MethodDoc <span className="text-primary">Studio</span></h1>
        <span className="mr-auto hidden text-xs text-muted-foreground md:inline">산출방법서 ↔ 조건 변환기</span>
        <button className="btn-primary" onClick={() => fileInput.current?.click()}>열기</button>
        <input ref={fileInput} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void open(f); e.target.value = ""; }} />
        <details className="menu">
          <summary className="btn">샘플 ▾</summary>
          <div className="menu-list" onClick={closeMenu}>
            <p className="menu-head">조건 샘플</p>
            {SAMPLES.map((x) => <button key={x.id} onClick={() => loadSample(x.yaml)}>{x.label}<small>{x.hint}</small></button>)}
            <p className="menu-head">산출방법서 샘플</p>
            <button onClick={() => loadSample(SAMPLES[0].yaml, "latex")}>LaTeX 산출방법서 고쳐 보기<small>이율·금액을 고친 뒤 [조건에 반영]</small></button>
            <button onClick={() => loadSample(SAMPLES[2].yaml, "markdown")}>Markdown 산출방법서 고쳐 보기<small>무해지 암보험 — 해지율을 바꿔 보기</small></button>
          </div>
        </details>
        <details className="menu">
          <summary className="btn">내보내기 ▾</summary>
          <div className="menu-list right-0" onClick={closeMenu}>
            <p className="menu-head">조건 (다른 앱에서 읽기)</p>
            <button onClick={() => exporters.yaml(yaml, s)}>조건 파일 .yaml</button>
            <button onClick={() => exporters.json(s)}>MethodSpec .json<small>flexible_insurance 등 다른 앱과 주고받는 형식</small></button>
            <p className="menu-head">산출방법서</p>
            <button onClick={() => exporters.tex(sections, title, s)}>LaTeX .tex<small>xelatex 로 조판 (kotex)</small></button>
            <button onClick={() => exporters.md(sections, title, s)}>Markdown .md</button>
            <button onClick={() => exporters.html(sections, title, s)}>HTML .html<small>수식 포함 단독 파일</small></button>
            <button onClick={print}>인쇄 · PDF 저장</button>
          </div>
        </details>
        <button className="btn" onClick={() => setHelp(true)}>도움말</button>
      </header>

      {/* ── 본문 ── */}
      <main className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[44fr_56fr]">
        <section className="no-print flex min-h-0 flex-col border-r border-border">
          <div className="pane-head">
            <b>조건</b><span className="text-muted-foreground">YAML · MethodSpec</span>
            <span className="flex-1" />
            {syntaxErrors.length > 0 && <span className="rounded bg-rose-100 px-1.5 text-rose-700">{syntaxErrors[0].line}줄: {syntaxErrors[0].message}</span>}
          </div>
          <div className="min-h-0 flex-1">
            <CodeEditor value={yaml} onChange={setYaml} language="yaml" mirror={mirror} errors={errorLines} onSelectLines={onSelectLines} apiRef={editor} />
          </div>
        </section>

        <section className="flex min-h-0 flex-col">
          <div className="no-print flex items-center gap-1 border-b border-border bg-white px-2 pt-1.5">
            {tabs.map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)} className={`tab ${tab === t ? "tab-on" : ""}`}>{label}</button>
            ))}
          </div>
          {tab === "doc" && (
            <div className="thin-scroll min-h-0 flex-1 overflow-auto bg-white">
              <DocPreview sections={sections} title={title} highlight={leftSel} follow={follow} onPick={pickPaths} />
            </div>
          )}
          {(tab === "latex" || tab === "markdown") && (() => {
            const buf = tab === "latex" ? latex : md, set = tab === "latex" ? setLatex : setMd, gen = tab === "latex" ? genLatex : genMd;
            return (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="pane-head">
                  <span className="text-muted-foreground">{buf.dirty ? "고친 원문 — 조건으로 옮길 값만 반영됩니다" : "조건에서 만든 원문 — 고치면 [조건에 반영]"}</span>
                  <span className="flex-1" />
                  <button className="btn-primary" disabled={!buf.dirty} onClick={() => applySource(tab)}>조건에 반영</button>
                  <button className="btn" disabled={!buf.dirty} onClick={() => set({ text: "", dirty: false })}>조건에서 다시 만들기</button>
                  <button className="btn" onClick={() => (tab === "latex" ? exporters.tex : exporters.md)(sections, title, s)}>내려받기</button>
                </div>
                <div className="min-h-0 flex-1">
                  <CodeEditor key={tab} value={buf.dirty ? buf.text : gen} onChange={(t) => { if (t !== gen || buf.dirty) set({ text: t, dirty: true }); }} />
                </div>
              </div>
            );
          })()}
          {tab === "original" && original && (
            <div className="min-h-0 flex-1"><OriginalPane original={original} highlight={origHl} follow={follow} onPick={pickAnchors} /></div>
          )}
        </section>
      </main>

      {/* ── 상태 ── */}
      <footer className="no-print flex flex-wrap items-center gap-3 border-t border-border bg-white px-4 py-1 text-xs text-muted-foreground">
        <span>담보 {s.benefits.length} · 위험률 {s.rates.length} · 사업비 {s.expenses.length}</span>
        {parsed.errors.filter((e) => !e.line).slice(0, 1).map((e, i) => <span key={i} className="text-amber-700">⚠ {e.message}</span>)}
        <span className="flex-1" />
        {leftSel.length > 0 && <span className="font-mono text-amber-700">{leftSel.slice(0, 3).join(", ")}{leftSel.length > 3 ? " …" : ""}</span>}
        <span>자동 저장됨</span>
      </footer>

      {drag && <div className="drop-overlay">여기에 놓으면 엽니다<small>PDF · DOCX · HWP · HWPX · TEX · MD · YAML · JSON</small></div>}
      {toast && <div className={`toast toast-${toast.kind}`} onClick={() => setToast(null)}>{toast.text}</div>}
      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  );
}

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-back no-print" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>MethodDoc Studio 사용법</h2>
        <ol>
          <li><b>조건 → 산출방법서</b> 왼쪽 조건(YAML)을 고치면 오른쪽 산출방법서가 바로 바뀝니다. 유지자수·납입자수·보험료·준비금 식은 조건에서 자동으로 만듭니다.</li>
          <li><b>산출방법서 → 조건</b> PDF·DOCX·HWP·HWPX·TEX·MD 를 [열기] 하거나 창에 끌어다 놓으면 조건으로 옮깁니다. 값 옆 주석이 원문 위치·확신도이고, [원문] 탭에서 근거 줄을 확인할 수 있습니다.</li>
          <li><b>LaTeX·Markdown 으로 고치기</b> 탭에서 산출방법서 원문을 고친 뒤 [조건에 반영] 하면 바뀐 값(이율·사업비·담보·위험률·계약)만 조건 파일에 들어갑니다. 조건 파일의 주석과 순서는 그대로 둡니다.</li>
          <li><b>대응 위치</b> 왼쪽에서 줄을 고르면 오른쪽에서 그 조건이 만든 곳(표의 행·수식·원문 근거)이 노랗게 표시됩니다. 오른쪽을 누르거나 끌어서 고르면 왼쪽 줄이 표시됩니다.</li>
          <li><b>다른 앱과 연동</b> [내보내기 → MethodSpec .json] 은 flexible_insurance 등이 읽는 중립 형식입니다. 그 JSON 을 여기서 [열기] 해도 됩니다.</li>
        </ol>
        <p className="text-xs text-muted-foreground">조건 파일 표기: 이율 <code>2.5%</code> · 사업비 <code>1.5/1000</code> · 배수 <code>1배</code> · 위험률 유형 death / incidence / recurring / waiver / other.</p>
        <button className="btn-primary mt-3" onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}
