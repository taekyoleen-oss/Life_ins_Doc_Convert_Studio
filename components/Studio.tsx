"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseDocument } from "yaml";
import CodeEditor, { type EditorApi } from "./CodeEditor";
import ConditionForm, { type RateSource } from "./ConditionForm";
import RateImportDialog, { type ImportPick } from "./RateImportDialog";
import RateProcessDialog, { type ProcessPick } from "./RateProcessDialog";
import DocPreview from "./DocPreview";
import FormulaPalette from "./FormulaPalette";
import OriginalPane from "./OriginalPane";
import dynamic from "next/dynamic";
// 그림으로 읽기 창은 열 때만 받는다 — Anthropic SDK 가 첫 화면 번들에 들어가지 않게
const VisionDialog = dynamic(() => import("./VisionDialog"), { ssr: false });
import RateSheetPane from "./RateSheetPane";
// 보험료 계산 화면(스프레드시트)은 열 때만 받는다
const PremiumSheet = dynamic(() => import("./PremiumSheet"), { ssr: false });
import RateLibraryDialog, { type LibPick } from "./RateLibraryDialog";
import { itemColumns, sanitizeLibrary, virtualizeSources, virtualSource, type RateLibrary } from "@/lib/rate-library";
import { SAMPLES, SHARED_SAMPLE_IDS, START_SAMPLE_ID } from "@/lib/samples";
import { editYaml, mergeSpec, patchYaml, yamlToSpec, type YamlEdit } from "@/lib/conditions/yaml";
import { anchorsForPaths, diffPaths, linesOfPaths, pathsAtLines, pathsForAnchors } from "@/lib/conditions/link";
import { withFormulas } from "@/lib/methoddoc/formulas";
import { CALC_DEFAULT, type CalcContract } from "@/lib/methoddoc/calc";
import { docToMarkdown, renderMethodDoc } from "@/lib/methoddoc/render";
import { docToLatex, latexToDoc } from "@/lib/methoddoc/tex";
import { ExtractError, extractDoc, extractText, type ExtractedDoc } from "@/lib/methoddoc/extract";
import { IMAGE_EXT } from "@/lib/pages";
import { parseMethodDoc } from "@/lib/methoddoc/parse";
import type { MethodSpec, RateRole } from "@/lib/methoddoc/spec";
import { ACCEPT, fromDoc, loadFile, type Original } from "@/lib/load";
import { DOCX_MIME, download, exporters } from "@/lib/export";
import { STANDARDS, standardFile, standardSpec, toStandardDocx } from "@/lib/standards";
import { addEmptyColumn, attachTables, autoMap, linkGroups, linkNote, newRateId, ratesWithoutTable, sanitizeSheet, sheetFromDoc, sheetFromFile, sheetFromSpec, sheetFromText, unlinkRate, unlinkedGroups, type Sheet, type SheetState } from "@/lib/sheet";
import { DOC_PARTS, SECTION_OF, formulaSnippet, inlineSnippet, type FormulaSample } from "@/lib/snippets";
import { buildPackage, isPackage, PACKAGE_EXT, readPackage } from "@/lib/package";
import { BASE_RATES_CSV } from "@/lib/base-rates";
import { baseName, guessRole, mergeColumns, sampleSheet, setCell, setHead, sexOf, type ColMap } from "@/lib/sheet";

/** 샘플은 조건 + 위험률 표 한 세트 — 기본 위험률 표(공개, 남·여)에서 그 조건의 위험률과 이름이 맞는 열만 */
const sampleSet = (y: string) => ({ yaml: y, sheet: sampleSheet(yamlToSpec(y).spec.rates, BASE_RATES_CSV, "기본 위험률 표") });
/** 첫 화면 = START_SAMPLE_ID(종신보험). [샘플] 메뉴는 공유용(SHARED_SAMPLE_IDS)만 — 주소에 ?all 이면 전부(개발·시험용) */
const START_SAMPLE = SAMPLES.find((x) => x.id === START_SAMPLE_ID) ?? SAMPLES[0];
const SHARED_SAMPLES = SHARED_SAMPLE_IDS.map((id) => SAMPLES.find((x) => x.id === id)).filter((x): x is (typeof SAMPLES)[number] => !!x);
const SAMPLE0 = sampleSet(START_SAMPLE.yaml);
/** 주소의 ?sample=<id> — 숨긴 샘플도 바로 연다(저장된 작업보다 먼저). ?all — [샘플] 메뉴에 모두 */
const urlParam = (k: string) => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(k));
/** 최근 작업 — 패키지로 저장·연 것과 연 파일. 조건·위험률 표를 그대로 두어 바로 되살린다 */
interface Recent { id: string; name: string; at: number; product: string; yaml: string; sheet: SheetState | null }
const RECENT_MAX = 12;
const sanitizeRecent = (raw: unknown): Recent[] => (Array.isArray(raw) ? raw : []).flatMap((r) => {
  const x = r as Partial<Recent>;
  return typeof x?.yaml === "string" && typeof x.name === "string"
    ? [{ id: String(x.id ?? x.at ?? Math.random()), name: x.name, at: Number(x.at) || 0, product: String(x.product ?? ""), yaml: x.yaml, sheet: sanitizeSheet(x.sheet ?? null) }] : [];
}).slice(0, RECENT_MAX);
const when = (t: number) => new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

type Tab = "doc" | "latex" | "markdown" | "word" | "original";
type PaneId = "cond" | "doc" | "sheet";
interface Buf { text: string; dirty: boolean }
type Toast = { text: string; kind: "ok" | "warn" | "err" } | null;
/** 화면 나눔 — 비율·숨김·크게 보기·왼쪽 탭·펼친 카드. 브라우저에 기억한다 */
/** `v` 는 저장본 판 — 기본값을 바꾸면 올린다(옛 저장본의 그 값을 한 번 버린다) */
interface Layout { v: number; split: number; sheetH: number; hide: PaneId[]; max: PaneId | null; left: "form" | "yaml"; open: string[]; /** 식을 보이는 카드 id — 카드마다 [수식 보이기], 기본 숨김 */ formulas: string[] }
const PANES: PaneId[] = ["cond", "doc", "sheet"];
const PANE_NAME: Record<PaneId, string> = { cond: "조건", doc: "산출방법서", sheet: "위험률 표" };
const LAYOUT0: Layout = { v: 3, split: 0.44, sheetH: 0.26, hide: [], max: null, left: "form", open: ["M01"], formulas: [] };

