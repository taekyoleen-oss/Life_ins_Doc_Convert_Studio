"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseDocument } from "yaml";
import CodeEditor, { type EditorApi } from "./CodeEditor";
import ConditionForm from "./ConditionForm";
import DocPreview from "./DocPreview";
import FormulaPalette from "./FormulaPalette";
import OriginalPane from "./OriginalPane";
import dynamic from "next/dynamic";
// 그림으로 읽기 창은 열 때만 받는다 — Anthropic SDK 가 첫 화면 번들에 들어가지 않게
const VisionDialog = dynamic(() => import("./VisionDialog"), { ssr: false });
import RateSheetPane from "./RateSheetPane";
import { SAMPLES } from "@/lib/samples";
import { editYaml, mergeSpec, patchYaml, yamlToSpec, type YamlEdit } from "@/lib/conditions/yaml";
import { anchorsForPaths, linesOfPaths, pathsAtLines, pathsForAnchors } from "@/lib/conditions/link";
import { withFormulas } from "@/lib/methoddoc/formulas";
import { docToMarkdown, renderMethodDoc } from "@/lib/methoddoc/render";
import { docToLatex, latexToDoc } from "@/lib/methoddoc/tex";
import { ExtractError, extractDoc, extractText, type ExtractedDoc } from "@/lib/methoddoc/extract";
import { IMAGE_EXT } from "@/lib/pages";
import { parseMethodDoc } from "@/lib/methoddoc/parse";
import type { RateRole } from "@/lib/methoddoc/spec";
import { ACCEPT, fromDoc, loadFile, type Original } from "@/lib/load";
import { DOCX_MIME, download, exporters } from "@/lib/export";
import { STANDARDS, standardFile, standardSpec, toStandardDocx } from "@/lib/standards";
import { attachTables, autoMap, linkNote, newRateId, sanitizeSheet, sheetFromFile, sheetFromText, type Sheet, type SheetState } from "@/lib/sheet";
import { DOC_PARTS, SECTION_OF, formulaSnippet, inlineSnippet, type FormulaSample } from "@/lib/snippets";

type Tab = "doc" | "latex" | "markdown" | "word" | "original";
type PaneId = "cond" | "doc" | "sheet";
interface Buf { text: string; dirty: boolean }
type Toast = { text: string; kind: "ok" | "warn" | "err" } | null;
/** 화면 나눔 — 비율·숨김·크게 보기·왼쪽 탭·펼친 카드. 브라우저에 기억한다 */
interface Layout { split: number; sheetH: number; hide: PaneId[]; max: PaneId | null; left: "form" | "yaml"; open: string[] }
const PANES: PaneId[] = ["cond", "doc", "sheet"];
const PANE_NAME: Record<PaneId, string> = { cond: "조건", doc: "산출방법서", sheet: "위험률 표" };
const LAYOUT0: Layout = { split: 0.44, sheetH: 0.26, hide: [], max: null, left: "form", open: ["M02"] };

