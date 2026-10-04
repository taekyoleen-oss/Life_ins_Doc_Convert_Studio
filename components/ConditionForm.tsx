"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isMap, isScalar, parseDocument } from "yaml";
import { pathKey, pct, type YamlEdit, type YamlPath } from "@/lib/conditions/yaml";
import { matchBlocks, splitPaths, under } from "@/lib/conditions/link";
import { parseRate, parseTimes } from "@/lib/methoddoc/parse";
import { benefitModels, eventCauses, eventRate, groupModels, payerModels, waitLabel, withFormulas, type BenefitModel, type GroupModel, type PayerModel } from "@/lib/methoddoc/formulas";
import { calcSheets, checkFormula, computeByPayMethod, computeSpec, PAY_METHODS, SUM_ASSURED_DEFAULT, type CalcContract, type CalcResult, type CalcSheets } from "@/lib/methoddoc/calc";
import { subSup } from "@/lib/methoddoc/render";
import { endAgeLabel, MAIN_UNIT, RATE_ROLE_LABEL, unitNames, WHOLE_LIFE_AGE, type FormulaSpec, type MethodSpec, type RateRole, type Sex } from "@/lib/methoddoc/spec";
import { guessRole } from "@/lib/sheet";
import { EXPENSE_PRESET } from "@/lib/samples";
import { SECTION_OF } from "@/lib/snippets";
import { formulaHtml } from "./DocPreview";
import FormulaPalette from "./FormulaPalette";

/**
 * 조건 입력 화면 — YAML 을 몰라도 칸을 채워 조건을 만든다.
 * 자유설계보험(flexible_insurance) 빌더의 단계 카드와 같은 모양·코드(M01 상품 기본정보 … M06 사업비)다.
 *
 * 따로 상태를 두지 않는다: 칸은 조건 파일(YAML)에서 읽고, 고치면 editYaml 로 그 칸만 파일에 쓴다.
 * 그래서 YAML 탭과 늘 같고, 사용자가 적은 주석·순서가 남는다. 칸의 경로(pathKey)는 산출방법서 블록 경로와 같아
 * 칸을 고르면 오른쪽에서 그 조건이 만든 곳이, 오른쪽을 고르면 여기서 그 칸이 표시된다.
 *
 * 카드 순서는 산출 순서다 — 기초율(M01·M03·M04) → 집단 l·l′(M05) → 보장(B01) → 보험료 현가(K01) →
 * 보험금 현가(K02) → 사업비(M06) → 보험료(K03) → 준비금·환급금(M07) → 따로 적는 식(M08).
 * K01·K02·K03·M05 카드는 **그 단계의 식을 그대로 보여 주고 고칠 수 있다** — 고친 식은 산출방법서에 실리고
 * 계산(calc.ts)에도 그대로 쓰인다. 한 번에 한 카드만 펼쳐 지금 보는 단계에 집중한다.
 */

type Obj = Record<string, unknown>;
type Status = "done" | "editing" | "error" | "optional";
interface CardDef {
  id: string; code: string; title: string; paths: string[]; status: Status; summary: string[]; help: string; message?: string; body: ReactNode; dirty?: boolean;
  /** 이 카드가 고치는 조건(바뀜 표시·오른쪽에서 고른 칸의 카드 펼치기). 없으면 paths. paths 는 열 때 산출방법서에서 비출 자리다 */
  owns?: string[];
  /** 카드를 열 때 산출방법서에서 비출 중심 자리 — 없으면 paths. 나머지(paths)는 카드 안의 그 칸·식을 고를 때 비친다 */
  focus?: string[];
  /** 이 카드에 식이 있다 — 머리에 [수식 보이기/숨기기] 단추가 붙는다(기본 숨김) */
  formulas?: boolean;
}

interface Ctx {
  get(p: YamlPath): unknown;
  set(p: YamlPath, v: unknown): void;
  edit(e: YamlEdit[]): void;
  /** 그 칸에 사용자가 단 YAML 주석(불러온 문서면 원문 위치·확신도) */
  note(p: YamlPath): string | undefined;
  err(key: string): string | undefined;
  select(key: string | string[]): void;
  /** 산출방법서의 식 한 덩이를 고친다(조건의 formulas 로) · 되돌린다 */
  setFormula(f: FormulaSpec, text: string): void;
  resetFormula(f: FormulaSpec): void;
  /** 기본 위험률 모음 창 — 위험률 더하기의 기본 */
  library?: () => void;
  /** 담보의 결합 위험률(가공)을 위험률 표·조건에 넣고 그 담보에 잇는다 */
  combine?: (benefitIdx: number) => void;
}
const FormCtx = createContext<Ctx | null>(null);
const useForm = () => useContext(FormCtx)!;

// ── 표기 ────────────────────────────────────────────────────────────────────
const getIn = (o: unknown, p: YamlPath): unknown => p.reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string | number, unknown>)[k] : undefined), o);
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map((x) => (x && typeof x === "object" ? (x as Obj) : {})) : []);
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const num = (v: unknown) => { const x = typeof v === "number" ? v : Number(str(v).replace(/[,\s원세년일]/g, "")); return str(v) !== "" && Number.isFinite(x) ? x : undefined; };
/** 숫자 칸: 깔끔한 수는 수로, 아니면 적은 글자 그대로("1,000" 도 조건 파일이 읽는다) — 입력 중 "0." 이 사라지지 않게 */
const toNum = (t: string) => { const x = Number(t.trim()); return t.trim() !== "" && Number.isFinite(x) && String(x) === t.trim() ? x : t; };
export const krw = (won?: number) => {
  if (won === undefined) return "";
  if (won < 1e4) return `${won.toLocaleString("ko-KR")} 원`;
  const eok = Math.floor(won / 1e8), man = Math.round((won % 1e8) / 1e4);
  return `${eok ? `${eok}억` : ""}${man ? `${eok ? " " : ""}${man.toLocaleString("ko-KR")}만` : ""} 원`;
};
const BEN_ROLES: [string, string, string][] = [
  ["incidence", "진단형 (최초발생)", "발생 시 정액 지급 후 그 담보 소멸 — 2대질병·3대질병·암 등. 급부 위험률 = 탈퇴 사유 가운데 사망이 아닌 것"],
  ["death", "사망형", "사망 시 지급(종신·정기). 탈퇴 사유 전부에 같은 보험금"],
  ["recurring", "일당형 (반복지급)", "입원 1일당 지급. 급부 위험률 자리에 연간 기대 입원일수"],
  ["other", "기타·생존형", "생존 시 지급(축하금·만기환급금) 등 — 지급 시점을 적는다"],
];
/** 보장금액 배수(가입금액 대비) · 면책·삭감 기간(일) · 면책·삭감 기간 중 지급 비율 — 실무 산출방법서의 흔한 값 */
const MULTIPLES: [number, string][] = [[0.1, "0.1배"], [0.2, "0.2배"], [0.3, "0.3배"], [0.5, "0.5배 (50%)"], [1, "1배 (가입금액)"], [1.5, "1.5배"], [2, "2배"], [3, "3배"]];
const WAIT_DAYS: [number, string][] = [[0, "없음"], [30, "30일"], [90, "90일"], [180, "180일"], [365, "1년"], [730, "2년"]];
const WAIT_PAY: [string, string][] = [["0%", "0% — 면책 (지급 없음)"], ["30%", "30% 지급"], ["50%", "50% (50% 삭감)"], ["70%", "70% 지급"]];
/** 시산의 보험가입금액 후보 */
const SUM_ASSURED: [number, string][] = [[1e7, "1천만원"], [3e7, "3천만원"], [5e7, "5천만원"], [1e8, "1억원"], [2e8, "2억원"], [3e8, "3억원"], [5e8, "5억원"]];
interface RateItem { id: string; name: string; role: RateRole }
/** 자유설계보험 autoExitCols 와 같은 규칙: 사망 위험률 전부 + (진단형이면 그 급부 위험률) */
const autoExit = (rates: RateItem[], role: string, rateId?: string) => {
  const d = rates.filter((r) => r.role === "death").map((r) => r.id);
  const ev = rates.find((r) => r.id === rateId);
  return role === "incidence" && ev?.role === "incidence" && !d.includes(ev.id) ? [...d, ev.id] : d;
};
const suggestRate = (rates: RateItem[], role: string) =>
  role === "death" || role === "other" ? undefined : rates.find((r) => r.role === (role === "recurring" ? "recurring" : "incidence"))?.id;
const uniqueId = (base: string, taken: string[]) => { let k = 1, id = base; while (taken.includes(id)) id = `${base}${++k}`; return id; };
const won0 = (x: number) => Math.round(x).toLocaleString("ko-KR");

// ── 칸 ──────────────────────────────────────────────────────────────────────
type Kind = "text" | "num" | "pct" | "area" | "formula";
function F({ p, label, kind = "text", unit, hint, wide, dl, placeholder, bare, keepEmpty }: {
  p: YamlPath; label?: string; kind?: Kind; unit?: string; hint?: ReactNode; wide?: boolean; dl?: string; placeholder?: string;
  /** 표 안의 작은 칸 — 이름·설명 없이 */ bare?: boolean;
  /** 목록 칸은 비워도 지우지 않는다 */ keepEmpty?: boolean;
}) {
  const f = useForm();
  const key = pathKey(p), v = f.get(p), s = str(v);
  const bad = f.err(key) ?? (kind === "pct" && s && typeof v !== "number" && parseRate(s) === null ? "비율로 읽을 수 없습니다 — 예: 2.5%" : undefined);
  const put = (t: string) => f.set(p, t === "" && !keepEmpty ? undefined : kind === "num" ? toNum(t) : t);
  const props = {
    value: s, placeholder, title: bare ? label : undefined,
    onFocus: () => f.select(key),
    className: `inp ${bad ? "inp-bad" : ""} ${kind === "formula" ? "font-mono text-[12.5px]" : ""}`,
  };
  const input = kind === "area" || kind === "formula"
    ? <textarea rows={kind === "formula" ? 3 : 2} {...props} onChange={(e) => put(e.target.value)} />
    : <input type="text" inputMode={kind === "num" ? "decimal" : undefined} list={dl} {...props} onChange={(e) => put(e.target.value)}
        onBlur={kind === "pct" ? () => { if (/^\d+(\.\d+)?$/.test(s) && Number(s) >= 1) f.set(p, `${s}%`); } : undefined} />;
  const tall = kind === "area" || kind === "formula";
  const box = <span className={`fld-box flex items-center gap-1 ${bare ? "min-w-0" : ""}`}>{input}{unit && <span className="fld-unit">{unit}</span>}</span>;
  if (bare) return <span data-path={key} className="min-w-0">{box}</span>;
  const note = f.note(p);
  return (
    <label data-path={key} className={`fld ${wide ? "col-span-2" : ""} ${tall ? "fld-tall" : ""}`}>
      <span className="fld-label">{label}</span>
      {box}
      {bad ? <span className="fld-err">{bad}</span> : hint ? <span className="fld-hint">{hint}</span> : null}
      {note && <span className="fld-note"># {note}</span>}
    </label>
  );
}

function Sel({ p, label, options, hint, wide, onPick, bare }: { p: YamlPath; label: string; options: [string | number, string][]; hint?: ReactNode; wide?: boolean; onPick?: (v: string | number) => YamlEdit[]; /** 표 안의 작은 칸 */ bare?: boolean }) {
  const f = useForm();
  const key = pathKey(p), cur = str(f.get(p));
  const opts: [string | number, string][] = cur === "" || options.some(([o]) => String(o) === cur) ? options : [...options, [cur, `${cur} (지금 값)`]];
  const select = (
    <select className="inp fld-box" value={cur} onFocus={() => f.select(key)} title={bare ? label : undefined} aria-label={bare ? label : undefined}
      onChange={(e) => { const v = opts.find(([o]) => String(o) === e.target.value)?.[0] ?? e.target.value; if (onPick) f.edit(onPick(v)); else f.set(p, v === "" ? undefined : v); }}>
      {!options.some(([o]) => o === "") && <option value="">—</option>}
      {opts.map(([o, l]) => <option key={String(o)} value={String(o)}>{l}</option>)}
    </select>
  );
  if (bare) return <span data-path={key} className="min-w-0">{select}</span>;
  return (
    <label data-path={key} className={`fld ${wide ? "col-span-2" : ""}`}>
      <span className="fld-label">{label}</span>
      {select}
      {hint && <span className="fld-hint">{hint}</span>}
    </label>
  );
}

function Check({ p, label, onToggle }: { p: YamlPath; label: ReactNode; onToggle?: (on: boolean) => YamlEdit[] }) {
  const f = useForm();
  const key = pathKey(p);
  return (
    <label data-path={key} className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" className="accent-[var(--primary)]" checked={f.get(p) === true} onFocus={() => f.select(key)}
        onChange={(e) => (onToggle ? f.edit(onToggle(e.target.checked)) : f.set(p, e.target.checked))} />
      {label}
    </label>
  );
}

const Grid = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">{children}</div>;
const Remove = ({ onClick, title = "지우기" }: { onClick: () => void; title?: string }) => (
  <button type="button" className="sub-x" title={title} onClick={onClick}>×</button>
);
const Add = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" className="btn mt-2" onClick={onClick}>{children}</button>
);

// ── 카드 ────────────────────────────────────────────────────────────────────
const BADGE: Record<Status, [string, string]> = {
  done: ["완료", "bg-accent text-primary"], editing: ["입력 중", "bg-amber-100 text-amber-800"],
  error: ["오류", "bg-rose-100 text-rose-700"], optional: ["선택", "bg-muted text-muted-foreground"],
};