const KEY = "life_ins_doc_convert_studio";
/** 공유 테스트의 의견 받는 곳 — 공개 저장소의 이슈 */
const FEEDBACK_URL = "https://github.com/taekyoleen-oss/Life_ins_Doc_Convert_Studio/issues";
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
    // 카드의 식은 기본이 숨김이다(카드마다) — v 가 낮은 옛 저장본(한 단추)은 한 번 버린다
    formulas: l.v === LAYOUT0.v && Array.isArray(l.formulas) ? l.formulas.filter((x): x is string => typeof x === "string") : LAYOUT0.formulas,
    v: LAYOUT0.v,
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
  const [yaml, setYaml] = useState(SAMPLE0.yaml);
  const [saved, setSaved] = useState(SAMPLE0.yaml);            // 마지막으로 연 내용 — 덮어쓰기 확인용
  const [layout, setLayout] = useState<Layout>(LAYOUT0);
  const [sheet, setSheet] = useState<SheetState | null>(SAMPLE0.sheet);
  const [recent, setRecent] = useState<Recent[]>([]);
  // 기본 위험률 모음 — 공개 기본 위험률 + (이 PC 에 있으면) 사내 위험률 모음(public/rate-library.json ← private/, 외부 반출 금지)
  const [library, setLibrary] = useState<RateLibrary | null>(null);
  const [libOpen, setLibOpen] = useState(false);
  /** M04 의 [스프레드시트에서 불러오기] · [위험률 가공] 창 */
  const [importOpen, setImportOpen] = useState(false);
  const [processOpen, setProcessOpen] = useState(false);
  const [allSamples, setAllSamples] = useState(false);
  /** 공유 테스트 안내 — 처음 여는 사람에게 펼쳐 두고, 닫으면 다시 펼치지 않는다(머리의 [테스트 안내]로 다시) */
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    fetch("/rate-library.json").then((r) => (r.ok ? r.json() : null)).then((j) => setLibrary(sanitizeLibrary(j))).catch(() => { /* 없으면 공개 기본 위험률만 */ });
  }, []);
  useEffect(() => {
    // 위험률 근거를 가상 이름으로 — 예전에 위험률 모음·다른 앱에서 실제 출처(회사·회차·호수)가 들어온 저장본을 한 번 고친다(최근 작업 목록도)
    const VSRC = `${KEY}:virtual-source-v1`;
    let s = readStore();
    if (!readJson(VSRC)) {
      const v = s ? virtualizeSources(s) : s;
      if (v && v !== s) { writeStore(v); s = v; }
      const rec = readJson(`${KEY}:recent`);
      if (Array.isArray(rec)) writeJson(`${KEY}:recent`, rec.map((r) => (r && typeof r.yaml === "string" ? { ...r, yaml: virtualizeSources(r.yaml) } : r)));
      writeJson(VSRC, 1);
    }
    // 공유 샘플을 새 모양으로 바꾼 뒤 — 예전 샘플에서 시작한 저장본(첫 줄이 그 샘플의 머리말)은 한 번 새 샘플로 바꾸고, 예전 것은 최근 작업에 남긴다
    const SV = `${KEY}:sample-v2`;
    if (!readJson(SV)) {
      const head = (y: string) => y.split("\n", 1)[0];
      const fresh = s ? SAMPLES.find((x) => SHARED_SAMPLE_IDS.includes(x.id) && head(x.yaml) === head(s!) && x.yaml !== s) : undefined;
      if (fresh && s) {
        const rec = readJson(`${KEY}:recent`);
        writeJson(`${KEY}:recent`, [{ id: `${Date.now()}`, name: "예전 샘플 저장본", at: Date.now(), product: yamlToSpec(s).spec.meta.productName, yaml: s, sheet: null }, ...(Array.isArray(rec) ? rec : [])].slice(0, RECENT_MAX));
        s = fresh.yaml; writeStore(s); writeJson(`${KEY}:sheet`, null);
        setToast({ text: `${fresh.label} 샘플이 새 모양으로 바뀌어 다시 열었습니다 — 예전 저장본은 [최근 작업]에 남겨 두었습니다`, kind: "ok" });
      }
      writeJson(SV, 1);
    }
    // 첫 화면을 암보험으로 바꾼 뒤(2026-10-06) — 손대지 않은 공유 샘플 그대로인 저장본이면 한 번 첫 화면 샘플로 연다
    const SV3 = `${KEY}:sample-v3`;
    if (!readJson(SV3)) {
      if (s && s !== START_SAMPLE.yaml && SAMPLES.some((x) => SHARED_SAMPLE_IDS.includes(x.id) && x.yaml === s)) { s = START_SAMPLE.yaml; writeStore(s); writeJson(`${KEY}:sheet`, null); }
      writeJson(SV3, 1);
    }
    setAllSamples(urlParam("all") !== null);
    setGuide(!readJson(`${KEY}:guide-v1`));
    // 주소로 고른 샘플 — 저장된 작업 대신 그 샘플 세트를 연다
    const pick = SAMPLES.find((x) => x.id === urlParam("sample"));
    if (pick) {
      const set = sampleSet(pick.yaml);
      setYaml(set.yaml); setSaved(set.yaml); setSheet(set.sheet);
      hist.current = { cur: { yaml: set.yaml, sheet: set.sheet }, past: [], future: [], at: 0 };
    } else
    // 이어서 작업 — 처음이면 샘플 세트 그대로. 저장된 조건에 표가 없으면(옛 저장본) 견본 표에서 그 조건의 위험률과 이름이 맞는 열을 붙여 준다 — 화면은 늘 조건 + 표 한 세트
    if (s) {
      setYaml(s); setSaved(s);
      const stored = sanitizeSheet(readJson(`${KEY}:sheet`));
      const fallback = stored ? null : s === SAMPLE0.yaml ? SAMPLE0.sheet : sampleSheet(yamlToSpec(s).spec.rates, BASE_RATES_CSV, "기본 위험률 표");
      setSheet(stored ?? fallback);
      if (fallback && s !== SAMPLE0.yaml) setToast({ text: `위험률 표가 없어 기본 위험률 표(공개)에서 이름이 맞는 ${fallback.sheet.head.length - 1}개 열을 이었습니다 — 실제 표를 올리거나 칸을 눌러 값을 고치세요`, kind: "warn" });
    }
    setLayout(sanitizeLayout(readJson(`${KEY}:layout`)));
    setRecent(sanitizeRecent(readJson(`${KEY}:recent`)));
  }, []);
  const pushRecent = useCallback((name: string, y: string, sh: SheetState | null) => {
    setRecent((list) => {
      const product = yamlToSpec(y).spec.meta.productName;
      const next = [{ id: `${Date.now()}`, name, at: Date.now(), product, yaml: y, sheet: sh }, ...list.filter((r) => r.name !== name)].slice(0, RECENT_MAX);
      writeJson(`${KEY}:recent`, next);
      return next;
    });
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
  const [pal, setPal] = useState(false);                   // 수식·기호 견본 (LaTeX·Markdown 탭 — 커서 자리에)
  const [calcOpen, setCalcOpen] = useState(false);         // 보험료 계산 화면(스프레드시트)
  const [calcOn, setCalcOn] = useState<CalcContract>(CALC_DEFAULT);   // 산출 결과에 쓰는 계약 한 점 — 조건에 저장하지 않는다
  const [palLeft, setPalLeft] = useState(false);           // 수식 더하기 (조건 창 — M08 식으로)
  const editor = useRef<EditorApi | null>(null);

  // ── 되돌리기 — 조건(YAML)과 위험률 표의 스냅샷. 0.8초 안에 이어진 변경(칸에 타자)은 한 걸음으로 묶는다 ──
  type Snap = { yaml: string; sheet: SheetState | null };
  const hist = useRef<{ cur: Snap; past: Snap[]; future: Snap[]; at: number }>({ cur: { yaml: SAMPLE0.yaml, sheet: SAMPLE0.sheet }, past: [], future: [], at: 0 });
  const [histN, setHistN] = useState({ past: 0, future: 0 });
  useEffect(() => {
    const h = hist.current;
    if (yaml === h.cur.yaml && sheet === h.cur.sheet) return;       // 되돌린 상태가 반영된 것 — 걸음을 만들지 않는다
    const now = Date.now();
    if (now - h.at > 800) { h.past.push(h.cur); if (h.past.length > 100) h.past.shift(); h.future = []; }
    h.cur = { yaml, sheet }; h.at = now;
    setHistN({ past: h.past.length, future: h.future.length });
  }, [yaml, sheet]);
  const restore = useCallback((dir: -1 | 1) => {
    const h = hist.current;
    const from = dir < 0 ? h.past : h.future, to = dir < 0 ? h.future : h.past;
    const s = from.pop();
    if (!s) return;
    to.push(h.cur); h.cur = s; h.at = 0;
    setYaml(s.yaml); setSheet(s.sheet);
    setHistN({ past: h.past.length, future: h.future.length });
    setToast({ text: dir < 0 ? `한 걸음 되돌렸습니다 (남은 ${h.past.length})` : "다시 실행했습니다", kind: "ok" });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement;
      // 입력칸·YAML 편집기 안에서는 그 칸의 되돌리기(글자 단위)가 먼저다 — 칸 밖에서 누를 때만 조건 전체를 되돌린다
      if (el.closest("input, textarea, select, [contenteditable], .cm-editor")) return;
      if (e.key === "z" || e.key === "Z") { e.preventDefault(); restore(e.shiftKey ? 1 : -1); }
      else if (e.key === "y") { e.preventDefault(); restore(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [restore]);
  // 열린 메뉴(샘플·내보내기)는 바깥을 누르거나 Esc 로 닫는다
  useEffect(() => {
    const close = (e: Event) => document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => {
      if (e.type === "keydown" ? (e as KeyboardEvent).key === "Escape" : !d.contains(e.target as Node)) d.removeAttribute("open");
    });
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, []);
  const srcEditor = useRef<EditorApi | null>(null);        // LaTeX·Markdown 편집기 — 견본을 커서 자리에 넣는다
  const [toast, setToast] = useState<Toast>(null);
  const [help, setHelp] = useState(false);
  // Word 로 고쳐 올린 결과 — 무엇이 조건에 들어갔는지 탭에 남긴다
  const [wordLog, setWordLog] = useState<{ name: string; format?: string; changes: string[] } | null>(null);
  const mergeInput = useRef<HTMLInputElement | null>(null);
  // 그림으로 읽기(스캔 PDF · PNG · JPG) — 쪽을 고르고 사용자 키로 보낸다
  const [vision, setVision] = useState<{ file: File; reason: string } | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.kind === "err" ? 9000 : 6000); return () => clearTimeout(t); }, [toast]);

  // LaTeX·Markdown 편집 버퍼 — 고치지 않았으면 조건에서 늘 새로 만든다
  const [latex, setLatex] = useState<Buf>({ text: "", dirty: false });
  const [md, setMd] = useState<Buf>({ text: "", dirty: false });
  // 그 탭을 볼 때만 만든다 — 조건을 한 글자 고칠 때마다 만들면 헛일이다(내보내기는 lib/export.ts 가 따로 만든다)
  const genLatex = useMemo(() => (tab === "latex" ? docToLatex(sections, title) : ""), [tab, sections, title]);
  const genMd = useMemo(() => (tab === "markdown" ? docToMarkdown(sections, title) : ""), [tab, sections, title]);

  const mirror = useMemo(() => linesOfPaths(parsed.ranges, rightSel), [parsed, rightSel]);
  // 마지막으로 연(또는 표시를 지운) 조건과 다른 곳 — 입력 카드·산출방법서에 "바뀜" 표시
  const rawOf = (y: string) => { const d = parseDocument(y); return d.errors.length ? null : (d.toJS() ?? {}); };
  const changed = useMemo(() => { const a = rawOf(saved), b = rawOf(deferred); return a && b ? diffPaths(a, b) : []; }, [saved, deferred]);
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
  /**
   * 조건과 위험률 표를 함께 — M04 에서 위험률을 더하면 표에 그 이름의 빈 열(값을 붙여넣을 자리)이 생기고,
   * 지우면 그 열의 연결이 풀린다. 산출방법서·JSON·계산 앱이 모두 이 연결에 기댄다
   */
  const onEdit = useCallback((edits: YamlEdit[]) => {
    setYaml((y) => {
      const raw = parseDocument(y).toJS() as { rates?: { id?: unknown; name?: unknown }[]; basis?: { waiverRateIds?: unknown[] } } | null;
      const more: YamlEdit[] = [];
      for (const e of edits) {
        if (e.path[0] !== "rates") continue;
        const v = e.value as { id?: unknown; name?: unknown } | undefined;
        if (e.add && e.path.length === 1 && v?.id) setSheet((st) => addEmptyColumn(st, { id: String(v.id), name: String(v.name ?? v.id) }));
        else if (!e.add && e.value === undefined && e.path.length === 2) {
          const id = raw?.rates?.[Number(e.path[1])]?.id;
          if (!id) continue;
          setSheet((st) => unlinkRate(st, String(id)));
          // 납입면제 사유 목록에서도 뺀다 — 없는 위험률을 가리키지 않게
          const w = (raw?.basis?.waiverRateIds ?? []).map(String);
          if (w.includes(String(id))) { const rest = w.filter((x) => x !== String(id)); more.push({ path: ["basis", "waiverRateIds"], value: rest.length ? rest : undefined }); }
        }
      }
      return editYaml(y, [...edits, ...more]);
    });
  }, []);
  /** 문서를 반영해 위험률이 늘거나 줄었을 때 표도 맞춘다 */
  const syncSheetRates = (before: MethodSpec["rates"], after: MethodSpec["rates"]) => {
    const was = new Set(before.map((r) => r.id)), now = new Set(after.map((r) => r.id));
    setSheet((st) => {
      let next = st;
      for (const r of after) if (!was.has(r.id)) next = addEmptyColumn(next, r);
      for (const r of before) if (!now.has(r.id)) next = unlinkRate(next, r.id);
      return next;
    });
  };
  const setOpen = useCallback((f: (o: string[]) => string[]) => setLayout((l) => ({ ...l, open: f(l.open) })), []);
  const tableNote = useCallback((id: string) => linkNote(sheet, specT, id), [sheet, specT]);

  /** 위험률 표의 열을 새 위험률로 — 조건에 더하고 id 를 돌려준다 */
  const addRates = (items: { name: string; role: RateRole; source?: string }[]): string[] => {
    if (syntaxErrors.length) { setToast({ text: `조건 파일 ${syntaxErrors[0].line}번째 줄 오류를 먼저 고쳐 주세요`, kind: "err" }); return []; }
    const raw = parseDocument(yaml).toJS() as { rates?: { id?: unknown }[] } | null;
    const taken = Array.isArray(raw?.rates) ? raw.rates.map((r) => String(r?.id)) : [];
    const ids: string[] = [];
    for (const it of items) ids.push(newRateId(it.role, [...taken, ...ids]));
    if (items.length) {
      setYaml((y) => editYaml(y, items.map((it, k) => ({ path: ["rates"], add: true, value: { id: ids[k], name: it.name, role: it.role, ...(it.source ? { source: it.source } : {}) } }))));
      setToast({ text: `위험률 ${items.map((x) => x.name).join(", ")} 을(를) 조건(M04)에 더했습니다 — 유형을 확인하세요`, kind: "ok" });
    }
    return ids;
  };

  /**
   * 표를 올리면 열 이름으로 조건의 위험률에 잇고, 조건에 없는 이름의 수 열은 새 위험률로 조건에 더해 잇는다 —
   * 사용자는 표만 올리면 된다(유형은 이름으로 어림하므로 M04 에서 확인 · 되돌리기 가능)
   */
  /**
   * 기본 위험률 모음에서 고른 것 → 위험률 표 창의 남·여 열. 고른 조건 위험률에 잇고(그 위험률에 이어 있던 열은 풀린다),
   * "새 위험률" 이면 M04 에 더해 잇는다 — 산출방법서 별첨·JSON(자유설계보험)에 그 값이 실린다
   */
  const addFromLibrary = (picks: LibPick[]) => {
    const fresh = picks.filter((p) => p.target === "new");
    const ids = fresh.length ? addRates(fresh.map((p) => ({ name: p.item.name, role: guessRole(`${p.item.category} ${p.item.name}`), source: virtualSource(undefined, p.item.name) }))) : [];
    if (ids.length !== fresh.length) return;                    // 조건 파일 오류 — addRates 가 알렸다
    const target = (p: LibPick) => (p.target === "new" ? ids[fresh.indexOf(p)] : p.target);
    let st = sheet;
    for (const p of picks) if (p.target !== "new") st = unlinkRate(st, p.target);
    st = mergeColumns(st, picks.flatMap((p) => itemColumns(p.item).map((c) => ({ ...c, target: target(p) }))), sheet?.sheet.name ?? "위험률 표");
    setSheet(st); showPane("sheet"); setLibOpen(false);
    const priv = picks.some((p) => p.item.private);
    setToast({ text: `위험률 ${picks.length}개를 표에 넣고 조건에 이었습니다 (${picks.map((p) => p.item.name).join(", ")})${priv ? " — 사내 자료(외부 반출 금지)가 들어 있습니다" : ""}`, kind: priv ? "warn" : "ok" });
  };

  // M04 의 위험률 표 연결 — 지금 위험률 표의 열(성별을 뺀 이름)만 고른다. 새로 필요한 위험률은 표에 새 열을 더한다(사용자 요청 2026-10-06 — 기본 위험률 모음에서 따로 가져오지 않는다)
  const rateSources = useMemo<RateSource[]>(() => {
    const cols = sheet ? [...new Set(sheet.sheet.head.flatMap((h, i) => (sheet.map[i]?.to !== "age" ? [baseName(h)] : [])))] : [];
    return cols.map((n) => ({ key: `col:${n}`, label: n, group: "위험률 표의 열" }));
  }, [sheet]);
  const rateSourceOf = useCallback((id: string) => {
    const i = sheet ? sheet.map.findIndex((m) => m.to === "rate" && m.rateId === id) : -1;
    return i >= 0 ? `col:${baseName(sheet!.sheet.head[i])}` : undefined;
  }, [sheet]);
  /** 근거 칸 — 늘 가상 출처(경험생명표(가상) <이름>) */
  const setRateSource = (rateId: string, name: string) => {
    const raw = parseDocument(yaml).toJS() as { rates?: { id?: unknown }[] } | null;
    const i = (raw?.rates ?? []).findIndex((r) => String(r?.id) === rateId);
    if (i >= 0) onEdit([{ path: ["rates", i, "source"], value: virtualSource(undefined, name) }]);
  };
  const onRateSource = (rateId: string, key: string) => {
    if (key === "new") {
      // 위험률 표에 이 위험률의 새 열(남·여) — 값은 표에 붙여넣는다. 표가 없으면 연령 0~110 열부터 만든다
      const r = specT.rates.find((x) => x.id === rateId);
      if (!r) return;
      setSheet((st) => {
        const hasAge = !!st && st.map.some((m) => m.to === "age") && st.sheet.rows.length > 0;
        const base: SheetState = hasAge ? st! : { sheet: { name: st?.sheet.name ?? "위험률 표", head: ["연령"], rows: Array.from({ length: 111 }, (_, a) => [String(a)]) }, map: [{ to: "age" }] };
        return mergeColumns(unlinkRate(base, rateId)!, (["M", "F"] as const).map((sx) => ({ head: `${r.name}(${sx === "M" ? "남" : "여"})`, ages: [], values: [], target: rateId })), base.sheet.name);
      });
      showPane("sheet");
      setToast({ text: `위험률 표에 ${r.name} 열(남·여)을 더했습니다 — 값을 붙여넣으세요`, kind: "ok" });
      return;
    }
    const name = key.slice(4);
    // 그 이름(성별을 뺀)의 수 열을 이 위험률에 — 이 위험률에 이어 있던 열은 풀린다
    setSheet((st) => {
      if (!st) return st;
      const map = st.map.map((m, i): ColMap => {
        if (m.to === "rate" && m.rateId === rateId) return { to: "skip" };
        if (m.to !== "age" && baseName(st.sheet.head[i]) === name) { const sx = m.to === "rate" && m.sex ? m.sex : sexOf(st.sheet.head[i]); return { to: "rate", rateId, ...(sx ? { sex: sx } : {}) }; }
        return m;
      });
      return { ...st, map };
    });
    setRateSource(rateId, name);
  };
  /** M04 기호(위험률 id) 바꾸기 — 조건에서 그 위험률을 가리키는 곳(담보·유지자·합성·납입면제)과 위험률 표의 잇기를 함께 */
  const onRenameRate = (from: string, to: string) => {
    const id = to.trim();
    if (!id || id === from) return;
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(id)) { setToast({ text: `기호 "${id}" 는 쓸 수 없습니다 — 영문자로 시작하는 영문·숫자로 적으세요(예: rc · r80)`, kind: "err" }); return; }
    if (specT.rates.some((r) => r.id === id)) { setToast({ text: `기호 "${id}" 는 이미 다른 위험률이 씁니다`, kind: "err" }); return; }
    const raw = parseDocument(yaml).toJS() as { rates?: { id?: unknown }[]; benefits?: { rateId?: unknown; exitRateIds?: unknown[] }[]; survivors?: { exitRateIds?: unknown[] }[]; combos?: { rateIds?: unknown[] }[]; basis?: { waiverRateIds?: unknown[] } } | null;
    const swap = (list?: unknown[]) => (list ?? []).map((x) => (String(x) === from ? id : x));
    const has = (list?: unknown[]) => (list ?? []).some((x) => String(x) === from);
    const edits: YamlEdit[] = [];
    (raw?.rates ?? []).forEach((r, i) => { if (String(r?.id) === from) edits.push({ path: ["rates", i, "id"], value: id }); });
    (raw?.benefits ?? []).forEach((b, i) => {
      if (String(b?.rateId ?? "") === from) edits.push({ path: ["benefits", i, "rateId"], value: id });
      if (has(b?.exitRateIds)) edits.push({ path: ["benefits", i, "exitRateIds"], value: swap(b.exitRateIds) });
    });
    (raw?.survivors ?? []).forEach((x, i) => { if (has(x?.exitRateIds)) edits.push({ path: ["survivors", i, "exitRateIds"], value: swap(x.exitRateIds) }); });
    (raw?.combos ?? []).forEach((x, i) => { if (has(x?.rateIds)) edits.push({ path: ["combos", i, "rateIds"], value: swap(x.rateIds) }); });
    if (has(raw?.basis?.waiverRateIds)) edits.push({ path: ["basis", "waiverRateIds"], value: swap(raw?.basis?.waiverRateIds) });
    onEdit(edits);
    setSheet((st) => (st ? { ...st, map: st.map.map((m): ColMap => (m.to === "rate" && m.rateId === from ? { ...m, rateId: id } : m)) } : st));
  };
  /** 스프레드시트에서 불러온 열 → 위험률 표 + 조건(새 위험률은 이름마다 하나 · 남·여 열은 한 위험률) */
  const addFromImport = (picks: ImportPick[]) => {
    const names = [...new Set(picks.filter((p) => p.target === "new").map((p) => p.name))];
    const ids = names.length ? addRates(names.map((n) => ({ name: n, role: picks.find((p) => p.name === n)!.role, source: virtualSource(undefined, n) }))) : [];
    if (ids.length !== names.length) return;
    const target = (p: ImportPick) => (p.target === "new" ? ids[names.indexOf(p.name)] : p.target);
    let st = sheet;
    for (const t of new Set(picks.filter((p) => p.target !== "new").map((p) => p.target))) st = unlinkRate(st, t);
    st = mergeColumns(st, picks.map((p) => ({ head: p.head, ages: p.ages, values: p.values, target: target(p) })), sheet?.sheet.name ?? "위험률 표");
    setSheet(st); showPane("sheet"); setImportOpen(false);
    setToast({ text: `위험률 ${new Set(picks.map((p) => p.name)).size}개(${picks.length}열)를 표에 넣고 조건에 이었습니다 — M04 에서 유형을 확인하세요`, kind: "ok" });
  };
  /** 가공한 위험률 → 새 위험률 + 표의 새 열(남·여) */
  const addFromProcess = (pk: ProcessPick) => {
    const [id] = addRates([{ name: pk.name, role: pk.role, source: pk.source }]);
    if (!id) return;
    setSheet((st) => mergeColumns(st, pk.cols.map((c) => ({ head: c.sex ? `${pk.name}(${c.sex === "M" ? "남" : "여"})` : pk.name, ages: c.ages, values: c.values, target: id })), st?.sheet.name ?? "위험률 표"));
    showPane("sheet"); setProcessOpen(false);
  };

  const loadSheet = (sh: Sheet) => {
    if (sheet && sheet.map.some((m) => m.to !== "skip") && !window.confirm("지금 위험률 표와 연결을 새 표로 바꿀까요?")) return;
    let st: SheetState = { sheet: sh, map: autoMap(sh, parsed.spec.rates) };
    const groups = unlinkedGroups(st, parsed.spec.rates);
    const ids = groups.length ? addRates(groups.map((g) => ({ name: g.name, role: g.role }))) : [];
    if (ids.length) st = linkGroups(st, groups, ids);
    setSheet(st);
    showPane("sheet");
    const n = new Set(st.map.flatMap((m) => (m.to === "rate" ? [m.rateId] : []))).size;
    const age = st.map.some((m) => m.to === "age");
    setToast({ text: `${sh.name}: ${sh.rows.length}행 × ${sh.head.length}열 — 위험률 ${n}개에 이었습니다${ids.length ? ` (${groups.map((g) => g.name).join(", ")} 은(는) 조건 M04 에 새로 더함 — 유형을 확인하세요)` : ""}${age ? "" : " · 연령 열을 [잇기]에서 정하세요"}`, kind: age ? "ok" : "warn" });
  };
  const openSheetFile = async (f: File) => {
    try { loadSheet(await sheetFromFile(f)); } catch (e) { setToast({ text: errText(e), kind: "err" }); }
  };
  const pasteSheet = (text: string) => {
    try { loadSheet(sheetFromText("붙여넣기", text)); } catch (e) { setToast({ text: errText(e), kind: "err" }); }
  };

  /** 견본 식을 조건의 식(M09 따로 적는 식)으로 더한다 — 산출방법서의 알맞은 절에 붙는다 */
  const addFormula = (f: FormulaSample) => {
    const raw = parseDocument(yaml).toJS() as { formulas?: unknown[] } | null;
    const n = Array.isArray(raw?.formulas) ? raw.formulas.length : 0;
    onEdit([{ path: ["formulas"], add: true, value: { section: SECTION_OF[f.group] ?? "계산기수", label: f.label, text: f.text } }]);
    setLayout((l) => ({ ...l, left: "form", open: ["M09"] }));      // 카드는 한 번에 하나만 펼친다
    setLeftSel([`formulas[${n}]`]); setRightSel([`formulas[${n}]`]); setFollow(true);
    setToast({ text: `"${f.label}" 식을 조건 M09(따로 적는 식) 에 더했습니다 — 그 카드에서 고쳐 쓰세요 (되돌리기 ↶)`, kind: "ok" });
  };

  // ── 열기 ─────────────────────────────────────────────────────────────────
  const open = useCallback(async (file: File) => {
    if (SHEET_EXT.test(file.name)) { await openSheetFile(file); return; }
    if (yaml !== saved && !window.confirm("지금 조건에 고친 내용이 있습니다. 새 파일로 바꿀까요?")) return;
    if (IMAGE_EXT.test(file.name)) { setVision({ file, reason: "그림 파일입니다." }); return; }
    if (file.name.toLowerCase().endsWith(PACKAGE_EXT)) { await openPackage(file); return; }
    try {
      setToast({ text: `${file.name} 읽는 중…`, kind: "ok" });
      const r = await loadFile(file);
      pushRecent(file.name, r.yaml, r.sheet ?? null);
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

  // ── 패키지(.lifepkg) — 조건 · 산출방법서 · 위험률 표를 한 파일로 저장하고 연다 · 최근 작업 ──
  const packageName = () => `${(s.meta.productName || "상품").replace(/[^\w가-힣]+/g, "_")}_패키지${PACKAGE_EXT}`;
  const savePackage = () => {
    if (syntaxErrors.length) { setToast({ text: `조건 파일 ${syntaxErrors[0].line}번째 줄 오류를 먼저 고쳐 주세요`, kind: "err" }); return; }
    const name = packageName();
    download(name, buildPackage({ yaml, sheet, spec: specT }), "application/zip");
    pushRecent(name, yaml, sheet);
    setSaved(yaml);
    const parts = ["조건", "산출방법서(Word·Markdown)", "MethodSpec JSON", ...(sheet?.map.some((m) => m.to === "rate") ? ["위험률 표"] : [])];
    setToast({ text: `${name} — ${parts.join(" · ")}${noTable.length ? ` (값 표 없는 위험률 ${noTable.length}개는 그대로)` : ""} 를 한 파일로 저장했습니다. 이름을 .zip 으로 바꾸면 안의 파일을 꺼낼 수 있습니다`, kind: "ok" });
  };
  const openPackage = async (file: File) => {
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      if (!isPackage(buf)) throw new Error(`${file.name} 은(는) 패키지(.lifepkg)가 아닙니다`);
      const r = await readPackage(buf);
      if (r.yaml === undefined) throw new Error("패키지에 조건(조건.yaml · MethodSpec.json)이 없습니다");
      restoreSet(file.name, r.yaml, r.sheet ?? null);
      pushRecent(file.name, r.yaml, r.sheet ?? null);
      setToast({ text: `${file.name} — ${r.meta.product || r.meta.name} · 위험률 ${r.meta.rates}개${r.sheet ? ` · 위험률 표 ${r.sheet.sheet.head.length - 1}열` : " · 위험률 표 없음"} (${new Date(r.meta.savedAt).toLocaleString("ko-KR")} 저장)`, kind: "ok" });
    } catch (e) { setToast({ text: errText(e), kind: "err" }); }
  };
  /** 조건 + 위험률 표를 한 세트로 바꾼다 — 패키지·최근 작업·샘플이 모두 이 길 */
  const restoreSet = (name: string, y: string, sh: SheetState | null) => {
    if (original?.pdfUrl) URL.revokeObjectURL(original.pdfUrl);
    setYaml(y); setSaved(y); setSheet(sh); setOriginal(null);
    setLatex({ text: "", dirty: false }); setMd({ text: "", dirty: false });
    setLeftSel([]); setRightSel([]); setTab("doc"); showPane("doc");
    if (sh) showPane("sheet");
  };
  const openRecent = (r: Recent) => {
    if (yaml !== saved && !window.confirm("지금 조건에 고친 내용이 있습니다. 최근 작업으로 바꿀까요?")) return;
    restoreSet(r.name, r.yaml, r.sheet);
    setToast({ text: `${r.name} (${when(r.at)}) 을(를) 불러왔습니다`, kind: "ok" });
  };
  const packageInput = useRef<HTMLInputElement | null>(null);

  const loadSample = (y: string, to: Tab = "doc") => {
    if (yaml !== saved && !window.confirm("지금 조건에 고친 내용이 있습니다. 샘플로 바꿀까요?")) return;
    const set = sampleSet(y);
    setYaml(y); setSaved(y); setOriginal(null); setSheet(set.sheet);
    setLatex({ text: "", dirty: false }); setMd({ text: "", dirty: false });
    setLeftSel([]); setRightSel([]); setTab(to);
    showPane("doc");
    setToast({ text: to === "doc" ? `샘플 세트를 열었습니다 — 조건·산출방법서·위험률 표${set.sheet ? `(${set.sheet.sheet.head.length - 1}열)` : ""}. 왼쪽을 고쳐 보세요` : `샘플 산출방법서(${to === "latex" ? "LaTeX" : "Markdown"})를 열었습니다 — 값을 고친 뒤 [조건에 반영]`, kind: "ok" });
  };

  // ── LaTeX·Markdown 을 고쳐 조건에 반영 ───────────────────────────────────
  const applySource = (kind: "latex" | "markdown") => {
    if (syntaxErrors.length) { setToast({ text: `조건 파일 ${syntaxErrors[0].line}번째 줄 오류를 먼저 고쳐 주세요`, kind: "err" }); return; }
    const text = kind === "latex" ? (latex.dirty ? latex.text : genLatex) : (md.dirty ? md.text : genMd);
    const doc = kind === "latex" ? latexToDoc(text) : extractText(new TextEncoder().encode(text));
    const back = parseMethodDoc(doc, { fallbackName: parsed.spec.meta.productName });
    const { spec, changes } = mergeSpec(parsed.spec, back.spec, back.evidence, { standard: !!back.format });
    if (!changes.length) { setToast({ text: "조건으로 옮길 바뀐 값이 없습니다 — 문장 수정은 조건에 들어가지 않습니다(내려받아 보관하세요)", kind: "warn" }); return; }
    setYaml(patchYaml(yaml, spec));
    syncSheetRates(parsed.spec.rates, spec.rates);
    (kind === "latex" ? setLatex : setMd)({ text: "", dirty: false });
    setToast({ text: `조건 ${changes.length}건 반영 — ${changes.slice(0, 3).join(" · ")}${changes.length > 3 ? " …" : ""}`, kind: "ok" });
  };

  /**
   * Word(또는 어떤 산출방법서든)를 고쳐 올리면 바뀐 값만 지금 조건에 넣는다 — [불러오기] 처럼 조건을 통째로 바꾸지 않는다.
   * 표준 산출방법서면 식·주석·절까지, 아니면 표·본문 규칙으로 읽은 값만.
   */
  const applyFile = async (file: File) => {
    if (syntaxErrors.length) { setToast({ text: `조건 파일 ${syntaxErrors[0].line}번째 줄 오류를 먼저 고쳐 주세요`, kind: "err" }); return; }
    try {
      setToast({ text: `${file.name} 읽는 중…`, kind: "ok" });
      const doc = await extractDoc(file.name, new Uint8Array(await file.arrayBuffer()));
      const back = parseMethodDoc(doc, { fallbackName: parsed.spec.meta.productName });
      const { spec, changes } = mergeSpec(parsed.spec, back.spec, back.evidence, { standard: !!back.format });
      // 별첨 위험률 값 표가 있고 지금 표(내보낸 모양)와 다르면 그 표로 바꾼다 — 문서에서 값을 고치거나 열을 더한 것
      const sh = sheetFromDoc(doc, file.name);
      const cur = sheetFromSpec(specT, "")?.sheet;
      const newSheet = sh && JSON.stringify([sh.head, sh.rows]) !== JSON.stringify([cur?.head, cur?.rows]) ? { sheet: sh, map: autoMap(sh, spec.rates) } : null;
      if (newSheet) changes.push(`위험률 값 표: ${sh!.head.length - 1}열 × ${sh!.rows.length}행 (별첨) → 위험률 표 창`);
      if (original?.pdfUrl) URL.revokeObjectURL(original.pdfUrl);
      setOriginal({ name: file.name, doc, evidence: back.evidence, missing: back.missing });
      setWordLog({ name: file.name, format: back.format, changes: [...changes, ...back.warnings.map((w) => `⚠ ${w}`)] });
      setTab("word"); showPane("doc");
      if (newSheet) { setSheet(newSheet); showPane("sheet"); }
      if (!changes.length) { setToast({ text: `${file.name} — 조건과 다른 값이 없습니다`, kind: "warn" }); return; }
      setYaml(patchYaml(yaml, spec));
      if (!newSheet) syncSheetRates(parsed.spec.rates, spec.rates);
      setToast({ text: `${file.name} — 조건 ${changes.length}건 반영${back.format ? "" : " (표준 양식이 아니어서 값만)"}`, kind: "ok" });
    } catch (e) {
      setToast({ text: errText(e), kind: "err" });
    }
  };

  /** 그림에서 옮겨 적은 글 → 조건. [불러오기] 와 같이 조건을 새로 만든다 */
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
  const tabs: [Tab, string][] = [["doc", "산출방법서"], ["latex", `LaTeX${latex.dirty ? " ●" : ""}`], ["markdown", `Markdown${md.dirty ? " ●" : ""}`], ["word", "Word"],
    ...(original ? [["original", `원문 · ${original.name}`] as [Tab, string]] : [])];
  const top = visible("cond") || visible("doc");
  const nTables = specT.rates.filter((r) => r.table).length;
  const noTable = ratesWithoutTable(specT);
  /** 계산 앱으로 넘기기 전에 값 표가 빠진 위험률을 알린다 — 그대로 넘기면 그쪽에서 0 으로 들어간다 */
  const exportJson = () => {
    exporters.json(specT);
    if (noTable.length) setToast({ text: `내보냈습니다. 값 표가 없는 위험률 ${noTable.map((r) => r.name).join(", ")} 은(는) 자유설계보험에서 0 으로 들어갑니다 — 아래 위험률 표에 값을 붙여넣으면 이어집니다`, kind: "warn" });
    else setToast({ text: "MethodSpec JSON 을 저장했습니다 — 자유설계보험의 [산출방법서 변환기] 에 이 파일을 올리고 [상품 만들기에 넣기] 하면 보험료가 계산됩니다", kind: "ok" });
  };

  return (
    <div className="flex h-screen flex-col">
      {/* ── 머리 ── */}
      <header className="no-print z-10 flex items-center gap-2 border-b border-border bg-white/95 px-4 py-2 shadow-[0_1px_0_#0000000a] backdrop-blur">
        <h1 className="mr-1 font-title text-lg font-bold tracking-tight text-foreground">Life_ins_Doc_Convert_<span className="text-primary">Studio</span></h1>
        <span className="mr-auto hidden text-xs text-muted-foreground lg:inline">산출방법서 ↔ 조건</span>
        <div className="seg" role="group" aria-label="보기">
          <span className="seg-label" title="이 묶음의 이름 — 아래 창(조건 · 산출방법서 · 위험률 표)을 켜고 끕니다">보기</span>
          {PANES.map((p) => (
            <button key={p} aria-pressed={visible(p)} className={visible(p) ? "seg-on" : ""} onClick={() => togglePane(p)} title={`${PANE_NAME[p]} ${visible(p) ? "숨기기" : "보이기"}`}>{PANE_NAME[p]}</button>
          ))}
        </div>
        <button className="btn-primary" onClick={() => setCalcOpen(true)} title="산출방법서의 식으로 이 앱이 보험료를 계산합니다 — 한 해 한 줄의 표로 과정을 봅니다">＝ 보험료 계산</button>
        <button className="btn-primary" onClick={() => fileInput.current?.click()} title="산출방법서(Word·PDF·한글·Markdown·LaTeX) · 조건 YAML · MethodSpec JSON · 위험률 표를 불러옵니다">불러오기</button>
        <input ref={fileInput} aria-label="열 파일" type="file" accept={`${ACCEPT},.csv,.tsv,.xlsx`} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void open(f); e.target.value = ""; }} />
        <details className="menu">
          <summary className="btn">패키지 ▾</summary>
          <div className="menu-list right-0" onClick={closeMenu}>
            <p className="menu-head">조건 · 산출방법서 · 위험률 표를 한 파일로 ({PACKAGE_EXT})</p>
            <button onClick={savePackage}>패키지로 저장<small>{packageName()} — 조건 YAML · 산출방법서 Word/Markdown · MethodSpec JSON{sheet?.map.some((m) => m.to === "rate") ? " · 위험률 표 CSV" : " (위험률 표 없음)"}</small></button>
            <button onClick={() => packageInput.current?.click()}>패키지 열기…<small>{PACKAGE_EXT} — 든 것을 그대로 되살립니다 ([불러오기]나 끌어다 놓기도 됩니다)</small></button>
            <p className="menu-head">최근 작업 {recent.length ? `(${recent.length})` : "— 아직 없음"}</p>
            {recent.map((r) => <button key={r.id} onClick={() => openRecent(r)}>{r.name}<small>{r.product || "(이름 없음)"} · {when(r.at)}{r.sheet ? ` · 위험률 표 ${r.sheet.sheet.head.length - 1}열` : ""}</small></button>)}
            {recent.length > 0 && <button onClick={() => { setRecent([]); writeJson(`${KEY}:recent`, null); }}><small>최근 작업 목록 지우기</small></button>}
          </div>
        </details>
        <input ref={packageInput} aria-label="열 패키지" type="file" accept={PACKAGE_EXT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void openPackage(f); e.target.value = ""; }} />
        <details className="menu">
          <summary className="btn">샘플 ▾</summary>
          <div className="menu-list right-0" onClick={closeMenu}>
            <p className="menu-head">샘플 세트 — 조건 · 산출방법서 · 위험률 표(기본 위험률)</p>
            {(allSamples ? SAMPLES : SHARED_SAMPLES).map((x) => <button key={x.id} onClick={() => loadSample(x.yaml)}>{x.label}<small>{x.hint}</small></button>)}
            <p className="menu-head">산출방법서 샘플</p>
            <button onClick={() => loadSample(START_SAMPLE.yaml, "latex")}>LaTeX 산출방법서 고쳐 보기<small>암보험 — 이율·배수를 고친 뒤 [조건에 반영]</small></button>
            <button onClick={() => loadSample((SHARED_SAMPLES[1] ?? START_SAMPLE).yaml, "markdown")}>Markdown 산출방법서 고쳐 보기<small>암보험 — 면책 기간·보장금액을 바꿔 보기</small></button>
          </div>
        </details>
        <input ref={mergeInput} aria-label="고쳐 반영할 파일" type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void applyFile(f); e.target.value = ""; }} />
        <details className="menu">
          <summary className="btn">내보내기 ▾</summary>
          <div className="menu-list right-0" onClick={closeMenu}>
            <p className="menu-head">산출방법서</p>
            <button onClick={() => exporters.docx(specT)}>Word .docx<small>표준 산출방법서 — 한글에서도 열림 · 작성 안내 포함</small></button>
            <button onClick={() => exporters.docx(specT, false)}>Word .docx (작성 안내 없이)<small>출력·제출용</small></button>
            <p className="menu-head">조건</p>
            <button onClick={() => exporters.yaml(yaml, s)}>조건 파일 .yaml</button>
            {/* 추가기능(개발중) — 사용자에게 아직 공개하지 않는다. 공유 화면에서는 누를 수 없고, 개발자 주소(?all)에서만 켜진다 */}
            <p className="menu-head">추가기능 (개발중){allSamples ? " — 개발자 화면에서만 켜짐" : ""}</p>
            <fieldset disabled={!allSamples} className="menu-dev" title={allSamples ? undefined : "개발 중인 기능입니다 — 아직 쓸 수 없습니다"}>
              <button onClick={exportJson}>자유설계보험으로 보내기 — MethodSpec .json<small>저장한 파일을 자유설계보험 [산출방법서 변환기] 화면에 올리고 [상품 만들기에 넣기] 하면 그쪽에서 보험료를 계산합니다 · 위험률 표 {nTables}개 포함{noTable.length ? ` · 표 없는 위험률 ${noTable.length}개` : ""}</small></button>
              <button onClick={() => mergeInput.current?.click()}>고친 Word 올려 조건에 반영<small>바뀐 값·식·주석만 들어갑니다 — 상품별 견본은 [Word] 탭</small></button>
              <button onClick={() => exporters.tex(sections, title, s)}>LaTeX .tex<small>xelatex 로 조판 (kotex)</small></button>
              <button onClick={() => exporters.md(sections, title, s)}>Markdown .md</button>
              <button onClick={() => exporters.html(sections, title, s)}>HTML .html<small>수식 포함 단독 파일</small></button>
              <button onClick={print}>인쇄 · PDF 저장</button>
            </fieldset>
          </div>
        </details>
        <button className="btn" onClick={() => setGuide((v) => !v)} aria-pressed={guide} title="공유 테스트 안내 — 무엇을 해 보면 되는지 · 저장 · 의견 보내기">테스트 안내</button>
        <button className="btn" onClick={() => setHelp(true)}>도움말</button>
      </header>
      {/* 좁은 화면 — 넓은 PC 화면 기준으로 만든 앱이라 알린다(CSS 가 1100px 아래에서만 보인다) */}
      <p className="narrow-warn no-print">이 앱은 <b>PC 화면(가로 1280px 이상, 크롬·엣지)</b> 기준입니다. 휴대폰·좁은 창에서는 칸이 겹치거나 잘릴 수 있습니다.</p>
      {guide && (
        <section className="guide-bar no-print" aria-label="테스트 안내">
          <div className="guide-cols">
            <div>
              <h2>무엇을 해 보면 되나요</h2>
              <ol>
                <li>[샘플 ▾]에서 <b>종신보험</b> 또는 <b>암보험</b>을 엽니다(암보험은 주계약·암입원특약·암수술특약 탭).</li>
                <li>맨 위 <b>[산출 조건]</b>에서 성별·나이·납입기간·가입금액을 바꾸면 보험료가 바로 바뀝니다(담보 보험료는 10원 미만 버림).</li>
                <li>왼쪽 카드(M01~M09)를 열거나 칸을 고르면 오른쪽 산출방법서의 그 자리가 노랗게 표시됩니다.</li>
                <li><b>[＝ 보험료 계산]</b>으로 한 해 한 줄의 계산 표를, [Word] 탭에서 산출방법서 Word 를 받아 볼 수 있습니다.</li>
              </ol>
            </div>
            <div>
              <h2>저장과 공유</h2>
              <p>작업은 <b>이 브라우저에만</b> 자동 저장됩니다. 다른 사람에게 보여 주려면 <b>[패키지 ▾ → 패키지로 저장]</b>한 <code>.lifepkg</code> 파일을 보내고, 받은 사람은 [불러오기]로 엽니다.</p>
              <p>위험률은 모두 가상의 값(경험생명표(가상))입니다. PC 화면(가로 1280px 이상)에서 써 주세요.</p>
            </div>
            <div>
              <h2>의견 보내기</h2>
              <p>이상한 값·불편한 점은 화면 캡처와 함께 <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">GitHub 이슈</a>로 남기거나, 이 앱을 공유해 준 담당자에게 알려 주세요.</p>
              <button className="btn-primary" onClick={() => { setGuide(false); writeJson(`${KEY}:guide-v1`, 1); }}>안내 닫기</button>
            </div>
          </div>
        </section>
      )}

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
                      <button key={t} role="tab" aria-selected={layout.left === t} className={layout.left === t ? "seg-on" : ""} onClick={() => setLayout((l) => ({ ...l, left: t }))}
                        title={t === "form" ? "카드의 칸을 채우면 조건 파일(YAML)에 들어갑니다" : "같은 조건을 MethodSpec 조건 파일로 봅니다"}>{t === "form" ? "입력" : "YAML"}</button>
                    ))}
                  </div>
                  <span className="pane-tools">
                    <button className="pane-tool" disabled={!histN.past} onClick={() => restore(-1)} title="마지막 입력·변경을 되돌립니다 (Ctrl+Z — 칸 밖에서)">↶ 되돌리기{histN.past ? ` ${histN.past}` : ""}</button>
                    <button className="pane-tool" disabled={!histN.future} onClick={() => restore(1)} title="되돌린 것을 다시 합니다 (Ctrl+Shift+Z)">↷ 다시</button>
                  </span>
                  <button className={`btn ${palLeft ? "btn-on" : ""}`} onClick={() => setPalLeft((v) => !v)} title="견본 식을 조건 M09(따로 적는 식) 에 더합니다">＋ 수식 더하기</button>
                  <span className="flex-1" />
                  {syntaxErrors.length > 0 && <span className="truncate rounded bg-rose-100 px-1.5 text-rose-700">{syntaxErrors[0].line}줄: {syntaxErrors[0].message}</span>}
                  {tools("cond")}
                </div>
                {palLeft && <FormulaPalette onFormula={addFormula}
                  hint="누르면 그 식을 조건(M09 따로 적는 식)에 넣습니다 — 산출방법서의 알맞은 절에 붙고, 그 카드에서 고칩니다." />}
                <div className="min-h-0 flex-1">
                  {layout.left === "form"
                    ? <ConditionForm yaml={yaml} spec={specT} errors={parsed.errors} onEdit={onEdit} highlight={rightSel} changed={changed} onSelect={onFormSelect}
                        open={layout.open} setOpen={setOpen} tableNote={tableNote} noTableIds={noTable.map((r) => r.id)} onLibrary={() => setLibOpen(true)} onShowYaml={() => setLayout((l) => ({ ...l, left: "yaml" }))}
                        calc={calcOn} setCalc={setCalcOn} formulasOn={layout.formulas} toggleFormulas={(id) => setLayout((l) => ({ ...l, formulas: l.formulas.includes(id) ? l.formulas.filter((x) => x !== id) : [...l.formulas, id] }))} onPremiumSheet={() => setCalcOpen(true)} onShowDoc={(paths) => { setTab("doc"); showPane("doc"); onFormSelect([...paths]); }}
                        rateSources={rateSources} rateSourceOf={rateSourceOf} onRateSource={onRateSource} onRenameRate={onRenameRate} onRateImport={() => setImportOpen(true)} onRateProcess={() => setProcessOpen(true)} />
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
                      <span className="truncate text-muted-foreground">블록을 누르면 왼쪽에서 그 조건이 표시됩니다 — 식을 더하려면 왼쪽 [＋ 수식 더하기]</span>
                    </div>
                    <div className="thin-scroll min-h-0 flex-1 overflow-auto bg-white">
                      <DocPreview sections={sections} title={title} highlight={leftSel} changed={changed} follow={follow} onPick={pickPaths} />
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
                    <h3 className="mb-1 text-base font-bold">Word로 고치기 — 표준 산출방법서</h3>
                    <div className="my-3 flex flex-wrap gap-2">
                      <button className="btn-primary" onClick={() => exporters.docx(specT)}>Word 내려받기</button>
                      <button className="btn-primary" onClick={() => mergeInput.current?.click()}>고친 Word 올리기 → 조건에 반영</button>
                      <button className="btn" onClick={() => exporters.docx(specT, false)}>Word (작성 안내 없이)</button>
                      <button className="btn" onClick={print}>PDF 저장</button>
                    </div>
                    <ol className="word-steps">
                      <li><b>내려받기</b> — 지금 조건을 표준 산출방법서(.docx)로 받습니다.</li>
                      <li><b>고치기</b> — 표의 값·행, <code>[식]</code> 아래 식 줄, <code>※</code> 설명을 고칩니다. 절 제목과 표 머리글은 그대로 둡니다. 식은 <code>l_{"{x+t}"}</code> 처럼 적거나 Word 수식 편집기로 넣습니다.</li>
                      <li><b>올리기</b> — 바뀐 것만 조건에 들어갑니다(조건 파일의 주석·순서는 지킵니다). 개요 표에 <code>양식 | 표준 산출방법서 v6</code> 행이 있으면 식·주석·절까지(위험률·담보 행을 지운 것도), 없으면 값만 읽습니다. 별첨 위험률 값 표를 고치면 아래 위험률 표 창에 들어갑니다.</li>
                      <li><b>출력</b> — Word(작성 안내 없이) 또는 PDF(인쇄 → PDF 저장, 수식이 조판되어 나옵니다).</li>
                    </ol>
                    {wordLog && (
                      <div className={`word-log ${wordLog.changes.length ? "" : "word-log-none"}`}>
                        <b>{wordLog.name}</b> — {wordLog.format ? `${wordLog.format} 로 읽음 (식·주석·절 포함)` : "표준 양식이 아님 — 표·본문 규칙으로 읽은 값만"}
                        {wordLog.changes.length
                          ? <ul>{wordLog.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
                          : <p>조건과 다른 값이 없습니다.</p>}
                        <p className="text-xs text-muted-foreground">어디서 읽었는지는 [원문] 탭에서 봅니다.</p>
                      </div>
                    )}
                    <h4 className="mt-4 font-bold">상품별 표준 산출방법서 견본 (Word)</h4>
                    <table className="word-std">
                      <tbody>
                        {STANDARDS.map((x) => (
                          <tr key={x.id}>
                            <td><b>{standardFile(x)}</b><br /><small className="text-muted-foreground">{x.hint}</small></td>
                            <td className="whitespace-nowrap">
                              <button className="btn" onClick={() => download(`${standardFile(x)}.docx`, toStandardDocx(standardSpec(x)), DOCX_MIME)}>Word</button>{" "}
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
              onClear={() => setSheet(null)} rates={s.rates} noTable={noTable} onNewRates={addRates} onLibrary={() => setLibOpen(true)} libraryCount={library?.rates.length ?? 0}
              onCell={(r, c, v) => setSheet((st) => (st ? setCell(st, r, c, v) : st))} onHead={(c, v) => setSheet((st) => (st ? setHead(st, c, v) : st))}
              onRole={(id, role) => { const i = s.rates.findIndex((r) => r.id === id); if (i >= 0) onEdit([{ path: ["rates", i, "role"], value: role }]); }}
              onEmptyColumns={(ids) => { setSheet((st) => ids.reduce((acc, id) => addEmptyColumn(acc, s.rates.find((r) => r.id === id)!), st)); setToast({ text: `빈 열 ${ids.length}개를 만들었습니다 — 값을 붙여넣거나 Excel 에서 채워 다시 올리세요`, kind: "ok" }); }}
              highlight={leftSel} onPick={(p) => pickPaths(p, true)} tools={tools("sheet")} />
          </section>
        )}
      </main>

      {/* ── 상태 ── */}
      <footer className="no-print flex flex-wrap items-center gap-3 border-t border-border bg-white px-4 py-1 text-xs text-muted-foreground">
        <span>담보 {s.benefits.length} · 위험률 {s.rates.length}{nTables ? ` (표 ${nTables})` : ""}{noTable.length && s.rates.length ? <span className="text-amber-700" title={noTable.map((r) => r.name).join(", ")}> · 표 없음 {noTable.length}</span> : null} · 사업비 {s.expenses.length}</span>
        {parsed.errors.filter((e) => !e.line).slice(0, 1).map((e, i) => <span key={i} className="text-amber-700">⚠ {e.message}</span>)}
        {changed.length > 0 && (
          <span className="changed-note" title={changed.slice(0, 12).join(", ") + (changed.length > 12 ? " …" : "")}>
            ● 바뀐 곳 {changed.length}
            <button className="pane-tool" onClick={() => setSaved(yaml)} title="지금 상태를 기준으로 삼아 바뀜 표시를 지웁니다">표시 지우기</button>
          </span>
        )}
        <span className="flex-1" />
        {leftSel.length > 0 && <span className="font-mono text-amber-700">{leftSel.slice(0, 3).join(", ")}{leftSel.length > 3 ? " …" : ""}</span>}
        <span>자동 저장됨</span>
      </footer>

      {drag && <div className="drop-overlay">여기에 놓으면 엽니다<small>패키지(.lifepkg) · PDF · DOCX · HWP · HWPX · TEX · MD · YAML · JSON · PNG · JPG — CSV · XLSX 는 위험률 표로</small></div>}
      {toast && <div className={`toast toast-${toast.kind}`} onClick={() => setToast(null)}>{toast.text}</div>}
      {help && <Help onClose={() => setHelp(false)} />}
      {calcOpen && <PremiumSheet spec={specT} contract={calcOn} setContract={setCalcOn} onClose={() => setCalcOpen(false)} />}
      {libOpen && <RateLibraryDialog library={library} rates={s.rates} onAdd={addFromLibrary} onClose={() => setLibOpen(false)} />}
      {importOpen && <RateImportDialog rates={s.rates} onAdd={addFromImport} onClose={() => setImportOpen(false)} />}
      {processOpen && <RateProcessDialog rates={specT.rates} onAdd={addFromProcess} onClose={() => setProcessOpen(false)} />}
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
          <li><b>조건 입력</b> 왼쪽 [입력] 탭의 카드(M00 문서 정보 · M01 상품 기본정보 · M03 예정이율·적용해지율 · M04 위험률 · M06 예정사업비율 · M05 납입(납입자수) · B01 보장(담보마다 유지자수·보험금 현가) · M07 보험료의 계산 · M08 준비금·환급금)에 칸을 채우면 오른쪽 산출방법서가 바로 바뀝니다. 카드를 열면 그 카드가 창 가운데로 오고, 식이 있는 카드는 머리의 [수식 보이기]로 식을 켭니다(기본 숨김). 담보의 보장금액은 <b>가입금액 × 배수</b>(1배·0.5배 …), 면책·삭감은 기간(30일~2년)과 그 기간의 지급 비율(면책 0% · 50% 삭감)로 적습니다. 급부 위험률은 따로 고르지 않고 탈퇴 사유에서 정해집니다. [YAML] 탭에서 같은 조건을 파일로 봅니다 — 둘은 늘 같습니다.</li>
          <li><b>산출 조건 · 계약 단위</b> 맨 위 줄의 계약 한 점(성별·가입나이·납입기간·납입방법·가입금액)으로 산출합니다 — 납입방법(월납·3개월·6개월·연납)마다 보험료가 함께 보이고, 조건에는 저장하지 않습니다. 그 아래 탭이 계약 단위(주계약·특약)입니다 — [＋ 특약]으로 특약을 더하면 그 이름의 담보가 생기고, 보장·납입 카드가 그 단위의 담보만 보이며, 엑셀도 단위마다 한 장이 됩니다.</li>
          <li><b>산출방법서 → 조건</b> PDF·DOCX·HWP·HWPX·TEX·MD 를 [불러오기] 하거나 창에 끌어다 놓으면 조건으로 옮깁니다. 표준 산출방법서는 식·주석까지, 다른 양식은 표·본문 규칙으로 읽을 수 있는 값을 읽습니다. [원문] 탭에서 근거 줄을 확인할 수 있습니다.</li>
          <li><b>위험률 표 ↔ 조건 ↔ 계산</b> 첫 화면부터 조건과 이어진 견본 표(가상의 값)가 들어 있습니다 — 칸을 누르면 값을, 머리를 두 번 누르면 열 이름을 고치고, 열마다 [잇기]에서 조건의 위험률·성별·유형을 고릅니다(유형은 M04 에 바로 반영). 아래 창에 Excel 표를 붙여넣거나 CSV·XLSX 를 올리면 첫 행을 열 이름으로 읽어 같은 이름의 위험률(M04)에 잇고, 조건에 없는 이름의 열은 새 위험률로 M04 에 더합니다(유형 확인). 거꾸로 M04 에서 위험률을 더하면 표에 그 이름의 빈 열이 생기고, 산출방법서에서 위험률을 더해 올려도 같습니다. 이은 값 표는 산출방법서 별첨과 MethodSpec JSON 에 실려 자유설계보험이 계약 성별의 표로 계산합니다 — 값 표가 없는 위험률은 상태줄에 &quot;표 없음&quot;으로 알리고 그쪽에서 0 이 됩니다. 순서: ① 샘플·산출방법서 열기 → ② 위험률 표 올리기 → ③ [내보내기 → MethodSpec .json] → 자유설계보험 /method 에서 열기.</li>
          <li><b>수식·기호 견본</b> 조건 창의 [＋ 수식 더하기]는 견본 식을 조건(M09)에 더하고, LaTeX·Markdown 탭의 [수식·기호 견본]은 커서 자리에 식·기호·표·절 제목을 넣습니다.</li>
          <li><b>＝ 보험료 계산</b> 머리의 단추를 누르면 담보마다 한 해 한 줄의 표가 열립니다 — 왼쪽에 계약·기초율(가입나이·가입금액·보장기간·납입기간·이율·배수·사업비), 표에 위험률 → 현가율 → 유지자수·납입자수·지급자수 → 현가·누계 → 보험금 → <b>책임준비금 V · 해약공제 · 해지환급금 W · 환급률</b>. 이 앱이 산출방법서의 식을 그대로 읽어 계산한 값이고, <b>열 제목이나 값을 누르면 그 값을 만든 식과 그 해에 쓰인 값</b>이 옆에 나옵니다. 1원당 영업보험료는 소수 여섯째 자리까지 만든 뒤 10만원당(원 단위 반올림) → 담보 보험료(× 가입금액 × 배수 ÷ 10만) 순서입니다.</li>
          <li><b>엑셀로 내려받기 (수식 포함)</b> 계약 단위(주계약·특약)마다 한 장 — 그 단위의 담보가 모두 한 장에 나란히 들어가고 맨 오른쪽에 담보별 보험료·준비금 결과와 합계가 있습니다. 계약·기초율과 위험률만 값이고 <b>현가율부터는 모두 엑셀 수식</b>이라 값을 바꿔 다시 계산해 볼 수 있습니다.</li>
          <li><b>Python 일괄 산출</b> [보험료 계산] 창의 [Python 일괄 산출]은 같은 계산을 단계마다 주석을 단 파이썬 셀로 만듭니다 — 셀을 하나씩(또는 전부) 브라우저 안에서 실제로 실행하고(Pyodide, 처음 한 번 내려받음), 코드를 .py 로 내려받아 밖에서 돌려도 같은 값이 나옵니다.</li>
          <li><b>식 고치기</b> 조건 카드(M05 납입 · B01 보장 · M07 보험료의 계산 · M08 준비금·환급금)의 [수식 보이기] → [식 고치기]로 산출방법서의 식을 바꾸면 문서와 계산이 함께 바뀝니다([되돌리기]로 자동 식).</li>
          <li><b>자유설계보험으로</b> [내보내기 → 자유설계보험으로 보내기]로 MethodSpec JSON 을 저장하고, 자유설계보험의 [산출방법서 변환기] 화면에 그 파일을 올리면 보험료가 바로 나오고 [상품 만들기에 넣기]로 설계 전체가 됩니다.</li>
          <li><b>바뀐 곳 표시</b> 파일을 연 뒤(또는 [표시 지우기] 뒤) 입력·수정·추가한 칸과 카드, 그것이 만든 산출방법서 블록에 초록 표시가 붙고, 아래 상태줄에 개수가 보입니다.</li>
          <li><b>되돌리기</b> 조건 창의 [↶ 되돌리기]·[↷ 다시]는 입력·수식·파일 열기·반영 등 조건과 위험률 표의 모든 변경을 한 걸음씩 되돌립니다(칸 밖에서 Ctrl+Z · Ctrl+Shift+Z). 이어서 타자한 글자는 한 걸음으로 묶입니다.</li>
          <li><b>그림으로 읽기</b> 스캔 PDF·PNG·JPG 를 열면 쪽을 골라 본인의 Anthropic API 키로 보냅니다. AI 는 쪽을 글로 옮겨 적기만 하고 값은 앱의 규칙이 읽습니다. 글자 있는 PDF 도 [원문] 탭에서 [그림으로 다시 읽기] 할 수 있습니다.</li>
          <li><b>Word로 고치기</b> [Word] 탭에서 표준 산출방법서(.docx — 상품별 견본 포함)를 받아 고친 뒤 올리면 바뀐 값·식·주석만 조건에 들어갑니다(지운 행·칸도 빠집니다). [불러오기]로 올리면 조건 전체를 새로 만듭니다.</li>
          <li><b>LaTeX·Markdown 으로 고치기</b> 원문을 고친 뒤 [조건에 반영] 하면 바뀐 값만 조건에 들어갑니다. 조건 파일의 주석과 순서는 그대로 둡니다.</li>
          <li><b>대응 위치</b> 왼쪽 칸·줄을 고르면 오른쪽에서 그 조건이 만든 곳(표의 행·수식·원문 근거·위험률 표의 열)이 노랗게, 오른쪽을 누르면 왼쪽 칸이 표시됩니다.</li>
          <li><b>화면 조절</b> 창 사이 막대를 끌어 크기를 바꾸고(두 번 누르면 처음 비율), 창마다 [⤢ 전체]·[– 숨기기], 위 [보기]에서 다시 켭니다.</li>
          <li><b>패키지 · 최근 작업</b> [패키지 → 패키지로 저장]은 조건(YAML)·산출방법서(Word·Markdown)·MethodSpec JSON·위험률 표(CSV)를 한 파일(<code>.lifepkg</code>)로 저장합니다(위험률 표가 없어도 됩니다). [패키지 열기]·[불러오기]·끌어다 놓기로 되살리고, 저장·연 것은 [최근 작업]에 남아 한 번에 불러옵니다. 첫 화면과 [샘플]도 조건·산출방법서·위험률 표가 한 세트입니다. 이름을 .zip 으로 바꾸면 안의 파일을 꺼낼 수 있습니다.</li>
          <li><b>다른 앱과 연동</b> [내보내기 → MethodSpec .json] 은 자유설계보험(flexible_insurance) 등이 읽는 중립 형식입니다(위험률 표 포함). 그 JSON 을 여기서 [불러오기] 해도 됩니다.</li>
        </ol>
        <p className="text-xs text-muted-foreground">조건 표기: 이율 <code>2.5%</code> · 사업비 <code>1.5/1000</code> · 배수 <code>1배</code> · 위험률 유형 death / incidence / recurring / waiver / lapse / other.</p>
        <button className="btn-primary mt-3" onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}