const KEY = "life_ins_doc_convert_studio";
const STORE = `${KEY}:yaml`;
const OLD_STORE = "methoddoc:yaml";            // 앱 이름을 바꾸기 전 자동 저장 키 — 한 번 옮겨 온다
const readStore = () => {
  try {
    const now = localStorage.getItem(STORE);
    if (now !== null) return now;
    const old = localStorage.getItem(OLD_STORE);
    if (old !== null) { localStorage.setItem(STORE, old); localStorage.removeItem(OLD_STORE); }
    return old;
  } catch { return null; }
};
const writeStore = (v: string) => { try { localStorage.setItem(STORE, v); } catch { /* 사생활 모드 등 — 자동 저장만 빠진다 */ } };
const readJson = (k: string): unknown => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const writeJson = (k: string, v: unknown) => {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* 공간이 없거나 사생활 모드 — 이번 창에서만 쓴다 */ }
};
function sanitizeLayout(raw: unknown): Layout {
  const l = (raw ?? {}) as Partial<Layout>;
  const ratio = (v: unknown, d: number) => (typeof v === "number" && v >= 0.1 && v <= 0.9 ? v : d);
  const hide = Array.isArray(l.hide) ? PANES.filter((p) => l.hide!.includes(p)) : [];
  return {
    split: ratio(l.split, LAYOUT0.split), sheetH: ratio(l.sheetH, LAYOUT0.sheetH),
    hide: hide.length === PANES.length ? [] : hide, max: PANES.includes(l.max as PaneId) ? (l.max as PaneId) : null,
    left: l.left === "yaml" ? "yaml" : "form",
    open: Array.isArray(l.open) ? l.open.filter((x): x is string => typeof x === "string").slice(0, 80) : LAYOUT0.open,
  };
}
const SHEET_EXT = /\.(csv|tsv|xlsx|xls)$/i;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
  const [layout, setLayout] = useState<Layout>(LAYOUT0);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  useEffect(() => {
    const s = readStore();
    if (s) { setYaml(s); setSaved(s); }
    setLayout(sanitizeLayout(readJson(`${KEY}:layout`)));
    setSheet(sanitizeSheet(readJson(`${KEY}:sheet`)));
  }, []);
  useEffect(() => { const t = setTimeout(() => writeStore(yaml), 500); return () => clearTimeout(t); }, [yaml]);
  useEffect(() => { const t = setTimeout(() => writeJson(`${KEY}:layout`, layout), 300); return () => clearTimeout(t); }, [layout]);
  useEffect(() => { const t = setTimeout(() => writeJson(`${KEY}:sheet`, sheet), 300); return () => clearTimeout(t); }, [sheet]);

  const deferred = useDebounced(yaml, 200);
  const parsed = useMemo(() => yamlToSpec(deferred), [deferred]);
  // 위험률 표에서 이은 열을 RateRef.table 로 — 산출방법서·JSON(자유설계보험 입력)에 실린다
  const specT = useMemo(() => attachTables(parsed.spec, sheet), [parsed, sheet]);
  const sections = useMemo(() => renderMethodDoc(withFormulas(specT)), [specT]);
  const title = `${parsed.spec.meta.productName || "상품"} 보험료 및 책임준비금 산출방법서`;
  const syntaxErrors = parsed.errors.filter((e) => e.line > 0);

  const [tab, setTab] = useState<Tab>("doc");
  const [original, setOriginal] = useState<Original | null>(null);
  const [leftSel, setLeftSel] = useState<string[]>([]);    // 왼쪽(조건)에서 고른 경로 → 오른쪽 강조
  const [rightSel, setRightSel] = useState<string[]>([]);  // 오른쪽에서 고른 경로 → 왼쪽 줄·칸 강조
  const [follow, setFollow] = useState(false);
  const [pal, setPal] = useState(false);                   // 수식·기호 견본
  const editor = useRef<EditorApi | null>(null);
  const srcEditor = useRef<EditorApi | null>(null);        // LaTeX·Markdown 편집기 — 견본을 커서 자리에 넣는다
  const [toast, setToast] = useState<Toast>(null);
  const [help, setHelp] = useState(false);
  // Word·한글로 고쳐 올린 결과 — 무엇이 조건에 들어갔는지 탭에 남긴다
  const [wordLog, setWordLog] = useState<{ name: string; format?: string; changes: string[] } | null>(null);
  const mergeInput = useRef<HTMLInputElement | null>(null);
  // 그림으로 읽기(스캔 PDF · PNG · JPG) — 쪽을 고르고 사용자 키로 보낸다
  const [vision, setVision] = useState<{ file: File; reason: string } | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.kind === "err" ? 9000 : 6000); return () => clearTimeout(t); }, [toast]);

  // LaTeX·Markdown 편집 버퍼 — 고치지 않았으면 조건에서 늘 새로 만든다
  const [latex, setLatex] = useState<Buf>({ text: "", dirty: false });
  const [md, setMd] = useState<Buf>({ text: "", dirty: false });
  const genLatex = useMemo(() => docToLatex(sections, title), [sections, title]);
  const genMd = useMemo(() => docToMarkdown(sections, title), [sections, title]);

  const mirror = useMemo(() => linesOfPaths(parsed.ranges, rightSel), [parsed, rightSel]);
  const errorLines = useMemo(() => syntaxErrors.map((e) => e.line), [syntaxErrors]);
  const origHl = useMemo(() => (original ? anchorsForPaths(original.evidence, leftSel) : new Set<string>()), [original, leftSel]);

  // ── 화면 나눔 ────────────────────────────────────────────────────────────
  const visible = (p: PaneId) => (layout.max ? layout.max === p : !layout.hide.includes(p));
  const shown = PANES.filter(visible);
  const togglePane = (p: PaneId) => setLayout((l) => {
    const vis = PANES.filter((x) => (l.max ? l.max === x : !l.hide.includes(x)));
    const next = vis.includes(p) ? vis.filter((x) => x !== p) : [...vis, p];
    return next.length ? { ...l, max: null, hide: PANES.filter((x) => !next.includes(x)) } : l;
  });
  const showPane = (p: PaneId) => setLayout((l) => ({ ...l, hide: l.hide.filter((x) => x !== p), max: l.max && l.max !== p ? null : l.max }));
  const tools = (p: PaneId) => (
    <span className="pane-tools">
      <button className="pane-tool" onClick={() => setLayout((l) => ({ ...l, max: l.max === p ? null : p }))}
        title={layout.max === p ? "나눠 보기로 되돌립니다" : `${PANE_NAME[p]}만 크게 봅니다`}>{layout.max === p ? "⤡ 복원" : "⤢ 전체"}</button>
      {layout.max !== p && <button className="pane-tool" disabled={shown.length <= 1} onClick={() => togglePane(p)} title="숨깁니다 — 위 [보기]에서 다시 켭니다">– 숨기기</button>}
    </span>
  );

  // ── 선택 연결 ────────────────────────────────────────────────────────────
  const onSelectLines = useCallback((from: number, to: number) => {
    setLeftSel(pathsAtLines(parsed.ranges, from, to));
    setRightSel([]);
    setFollow(true);
  }, [parsed]);

  /** 입력 화면에서 칸을 고름 — YAML 줄을 고른 것과 같다 */
  const onFormSelect = useCallback((paths: string[]) => { setLeftSel(paths); setRightSel([]); setFollow(true); }, []);

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

  // ── 입력 화면·위험률 표 → 조건 파일 ──────────────────────────────────────
  const onEdit = useCallback((edits: YamlEdit[]) => setYaml((y) => editYaml(y, edits)), []);
  const setOpen = useCallback((f: (o: string[]) => string[]) => setLayout((l) => ({ ...l, open: f(l.open) })), []);
  const tableNote = useCallback((id: string) => linkNote(sheet, specT, id), [sheet, specT]);

  /** 위험률 표의 열을 새 위험률로 — 조건에 더하고 id 를 돌려준다 */
  const addRates = (items: { name: string; role: RateRole }[]): string[] => {
    if (syntaxErrors.length) { setToast({ text: `조건 파일 ${syntaxErrors[0].line}번째 줄 오류를 먼저 고쳐 주세요`, kind: "err" }); return []; }
    const raw = parseDocument(yaml).toJS() as { rates?: { id?: unknown }[] } | null;
    const taken = Array.isArray(raw?.rates) ? raw.rates.map((r) => String(r?.id)) : [];
    const ids: string[] = [];
    for (const it of items) ids.push(newRateId(it.role, [...taken, ...ids]));
    if (items.length) {
      setYaml(editYaml(yaml, items.map((it, k) => ({ path: ["rates"], add: true, value: { id: ids[k], name: it.name, role: it.role } }))));
      setToast({ text: `위험률 ${items.map((x) => x.name).join(", ")} 을(를) 조건(M04)에 더했습니다 — 유형을 확인하세요`, kind: "ok" });
    }
    return ids;
  };

  const loadSheet = (sh: Sheet) => {
    if (sheet && sheet.map.some((m) => m.to !== "skip") && !window.confirm("지금 위험률 표와 연결을 새 표로 바꿀까요?")) return;
    const map = autoMap(sh, parsed.spec.rates);
    setSheet({ sheet: sh, map });
    showPane("sheet");
    const n = map.filter((m) => m.to === "rate").length;
    setToast({ text: `${sh.name}: ${sh.rows.length}행 × ${sh.head.length}열 — 첫 행을 열 이름으로 읽고 ${n}개 열을 조건의 위험률에 이었습니다`, kind: "ok" });
  };
  const openSheetFile = async (f: File) => {
    try { loadSheet(await sheetFromFile(f)); } catch (e) { setToast({ text: errText(e), kind: "err" }); }
  };
  const pasteSheet = (text: string) => {
    try { loadSheet(sheetFromText("붙여넣기", text)); } catch (e) { setToast({ text: errText(e), kind: "err" }); }
  };

  /** 견본 식을 조건의 식(M08)으로 더한다 — 산출방법서의 알맞은 절에 붙는다 */
  const addFormula = (f: FormulaSample) => {
    const raw = parseDocument(yaml).toJS() as { formulas?: unknown[] } | null;
    const n = Array.isArray(raw?.formulas) ? raw.formulas.length : 0;
    onEdit([{ path: ["formulas"], add: true, value: { section: SECTION_OF[f.group] ?? "계산기수", label: f.label, text: f.text } }]);
    setLayout((l) => ({ ...l, left: "form", open: l.open.includes("M08") ? l.open : [...l.open, "M08"] }));
    setLeftSel([`formulas[${n}]`]); setRightSel([`formulas[${n}]`]); setFollow(true);
    setToast({ text: `"${f.label}" 식을 조건 M08 에 더했습니다 — 왼쪽에서 고쳐 쓰세요`, kind: "ok" });
  };

  // ── 열기 ─────────────────────────────────────────────────────────────────
  const open = useCallback(async (file: File) => {
    if (SHEET_EXT.test(file.name)) { await openSheetFile(file); return; }
    if (yaml !== saved && !window.confirm("지금 조건에 고친 내용이 있습니다. 새 파일로 바꿀까요?")) return;
    if (IMAGE_EXT.test(file.name)) { setVision({ file, reason: "그림 파일입니다." }); return; }
    try {
      setToast({ text: `${file.name} 읽는 중…`, kind: "ok" });
      const r = await loadFile(file);
      if (original?.pdfUrl) URL.revokeObjectURL(original.pdfUrl);
      setYaml(r.yaml); setSaved(r.yaml);
      setOriginal(r.original ?? null);
      if (r.sheet) { setSheet(r.sheet); showPane("sheet"); }
      setLatex(r.source?.kind === "latex" ? { text: r.source.text, dirty: true } : { text: "", dirty: false });
      setMd(r.source?.kind === "markdown" ? { text: r.source.text, dirty: true } : { text: "", dirty: false });
      setTab(r.original ? "original" : "doc");
      setLeftSel([]); setRightSel([]);
      setToast({ text: r.message, kind: "ok" });
    } catch (e) {
      if (e instanceof ExtractError && e.why === "scanned") { setToast(null); setVision({ file, reason: "글자 층이 없는 스캔 PDF 입니다." }); return; }
      setToast({ text: errText(e), kind: "err" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yaml, saved, original, sheet, parsed]);
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
    showPane("doc");
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

  /**
   * Word·한글(또는 어떤 산출방법서든)을 고쳐 올리면 바뀐 값만 지금 조건에 넣는다 — [열기] 처럼 조건을 통째로 바꾸지 않는다.
   * 표준 산출방법서면 식·주석·절까지, 아니면 표·본문 규칙으로 읽은 값만.
   */
  const applyFile = async (file: File) => {
    if (syntaxErrors.length) { setToast({ text: `조건 파일 ${syntaxErrors[0].line}번째 줄 오류를 먼저 고쳐 주세요`, kind: "err" }); return; }
    try {
      setToast({ text: `${file.name} 읽는 중…`, kind: "ok" });
      const doc = await extractDoc(file.name, new Uint8Array(await file.arrayBuffer()));
      const back = parseMethodDoc(doc, { fallbackName: parsed.spec.meta.productName });
      const { spec, changes } = mergeSpec(parsed.spec, back.spec, back.evidence);
      if (original?.pdfUrl) URL.revokeObjectURL(original.pdfUrl);
      setOriginal({ name: file.name, doc, evidence: back.evidence, missing: back.missing });
      setWordLog({ name: file.name, format: back.format, changes });
      setTab("word"); showPane("doc");
      if (!changes.length) { setToast({ text: `${file.name} — 조건과 다른 값이 없습니다`, kind: "warn" }); return; }
      setYaml(patchYaml(yaml, spec));
      setToast({ text: `${file.name} — 조건 ${changes.length}건 반영${back.format ? "" : " (표준 양식이 아니어서 값만)"}`, kind: "ok" });
    } catch (e) {
      setToast({ text: errText(e), kind: "err" });
    }
  };

  /** 표준 산출방법서 한글 파일 — public/standards 에 있으면 받는다(없으면 .docx 를 한글에서 저장하도록 안내) */
  const downloadHwpx = async (name: string) => {
    try {
      const r = await fetch(`/standards/${encodeURIComponent(name)}.hwpx`);
      if (!r.ok) throw new Error();
      download(`${name}.hwpx`, new Uint8Array(await r.arrayBuffer()), "application/hwp+zip");
    } catch {
      setToast({ text: `${name}.hwpx 가 아직 없습니다 — .docx 를 한글에서 열어 [다른 이름으로 저장 → HWPX] 하세요`, kind: "warn" });
    }
  };

  /** 그림에서 옮겨 적은 글 → 조건. [열기] 와 같이 조건을 새로 만든다 */
  const onVisionDone = (doc: ExtractedDoc, pages: string[], usd: number) => {
    const name = vision!.file.name;
    const { yaml: y, original: o } = fromDoc(name, doc);
    o.images = pages;
    if (original?.pdfUrl) URL.revokeObjectURL(original.pdfUrl);
    setVision(null);
    setYaml(y); setSaved(y); setOriginal(o);
    setLatex({ text: "", dirty: false }); setMd({ text: "", dirty: false });
    setTab("original"); showPane("doc"); setLeftSel([]); setRightSel([]);
    setToast({ text: `${name} — 그림 ${pages.length}쪽을 옮겨 적어 조건 ${o.evidence.length}개를 읽었습니다 · 쓴 비용 약 $${usd.toFixed(3)} — 쪽 그림과 대조하세요`, kind: "ok" });
  };

  const print = () => { setTab("doc"); showPane("doc"); setTimeout(() => window.print(), 150); };

  const s = parsed.spec;
  const tabs: [Tab, string][] = [["doc", "산출방법서"], ["latex", `LaTeX${latex.dirty ? " ●" : ""}`], ["markdown", `Markdown${md.dirty ? " ●" : ""}`], ["word", "Word·한글"],
    ...(original ? [["original", `원문 · ${original.name}`] as [Tab, string]] : [])];
  const top = visible("cond") || visible("doc");
  const nTables = specT.rates.filter((r) => r.table).length;

  return (
    <div className="flex h-screen flex-col">
      {/* ── 머리 ── */}
      <header className="no-print flex items-center gap-2 border-b border-border bg-white px-4 py-2">
        <h1 className="mr-2 font-title text-lg font-bold text-foreground">Life_ins_Doc_Convert_<span className="text-primary">Studio</span></h1>
        <span className="mr-auto hidden text-xs text-muted-foreground lg:inline">산출방법서 ↔ 조건 변환기</span>
        <div className="seg" role="group" aria-label="보기">
          <span className="seg-label">보기</span>
          {PANES.map((p) => (
            <button key={p} aria-pressed={visible(p)} className={visible(p) ? "seg-on" : ""} onClick={() => togglePane(p)} title={`${PANE_NAME[p]} ${visible(p) ? "숨기기" : "보이기"}`}>{PANE_NAME[p]}</button>
          ))}
        </div>
        <button className="btn-primary" onClick={() => fileInput.current?.click()}>열기</button>
        <input ref={fileInput} aria-label="열 파일" type="file" accept={`${ACCEPT},.csv,.tsv,.xlsx`} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void open(f); e.target.value = ""; }} />
        <details className="menu">
          <summary className="btn">샘플 ▾</summary>
          <div className="menu-list right-0" onClick={closeMenu}>
            <p className="menu-head">조건 샘플</p>
            {SAMPLES.map((x) => <button key={x.id} onClick={() => loadSample(x.yaml)}>{x.label}<small>{x.hint}</small></button>)}
            <p className="menu-head">산출방법서 샘플</p>
            <button onClick={() => loadSample(SAMPLES[0].yaml, "latex")}>LaTeX 산출방법서 고쳐 보기<small>이율·금액을 고친 뒤 [조건에 반영]</small></button>
            <button onClick={() => loadSample(SAMPLES[2].yaml, "markdown")}>Markdown 산출방법서 고쳐 보기<small>무해지 암보험 — 해지율을 바꿔 보기</small></button>
          </div>
        </details>
        <details className="menu">
          <summary className="btn">표준 양식 ▾</summary>
          <div className="menu-list right-0" onClick={closeMenu}>
            <p className="menu-head">표준 산출방법서 — 상품별 견본 (Word · 한글)</p>
            {STANDARDS.map((x) => [
              <button key={`${x.id}-d`} onClick={() => download(`${standardFile(x)}.docx`, toStandardDocx(standardSpec(x)), DOCX_MIME)}>{standardFile(x)}.docx<small>{x.hint}</small></button>,
              <button key={`${x.id}-h`} onClick={() => void downloadHwpx(standardFile(x))}>{standardFile(x)}.hwpx<small>한글</small></button>,
            ])}
            <p className="menu-head">지금 조건으로</p>
            <button onClick={() => exporters.docx(specT)}>Word .docx — 표준 양식으로 내려받기<small>Word·한글에서 고친 뒤 아래로 올립니다</small></button>
            <button onClick={() => mergeInput.current?.click()}>고친 Word·한글 올려 조건에 반영<small>바뀐 값·식·주석만 들어갑니다 (조건 주석 유지)</small></button>
          </div>
        </details>
        <input ref={mergeInput} aria-label="고쳐 반영할 파일" type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void applyFile(f); e.target.value = ""; }} />
        <details className="menu">
          <summary className="btn">내보내기 ▾</summary>
          <div className="menu-list right-0" onClick={closeMenu}>
            <p className="menu-head">조건 (다른 앱에서 읽기)</p>
            <button onClick={() => exporters.yaml(yaml, s)}>조건 파일 .yaml</button>
            <button onClick={() => exporters.json(specT)}>MethodSpec .json<small>자유설계보험(flexible_insurance) 등 다른 앱 입력 · 위험률 표 {nTables}개 포함</small></button>
            <p className="menu-head">산출방법서</p>
            <button onClick={() => exporters.docx(specT)}>Word .docx<small>표준 산출방법서 — 한글에서도 열림 · 작성 안내 포함</small></button>
            <button onClick={() => exporters.docx(specT, false)}>Word .docx (작성 안내 없이)<small>출력·제출용</small></button>
            <button onClick={() => exporters.tex(sections, title, s)}>LaTeX .tex<small>xelatex 로 조판 (kotex)</small></button>
            <button onClick={() => exporters.md(sections, title, s)}>Markdown .md</button>
            <button onClick={() => exporters.html(sections, title, s)}>HTML .html<small>수식 포함 단독 파일</small></button>
            <button onClick={print}>인쇄 · PDF 저장</button>
          </div>
        </details>
        <button className="btn" onClick={() => setHelp(true)}>도움말</button>
      </header>

      {/* ── 본문: 위(조건 | 산출방법서) · 아래(위험률 표) ── */}
      <main className="print-block flex min-h-0 flex-1 flex-col">
        {top && (
          <div className="print-block flex min-h-0" style={{ flex: visible("sheet") ? `${1 - layout.sheetH} 1 0` : "1 1 0" }}>
            {visible("cond") && (
              <section className="no-print flex min-h-0 min-w-0 flex-col" style={{ flex: visible("doc") ? `0 0 ${layout.split * 100}%` : "1 1 0" }}>
                <div className="pane-head">
                  <b>조건</b>
                  <div className="seg" role="tablist" aria-label="조건 보기">
                    {(["form", "yaml"] as const).map((t) => (
                      <button key={t} role="tab" aria-selected={layout.left === t} className={layout.left === t ? "seg-on" : ""} onClick={() => setLayout((l) => ({ ...l, left: t }))}>{t === "form" ? "입력" : "YAML"}</button>
                    ))}
                  </div>
                  <span className="truncate text-muted-foreground">{layout.left === "form" ? "칸을 채우면 조건 파일(YAML)에 들어갑니다" : "MethodSpec 조건 파일"}</span>
                  <span className="flex-1" />
                  {syntaxErrors.length > 0 && <span className="truncate rounded bg-rose-100 px-1.5 text-rose-700">{syntaxErrors[0].line}줄: {syntaxErrors[0].message}</span>}
                  {tools("cond")}
                </div>
                <div className="min-h-0 flex-1">
                  {layout.left === "form"
                    ? <ConditionForm yaml={yaml} spec={specT} errors={parsed.errors} onEdit={onEdit} highlight={rightSel} onSelect={onFormSelect}
                        open={layout.open} setOpen={setOpen} tableNote={tableNote} onShowYaml={() => setLayout((l) => ({ ...l, left: "yaml" }))} />
                    : <CodeEditor value={yaml} onChange={setYaml} language="yaml" mirror={mirror} errors={errorLines} onSelectLines={onSelectLines} apiRef={editor} />}
                </div>
              </section>
            )}
            {visible("cond") && visible("doc") && <Splitter dir="x" value={layout.split} onChange={(v) => setLayout((l) => ({ ...l, split: v }))} />}
            {visible("doc") && (
              <section className="print-block flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="no-print flex items-center gap-1 border-b border-border bg-white px-2 pt-1.5">
                  {tabs.map(([t, label]) => (
                    <button key={t} onClick={() => setTab(t)} className={`tab ${t === "original" ? "tab-shrink" : ""} ${tab === t ? "tab-on" : ""}`}>{label}</button>
                  ))}
                  <span className="flex-1" />
                  <span className="pb-1">{tools("doc")}</span>
                </div>
                {tab === "doc" && (
                  <div className="print-block flex min-h-0 flex-1 flex-col">
                    <div className="no-print pane-head">
                      <span className="truncate text-muted-foreground">조건으로 만든 산출방법서 — 블록을 누르면 왼쪽에서 그 조건이 표시됩니다</span>
                      <span className="flex-1" />
                      <button className={`btn ${pal ? "btn-on" : ""}`} onClick={() => setPal((v) => !v)}>＋ 수식 더하기</button>
                    </div>
                    {pal && <FormulaPalette onFormula={addFormula}
                      hint="누르면 그 식을 조건(M08 수식 더하기)에 넣어 산출방법서의 알맞은 절에 붙입니다. 식은 왼쪽 입력 화면에서 고칩니다." />}
                    <div className="thin-scroll min-h-0 flex-1 overflow-auto bg-white">
                      <DocPreview sections={sections} title={title} highlight={leftSel} follow={follow} onPick={pickPaths} />
                    </div>
                  </div>
                )}
                {(tab === "latex" || tab === "markdown") && (() => {
                  const buf = tab === "latex" ? latex : md, set = tab === "latex" ? setLatex : setMd, gen = tab === "latex" ? genLatex : genMd;
                  const put = (text: string) => srcEditor.current?.insert(text);
                  return (
                    <div className="flex min-h-0 flex-1 flex-col">
                      <div className="pane-head">
                        <span className="truncate text-muted-foreground">{buf.dirty ? "고친 원문 — 조건으로 옮길 값만 반영됩니다" : "조건에서 만든 원문 — 고치면 [조건에 반영]"}</span>
                        <span className="flex-1" />
                        <button className={`btn ${pal ? "btn-on" : ""}`} onClick={() => setPal((v) => !v)}>수식·기호 견본</button>
                        <button className="btn-primary" disabled={!buf.dirty} onClick={() => applySource(tab)}>조건에 반영</button>
                        <button className="btn" disabled={!buf.dirty} onClick={() => set({ text: "", dirty: false })}>조건에서 다시 만들기</button>
                        <button className="btn" onClick={() => (tab === "latex" ? exporters.tex : exporters.md)(sections, title, s)}>내려받기</button>
                      </div>
                      {pal && <FormulaPalette hint={`누르면 커서 자리에 넣습니다 — ${tab === "latex" ? "식은 align* 블록, 기호는 LaTeX 명령" : "식은 코드 블록, 기호는 글자 그대로"}.`}
                        onFormula={(f) => put(formulaSnippet(tab, f.text))} onInline={(t) => put(inlineSnippet(tab, t))} parts={DOC_PARTS[tab]} onPart={put} />}
                      <div className="min-h-0 flex-1">
                        <CodeEditor key={tab} value={buf.dirty ? buf.text : gen} apiRef={srcEditor} onChange={(t) => { if (t !== gen || buf.dirty) set({ text: t, dirty: true }); }} />
                      </div>
                    </div>
                  );
                })()}
                {tab === "word" && (
                  <div className="thin-scroll min-h-0 flex-1 overflow-auto bg-white px-6 py-5 text-sm leading-7">
                    <h3 className="mb-1 text-base font-bold">Word·한글로 고치기 — 표준 산출방법서</h3>
                    <ol className="word-steps">
                      <li><b>내려받기</b> — 지금 조건을 표준 산출방법서(.docx)로 받습니다. 한글에서도 열리고, [다른 이름으로 저장 → HWPX] 하면 한글 문서가 됩니다.</li>
                      <li><b>고치기</b> — 표의 값·행, <code>[식]</code> 아래 식 줄, <code>※</code> 설명을 고칩니다. 절 제목과 표 머리글은 그대로 둡니다. 식은 <code>l_{"{x+t}"}</code> 처럼 적거나 Word·한글 수식 편집기로 넣습니다.</li>
                      <li><b>올리기</b> — 바뀐 것만 조건에 들어갑니다(조건 파일의 주석·순서는 지킵니다). 개요 표에 <code>양식 | 표준 산출방법서 v1</code> 행이 있으면 식·주석·절까지, 없으면 값만 읽습니다.</li>
                      <li><b>출력</b> — Word(작성 안내 없이) 또는 PDF(인쇄 → PDF 저장, 수식이 조판되어 나옵니다).</li>
                    </ol>
                    <div className="my-3 flex flex-wrap gap-2">
                      <button className="btn-primary" onClick={() => exporters.docx(specT)}>Word 내려받기</button>
                      <button className="btn-primary" onClick={() => mergeInput.current?.click()}>고친 Word·한글 올리기 → 조건에 반영</button>
                      <button className="btn" onClick={() => exporters.docx(specT, false)}>Word (작성 안내 없이)</button>
                      <button className="btn" onClick={print}>PDF 저장</button>
                    </div>
                    {wordLog && (
                      <div className={`word-log ${wordLog.changes.length ? "" : "word-log-none"}`}>
                        <b>{wordLog.name}</b> — {wordLog.format ? `${wordLog.format} 로 읽음 (식·주석·절 포함)` : "표준 양식이 아님 — 표·본문 규칙으로 읽은 값만"}
                        {wordLog.changes.length
                          ? <ul>{wordLog.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
                          : <p>조건과 다른 값이 없습니다.</p>}
                        <p className="text-xs text-muted-foreground">어디서 읽었는지는 [원문] 탭에서 봅니다.</p>
                      </div>
                    )}
                    <h4 className="mt-4 font-bold">상품별 표준 산출방법서</h4>
                    <table className="word-std">
                      <tbody>
                        {STANDARDS.map((x) => (
                          <tr key={x.id}>
                            <td><b>{standardFile(x)}</b><br /><small className="text-muted-foreground">{x.hint}</small></td>
                            <td className="whitespace-nowrap">
                              <button className="btn" onClick={() => download(`${standardFile(x)}.docx`, toStandardDocx(standardSpec(x)), DOCX_MIME)}>Word</button>{" "}
                              <button className="btn" onClick={() => void downloadHwpx(standardFile(x))}>한글</button>{" "}
                              <button className="btn" onClick={() => loadSample(x.yaml)}>조건 열기</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {tab === "original" && original && (
                  <div className="min-h-0 flex-1"><OriginalPane original={original} highlight={origHl} follow={follow} onPick={pickAnchors}
                  onVision={original.file ? () => setVision({ file: original.file!, reason: "글자 있는 PDF 를 쪽 그림으로 다시 읽습니다(표가 깨졌거나 수식이 그림일 때)." }) : undefined} /></div>
                )}
              </section>
            )}
          </div>
        )}
        {top && visible("sheet") && <Splitter dir="y" value={1 - layout.sheetH} onChange={(v) => setLayout((l) => ({ ...l, sheetH: 1 - v }))} />}
        {visible("sheet") && (
          <section className="no-print flex min-h-0 flex-col border-t border-border bg-white" style={{ flex: top ? `${layout.sheetH} 1 0` : "1 1 0" }}>
            <RateSheetPane state={sheet} onMap={(map) => setSheet((x) => (x ? { ...x, map } : x))} onText={pasteSheet} onFile={(f) => void openSheetFile(f)}
              onClear={() => setSheet(null)} rates={s.rates} sex={s.contract.sex} onNewRates={addRates} highlight={leftSel} onPick={(p) => pickPaths(p, true)} tools={tools("sheet")} />
          </section>
        )}
      </main>

      {/* ── 상태 ── */}
      <footer className="no-print flex flex-wrap items-center gap-3 border-t border-border bg-white px-4 py-1 text-xs text-muted-foreground">
        <span>담보 {s.benefits.length} · 위험률 {s.rates.length}{nTables ? ` (표 ${nTables})` : ""} · 사업비 {s.expenses.length}</span>
        {parsed.errors.filter((e) => !e.line).slice(0, 1).map((e, i) => <span key={i} className="text-amber-700">⚠ {e.message}</span>)}
        <span className="flex-1" />
        {leftSel.length > 0 && <span className="font-mono text-amber-700">{leftSel.slice(0, 3).join(", ")}{leftSel.length > 3 ? " …" : ""}</span>}
        <span>자동 저장됨</span>
      </footer>

      {drag && <div className="drop-overlay">여기에 놓으면 엽니다<small>PDF · DOCX · HWP · HWPX · TEX · MD · YAML · JSON · PNG · JPG — CSV · XLSX 는 위험률 표로</small></div>}
      {toast && <div className={`toast toast-${toast.kind}`} onClick={() => setToast(null)}>{toast.text}</div>}
      {help && <Help onClose={() => setHelp(false)} />}
      {vision && <VisionDialog file={vision.file} reason={vision.reason} onDone={onVisionDone} onClose={() => setVision(null)} />}
    </div>
  );
}

/** 두 창 사이 막대 — 끌거나 화살표 키로 크기를 바꾸고, 두 번 누르면 처음 비율로 */
function Splitter({ dir, value, onChange }: { dir: "x" | "y"; value: number; onChange: (v: number) => void }) {
  const clamp = (v: number) => Math.min(0.85, Math.max(0.15, v));
  return (
    <div role="separator" tabIndex={0} aria-orientation={dir === "x" ? "vertical" : "horizontal"} aria-valuenow={Math.round(value * 100)} aria-label="창 크기 조절"
      className={`no-print split split-${dir}`}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const r = e.currentTarget.parentElement!.getBoundingClientRect();
        onChange(clamp(dir === "x" ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height));
      }}
      onKeyDown={(e) => {
        const d = ({ ArrowLeft: -0.02, ArrowUp: -0.02, ArrowRight: 0.02, ArrowDown: 0.02 } as Record<string, number>)[e.key];
        if (d) { e.preventDefault(); onChange(clamp(value + d)); }
      }}
      onDoubleClick={() => onChange(dir === "x" ? LAYOUT0.split : 1 - LAYOUT0.sheetH)} />
  );
}

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-back no-print" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Life_ins_Doc_Convert_Studio 사용법</h2>
        <ol>
          <li><b>조건 입력</b> 왼쪽 [입력] 탭의 카드(M01 상품 기본정보 · M02 계약조건 · M03 이자율·저해지 · M04 위험률 · M05 납입자수 · C01 담보 · M06 사업비 …)에 칸을 채우면 오른쪽 산출방법서가 바로 바뀝니다. 담보·위험률·사업비 행은 ＋ 로 더합니다. [YAML] 탭에서 같은 조건을 파일로 봅니다 — 둘은 늘 같습니다.</li>
          <li><b>산출방법서 → 조건</b> PDF·DOCX·HWP·HWPX·TEX·MD 를 [열기] 하거나 창에 끌어다 놓으면 조건으로 옮깁니다. 표준 산출방법서는 식·주석까지, 다른 양식은 표·본문 규칙으로 읽을 수 있는 값을 읽습니다. [원문] 탭에서 근거 줄을 확인할 수 있습니다.</li>
          <li><b>위험률 표</b> 아래 창에 Excel 표를 붙여넣거나 CSV·XLSX 를 올리면 첫 행을 열 이름으로 읽습니다. 열마다 [잇기]에서 연령·위험률·성별을 고르면 그 값 표가 산출방법서와 MethodSpec JSON 에 실립니다(남·여 열이 있으면 계약 성별의 열).</li>
          <li><b>수식·기호 견본</b> 산출방법서 탭의 [＋ 수식 더하기]는 견본 식을 조건에 더하고, LaTeX·Markdown 탭의 [수식·기호 견본]은 커서 자리에 식·기호·표·절 제목을 넣습니다.</li>
          <li><b>그림으로 읽기</b> 스캔 PDF·PNG·JPG 를 열면 쪽을 골라 본인의 Anthropic API 키로 보냅니다. AI 는 쪽을 글로 옮겨 적기만 하고 값은 앱의 규칙이 읽습니다. 글자 있는 PDF 도 [원문] 탭에서 [그림으로 다시 읽기] 할 수 있습니다.</li>
          <li><b>Word·한글로 고치기</b> [Word·한글] 탭이나 [표준 양식] 메뉴에서 표준 산출방법서(.docx · .hwpx)를 받아 고친 뒤 올리면 바뀐 값·식·주석만 조건에 들어갑니다. [열기]로 올리면 조건 전체를 새로 만듭니다.</li>
          <li><b>LaTeX·Markdown 으로 고치기</b> 원문을 고친 뒤 [조건에 반영] 하면 바뀐 값만 조건에 들어갑니다. 조건 파일의 주석과 순서는 그대로 둡니다.</li>
          <li><b>대응 위치</b> 왼쪽 칸·줄을 고르면 오른쪽에서 그 조건이 만든 곳(표의 행·수식·원문 근거·위험률 표의 열)이 노랗게, 오른쪽을 누르면 왼쪽 칸이 표시됩니다.</li>
          <li><b>화면 조절</b> 창 사이 막대를 끌어 크기를 바꾸고(두 번 누르면 처음 비율), 창마다 [⤢ 전체]·[– 숨기기], 위 [보기]에서 다시 켭니다.</li>
          <li><b>다른 앱과 연동</b> [내보내기 → MethodSpec .json] 은 자유설계보험(flexible_insurance) 등이 읽는 중립 형식입니다(위험률 표 포함). 그 JSON 을 여기서 [열기] 해도 됩니다.</li>
        </ol>
        <p className="text-xs text-muted-foreground">조건 표기: 이율 <code>2.5%</code> · 사업비 <code>1.5/1000</code> · 배수 <code>1배</code> · 위험률 유형 death / incidence / recurring / waiver / lapse / other.</p>
        <button className="btn-primary mt-3" onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}