function Card({ c, index, open, onToggle, showF, onToggleF }: { c: CardDef; index: number; open: boolean; onToggle: () => void; showF: boolean; onToggleF: () => void }) {
  const [help, setHelp] = useState(false);
  const [label, tone] = BADGE[c.status];
  return (
    <section data-path={c.paths.join("|")} data-card={c.id} className={`card ${open ? "card-open" : ""}`}>
      <header className="card-head" onClick={onToggle}>
        <span className={`card-no card-no-${c.status}`}>{index + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
            <h3 className="text-[14px] font-semibold">{c.title}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{label}</span>
            {c.dirty && <span className="chip-changed" title="연 뒤에 바뀐 칸이 있습니다">● 바뀜</span>}
          </div>
          {!open && c.summary.some(Boolean) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {c.summary.filter(Boolean).map((t, i) => <span key={i} className="chip">{t}</span>)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {/* 식이 있는 카드만 — 기본은 숨김(값부터 보고, 필요할 때 켠다) */}
          {c.formulas && <button type="button" className={`card-fx ${showF ? "on" : ""}`} onClick={onToggleF}
            title={showF ? "이 카드의 식을 감춥니다 — 값만 보고 싶을 때" : "이 카드의 식을 보입니다 — 고치기도 여기서"}>{showF ? "수식 숨기기" : "수식 보이기"}</button>}
          <button type="button" className={`card-icon ${help ? "text-primary" : ""}`} onClick={() => setHelp((v) => !v)} title="설명 보기">ⓘ</button>
        </div>
        <button type="button" className="card-toggle" aria-expanded={open} aria-label={open ? "접기" : "펼치기"} title={open ? "접기" : "펼치기"} onClick={(e) => { e.stopPropagation(); onToggle(); }}>{open ? "︿" : "﹀"}</button>
      </header>
      {help && <div className="card-help">{c.help}</div>}
      {open && (
        <div className="card-body">
          {c.message && <p className={`mb-2 rounded px-2 py-1.5 text-xs ${c.status === "error" ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-800"}`}>{c.message}</p>}
          {c.body}
        </div>
      )}
    </section>
  );
}

/** 접었다 펴는 작은 묶음 — 보장 카드 안의 담보 하나, 집단 하나 */
function Fold({ title, chips, open, onToggle, tools, children }: { title: ReactNode; chips?: (string | false | undefined)[]; open: boolean; onToggle: () => void; tools?: ReactNode; children: ReactNode }) {
  return (
    <div className={`sub ${open ? "sub-open" : ""}`}>
      <div className="flex items-center gap-2">
        <button type="button" className="fold-head" aria-expanded={open} onClick={onToggle}>
          <span className="fold-mark">{open ? "︿" : "﹀"}</span>
          <span className="truncate text-[13px] font-semibold">{title}</span>
          {!open && (chips ?? []).filter(Boolean).map((t, i) => <span key={i} className="chip">{t}</span>)}
        </button>
        {tools}
      </div>
      {open && <div className="mt-2 space-y-3">{children}</div>}
    </div>
  );
}

// ── 식 한 덩이 — 보여 주고, 고치고, 되돌린다 ─────────────────────────────────
/**
 * 산출방법서에 실리는 식을 그 단계의 카드에서 그대로 고친다.
 * 고친 글은 조건의 formulas 에 같은 절·제목으로 들어가 자동 식을 덮고(withFormulas), 산출방법서와 계산에 함께 쓰인다.
 * 산출방법서(Word·한글)에서 고쳐 [조건에 반영] 해도 같은 자리에 들어온다 — 두 쪽이 한 곳을 가리킨다.
 */
function FormulaBox({ f }: { f: FormulaSpec }) {
  const fm = useForm();
  const [edit, setEdit] = useState(false);
  const key = f.key ? `formula:${f.key.replace(/:/g, ".")}` : `formulas`;
  const chk = useMemo(() => checkFormula(f), [f]);
  const hard = chk.skipped.filter((s) => s.includes("="));
  return (
    // 식 상자를 누르면 그 식만 산출방법서에서 비춘다 — 카드를 열 때는 카드의 중심(focus)만 비추고, 세부 식은 이렇게 골라 본다
    <div data-path={key} className="formula-card" onClick={() => fm.select(key)}>
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-[12.5px] font-semibold text-[#334155]">{f.label}</span>
        {f.edited && <span className="chip-changed" title="자동 식을 사용자가 고쳤습니다">고친 식</span>}
        {hard.length > 0 && <span className="chip-warn" title={`계산에 쓸 수 없는 줄: ${hard.join(" / ")}`}>계산 제외</span>}
        <button type="button" className="pane-tool" onClick={() => { setEdit((v) => !v); fm.select(key); }}>{edit ? "닫기" : "식 고치기"}</button>
        {f.edited && <button type="button" className="pane-tool" onClick={() => { fm.resetFormula(f); setEdit(false); }} title="자동으로 만든 식으로 되돌립니다">되돌리기</button>}
      </div>
      {edit ? (
        <>
          <textarea className="inp mt-1.5 font-mono text-[12.5px]" rows={Math.min(14, f.text.split("\n").length + 2)} value={f.text}
            onFocus={() => fm.select(key)} onChange={(e) => fm.setFormula(f, e.target.value)} />
          <p className="fld-hint mt-1">
            한 줄에 식 하나. 설명 줄은 그 위에 적습니다(= 가 없는 줄은 계산에 쓰지 않습니다). 첨자는 <code>l_{"{x+t}"}</code>·<code>v^t</code>,
            합은 <code>Σ_{"{u≥t}"}</code>, 조건은 <code>if( t = 0, a, b )</code> 로 적으면 계산까지 반영됩니다.
          </p>
          {hard.length > 0 && <p className="fld-err mt-1">계산에 쓸 수 없는 줄: {hard.join(" / ")}</p>}
        </>
      ) : (
        <div className="mt-1 space-y-0.5 font-mono text-[11.5px] leading-5 text-[#475569]">
          {f.text.split("\n").filter(Boolean).map((l, i) => (
            <div key={i} className={l.includes("=") ? "" : "text-muted-foreground"} dangerouslySetInnerHTML={{ __html: subSup(l) }} />
          ))}
        </div>
      )}
      {f.note && !edit && <p className="fld-hint mt-1">※ {f.note}</p>}
    </div>
  );
}

/** 그 카드가 맡은 식들. show 를 끄면 감춘다(머리의 [수식] 단추) */
function Formulas({ items, hint, show = true }: { items: FormulaSpec[]; hint?: ReactNode; show?: boolean }) {
  if (!items.length || !show) return null;
  return (
    <div className="space-y-2">
      {hint && <p className="fld-hint">{hint}</p>}
      {items.map((f) => <FormulaBox key={f.key ?? f.label} f={f} />)}
    </div>
  );
}

// ── 카드 본문 ────────────────────────────────────────────────────────────────
const PAY_FREQS = ["월납", "2개월납", "3개월납", "6개월납", "연납", "일시납"];
/** M00 문서 정보 — 회사·판·작성일·비고. 산출방법서 본문의 계산과 무관한 정보라 따로 둔다(적으면 개요 표에 함께 실린다) */
function DocInfoBody() {
  return (
    <Grid>
      <F p={["meta", "insurer"]} label="회사" />
      <F p={["meta", "version"]} label="판" />
      <F p={["meta", "date"]} label="작성일" placeholder="비우면 싣지 않음" />
      <F p={["meta", "note"]} label="비고" kind="area" wide />
    </Grid>
  );
}

/** 보험기간 글 → 만기 나이(종신 110). 못 읽으면 undefined */
export const termAgeOf = (t: unknown): number | undefined => {
  const s = str(t);
  if (/종신/.test(s)) return WHOLE_LIFE_AGE;
  const m = /(\d+)\s*세/.exec(s);
  return m ? Number(m[1]) : undefined;
};
/** 가입 조건 행의 계약 단위 — 구분이 비었거나 "주계약…" 이면 주계약, 아니면 그 이름의 특약 */
const termUnitOf = (label: unknown) => { const s = str(label).trim(); return !s || s.startsWith(MAIN_UNIT) ? MAIN_UNIT : s; };
const TERM_OPTIONS: [string, string][] = [["110세만기", "종신 (110세만기)"], ["100세만기", "100세만기"], ["90세만기", "90세만기"], ["80세만기", "80세만기"], ["70세만기", "70세만기"], ["60세만기", "60세만기"]];

/**
 * M01 상품 기본정보 — 산출방법서 개요와 같은 차례: 상품명 · 종류 → 가입 조건(보험의 종류 · 보험종목 · 납입주기 · 가입금액 한도 · 갱신)
 * → 보험기간 · 납입기간 · 가입나이 표. 보험기간은 여기서만 정한다 — 바꾸면 그 계약 단위(구분) 담보의 보험기간이 함께 바뀌고
 * 맨 위 [산출 조건] 이 그 값을 보인다(보장 카드에는 보험기간 칸이 없다).
 */
function ProductBody() {
  const f = useForm();
  const terms = list(f.get(["product", "terms"]));
  const bens = list(f.get(["benefits"]));
  const freqs = ((f.get(["product", "payFreqs"]) as unknown[] | undefined) ?? []).map(String);
  const types = (f.get(["product", "types"]) as unknown[] | undefined) ?? [];
  const female = terms.some((r) => str(r.ageF));
  const setFreq = (x: string, on: boolean) => {
    const next = [...PAY_FREQS.filter((k) => (k === x ? on : freqs.includes(k))), ...freqs.filter((k) => !PAY_FREQS.includes(k))];
    f.set(["product", "payFreqs"], next.length ? next : undefined);
  };
  /** 보험기간을 바꾸면 그 단위 담보 가운데 옛 만기 나이였던 것의 보험기간도 바꾼다 — 산출방법서 담보 표·계산이 따라온다 */
  const pickTerm = (i: number, v: string | number): YamlEdit[] => {
    const old = termAgeOf(terms[i]?.term), age = termAgeOf(v), u = termUnitOf(terms[i]?.label);
    const sync = age === undefined ? [] : bens.flatMap((x, k) => ((str(x.unit).trim() || MAIN_UNIT) === u && (old === undefined || num(x.endAge) === old) ? [{ path: ["benefits", k, "endAge"] as YamlPath, value: age }] : []));
    return [{ path: ["product", "terms", i, "term"], value: v }, ...sync];
  };
  return (
    <div className="space-y-3">
      <Grid>
        <F p={["meta", "productName"]} label="상품명" wide placeholder="예: 2대질병 진단보험" />
        <F p={["meta", "kind"]} label="종류" dl="dl-kind" placeholder="표준형(완전 환급)" />
      </Grid>
      <div data-path="product" className="sub space-y-3">
        <p className="sub-title">가입 조건 <span>산출방법서 개요의 가입 조건 표와 같은 차례입니다.</span></p>
        <Grid>
          <F p={["product", "category"]} label="보험의 종류" dl="dl-category" placeholder="예: 생명보험 / 종신" />
        </Grid>
        <div data-path="product.types">
          <p className="fld-label">보험종목</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {types.map((_, i) => (
              <span key={i} className="flex w-52 items-center gap-0.5">
                <F p={["product", "types", i]} label="보험종목" bare keepEmpty placeholder="예: 1종(무해지환급형)" />
                <Remove onClick={() => f.edit([{ path: ["product", "types", i] }])} />
              </span>
            ))}
            <button type="button" className="btn" onClick={() => f.edit([{ path: ["product", "types"], add: true, value: "" }])}>＋ 종목</button>
          </div>
        </div>
        <div data-path="product.payFreqs">
          <p className="fld-label">보험료 납입주기</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {PAY_FREQS.map((x) => (
              <label key={x} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs">
                <input type="checkbox" className="accent-[var(--primary)]" checked={freqs.includes(x)} onFocus={() => f.select("product.payFreqs")} onChange={(e) => setFreq(x, e.target.checked)} />
                {x}
              </label>
            ))}
          </div>
        </div>
        <Grid>
          <F p={["product", "sumLimit"]} label="보험가입금액 한도" wide placeholder="예: 1천만원 ~ 10억원" />
          <F p={["product", "renewal"]} label="갱신" dl="dl-renewal" placeholder="예: 비갱신형" />
        </Grid>
        <div data-path="product.terms">
          <p className="fld-label">보험기간 · 보험료 납입기간 · 가입나이 <span className="font-normal text-muted-foreground">— 보험기간은 구분(주계약 · 특약 이름)마다 그 담보의 보험기간이 됩니다</span></p>
          <div className="term-grid mt-1 text-[11px] text-muted-foreground"><span>구분</span><span>보험기간</span><span>납입기간</span><span>{female ? "가입나이(남)" : "가입나이"}</span><span>가입나이(여)</span><span /></div>
          {terms.map((_, i) => (
            <div key={i} data-path={`product.terms[${i}]`} className="term-grid mt-1">
              <F p={["product", "terms", i, "label"]} label="구분" bare placeholder="(전체)" />
              <Sel p={["product", "terms", i, "term"]} label="보험기간" bare
                options={TERM_OPTIONS} onPick={(v) => pickTerm(i, v)} />
              <F p={["product", "terms", i, "pay"]} label="납입기간" bare dl="dl-paylist" placeholder="10·20년납" />
              <F p={["product", "terms", i, "age"]} label="가입나이" bare dl="dl-agerange" placeholder="만15세 ~ 60세" />
              <F p={["product", "terms", i, "ageF"]} label="가입나이(여)" bare dl="dl-agerange" placeholder="(남자와 같음)" />
              <Remove onClick={() => f.edit([{ path: ["product", "terms", i] }])} />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Add onClick={() => f.edit([{ path: ["product", "terms"], add: true, value: { term: "", pay: "", age: "" } }])}>＋ 행</Add>
          </div>
          <p className="fld-hint mt-1">사업방법서의 판매 범위 표처럼 적습니다 — 예: 80세만기 · 10·15·20년납 · 만15세 ~ (80-납입기간)세. 구분은 담보·종목마다 다를 때만, 여자 칸은 남자와 다를 때만.</p>
        </div>
      </div>
    </div>
  );
}

function BasisBody() {
  const f = useForm();
  const lapse = list(f.get(["basis", "lapse"]));
  const on = lapse.length > 0;
  return (
    <div className="space-y-3">
      <Grid>
        <F p={["basis", "interest"]} label="적용이율 i" kind="pct" hint="예정이율 — 예: 2.5%" />
        <F p={["basis", "standardInterest"]} label="표준이율" kind="pct" hint="표준책임준비금·해약공제 기준" />
        <F p={["basis", "minGuaranteed"]} label="최저보증이율" kind="pct" />
        <F p={["basis", "averagePublished"]} label="평균공시이율" kind="pct" />
      </Grid>
      <div data-path="basis.lapse" className="space-y-2">
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" className="accent-[var(--primary)]" checked={on} onFocus={() => f.select("basis.lapse")}
            onChange={(e) => f.edit(e.target.checked
              ? [{ path: ["basis", "lapse"], value: [{ label: "저해지환급형", rate: "3%", duringPayOnly: true }] }, { path: ["basis", "lowRatio"], value: "70%" }]
              : [{ path: ["basis", "lapse"] }, { path: ["basis", "lowRatio"] }])} />
          저해지·무해지환급형 (적용해지율)
        </label>
        {on && (
          <>
            {lapse.map((_, i) => (
              <div key={i} data-path={`basis.lapse[${i}]`} className="sub grid grid-cols-[1fr_7rem_auto_auto] items-center gap-2">
                <F p={["basis", "lapse", i, "label"]} label="구분" bare placeholder="구분 (예: 무해지환급형)" />
                <F p={["basis", "lapse", i, "rate"]} label="적용해지율" kind="pct" bare placeholder="3%" />
                <Check p={["basis", "lapse", i, "duringPayOnly"]} label="납입기간 중만" />
                <Remove onClick={() => f.edit([{ path: ["basis", "lapse", i] }])} />
              </div>
            ))}
            <Grid>
              <F p={["basis", "lowRatio"]} label="환급률 (0% = 무해지)" kind="pct" hint="납입기간 중 해지환급금 = 표준형 × 환급률" />
            </Grid>
            <Add onClick={() => f.edit([{ path: ["basis", "lapse"], add: true, value: { label: "", rate: "3%", duringPayOnly: true } }])}>＋ 해지율 행</Add>
          </>
        )}
      </div>
    </div>
  );
}

/** 위험률의 출처(값 표) 고르기 — 기본 위험률 모음의 항목 또는 위험률 표 창의 열(이름) */
export interface RateSource { key: string; label: string; group: string }

/**
 * M04 위험률 — 산출방법서 가.(2) 예정위험률 표와 같은 열(위험률 · 기호 · 유형 · 근거·출처 · 표).
 * 출처는 콤보에서 고른다: 기본 위험률 모음의 항목이나 위험률 표의 열을 고르면 그 값이 이어지고 근거 칸이 "경험생명표(가상) <이름>" 으로 채워진다.
 * 더하기는 기본 위험률 모음이 기본이고, 다른 위험률은 스프레드시트에서 불러오거나 있는 위험률을 가공해 만든다.
 */
function RatesBody({ rates, used, tableNote, onLibrary, sources, sourceOf, onSource, onImport, onProcess }: {
  rates: RateItem[]; used: (id: string) => string[]; tableNote: (id: string) => string | undefined; onLibrary: () => void;
  sources: RateSource[]; sourceOf: (id: string) => string | undefined; onSource: (rateId: string, key: string) => void; onImport: () => void; onProcess: () => void;
}) {
  const f = useForm();
  const remove = (i: number) => {
    const who = used(rates[i].id);
    if (who.length && !window.confirm(`${who.join(", ")} 담보가 이 위험률을 씁니다. 지울까요?`)) return;
    f.edit([{ path: ["rates", i] }]);
  };
  const groups = [...new Set(sources.map((s) => s.group))];
  return (
    <div className="space-y-2">
      <div className="rate-table">
        <div className="rate-row rate-head"><span>위험률</span><span>기호</span><span>유형</span><span>근거·출처 (값 표)</span><span>표</span><span /></div>
        {rates.map((r, i) => {
          const cur = sourceOf(r.id) ?? "";
          const src = str(f.get(["rates", i, "source"]));
          return (
            <div key={i} data-path={`rates[${i}]`} className="rate-row">
              <F p={["rates", i, "name"]} label="위험률 이름" bare placeholder="위험률 이름" />
              <span className="chip" title="담보가 이 위험률을 가리키는 기호(id) — 식의 q · r · f 와 같은 뜻, YAML 탭에서 바꿉니다">{r.id}</span>
              <Sel p={["rates", i, "role"]} label="유형" bare options={Object.entries(RATE_ROLE_LABEL)} />
              <span data-path={`rates[${i}].source`} className="min-w-0">
                <select className="inp w-full" value={cur} aria-label={`${r.name} 출처`} onFocus={() => f.select([`rates[${i}]`, `rate:${r.id}`])}
                  onChange={(e) => { if (e.target.value) onSource(r.id, e.target.value); }}>
                  <option value="">{cur ? "—" : "값 표 고르기 …"}</option>
                  {groups.map((g) => <optgroup key={g} label={g}>{sources.filter((s) => s.group === g).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</optgroup>)}
                </select>
                <span className="block truncate text-[11px] text-muted-foreground" title={src}>{src || "근거 없음"}</span>
              </span>
              <span className={`text-[11px] ${tableNote(r.id) ? "text-primary" : "text-rose-700"}`}>{tableNote(r.id)?.replace(/^표: /, "") ?? "값 표 없음"}</span>
              <Remove onClick={() => remove(i)} />
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={onLibrary} title="공개 기본 위험률(과 개발 PC 의 사내 모음)에서 골라 표와 조건에 넣습니다">＋ 위험률 (기본 위험률 모음)</button>
        <button type="button" className="btn" onClick={onImport} title="다른 위험률 — 스프레드시트를 띄워 값과 함께 불러옵니다">＋ 스프레드시트에서 불러오기</button>
        <button type="button" className="btn" onClick={onProcess} title="있는 위험률을 합치거나 곱해 새 위험률을 만듭니다">위험률 가공</button>
      </div>
    </div>
  );
}


/**
 * L01 유지자수 — 산출방법서 "다. 유지자수·납입자수" 의 [식] 유지자수 덩이와 같다: 탈퇴 사유가 같은 담보들의 집단마다 l 하나.
 * 여기서 집단의 탈퇴 사유를 고치면 그 집단을 쓰는 담보들이 함께 바뀐다(담보 하나만 옮기는 것은 B01 에서).
 */
function MaintainersBody({ groups, allGroups, idxs, rates, spec, formulas, show }: { groups: GroupModel[]; allGroups: GroupModel[]; idxs: number[]; rates: RateItem[]; spec: MethodSpec; formulas: FormulaSpec[]; show: boolean }) {
  const f = useForm();
  /** 이 담보만 새 집단으로 — 탈퇴 사유를 그 담보에서 직접 고른다(같은 사유가 되면 그 집단에 다시 묶인다) */
  const [own, setOwn] = useState<number | null>(null);
  const exitsOf = (i: number) => ((f.get(["benefits", i, "exitRateIds"]) as unknown[] | undefined) ?? []).map(String);
  const setExits = (g: GroupModel, id: string, on: boolean) => {
    const cur = g.exits.map((r) => r.id);
    const next = rates.map((r) => r.id).filter((x) => (x === id ? on : cur.includes(x)));
    f.edit(g.benefitIdx.map((i) => ({ path: ["benefits", i, "exitRateIds"] as YamlPath, value: next })));
  };
  return (
    <div className="space-y-3">
      {!groups.length && <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">담보가 없습니다 — [보장] 카드에서 담보를 먼저 더하세요.</p>}
      {groups.map((g) => (
        <div key={g.id} data-path={g.benefitIdx.map((i) => `benefits[${i}].exitRateIds`).join("|")} className="sub space-y-1.5">
          <p className="sub-title">{g.label} <span>{g.benefitIdx.map((i) => spec.benefits[i]?.name).filter(Boolean).join(" · ")} 담보의 보험금 현가와 D·N 에 쓴다</span></p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">탈퇴 사유</span>
            {rates.map((r) => (
              <label key={r.id} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs">
                <input type="checkbox" className="accent-[var(--primary)]" checked={g.exits.some((x) => x.id === r.id)}
                  onFocus={() => f.select([`formula:group.${g.id}`, `rate:${r.id}`])} onChange={(e) => setExits(g, r.id, e.target.checked)} />
                {r.name}
              </label>
            ))}
          </div>
          <Formulas items={formulas.filter((x) => x.key === `group:${g.id}`)} show={show} />
        </div>
      ))}
      {idxs.length > 0 && (
        <div className="sub space-y-1.5">
          <p className="sub-title">담보마다 쓰는 집단 <span>담보는 [보장] 카드에서 이 집단을 가져다 씁니다</span></p>
          {idxs.map((i) => {
            const mine = allGroups.find((g) => g.benefitIdx.includes(i)), cur = exitsOf(i);
            return (
              <div key={i} data-path={`benefits[${i}].exitRateIds`} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <b className="min-w-[7rem]">{spec.benefits[i]?.name ?? `담보 ${i + 1}`}</b>
                  <select className="inp" value={own === i ? "own" : mine?.id ?? ""} aria-label={`${spec.benefits[i]?.name} 집단`} onFocus={() => f.select([`benefits[${i}].exitRateIds`])}
                    onChange={(e) => { if (e.target.value === "own") { setOwn(i); return; } setOwn(null); const g = allGroups.find((y) => y.id === e.target.value); if (g) f.set(["benefits", i, "exitRateIds"], g.exits.map((r) => r.id)); }}>
                    {allGroups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                    <option value="own">＋ 이 담보만 새 집단 — 탈퇴 사유 직접 고르기</option>
                  </select>
                </div>
                {own === i && (
                  <div className="flex flex-wrap items-center gap-2 pl-2">
                    {rates.map((r) => (
                      <label key={r.id} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs">
                        <input type="checkbox" className="accent-[var(--primary)]" checked={cur.includes(r.id)} onFocus={() => f.select([`benefits[${i}].exitRateIds`, `rate:${r.id}`])}
                          onChange={(e) => f.set(["benefits", i, "exitRateIds"], rates.map((x) => x.id).filter((x) => (x === r.id ? e.target.checked : cur.includes(x))))} />
                        {r.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" className="pane-tool" title="기본 위험률 모음에서 위험률을 더합니다(값 표와 함께) — 더한 뒤 탈퇴 사유로 고릅니다" onClick={() => f.library?.()}>＋ 위험률</button>
        </div>
      )}
    </div>
  );
}

/**
 * M05 납입 — 집단마다 납입자수 l′ 를 정한다(보험료는 "낼 사람" 쪽이다). 유지자수 l 은 보장별로 쓰므로 보장 카드(B01)에 있다.
 * 집단은 따로 적는 항목이 아니라 "탈퇴 사유가 같은 담보들"이다: 여기서 탈퇴 사유를 고치면 그 집단을 쓰는 담보들이 함께 바뀌고,
 * 담보(B01)에서 집단을 바꾸면 그 담보만 옮겨 간다.
 */
function GroupsBody({ payers, rates, spec, formulas, show }: { payers: PayerModel[]; rates: RateItem[]; spec: MethodSpec; formulas: FormulaSpec[]; show: boolean }) {
  const f = useForm();
  const waiverIds = ((f.get(["basis", "waiverRateIds"]) as unknown[] | undefined) ?? []).map(String);
  const waiverOn = f.get(["basis", "waiver"]) === true;
  /**
   * 납입면제 사유 고르기 — 유형이 '납입면제'인 위험률은 그 자체로 사유이고, 다른 유형(예: 암 발생률 — 암진단 급부이면서 사망 담보의 납입면제 사유)은
   * 유형을 그대로 두고 basis.waiverRateIds 에 넣는다.
   */
  const toggleWaiver = (i: number, v: boolean) => {
    const r = rates[i];
    if (r.role === "waiver") { if (!v) { const back = guessRole(r.name); f.edit([{ path: ["rates", i, "role"], value: back === "waiver" ? "other" : back }]); } return; }
    const next = rates.filter((x) => x.role !== "waiver" && (x.id === r.id ? v : waiverIds.includes(x.id))).map((x) => x.id);
    f.set(["basis", "waiverRateIds"], next.length ? next : undefined);
  };
  return (
    <div className="space-y-3">
      {!payers.length && <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">담보가 없습니다 — 아래 [보장] 카드에서 담보를 먼저 더하세요.</p>}
      {payers.map((p) => (
        <div key={p.id} className="sub space-y-1.5">
          <p className="sub-title">{p.label} <span>{p.benefitIdx.map((i) => spec.benefits[i]?.name).filter(Boolean).join(" · ")} 담보의 보험료에 쓴다</span></p>
          <Formulas items={formulas.filter((x) => x.key === `pay:${p.id}`)} show={show} />
        </div>
      ))}
      <div data-path="basis.waiver" className="sub space-y-2">
        <p className="sub-title">납입만 면제되는 사유 <span>보장은 이어지고 납입만 멈추는 사유 — 납입자수 l′ 에서만 뺍니다</span></p>
        <Check p={["basis", "waiver"]} label="추가 납입면제 사유 적용" />
        {waiverOn && (
          <div data-path="basis.waiverRateIds" className="flex flex-wrap gap-2">
            {rates.map((r, i) => (
              <label key={i} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs">
                <input type="checkbox" className="accent-[var(--primary)]" checked={r.role === "waiver" || waiverIds.includes(r.id)} onFocus={() => f.select("basis.waiverRateIds")} onChange={(e) => toggleWaiver(i, e.target.checked)} />
                {r.name} <span className="text-muted-foreground">({RATE_ROLE_LABEL[r.role]})</span>
              </label>
            ))}
            {!rates.length && <span className="text-xs text-muted-foreground">M04 에서 위험률을 먼저 더하세요</span>}
          </div>
        )}
        <p className="fld-hint">담보의 급부이기도 한 위험률(예: 암 발생률)도 고를 수 있습니다 — 그 담보에서는 탈퇴로 이미 줄었으므로 다시 빼지 않습니다.</p>
      </div>
    </div>
  );
}

/** B01 보장 — 담보를 한 카드에서 더하고 고친다. 담보마다 조건 → 보험금의 현가(C·M·PVB). 유지자수 l 식은 L01, 납입자수는 M05 */
function BenefitsBody({ bens, idxs, rates, groups, spec, addBen, models, formulas, show, onGroup, onKeep, sumAssured }: {
  bens: Obj[]; idxs: number[]; rates: RateItem[]; groups: GroupModel[]; spec: MethodSpec; addBen: (role: string) => void;
  models: BenefitModel[]; formulas: FormulaSpec[]; show: boolean; onGroup: (id: string) => void; onKeep: (id: string) => void; sumAssured: number;
}) {
  const f = useForm();
  const [open, setOpen] = useState(0);
  const move = (i: number, dir: -1 | 1) => {
    const k = idxs.indexOf(i), j = idxs[k + dir];
    if (j === undefined) return;
    f.edit([{ path: ["benefits", i], value: bens[j] }, { path: ["benefits", j], value: bens[i] }]);
    setOpen(k + dir);
  };
  const copy = (i: number) => {
    const src = JSON.parse(JSON.stringify(bens[i])) as Obj;
    src.id = uniqueId("b", bens.map((x) => str(x.id)));
    src.name = `${str(bens[i].name)} (복사)`;
    f.edit([{ path: ["benefits"], add: true, value: src }]);
    setOpen(idxs.length);
  };
  return (
    <div className="space-y-3">
      {idxs.map((i, k) => {
        const x = bens[i], s = spec.benefits[i], g = groups.find((y) => y.benefitIdx.includes(i));
        return (
          <Fold key={i} open={open === k} onToggle={() => setOpen(open === k ? -1 : k)}
            title={<>{k + 1}. {str(x.name) || `담보 ${k + 1}`}</>}
            chips={[BEN_ROLES.find(([r]) => r === str(x.role))?.[1], s?.multiple !== undefined ? `${s.multiple}배 = ${krw(s.multiple * sumAssured)}` : s?.amount !== undefined ? krw(s.amount) : "금액 없음",
              s?.endAge ? endAgeLabel(s.endAge) : undefined, s?.waitDays ? waitLabel(s) : undefined, g && `집단: ${g.label}`]}
            tools={<>
              <button type="button" className="card-icon" onClick={() => move(i, -1)} title="위로">▲</button>
              <button type="button" className="card-icon" onClick={() => move(i, 1)} title="아래로">▼</button>
              <button type="button" className="card-icon" onClick={() => copy(i)} title="이 담보를 복사해 새 담보로">복사</button>
              <Remove title="담보 삭제" onClick={() => { if (window.confirm(`담보 "${str(x.name)}" 를 지울까요?`)) f.edit([{ path: ["benefits", i] }]); }} />
            </>}>
            <BenefitBody i={i} rates={rates} groups={groups} spec={spec} sumAssured={sumAssured} onKeep={onKeep} />
            {(() => {
              const mo = models[i];
              if (!mo) return null;
              return (
                <>
                  <div className="lx-from">
                    <p>
                      납입자수 l′ = {mo.payer.label}
                      <button type="button" className="pane-tool ml-1" onClick={() => onGroup(mo.payer.id)}>납입 카드에서 보기</button>
                    </p>
                  </div>
                  {show && <div className="ml-2 font-mono text-[11.5px] leading-5 text-[#475569]" dangerouslySetInnerHTML={{ __html: `${subSup(mo.payout)} <span class="text-muted-foreground">— 지급자수 (표에서만 보인다)</span>` }} />}
                  <Formulas items={formulas.filter((y) => y.key === `benefit:${mo.b.id}`)} show={show} />
                </>
              );
            })()}
          </Fold>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-2">
        <span className="text-xs text-muted-foreground">담보 추가</span>
        {BEN_ROLES.map(([k, l, h]) => <button key={k} type="button" className="btn" title={h} onClick={() => { addBen(k); setOpen(idxs.length); }}>＋ {l}</button>)}
      </div>
    </div>
  );
}

function BenefitBody({ i, rates, groups, spec, sumAssured, onKeep }: { i: number; rates: RateItem[]; groups: GroupModel[]; spec: MethodSpec; sumAssured: number; onKeep: (id: string) => void }) {
  const f = useForm();
  const base: YamlPath = ["benefits", i];
  const at = (k: string | number, ...rest: (string | number)[]): YamlPath => [...base, k, ...rest];
  const role = str(f.get(at("role"))) || "other";
  const amount = num(f.get(at("amount"))), mult = num(f.get(at("multiple"))), wait = num(f.get(at("waitDays"))) ?? 0;
  const points = list(f.get(at("points")));
  const end = num(f.get(at("endAge"))) ?? 80;
  const mine = groups.find((g) => g.benefitIdx.includes(i));
  const s = spec.benefits[i];
  const ev = s ? eventRate(spec, s) : undefined;
  return (
    <div className="space-y-3">
      <Grid>
        <F p={at("name")} label="담보 이름" wide />
        <Sel p={at("role")} label="급부 유형" options={BEN_ROLES.map(([k, l]) => [k, l])} hint={BEN_ROLES.find(([k]) => k === role)?.[2]}
          onPick={(v) => { const id = suggestRate(rates, String(v)); return [{ path: at("role"), value: v }, { path: at("rateId"), value: undefined }, { path: at("exitRateIds"), value: autoExit(rates, String(v), id) }]; }} />
        {/* 보험기간은 M01 가입 조건(구분 = 계약 단위)에서 정하고 맨 위 [산출 조건]에 보인다 — 여기서는 읽기만 */}
        <p data-path={`benefits[${i}].endAge`} className="fld">
          <span className="fld-label">보험기간</span>
          <span className="ben-term" title="M01 상품 기본정보의 가입 조건(보험기간)에서 바꿉니다">{endAgeLabel(end)} <small>· M01 가입 조건</small></span>
        </p>
      </Grid>
      <div className="ben-grid">
        <Sel p={at("multiple")} label="보장금액" options={MULTIPLES}
          hint={mult !== undefined ? `가입금액 × ${mult} = ${krw(mult * sumAssured)} (산출 조건의 가입금액 기준)` : amount !== undefined ? `따로 정한 금액 ${krw(amount)}${role === "recurring" ? " (1일당)" : ""} — 입원 일당·월 지원액처럼 가입금액과 따로 정하는 담보. 배수를 고르면 가입금액 × 배수로 바뀝니다` : "가입금액 대비 배수"}
          onPick={(v) => [{ path: at("multiple"), value: v === "" ? undefined : Number(v) }, { path: at("amount"), value: undefined }]} />
        <Sel p={at("waitDays")} label="면책·삭감 기간" options={WAIT_DAYS}
          onPick={(v) => [{ path: at("waitDays"), value: !v || v === "" || Number(v) === 0 ? undefined : Number(v) }, ...(!v || Number(v) === 0 ? [{ path: at("waitPayRatio"), value: undefined }] : [])]} />
        {wait > 0
          ? <Sel p={at("waitPayRatio")} label="그 기간 지급" options={WAIT_PAY} hint="면책은 0%, 삭감은 지급하는 비율" onPick={(v) => [{ path: at("waitPayRatio"), value: v === "" || v === "0%" ? undefined : v }]} />
          : <label className="fld"><span className="fld-label text-muted-foreground">그 기간 지급</span><select className="inp fld-box" disabled value=""><option value="">—</option></select><span className="fld-hint">면책·삭감 기간이 없습니다</span></label>}
      </div>
      <div data-path={`benefits[${i}].exitRateIds`}>
        <p className="fld-label">유지자수 집단 <span className="font-normal text-muted-foreground">— L01 유지자수 카드에서 정한 집단을 고릅니다(탈퇴 사유는 그 카드에서)</span></p>
        <div className="flex flex-wrap items-center gap-2">
          <select className="inp" value={mine?.id ?? ""} onFocus={() => f.select([`benefits[${i}].exitRateIds`, ...(mine ? [`formula:group.${mine.id}`] : [])])} aria-label="유지자수 집단"
            onChange={(e) => { const g = groups.find((y) => y.id === e.target.value); if (g) f.set(at("exitRateIds"), g.exits.map((r) => r.id)); }}>
            {!mine && <option value="">—</option>}
            {groups.map((g) => <option key={g.id} value={g.id}>{g.label}{g.benefitIdx.length > 1 ? ` (담보 ${g.benefitIdx.length}개)` : ""}</option>)}
          </select>
          {mine && <button type="button" className="pane-tool" onClick={() => onKeep(mine.id)}>유지자수 카드에서 고치기</button>}
        </div>
        {/* 급부 위험률 — 어느 위험률과 이어지는지 늘 보인다. 여러 위험률의 결합(가공)이면 위험률 표에 넣어 값으로 보인다 */}
        <div data-path={`benefits[${i}].rateId`} className="mt-2 space-y-1">
          {role === "death" ? (
            <p className="text-xs"><span className="fld-label">급부 위험률</span>{" "}
              {s?.rateId && rates.some((r) => r.id === s.rateId)
                ? <>{rates.find((r) => r.id === s.rateId)?.name} <span className="text-muted-foreground">— 탈퇴 사유 전부의 결합 Q (위험률 표에 있음)</span></>
                : <>결합 Q = {(s?.exitRateIds ?? []).map((id) => rates.find((r) => r.id === id)?.name ?? id).join(" ⊕ ")} <span className="text-muted-foreground">(사망형 — 탈퇴 사유 전부)</span></>}
            </p>
          ) : (
            <Sel p={at("rateId")} label="급부 위험률" options={[["", `탈퇴 사유에서 — ${(ev?.name ?? (s ? eventCauses(spec, s).map((r) => r.name).join(" ⊕ ") : "")) || "없음"}`] as [string, string], ...rates.map((r): [string, string] => [r.id, `${r.name} (${RATE_ROLE_LABEL[r.role]})`])]}
              hint={role === "recurring" ? "일당형 — 연간 기대 입원일수" : "탈퇴 사유와 다른 위험률로 지급할 때(예: 암수술률)만 고릅니다"} />
          )}
          {((role === "death" && (s?.exitRateIds?.length ?? 0) > 1 && !(s?.rateId && rates.some((r) => r.id === s.rateId)))
            || (role !== "death" && !s?.rateId && s && eventCauses(spec, s).length > 1)) && (
            <button type="button" className="pane-tool" title="결합한 위험률(가공)을 연령마다 계산해 위험률 표에 열로 넣고, 조건(M04)에 위험률로 더해 이 담보에 잇습니다" onClick={() => f.combine?.(i)}>결합 위험률을 위험률 표에 넣기</button>
          )}
        </div>
      </div>
      {role === "other" && (
        <div data-path={`benefits[${i}].points`} className="border-t border-border pt-2">
          <div className="flex items-center justify-between"><p className="fld-label">생존 지급 시점</p>
            <button type="button" className="btn" onClick={() => f.edit([{ path: at("points"), add: true, value: { age: end + 1, multiple: 1 } }])}>＋ 시점</button></div>
          {points.map((_, k) => (
            <div key={k} className="mt-1 flex items-center gap-1.5 text-xs">
              <F p={at("points", k, "age")} label="나이" kind="num" unit="세에" bare />
              <F p={at("points", k, "multiple")} label="배수" kind="num" unit="배" bare />
              <Remove onClick={() => f.edit([{ path: at("points", k) }])} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExpenseBody({ count }: { count: number }) {
  const f = useForm();
  const rateOrTimes = (i: number) => {
    const t = f.get(["expenses", i, "times"]), r = f.get(["expenses", i, "rate"]);
    const v = str(t ?? r);
    const bad = v !== "" && typeof (t ?? r) !== "number" && parseTimes(v) === null && parseRate(v) === null;
    return (
      <span data-path={`expenses[${i}]`}>
        <input className={`inp ${bad ? "inp-bad" : ""}`} value={v} placeholder="1% · 1.5/1000 · 1배" title={bad ? "읽을 수 없습니다 — 1% · 1.5/1000 · 1배" : "비율 또는 배수"}
          onFocus={() => f.select(`expenses[${i}]`)}
          onChange={(e) => {
            const x = e.target.value, times = /배\s*$/.test(x);
            f.edit(times ? [{ path: ["expenses", i, "rate"] }, { path: ["expenses", i, "times"], value: x }]
              : [{ path: ["expenses", i, "times"] }, { path: ["expenses", i, "rate"], value: x === "" ? undefined : x }]);
          }} />
      </span>
    );
  };
  return (
    <div className="space-y-2">
      <div className="exp-grid text-[11px] text-muted-foreground"><span>구분</span><span>기호</span><span>기준</span><span>비율·배수</span><span>시기</span><span /></div>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} data-path={`expenses[${i}]`} className="exp-grid">
          <F p={["expenses", i, "group"]} label="구분" bare dl="dl-group" />
          <F p={["expenses", i, "symbol"]} label="기호" bare dl="dl-symbol" />
          <F p={["expenses", i, "basis"]} label="기준" bare dl="dl-basis" />
          {rateOrTimes(i)}
          <F p={["expenses", i, "phase"]} label="시기" bare dl="dl-phase" />
          <Remove onClick={() => f.edit([{ path: ["expenses", i] }])} />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Add onClick={() => f.edit([{ path: ["expenses"], add: true, value: { group: "계약관리비용", symbol: "", basis: "영업보험료", rate: "" } }])}>＋ 행</Add>
        <Add onClick={() => { if (!count || window.confirm("지금 사업비를 산출방법서형 6줄로 바꿀까요?")) f.set(["expenses"], EXPENSE_PRESET); }}>산출방법서형 6줄 넣기</Add>
      </div>
      <p className="fld-hint">비율은 1% · 1.5/1000, 배수는 1배. 기호 α_S · α_P · β_S · β_G · β′ · γ 는 자유설계보험 사업비와 그대로 짝지어집니다.</p>
    </div>
  );
}

function StringList({ p, label, placeholder }: { p: YamlPath; label: string; placeholder: string }) {
  const f = useForm();
  const items = (f.get(p) as unknown[] | undefined) ?? [];
  return (
    <div data-path={pathKey(p)}>
      <p className="fld-label">{label}</p>
      {items.map((_, i) => (
        <div key={i} className="mt-1 flex items-start gap-1.5">
          <F p={[...p, i]} label={label} kind="area" bare keepEmpty placeholder={placeholder} />
          <Remove onClick={() => f.edit([{ path: [...p, i] }])} />
        </div>
      ))}
      <Add onClick={() => f.edit([{ path: p, add: true, value: "" }])}>＋ 문장</Add>
    </div>
  );
}

/** 준비금·환급금 미리보기 — 계산 표(calcSheets)의 V · W · 환급률을 몇 해만 뽑아 보인다 */
const PREVIEW_YEARS = [1, 3, 5, 10, 20, 30];
function ReservePanel({ sheets, ids }: { sheets: CalcSheets | null; ids: string[] }) {
  if (!sheets) return null;
  const col = (s: CalcSheets["sheets"][number], sym: string) => s.cols.find((c) => c.sym === sym);
  return (
    <div className="calc-panel">
      <p className="text-[12.5px] font-semibold text-[#334155]">산출 결과 — 10만원당 책임준비금 V · 해지환급금 W · 환급률 (맨 위 [산출 조건] 의 계약으로)</p>
      {sheets.sheets.filter((s) => ids.includes(s.id)).map((s) => {
        const V = col(s, "V^{10만}"), W = col(s, "W"), R = col(s, "환급률");
        if (!V) return <p key={s.id} className="fld-hint">{s.name}: 준비금 식을 세우지 못했습니다 {s.warnings.join(" · ")}</p>;
        return (
          <table key={s.id} className="calc-table mt-1.5">
            <thead><tr><th>{s.name}</th>{PREVIEW_YEARS.map((t) => <th key={t}>{t}년 말</th>)}</tr></thead>
            <tbody>
              <tr><td>준비금 V (10만원당)</td>{PREVIEW_YEARS.map((t) => <td key={t} className="num">{t <= s.n ? won0(V.values[t]) : "—"}</td>)}</tr>
              {W && <tr><td>해지환급금 W (10만원당)</td>{PREVIEW_YEARS.map((t) => <td key={t} className="num">{t <= s.n ? won0(W.values[t] * 1e5) : "—"}</td>)}</tr>}
              {R && <tr><td>환급률</td>{PREVIEW_YEARS.map((t) => <td key={t} className="num">{t <= s.n ? `${(R.values[t] * 100).toFixed(1)}%` : "—"}</td>)}</tr>}
            </tbody>
          </table>
        );
      })}
      {sheets.sheets.some((s) => s.warnings.length) && <p className="fld-hint mt-1">{sheets.sheets.flatMap((s) => s.warnings).join(" · ")}</p>}
    </div>
  );
}

/**
 * 준비금·환급금 관련 문장이 계산에 들어가는지 — 알아보는 문장은 그 식을 보이고, 계산에 쓰지 않는 문장은 접어 둔다.
 * 문장은 산출방법서에 그대로 싣는다(정보) — 계산은 식이 한다.
 */
const NOTE_RULES: { re: RegExp; formula: string; std?: boolean }[] = [   // formula 에 "=" 가 없으면 글로 보인다
  { re: /신계약비.*(작은|적은)|해약공제\s*기준\s*신계약비/, formula: "α^{공제} = min( α_S + α_P·round₅( P_base ), α^{표준} )" },
  { re: /(적용기초율|적용).*(표준기초율|표준).*(큰|많은)/, formula: "V^{결산}_t = max( V_t, V^{표준}_t )", std: true },
  { re: /보간/, formula: "자동 반영 — 연말 값 그대로 (보간 없음)" },
  { re: /사망.*책임준비금.*지급/, formula: "자동 반영 — 탈퇴 사유에서 사망을 뺀다 (Q = 질병 발생률)" },
];
function noteRule(text: string, hasStd: boolean) {
  const r = NOTE_RULES.find((x) => x.re.test(text));
  return r && (!r.std || hasStd) ? r.formula : undefined;
}

function NotesBody({ formulas, show, sheets, ids, onSheet, spec }: { formulas: FormulaSpec[]; show: boolean; sheets: CalcSheets | null; ids: string[]; onSheet: () => void; spec: MethodSpec }) {
  const hasStd = spec.basis.standardInterest !== undefined;
  const notes = [...spec.reserve.notes, ...spec.surrender.notes].map((t) => ({ t, f: noteRule(t, hasStd) }));
  const used = notes.filter((x) => x.f), unused = notes.filter((x) => !x.f);
  const dy = spec.surrender.deductionYears ?? 7;
  return (
    <div className="space-y-3">
      <Grid><F p={["surrender", "deductionYears"]} label="해약공제 기간" kind="num" unit="년" /></Grid>
      <div className="note-list">
        <p className="fld-label">계산에 반영되는 조건</p>
        {[{ t: `해약공제 기간 ${dy}년`, f: `해약공제_t = α^{공제} · max( min(m, ${dy}) − t, 0 ) / min(m, ${dy})` }, ...used].map((x, k) => (
          <div key={k} className="note-item">
            <p className="text-xs">{x.t}</p>
            {x.f!.startsWith("자동") ? <p className="fld-hint">{x.f}</p> : <div className="formula-preview" dangerouslySetInnerHTML={{ __html: formulaHtml(x.f!) }} />}
          </div>
        ))}
      </div>
      <details className="sub">
        <summary className="cursor-pointer text-xs text-muted-foreground">관련 사항 문장 고치기{unused.length ? ` · 계산에 쓰지 않는 문장 ${unused.length}개` : ""}</summary>
        <div className="mt-2 space-y-2">
          {unused.length > 0 && <p className="fld-hint">계산에 쓰지 않는 문장(산출방법서에만 싣는다): {unused.map((x) => `“${x.t}”`).join(" · ")} — 계산에 넣으려면 [따로 적는 식]에 식으로 적습니다.</p>}
          <StringList p={["reserve", "notes"]} label="책임준비금 관련 사항" placeholder="예: 연중 보간은 하지 않고 …" />
          <StringList p={["surrender", "notes"]} label="해지환급금 관련 사항" placeholder="예: 해약공제 기준 신계약비는 …" />
        </div>
      </details>
      <Formulas items={formulas} show={show} />
      <ReservePanel sheets={sheets} ids={ids} />
      <div><button type="button" className="btn" onClick={onSheet} title="한 해 한 줄의 표로 준비금·환급금 열까지 봅니다">＝ 보험료 계산 표에서 연도별로 보기</button></div>
    </div>
  );
}

/** M09 따로 적는 식 — 자동 식을 덮지 않는, 사용자가 새로 더한 식만 다룬다 */
function FormulasBody({ idxs }: { idxs: number[] }) {
  const f = useForm();
  const [pal, setPal] = useState(false);
  const target = useRef<{ i: number; ta: HTMLTextAreaElement } | null>(null);
  const insert = (text: string) => {
    const t = target.current;
    if (!t) { f.edit([{ path: ["formulas"], add: true, value: { section: "계산기수", label: "새 식", text } }]); return; }
    const cur = t.ta.value, a = t.ta.selectionStart, b = t.ta.selectionEnd;
    f.set(["formulas", t.i, "text"], cur.slice(0, a) + text + cur.slice(b));
    requestAnimationFrame(() => { t.ta.focus(); t.ta.setSelectionRange(a + text.length, a + text.length); });
  };
  return (
    <div className="space-y-2">
      <p className="fld-hint">자동으로 만든 식에 더해 적을 식입니다. 표준 식을 고치는 것은 그 단계의 카드(보험료·보장·보험료의 계산·준비금)에서 합니다. 첨자는 <code>l_{"{x+t}"}</code> · <code>v^t</code> 처럼 적습니다.</p>
      {idxs.map((i) => {
        const text = str(f.get(["formulas", i, "text"]));
        return (
          <div key={i} data-path={`formulas[${i}]`} className="sub space-y-2"
            onFocusCapture={(e) => { if (e.target instanceof HTMLTextAreaElement && e.target.closest("[data-path$='.text']")) target.current = { i, ta: e.target }; }}>
            <div className="flex items-start gap-2">
              <div className="flex-1"><Grid>
                <F p={["formulas", i, "section"]} label="절" dl="dl-section" />
                <F p={["formulas", i, "label"]} label="제목" />
                <F p={["formulas", i, "text"]} label="식" kind="formula" wide keepEmpty />
                <F p={["formulas", i, "note"]} label="비고" wide />
              </Grid></div>
              <Remove onClick={() => f.edit([{ path: ["formulas", i] }])} />
            </div>
            {text.trim() && <div className="formula-preview" dangerouslySetInnerHTML={{ __html: formulaHtml(text) }} />}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Add onClick={() => f.edit([{ path: ["formulas"], add: true, value: { section: "계산기수", label: "새 식", text: "" } }])}>＋ 식</Add>
        <Add onClick={() => setPal((v) => !v)}>{pal ? "견본 닫기" : "수식·기호 견본"}</Add>
      </div>
      {pal && <FormulaPalette hint="식 칸을 고른 뒤 누르면 커서 자리에 넣습니다. 식 칸이 없으면 새 식으로 더합니다."
        onInline={insert} onFormula={(s) => (target.current ? insert(s.text)
          : f.edit([{ path: ["formulas"], add: true, value: { section: SECTION_OF[s.group] ?? "계산기수", label: s.label, text: s.text } }]))} />}
    </div>
  );
}

// ── 산출 결과 — 식대로 계산한 값 ──────────────────────────────────────────────
/**
 * 지금 조건과 **지금 산출방법서에 실린 식**으로 계산한 결과. 식을 고치면 여기 값이 바로 바뀐다 — 식이 계산에 쓰인다는 증거다.
 * 카드마다 그 카드의 식이 낸 값만 보인다 — M05 납입자수(집단별 m · N*), B01 보험금(담보별 n · PVB), M07 보험료.
 * 계약 한 점(가입나이·납입기간·주기·가입금액)은 산출방법서의 정보가 아니므로 조건에 저장하지 않는다(화면에서만).
 */
function CalcPanel({ calc, ids, kind, onSheet, benefitRate }: { calc: CalcResult; ids: string[]; kind: "pay" | "benefit" | "premium"; onSheet: () => void; /** 담보 id → 급부 위험률 이름 */ benefitRate?: (id: string) => string }) {
  const rows = calc.benefits.filter((b) => ids.includes(b.id));
  // 납입자수는 계약 단위마다 하나 — 담보가 여럿이어도 한 줄(담보의 보험기간이 납입기간보다 짧아 m 이 다를 때만 m 마다)
  const pays = [...new Map(rows.map((b) => [`${b.payer}|${b.m}`, b])).values()];
  return (
    <div className="calc-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-[#334155]">산출 결과 — 맨 위 [산출 조건] 의 계약으로</span>
        <button type="button" className="btn ml-auto" onClick={onSheet} title="한 해 한 줄의 표로 계산 과정을 봅니다">＝ 보험료 계산</button>
      </div>
      {calc.missingRates.length > 0 && <p className="mt-1 text-[11.5px] text-amber-700">값 표가 없어 0 으로 둔 위험률: {calc.missingRates.join(", ")} — [위험률 표] 에서 열을 이으세요</p>}
      {kind === "pay" && <>
        <table className="calc-table mt-1.5">
          <thead><tr><th>납입자수</th><th>납입기간 m</th><th>납입기수 N*</th></tr></thead>
          <tbody>{pays.map((b) => (
            <tr key={`${b.payer}|${b.m}`}><td>{b.payer}{b.error && <span className="fld-err"> — {b.error}</span>}</td><td className="num">{b.m}년</td><td className="num">{won0(b.nStar)}</td></tr>
          ))}</tbody>
        </table>
      </>}
      {kind === "benefit" && (
        <table className="calc-table mt-1.5">
          <thead><tr><th>담보</th><th className="txt">유지자수 집단</th><th className="txt">급부 위험률</th><th>보험기간 n</th><th>보험금 현가 PVB</th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}><td>{b.name}{b.error && <span className="fld-err"> — {b.error}</span>}</td><td>{b.group}</td><td>{benefitRate?.(b.id) ?? "—"}</td><td className="num">{b.n}년</td><td className="num">{won0(b.pvb)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {kind === "premium" && (
        <table className="calc-table mt-1.5">
          <thead><tr><th>담보</th><th>보험금 현가 PVB</th><th>납입기수 N*</th><th>순보험료 10만원당</th><th>1원당 G (6자리)</th><th>영업보험료 10만원당</th><th>담보 보험료</th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td>{b.name}{b.error && <span className="fld-err"> — {b.error}</span>}</td>
                <td className="num">{won0(b.pvb)}</td><td className="num">{won0(b.nStar)}</td><td className="num">{won0(b.net * 1e5)}</td>
                <td className="num">{b.gross6.toFixed(6)}</td><td className="num">{won0(b.per100k)}</td>
                <td className="num">{won0(b.premium)} 원 <small className="text-muted-foreground">({krw(b.amount)})</small></td>
              </tr>
            ))}
            {rows.length > 1 && <tr className="calc-sum"><td colSpan={5}>합계</td><td className="num">{won0(rows.reduce((s, b) => s + b.per100k, 0))}</td><td className="num">{won0(rows.reduce((s, b) => s + b.premium, 0))} 원</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── 화면 ────────────────────────────────────────────────────────────────────
interface Props {
  yaml: string;
  /** 조건 파일을 읽은 결과(잠깐 늦게 따라온다) — 요약·오류·자동 식 */
  spec: MethodSpec;
  errors: { line: number; message: string }[];
  onEdit: (edits: YamlEdit[]) => void;
  /** 오른쪽에서 고른 경로 → 이 칸들을 표시 */
  highlight: string[];
  /** 마지막으로 연 조건과 다른 경로 → 바뀐 칸·카드 표시 */
  changed: string[];
  /** 칸을 골랐을 때 */
  onSelect: (paths: string[]) => void;
  open: string[];
  setOpen: (f: (open: string[]) => string[]) => void;
  tableNote: (rateId: string) => string | undefined;
  /** 값 표가 없는 위험률 id — M04 가 알려 준다(계산 앱에서 0 이 된다) */
  noTableIds: string[];
  /** 기본 위험률 모음 창을 연다 */
  onLibrary: () => void;
  onShowYaml: () => void;
  /** 시산에 쓰는 계약 한 점 — 보험료 계산 화면과 함께 쓴다(조건에 저장하지 않는다) */
  calc: CalcContract;
  setCalc: (c: CalcContract) => void;
  /** 식을 보이는 카드 id (카드마다 [수식 보이기] — 기본 숨김) */
  formulasOn: string[];
  toggleFormulas: (id: string) => void;
  /** 보험료 계산 화면(스프레드시트)을 연다 */
  onPremiumSheet: () => void;
  /** M04 출처 콤보 — 고를 수 있는 값 표(기본 위험률 모음 · 위험률 표의 열), 위험률마다 지금 이어진 것, 고르면 잇는다 */
  rateSources: RateSource[];
  rateSourceOf: (rateId: string) => string | undefined;
  onRateSource: (rateId: string, key: string) => void;
  /** 스프레드시트에서 위험률 불러오기 · 위험률 가공 창 */
  onRateImport: () => void;
  onRateProcess: () => void;
  /** 담보의 결합 위험률(사망형 Q · 여러 질병 R)을 위험률 표에 넣고 잇는다 */
  onCombineRate: (benefitIdx: number) => void;
}

export default function ConditionForm({ yaml, spec, errors, onEdit, highlight, changed, onSelect, open, setOpen, tableNote, noTableIds, onLibrary, onShowYaml, calc: calcOn, setCalc: setCalcOn, formulasOn, toggleFormulas, onPremiumSheet, rateSources, rateSourceOf, onRateSource, onRateImport, onRateProcess, onCombineRate }: Props) {
  const { doc, syntax, raw } = useMemo(() => {
    const doc = parseDocument(yaml);
    const syntax = doc.errors[0] ?? (doc.contents !== null && !isMap(doc.contents)
      ? { linePos: [{ line: 1 }], message: "맨 위는 meta:, basis: 같은 항목이어야 합니다" } : undefined);
    return { doc, syntax, raw: syntax ? {} : ((doc.toJS() ?? {}) as Obj) };
  }, [yaml]);
  const general = errors.filter((e) => !e.line).map((e) => e.message);
  const box = useRef<HTMLDivElement | null>(null);

  // 지금 조건 + 지금 식 — 카드가 보여 주고 고치는 대상이고, 시산이 쓰는 것과 같다
  const full = useMemo(() => withFormulas(spec), [spec]);
  const groups = useMemo(() => groupModels(spec), [spec]);
  const calc = useMemo(() => computeSpec(spec, calcOn), [spec, calcOn]);
  const byPay = useMemo(() => computeByPayMethod(spec, calcOn), [spec, calcOn]);
  // 준비금·환급금 시산은 한 해 한 줄의 표를 세워야 하므로 M08 을 열었을 때만
  const sheets = useMemo(() => (open.includes("M08") ? calcSheets(spec, calcOn) : null), [spec, calcOn, open]);
  const sumAssured = calcOn.sumAssured ?? SUM_ASSURED_DEFAULT;
  /** B01 에서 "납입 카드에서 보기" — M05 의 그 집단을 펼쳐 비춘다 */
  const onGroupCard = (pid: string) => { openCard("M05"); onSelect([`formula:pay.${pid}`]); };
  /** B01 에서 "유지자수 카드에서 보기" — L01 의 그 집단을 펼쳐 비춘다 */
  const onKeepCard = (gid: string) => { openCard("L01"); onSelect([`formula:group.${gid}`]); };
  const byKey = (re: RegExp) => full.formulas.filter((f) => f.key && re.test(f.key));
  /** 조건의 formulas 중 자동 식을 덮은 것(카드에서 고친 식)이 아닌 것 — M09 가 다룬다 */
  const autoKeys = new Set(full.formulas.filter((f) => f.key).map((f) => `${f.section}|${f.label}`));
  const ownIdxs = list(raw.formulas).map((f, i) => ({ f, i })).filter(({ f }) => !autoKeys.has(`${str(f.section)}|${str(f.label)}`)).map(({ i }) => i);

  const formulaAt = (f: FormulaSpec) => list(raw.formulas).findIndex((x) => str(x.section) === f.section && str(x.label) === f.label);
  const ctx: Ctx = {
    get: (p) => getIn(raw, p),
    set: (p, v) => onEdit([{ path: p, value: v }]),
    edit: onEdit,
    note: (p) => { const n = doc.getIn(p, true); return isScalar(n) && n.comment ? n.comment.trim() : undefined; },
    err: (key) => general.find((m) => m.startsWith(`${key} `) || m.startsWith(`${key}:`)),
    select: (key) => onSelect(Array.isArray(key) ? key : [key]),
    setFormula: (f, text) => {
      const i = formulaAt(f);
      if (i >= 0) onEdit([{ path: ["formulas", i, "text"], value: text }]);
      else onEdit([{ path: ["formulas"], add: true, value: { section: f.section, label: f.label, text, ...(f.note ? { note: f.note } : {}) } }]);
    },
    resetFormula: (f) => { const i = formulaAt(f); if (i >= 0) onEdit([{ path: ["formulas", i] }]); },
    library: onLibrary,
    combine: onCombineRate,
  };

  const m = (raw.meta ?? {}) as Obj, b = (raw.basis ?? {}) as Obj;
  const rates: RateItem[] = list(raw.rates).map((r, i) => {
    const id = str(r.id) || `r${i + 1}`;
    const role = (Object.keys(RATE_ROLE_LABEL).includes(str(r.role)) ? str(r.role) : spec.rates.find((x) => x.id === id)?.role ?? "other") as RateRole;
    return { id, name: str(r.name) || `위험률 ${i + 1}`, role };
  });
  const bens = list(raw.benefits);
  // ── 계약 단위(주계약·특약) — 담보의 unit 이름에서 나온다. 탭을 고르면 보장·납입 카드가 그 단위의 담보만 보인다
  const units = useMemo(() => unitNames(spec), [spec]);
  const [unitSel, setUnit] = useState<string | null>(null);
  // 다른 상품(샘플·파일)을 열면 고른 탭을 비운다 — 앞 상품에서 고른 주계약 탭이 특약만 있는 상품에 남지 않게
  const product = spec.meta.productName;
  const [unitFor, setUnitFor] = useState(product);
  if (unitFor !== product) { setUnitFor(product); setUnit(null); }
  // 고르기 전에는 담보가 있는 첫 단위 — 특약만 있는 조건(입원·수술 특약 샘플)이 빈 주계약 탭으로 열리지 않게
  const unitOfBen = (x: Record<string, unknown>) => str(x.unit).trim() || MAIN_UNIT;
  const unit = unitSel && units.includes(unitSel) ? unitSel : units.find((u) => bens.some((x) => unitOfBen(x) === u)) ?? MAIN_UNIT;
  const unitIdxs = bens.map((x, i) => (((str(x.unit).trim() || MAIN_UNIT) === unit) ? i : -1)).filter((i) => i >= 0);
  const unitIds = unitIdxs.map((i) => spec.benefits[i]?.id).filter(Boolean) as string[];
  const unitGroupIds = groups.filter((g) => g.benefitIdx.some((i) => unitIdxs.includes(i))).map((g) => g.id);
  const unitPayers = useMemo(() => payerModels(spec), [spec]).filter((p) => p.benefitIdx.some((i) => unitIdxs.includes(i)));
  const termRows = list((raw.product as Obj | undefined)?.terms);
  /** 그 계약 단위의 가입 조건 보험기간(만기 나이) — 행의 구분이 단위 이름(비면 주계약) */
  const unitTermAges = (u: string) => [...new Set(termRows.filter((r) => termUnitOf(r.label) === u).map((r) => termAgeOf(r.term)).filter((a): a is number => a !== undefined))];
  /** 지금 단위 담보의 보험기간 */
  const benAges = [...new Set(unitIdxs.map((i) => num(bens[i]?.endAge)).filter((a): a is number => a !== undefined))];
  const rateName = (id: string) => sp.rates.find((r) => r.id === id)?.name ?? id;
  const benefitRateOf = (bid: string) => {
    const b = sp.benefits.find((x) => x.id === bid);
    if (!b) return "—";
    const named = b.rateId && sp.rates.some((r) => r.id === b.rateId) ? rateName(b.rateId) : undefined;
    if (b.role === "death") return named ? `${named} (결합)` : `결합 Q — ${(b.exitRateIds ?? []).map(rateName).join(" ⊕ ")}`;
    if (named) return named;
    const c = eventCauses(sp, b);
    return c.length > 1 ? `결합 R — ${c.map((r) => r.name).join(" ⊕ ")}` : c[0]?.name ?? "—";
  };
  const used = (id: string) => bens.filter((x) => str(x.rateId) === id || (Array.isArray(x.exitRateIds) && x.exitRateIds.map(String).includes(id))).map((x) => str(x.name));
  const bad = (re: RegExp) => general.find((x) => re.test(x));
  const status = (err: string | undefined, done: boolean, optional = false): Status => (err ? "error" : done ? "done" : optional ? "optional" : "editing");
  const sp = spec;
  const waiverIds = (Array.isArray(b.waiverRateIds) ? b.waiverRateIds : []).map(String);
  const waiverRates = rates.filter((r) => r.role === "waiver" || waiverIds.includes(r.id));
  const noTable = rates.filter((r) => r.role !== "lapse" && noTableIds.includes(r.id)).map((r) => r.name);
  const waiverOff = b.waiver === true && !waiverRates.length;
  const nExp = list(raw.expenses).length;
  const sr = (raw.surrender ?? {}) as Obj, rs = (raw.reserve ?? {}) as Obj;
  const nNotes = (Array.isArray(sr.notes) ? sr.notes.length : 0) + (Array.isArray(rs.notes) ? rs.notes.length : 0);
  const benErr = general.find((g) => /담보 "/.test(g));
  const edited = (re: RegExp) => byKey(re).filter((f) => f.edited).length;
  const editChip = (n: number) => (n ? `고친 식 ${n}개` : "자동 식");
  const unitBens = unitIdxs.map((i) => sp.benefits[i]).filter(Boolean);
  const unitCalc = calc.benefits.filter((x) => unitIds.includes(x.id));

  const errM01 = bad(/^meta\.|^contract/), errM03 = bad(/^basis\.(?!waiver)|해지율/), errM06 = bad(/^사업비/);
  const infoN = ["insurer", "version", "date", "note"].filter((k) => str(m[k])).length;
  const cards: CardDef[] = [
    // 산출방법서 차례대로: 개요(M00 정보 · M01 상품) → 1장 가. 예정기초율((1) 이율·(3) 해지율 M03 · (2) 위험률 M04 · (5) 사업비 M06)
    // → 다·라. 납입자수·보험료 계산기수(M05, (4) 납입면제 포함) → 다·마. 유지자수·보험금(B01) → 바. 보험료(M07) → 2·3장(M08) → 따로 적는 식(M09)
    { id: "M00", code: "M00", title: "문서 정보 (회사 · 판 · 작성일 · 비고)", paths: ["meta.insurer", "meta.version", "meta.date", "meta.note"], status: status(undefined, infoN > 0, true),
      summary: [infoN ? `${infoN}칸` : "비어 있음", str(m.insurer), str(m.version)],
      help: "계산에 쓰지 않는 문서 정보입니다. 적은 칸만 산출방법서 개요 표에 실립니다.", body: <DocInfoBody /> },
    { id: "M01", code: "M01", title: "상품 기본정보 — 개요 · 가입 조건", paths: ["meta.productName", "meta.kind", "product"], status: status(errM01, !!str(m.productName)), message: errM01,
      summary: [str(m.productName) || "이름 없음", str(m.kind), sp.product?.terms?.length ? `가입 조건 ${sp.product.terms.length}행` : "",
        sp.product?.payFreqs?.join("·") ?? ""],
      help: "산출방법서 개요의 상품명·종류와 가입 조건 표입니다. 보험기간은 여기 가입 조건에서 정합니다 — 구분(주계약 · 특약 이름)마다 그 담보의 보험기간이 되고, 맨 위 [산출 조건]에 보입니다.",
      body: <ProductBody /> },
    { id: "M03", code: "M03", title: "예정이율 · 적용해지율", paths: ["basis.interest", "basis.standardInterest", "basis.minGuaranteed", "basis.averagePublished", "basis.lapse", "basis.lowRatio"],
      status: status(errM03, sp.basis.interest !== undefined), message: errM03,
      summary: [sp.basis.interest !== undefined ? `i = ${pct(sp.basis.interest)}` : "", sp.basis.standardInterest !== undefined ? `표준 ${pct(sp.basis.standardInterest)}` : "",
        ...(sp.basis.lapse?.length ? [`해지율 ${sp.basis.lapse.map((l) => pct(l.rate)).join("·")}`, sp.basis.lowRatio !== undefined ? (sp.basis.lowRatio === 0 ? "무해지" : `환급률 ${pct(sp.basis.lowRatio)}`) : ""] : [])],
      help: "적용이율은 보험료·책임준비금에, 표준이율은 표준책임준비금과 해약공제 기준 신계약비에 씁니다. 저해지·무해지형은 적용해지율과 환급률을 넣습니다.", body: <BasisBody /> },
    { id: "M04", code: "M04", title: "위험률 — 예정위험률", paths: ["rates"], status: rates.length ? (noTable.length ? "editing" : "done") : "editing",
      message: noTable.length ? `값 표가 없는 위험률: ${noTable.join(", ")} — 아래 [위험률 표]에 같은 이름의 열을 붙여넣으면 이어집니다(계산 앱에서는 그때까지 0). 위험률을 더하면 표에 빈 열이 생깁니다.` : undefined,
      summary: [...rates.slice(0, 4).map((r) => r.name), rates.length > 4 ? `외 ${rates.length - 4}` : "", sp.rates.some((r) => r.table) ? `표 ${sp.rates.filter((r) => r.table).length}개 연결` : "", noTable.length ? `표 없음 ${noTable.length}` : ""],
      help: "산출방법서 가.(2) 예정위험률 표와 같은 칸입니다. 출처 콤보에서 값 표(기본 위험률 모음 · 위험률 표의 열)를 고르면 값이 이어지고 근거가 채워집니다. 더하기는 기본 위험률 모음이 기본이고, 다른 위험률은 스프레드시트에서 불러오거나 [위험률 가공]으로 있는 위험률을 합치거나 곱해 만듭니다.",
      body: <RatesBody rates={rates} used={used} tableNote={tableNote} onLibrary={onLibrary} sources={rateSources} sourceOf={rateSourceOf} onSource={onRateSource} onImport={onRateImport} onProcess={onRateProcess} /> },
    { id: "M06", code: "M06", title: "예정사업비율", paths: ["expenses"], status: status(errM06, nExp > 0), message: errM06,
      summary: [`${nExp}줄`, sp.expenses.some((e) => /^(α_S|α_P|β_S|β_G)$/.test(e.symbol)) ? "산출방법서형" : ""],
      help: "산출방법서형은 α_S·α_P·β_S·β_G·β′·γ 를 씁니다. 보장기간이 20년보다 짧으면 α_P 는 n/20 배로 줄입니다. 이 값들이 다음 카드의 영업보험료 식에 그대로 들어갑니다.", body: <ExpenseBody count={nExp} /> },
    { id: "L01", code: "L01", title: "유지자수 (l) — 탈퇴 사유가 같은 담보의 집단마다", paths: unitGroupIds.length ? unitGroupIds.map((id) => `formula:group.${id}`) : ["formula:group"], formulas: true,
      status: unitGroupIds.length ? "done" : "editing",
      summary: [...groups.filter((g) => unitGroupIds.includes(g.id)).map((g) => g.label), editChip(edited(/^group:/))],
      help: "산출방법서 다. 의 유지자수 식입니다. 탈퇴 사유가 같은 담보는 한 집단으로 같은 l 을 씁니다 — 여기서 탈퇴 사유를 고치면 그 집단의 담보가 함께 바뀝니다. 질병끼리는 곱, 사망과는 겹치는 부분 절반으로 결합합니다.",
      body: <MaintainersBody groups={groups.filter((g) => unitGroupIds.includes(g.id))} allGroups={groups} idxs={unitIdxs} rates={rates} spec={sp} formulas={full.formulas} show={formulasOn.includes("L01")} /> },
    { id: "M05", code: "M05", title: "납입 — 납입자수 (l′) · 납입기수 (N*)", paths: ["basis.waiver", "basis.waiverRateIds", "formula:pay", "formula:pv.D′", "formula:pv.NStar"], formulas: true,
      // 열면 납입자수(그 계약 단위의 l′ 식)만 — 납입면제(가.(4))·D′·N* 는 카드 안에서 그 칸·식을 고를 때
      focus: unitPayers.length ? unitPayers.map((p) => `formula:pay.${p.id}`) : ["formula:pay"],
      status: waiverOff ? "error" : unitPayers.length ? "done" : "editing",
      message: waiverOff ? "추가 납입면제 사유를 켰지만 고른 위험률이 없습니다. 아래에서 고르세요." : undefined,
      summary: [...unitPayers.map((p) => p.label), b.waiver === true ? `납입면제: ${waiverRates.map((r) => r.name).join(" · ") || "없음"}` : "납입면제 없음",
        "D′ · N′ · N*", editChip(edited(/^(pay|pv:D′|pv:NStar)/))],
      help: "보험료를 내는 사람 쪽입니다. 보험료 계산에는 납입자수 l′ 를 하나만 씁니다 — 계약을 끝내는 탈퇴 사유(모든 담보에 공통, 보통 사망)와 납입면제 사유가 생긴 사람을 빼서, 납입자(사망X, 장해X, 암X)처럼 적습니다. 이를 현재 가치로 옮겨(D′) 누계(N′)와 납입기수 N* 를 냅니다. 보험기간은 쓰지 않고 납입기간 m 만 씁니다. 유지자수 l(받을 사람)은 담보마다 다르므로 [보장] 카드에 있습니다.",
      body: <><GroupsBody payers={unitPayers} rates={rates} spec={sp} formulas={full.formulas} show={formulasOn.includes("M05")} />
        <div className="border-t border-border pt-2">
          <p className="fld-label mb-1">납입자수의 현가·납입기수 — 납입기간 m 동안의 납입자수로</p>
          <Formulas items={byKey(/^pv:(D′|NStar)$/)} show={formulasOn.includes("M05")} />
        </div>
        <CalcPanel calc={calc} ids={unitIds} kind="pay" onSheet={onPremiumSheet} /></> },
    { id: "B01", code: "B01", title: "보장 — 담보마다 보험금의 현가 (C · M · PVB)", paths: [...unitIds.map((id) => `formula:benefit.${id}`), "formula:pv.D"], owns: ["benefits"], formulas: true,
      status: status(benErr, unitBens.length > 0 && unitBens.every((x) => x.multiple !== undefined || x.amount !== undefined)), message: benErr,
      summary: [`담보 ${unitBens.length}개`, ...unitBens.slice(0, 2).map((x) => `${x.name} ${x.multiple !== undefined ? `${x.multiple}배` : krw(x.amount)}`),
        unitBens.some((x) => x.waitDays) ? "면책·삭감 있음" : "", editChip(edited(/^(benefit|pv:D$)/))],
      help: "담보 하나가 한 묶음입니다 — 조건(급부 유형·보험기간·보장금액 배수·면책/삭감·집단)과 그 담보의 유지자수 l(집단의 식), 보험금 현가 식(지급자수 d → C → M → PVB)이 같은 자리에 있습니다. 보장금액은 가입금액 × 배수이고 식은 1원당이라 보험료 맨 뒤에서 곱합니다. 급부 위험률은 탈퇴 사유에서 정해집니다(사망형은 전부, 진단형은 사망이 아닌 사유). 담보를 복사해 비슷한 보장을 빨리 더할 수 있습니다. 보험금 증액·감액(연령 구간 배수)은 뒤에 설계할 예정이라 여기서 다루지 않습니다.",
      body: <><BenefitsBody bens={bens} idxs={unitIdxs} rates={rates} groups={groups} spec={sp} addBen={(role) => addBen(role)} sumAssured={sumAssured}
          models={benefitModels(sp)} formulas={full.formulas} show={formulasOn.includes("B01")} onGroup={onGroupCard} onKeep={onKeepCard} />
        <div className="border-t border-border pt-2">
          <p className="fld-label mb-1">유지자수의 현가·누계 — 담보마다 같은 식</p>
          <Formulas items={byKey(/^pv:(D|H)$/)} show={formulasOn.includes("B01")} />
        </div>
        <CalcPanel calc={calc} ids={unitIds} kind="benefit" onSheet={onPremiumSheet} benefitRate={benefitRateOf} /></> },
    { id: "M07", code: "M07", title: "보험료의 계산 (P · G · 10만원당)", paths: ["formula:premium"], formulas: true, status: calc.errors.length ? "error" : "done",
      message: calc.errors.length ? `식으로 계산할 수 없습니다 — ${calc.errors[0]}` : undefined,
      summary: ["P · 기준연납 · G · 반올림", unitCalc.length ? `10만원당 ${won0(unitCalc.reduce((s, x) => s + x.per100k, 0))}원` : "", editChip(edited(/^premium:/))],
      help: "보험금 현가를 납입기수로 나눠 순보험료 P 를 내고, 사업비를 얹어 영업보험료 G 를 냅니다. 1원당 G 를 소수 여섯째 자리까지 만들고(G₁), × 100,000 을 원 단위로 반올림한 것이 10만원당 보험료입니다. 담보 보험료 = 10만원당 × (가입금액 × 배수 ÷ 10만) 으로 맨 뒤에서 한꺼번에 곱합니다. 아래 산출 결과은 지금 식으로 바로 계산한 값이고, [보험료 계산] 을 누르면 한 해 한 줄의 표로 그 과정을 다 볼 수 있습니다.",
      body: <><Formulas items={byKey(/^premium:/)} show={formulasOn.includes("M07")} />
        <CalcPanel calc={calc} ids={unitIds} kind="premium" onSheet={onPremiumSheet} /></> },
    { id: "M08", code: "M08", title: "책임준비금·해지환급금 (V · W)", paths: ["reserve", "surrender", "formula:reserve", "formula:surrender"], formulas: true, status: status(undefined, nNotes > 0 || num(sr.deductionYears) !== undefined, true),
      summary: [sp.surrender.deductionYears ? `해약공제 ${sp.surrender.deductionYears}년` : "해약공제 7년", nNotes ? `문장 ${nNotes}` : "", "P_β · V · 해약공제 · W · 환급률", editChip(edited(/^(reserve|surrender):/))],
      help: "연말 책임준비금 V 는 장래 보험금·유지비의 현가에서 장래 순보험료(P_β)의 현가를 빼 유지자수의 현가로 나눈 것이고, 해지환급금 W 는 거기서 해약공제(신계약비를 납입기간과 해약공제 기간 중 짧은 쪽에 걸쳐 균등 상각)를 뺀 것입니다. 식은 조건에서 자동으로 만들고 여기서 고칠 수 있으며, 아래 산출 결과과 [보험료 계산] 표·엑셀·파이썬에 연도별 열로 들어갑니다.",
      body: <NotesBody formulas={byKey(/^(reserve|surrender):/)} show={formulasOn.includes("M08")} sheets={sheets} ids={unitIds} onSheet={onPremiumSheet} spec={sp} /> },
    { id: "M09", code: "M09", title: "따로 적는 식", paths: ["formulas"], status: status(undefined, ownIdxs.length > 0, true),
      summary: [ownIdxs.length ? `식 ${ownIdxs.length}개` : "없음"],
      help: "표준 식 말고 따로 적을 식입니다(새 절도 만들 수 있습니다). 표준 식을 고치는 것은 그 단계의 카드에서 합니다 — 고친 식은 이 목록에 나타나지 않습니다.", body: <FormulasBody idxs={ownIdxs} /> },
  ];

  const touches = (paths: string[]) => changed.some((s) => paths.some((p) => under(s, p) || under(p, s)));
  for (const c of cards) c.dirty = touches([...c.paths, ...(c.owns ?? [])]);

  // 바뀐 칸 표시 — 가장 안쪽(칸)만. 카드는 머리의 "바뀜" 딱지가 맡는다
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    root.querySelectorAll(".form-changed").forEach((el) => el.classList.remove("form-changed"));
    if (!changed.length) return;
    const els = [...root.querySelectorAll<HTMLElement>("[data-path]")].filter((el) => !el.classList.contains("card") && touches(splitPaths(el.dataset.path)));
    els.filter((el) => !els.some((o) => o !== el && el.contains(o))).forEach((el) => el.classList.add("form-changed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changed, open, yaml]);

  // 오른쪽에서 고른 조건이 든 카드를 펼친다 — 한 번에 하나만
  useEffect(() => {
    if (!highlight.length) return;
    const ids = cards.filter((x) => highlight.some((s) => [...x.paths, ...(x.owns ?? [])].some((p) => under(s, p) || under(p, s)))).map((x) => x.id);
    if (ids.length && !ids.some((id) => open.includes(id))) setOpen(() => [ids[0]]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight]);

  // 고른 조건의 칸을 표시 — 겹치면 바깥 것만
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    root.querySelectorAll(".form-hl").forEach((el) => el.classList.remove("form-hl"));
    if (!highlight.length) return;
    const els = [...root.querySelectorAll<HTMLElement>("[data-path]")];
    const hit = [...matchBlocks(els.map((el) => splitPaths(el.dataset.path)), highlight)].map((i) => els[i]);
    const top = hit.filter((el) => !hit.some((o) => o !== el && o.contains(el)));
    top.forEach((el) => el.classList.add("form-hl"));
    top[0]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight, open]);

  // 왼쪽에서 카드를 열면 그 카드를 창 한가운데로 — 펼쳐진 뒤에 재야 하므로 open 이 바뀐 다음 프레임에
  const center = useRef<string | null>(null);
  useEffect(() => {
    const id = center.current;
    if (!id || !open.includes(id)) return;
    center.current = null;
    const el = box.current?.querySelector<HTMLElement>(`[data-card="${id}"]`);
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [open]);
  const openCard = (id: string) => { center.current = id; setOpen(() => [id]); };

  if (syntax) {
    return (
      <div className="p-4">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          조건 파일 {syntax.linePos?.[0]?.line ?? "?"}줄에 문법 오류가 있어 입력 화면을 열 수 없습니다 — {syntax.message.split("\n")[0]}
          <button className="btn ml-2" onClick={onShowYaml}>YAML 탭에서 고치기</button>
        </div>
      </div>
    );
  }

  /** 한 번에 한 카드만 — 지금 보는 단계에 집중하고, 열면 그 카드를 창 가운데로 두고 산출방법서의 그 자리를 비춘다 */
  const toggle = (c: CardDef) => {
    const was = open.includes(c.id);
    if (was) setOpen(() => []);
    else { openCard(c.id); onSelect(c.focus ?? c.paths); }
  };
  function addBen(role: string, toUnit = unit) {
    const id = uniqueId("b", bens.map((x) => str(x.id))), rateId = suggestRate(rates, role);
    const value = Object.fromEntries(Object.entries({
      id, name: `담보 ${bens.length + 1}`, ...(toUnit !== MAIN_UNIT ? { unit: toUnit } : {}), role, multiple: role === "death" ? 1 : 0.5,
      endAge: unitTermAges(toUnit)[0] ?? unitTermAges(MAIN_UNIT)[0] ?? (role === "death" ? WHOLE_LIFE_AGE : 100),     // 보험기간은 M01 가입 조건에서
      ...(role === "incidence" ? { waitDays: 90 } : {}), exitRateIds: autoExit(rates, role, rateId),
    }).filter(([, v]) => v !== undefined));
    onEdit([{ path: ["benefits"], add: true, value }]);
  }
  /** 특약 더하기 — 계약 단위는 담보의 unit 이름이라, 그 이름의 첫 담보를 만들면 탭이 생긴다 */
  const addRider = () => {
    const name = window.prompt("특약 이름 (엑셀 시트 이름으로도 쓰입니다 — 짧게)", `특약${units.length}`)?.trim();
    if (!name || name === MAIN_UNIT) return;
    if (units.includes(name)) { setUnit(name); return; }
    const main = termRows.find((r) => termUnitOf(r.label) === MAIN_UNIT);
    if (main) onEdit([{ path: ["product", "terms"], add: true, value: { label: name, term: str(main.term), pay: "주계약과 같음", age: str(main.age) } }]);
    addBen("incidence", name);
    setUnit(name);
    openCard("B01");
  };
  const removeRider = (name: string) => {
    const idxs = bens.map((x, i) => (str(x.unit).trim() === name ? i : -1)).filter((i) => i >= 0);
    if (!window.confirm(`특약 "${name}" 과 그 담보 ${idxs.length}개를 지울까요?`)) return;
    const rows = termRows.map((r, i) => (str(r.label).trim() === name ? i : -1)).filter((i) => i >= 0);
    onEdit([...idxs.slice().reverse().map((i) => ({ path: ["benefits", i] as YamlPath })), ...rows.slice().reverse().map((i) => ({ path: ["product", "terms", i] as YamlPath }))]);
    setUnit(MAIN_UNIT);
  };
  const extra = [list(raw.units).length ? `계약 단위(units) ${list(raw.units).length}개` : "", list(raw.sections).length ? `추가 절(sections) ${list(raw.sections).length}개` : ""].filter(Boolean);
  const totalPer100k = calc.benefits.reduce((s, x) => s + x.per100k, 0);

  return (
    <FormCtx.Provider value={ctx}>
      <div ref={box} className="form-body thin-scroll">
        {/* 시산보험료 조건 — 산출방법서의 정보가 아니라 "이 조건으로 계산해 보는" 계약 한 점. 조건 파일에 저장하지 않는다 */}
        <div className="trial-bar">
          <b>산출 조건</b>
          <select className="inp" value={calcOn.sex ?? "M"} onChange={(e) => setCalcOn({ ...calcOn, sex: e.target.value as Sex })}><option value="M">남</option><option value="F">여</option></select>
          <select className="inp" value={calcOn.age} onChange={(e) => setCalcOn({ ...calcOn, age: Number(e.target.value) })}>{[0, 20, 30, 40, 50, 60].map((a) => <option key={a} value={a}>{a}세</option>)}</select>
          {(() => {
            const cur = benAges.length === 1 ? benAges[0] : undefined;
            const opts = [...new Set([...unitTermAges(unit), ...(cur !== undefined ? [cur] : [])])].sort((a, b) => b - a);
            const name = `보험기간${units.length > 1 ? ` (${unit})` : ""}`;
            if (cur === undefined || opts.length <= 1)
              return <span className="inp trial-fixed" title={`${name} — M01 가입 조건에서 정합니다${cur !== undefined && cur >= WHOLE_LIFE_AGE ? " (종신 — 고정)" : ""}`}>{cur !== undefined ? endAgeLabel(cur) : `담보별 (${benAges.map(endAgeLabel).join(" · ")})`}</span>;
            return (
              <select className="inp" value={cur} title={`${name} — M01 가입 조건의 보험기간 가운데에서 고릅니다(그 단위 담보의 보험기간이 바뀝니다)`} aria-label={name}
                onChange={(e) => { const v = Number(e.target.value); onEdit(unitIdxs.filter((i) => num(bens[i]?.endAge) === cur).map((i) => ({ path: ["benefits", i, "endAge"] as YamlPath, value: v }))); }}>
                {opts.map((a) => <option key={a} value={a}>{endAgeLabel(a)}</option>)}
              </select>
            );
          })()}
          <select className="inp" value={calcOn.payYears} onChange={(e) => setCalcOn({ ...calcOn, payYears: Number(e.target.value) })}>{[5, 10, 15, 20, 30].map((a) => <option key={a} value={a}>{a}년납</option>)}</select>
          <select className="inp" value={calcOn.freq} onChange={(e) => setCalcOn({ ...calcOn, freq: Number(e.target.value) })}>{PAY_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className="inp" value={sumAssured} title="보험가입금액 — 담보의 보장금액 = 가입금액 × 배수" onChange={(e) => setCalcOn({ ...calcOn, sumAssured: Number(e.target.value) })}>
            {(SUM_ASSURED.some(([v]) => v === sumAssured) ? SUM_ASSURED : [...SUM_ASSURED, [sumAssured, krw(sumAssured)] as [number, string]]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span className="trial-out">10만원당 <b>{won0(totalPer100k)}</b>원 · {PAY_METHODS.find(([v]) => v === calcOn.freq)?.[1] ?? "회당"} <b>{won0(calc.premium)}</b>원</span>
          <table className="trial-pay" title="납입방법마다 보험료 — 보험금의 현가는 같고 납입기수 N* 만 다르다">
            <tbody>
              <tr>{byPay.map((r) => <th key={r.freq} className={r.freq === calcOn.freq ? "on" : ""}>{r.label}</th>)}</tr>
              <tr>{byPay.map((r) => <td key={r.freq} className={r.freq === calcOn.freq ? "on" : ""}>{won0(r.premium)}원 <small>({won0(r.per100k)})</small></td>)}</tr>
            </tbody>
          </table>
          <button type="button" className="btn" onClick={onPremiumSheet}>＝ 보험료 계산</button>
          <span className="fld-hint w-full">보험료를 계산해 보는 계약 한 점입니다 — 산출방법서의 정보가 아니라서 조건 파일에 저장하지 않습니다. 납입방법별 보험료는 가입금액 × 배수의 담보 보험료 합{units.length > 1 ? " (주계약 + 특약)" : ""}입니다.</span>
        </div>
        {/* 계약 단위 탭 — 주계약과 특약. 보장·납입 카드가 그 단위의 담보만 보이고, 엑셀은 단위마다 한 장 */}
        <div className="unit-tabs" role="tablist" aria-label="계약 단위">
          {units.map((u) => (
            <span key={u} className={`unit-tab ${u === unit ? "on" : ""}`}>
              <button type="button" role="tab" aria-selected={u === unit} onClick={() => setUnit(u)}>{u}<small>{calc.benefits.filter((x) => x.unit === u).length}담보 · {won0(calc.benefits.filter((x) => x.unit === u).reduce((s, x) => s + x.premium, 0))}원</small></button>
              {u !== MAIN_UNIT && <button type="button" className="sub-x" title="특약 삭제" onClick={() => removeRider(u)}>×</button>}
            </span>
          ))}
          <button type="button" className="btn" onClick={addRider} title="특약을 더합니다 — 그 이름의 담보가 생기고 탭이 됩니다">＋ 특약</button>
        </div>
        {cards.map((card, i) => (
          <Card key={card.id} c={card} index={i} open={open.includes(card.id)} onToggle={() => toggle(card)} showF={formulasOn.includes(card.id)} onToggleF={() => toggleFormulas(card.id)} />
        ))}
        {extra.length > 0 && <p className="px-1 text-xs text-muted-foreground">{extra.join(" · ")} 는 YAML 탭에서 고칩니다.</p>}
        <Lists />
      </div>
    </FormCtx.Provider>
  );
}

/** 칸에 붙는 추천 목록 */
function Lists() {
  const dl = (id: string, items: (string | number)[]) => <datalist id={id}>{items.map((x) => <option key={x} value={x} />)}</datalist>;
  return (
    <>
      {dl("dl-kind", ["표준형(완전 환급)", "저해지환급형", "무해지환급형"])}
      {dl("dl-category", ["생명보험 / 종신", "생명보험 / 정기", "생명보험 / 건강(진단)", "생명보험 / 건강(암)", "장기손해보험 / 장기질병", "장기손해보험 / 장기상해"])}
      {dl("dl-renewal", ["비갱신형", "갱신형 (10년 갱신)", "갱신형 (20년 갱신)"])}
      {dl("dl-term", ["80세만기", "90세만기", "100세만기", "110세만기", "종신", "10년만기", "20년만기", "30년만기"])}
      {dl("dl-endage", [80, 90, 100, 110])}
      {dl("dl-paylist", ["전기납", "일시납", "10년납", "20년납", "30년납", "10·15·20년납", "10·20·30년납", "5·10·15·20년납"])}
      {dl("dl-agerange", ["만15세 ~ 60세", "만15세 ~ 65세", "만15세 ~ 70세", "만15세 ~ (80-납입기간)세", "0세 ~ 60세", "20세 ~ 60세"])}
      {dl("dl-group", ["계약체결비용", "계약관리비용", "수금비용"])}
      {dl("dl-symbol", ["α_S", "α_P", "β_S", "β_G", "β′", "γ", "α", "β"])}
      {dl("dl-basis", ["보험가입금액", "기준연납순보험료", "매년 보험가입금액", "영업보험료"])}
      {dl("dl-phase", ["초년도", "납입중", "납입후"])}
      {dl("dl-section", ["계산기수", "보험료의 계산", "책임준비금의 계산", "해지환급금의 계산"])}
    </>
  );
}
