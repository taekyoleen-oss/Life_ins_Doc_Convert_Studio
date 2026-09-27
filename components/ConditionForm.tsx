"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isMap, isScalar, parseDocument } from "yaml";
import { pathKey, pct, type YamlEdit, type YamlPath } from "@/lib/conditions/yaml";
import { matchBlocks, splitPaths, under } from "@/lib/conditions/link";
import { parseRate, parseTimes } from "@/lib/methoddoc/parse";
import { benefitModels, groupModels, waitMonths, withFormulas, type BenefitModel, type GroupModel } from "@/lib/methoddoc/formulas";
import { checkFormula, computeSpec, type CalcContract, type CalcResult } from "@/lib/methoddoc/calc";
import { subSup } from "@/lib/methoddoc/render";
import { RATE_ROLE_LABEL, type FormulaSpec, type MethodSpec, type RateRole, type Sex } from "@/lib/methoddoc/spec";
import { guessRole, newRateId } from "@/lib/sheet";
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
interface CardDef { id: string; code: string; title: string; paths: string[]; status: Status; summary: string[]; help: string; message?: string; body: ReactNode; dirty?: boolean }

interface Ctx {
  get(p: YamlPath): unknown;
  set(p: YamlPath, v: unknown): void;
  edit(e: YamlEdit[]): void;
  /** 그 칸에 사용자가 단 YAML 주석(불러온 문서면 원문 위치·확신도) */
  note(p: YamlPath): string | undefined;
  err(key: string): string | undefined;
  select(key: string): void;
  /** 산출방법서의 식 한 덩이를 고친다(조건의 formulas 로) · 되돌린다 */
  setFormula(f: FormulaSpec, text: string): void;
  resetFormula(f: FormulaSpec): void;
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
  ["incidence", "진단형 (최초발생)", "발생 시 정액 지급 후 그 담보 소멸 — 2대질병·3대질병·암 등"],
  ["death", "사망형", "사망 시 지급(종신·정기). 탈퇴 사유 전부에 같은 보험금"],
  ["recurring", "일당형 (반복지급)", "입원 1일당 지급. 급부 위험률 자리에 연간 기대 입원일수"],
  ["other", "기타·생존형", "생존 시 지급(축하금·만기환급금) 등 — 지급 시점을 적는다"],
];
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
  const box = <span className="flex min-w-0 items-center gap-1">{input}{unit && <span className="fld-unit">{unit}</span>}</span>;
  if (bare) return <span data-path={key} className="min-w-0">{box}</span>;
  const note = f.note(p);
  return (
    <label data-path={key} className={`fld ${wide ? "col-span-2" : ""}`}>
      <span className="fld-label">{label}</span>
      {box}
      {bad ? <span className="fld-err">{bad}</span> : hint ? <span className="fld-hint">{hint}</span> : null}
      {note && <span className="fld-note"># {note}</span>}
    </label>
  );
}

function Sel({ p, label, options, hint, wide, onPick }: { p: YamlPath; label: string; options: [string | number, string][]; hint?: ReactNode; wide?: boolean; onPick?: (v: string | number) => YamlEdit[] }) {
  const f = useForm();
  const key = pathKey(p), cur = str(f.get(p));
  const opts: [string | number, string][] = cur === "" || options.some(([o]) => String(o) === cur) ? options : [...options, [cur, `${cur} (지금 값)`]];
  return (
    <label data-path={key} className={`fld ${wide ? "col-span-2" : ""}`}>
      <span className="fld-label">{label}</span>
      <select className="inp" value={cur} onFocus={() => f.select(key)}
        onChange={(e) => { const v = opts.find(([o]) => String(o) === e.target.value)?.[0] ?? e.target.value; if (onPick) f.edit(onPick(v)); else f.set(p, v === "" ? undefined : v); }}>
        {!options.some(([o]) => o === "") && <option value="">—</option>}
        {opts.map(([o, l]) => <option key={String(o)} value={String(o)}>{l}</option>)}
      </select>
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

function Card({ c, index, open, onToggle }: { c: CardDef; index: number; open: boolean; onToggle: () => void }) {
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
    <div data-path={key} className="formula-card">
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

/**
 * M06 보험금 — 담보마다 유지자수 l 에서 시작한다.
 * l 은 M05 에서 정한 집단의 것을 **그대로 가져온다**(탈퇴 사유가 같으면 같은 집단) — 여기서 다시 정하지 않고 어느 집단인지만 밝힌다.
 */
function PvbBody({ models, formulas, show, onGroup }: { models: BenefitModel[]; formulas: FormulaSpec[]; show: boolean; onGroup: (id: string) => void }) {
  const [open, setOpen] = useState(0);
  if (!models.length) return <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">담보가 없습니다 — 위 [보장] 카드에서 담보를 먼저 더하세요.</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        담보마다 <b>유지자수 l</b> → <b>지급자수 d</b> → 그 현가 <b>C</b> → 누계 <b>M</b> → <b>보험금 현가 PVB</b> 순으로 냅니다.
        l 은 M05 에서 정한 집단의 것을 그대로 씁니다 — 담보의 탈퇴 사유가 같으면 같은 l 입니다.
      </p>
      {models.map((mo, i) => {
        const keep = mo.group.lines.filter((l) => /^(l_x|Q_|l_\{x\+t\+1\})/.test(l));
        return (
          <Fold key={mo.b.id} open={open === i} onToggle={() => setOpen(open === i ? -1 : i)}
            title={<>{i + 1}. {mo.b.name}</>} chips={[`집단: ${mo.group.label}`, mo.b.waitDays ? `면책 ${mo.b.waitDays}일` : undefined, krw(mo.b.amount)]}>
            <div className="lx-from">
              <p>
                유지자수 <b>l</b> 은 M05 의 집단 <b>“{mo.group.label}”</b> 에서 가져옵니다
                {mo.group.benefitIdx.length > 1 && <> (이 집단을 쓰는 담보 {mo.group.benefitIdx.length}개)</>}.
                <button type="button" className="pane-tool ml-1" onClick={() => onGroup(mo.group.id)}>M05 에서 보기</button>
              </p>
              {show && <div className="mt-1 space-y-0.5 font-mono text-[11.5px] leading-5 text-[#475569]">
                {keep.map((l, k) => <div key={k} dangerouslySetInnerHTML={{ __html: subSup(l) }} />)}
              </div>}
            </div>
            {show && (
              <div className="formula-card">
                <p className="text-[12.5px] font-semibold text-[#334155]">지급자수 <span className="text-muted-foreground">— 문서에는 급부 현가 C 식에 함께 적힙니다</span></p>
                <div className="mt-1 font-mono text-[11.5px] leading-5 text-[#475569]" dangerouslySetInnerHTML={{ __html: subSup(mo.payout) }} />
              </div>
            )}
            <Formulas items={formulas.filter((f) => f.key === `benefit:${mo.b.id}`)} show={show} />
          </Fold>
        );
      })}
    </div>
  );
}

// ── 카드 본문 ────────────────────────────────────────────────────────────────
const PAY_FREQS = ["월납", "2개월납", "3개월납", "6개월납", "연납", "일시납"];
function ProductBody() {
  const f = useForm();
  const terms = list(f.get(["product", "terms"]));
  const freqs = ((f.get(["product", "payFreqs"]) as unknown[] | undefined) ?? []).map(String);
  const types = (f.get(["product", "types"]) as unknown[] | undefined) ?? [];
  const female = terms.some((r) => str(r.ageF));
  const setFreq = (x: string, on: boolean) => {
    const next = [...PAY_FREQS.filter((k) => (k === x ? on : freqs.includes(k))), ...freqs.filter((k) => !PAY_FREQS.includes(k))];
    f.set(["product", "payFreqs"], next.length ? next : undefined);
  };
  return (
    <div className="space-y-3">
      <Grid>
        <F p={["meta", "productName"]} label="상품 이름" wide placeholder="예: 2대질병 진단보험" />
        <F p={["meta", "insurer"]} label="회사" />
        <F p={["meta", "kind"]} label="종류" dl="dl-kind" placeholder="표준형(완전 환급)" />
        <F p={["meta", "version"]} label="판" />
        <F p={["meta", "date"]} label="작성일" placeholder="비우면 오늘" />
        <F p={["meta", "note"]} label="비고" kind="area" wide />
      </Grid>
      <div data-path="product" className="sub space-y-3">
        <p className="sub-title">가입 조건 <span>판매 범위(정보) — 산출방법서 개요에 싣습니다. 계산할 계약 한 점(성별·나이·기간·금액)은 자유설계보험 M02 계약정보에서 정합니다.</span></p>
        <Grid>
          <F p={["product", "category"]} label="보험의 종류" dl="dl-category" placeholder="예: 생명보험 / 종신" />
          <F p={["product", "renewal"]} label="갱신" dl="dl-renewal" placeholder="예: 비갱신형" />
          <F p={["product", "sumLimit"]} label="보험가입금액 한도" wide placeholder="예: 1천만원 ~ 10억원" />
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
        <div data-path="product.terms">
          <p className="fld-label">보험기간 · 보험료 납입기간 · 가입나이</p>
          <div className="term-grid mt-1 text-[11px] text-muted-foreground"><span>구분</span><span>보험기간</span><span>납입기간</span><span>{female ? "가입나이(남)" : "가입나이"}</span><span>가입나이(여)</span><span /></div>
          {terms.map((_, i) => (
            <div key={i} data-path={`product.terms[${i}]`} className="term-grid mt-1">
              <F p={["product", "terms", i, "label"]} label="구분" bare placeholder="(전체)" />
              <F p={["product", "terms", i, "term"]} label="보험기간" bare dl="dl-term" placeholder="80세만기" />
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

function RatesBody({ rates, used, tableNote, onLibrary }: { rates: RateItem[]; used: (id: string) => string[]; tableNote: (id: string) => string | undefined; onLibrary: () => void }) {
  const f = useForm();
  const remove = (i: number) => {
    const who = used(rates[i].id);
    if (who.length && !window.confirm(`${who.join(", ")} 담보가 이 위험률을 씁니다. 지울까요?`)) return;
    f.edit([{ path: ["rates", i] }]);
  };
  return (
    <div className="space-y-2">
      {rates.map((r, i) => (
        <div key={i} data-path={`rates[${i}]`} className="sub">
          <div className="flex items-center gap-2">
            <span className="chip" title="담보가 이 위험률을 가리키는 이름(id) — YAML 탭에서 바꿉니다">{r.id}</span>
            <F p={["rates", i, "name"]} label="이름" bare placeholder="위험률 이름" />
            <Remove onClick={() => remove(i)} />
          </div>
          <div className="mt-2">
            <Grid>
              <Sel p={["rates", i, "role"]} label="유형" options={Object.entries(RATE_ROLE_LABEL)} />
              <F p={["rates", i, "adjustment"]} label="보정" placeholder="예: × 연령전환계수" />
              <F p={["rates", i, "source"]} label="근거·출처" wide placeholder="예: 보험개발원 제7회 경험생명표 사망률" />
            </Grid>
          </div>
          <p className={`mt-1 text-[11px] ${tableNote(r.id) ? "text-primary" : "text-muted-foreground"}`}>{tableNote(r.id) ?? "표 없음 — 아래 [위험률 표]에서 열을 이 위험률에 이으면 값 표가 붙습니다"}</p>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Add onClick={() => f.edit([{ path: ["rates"], add: true, value: { id: newRateId("incidence", rates.map((r) => r.id)), name: "새 위험률", role: "incidence" } }])}>＋ 위험률</Add>
        <Add onClick={onLibrary}>＋ 기본 위험률 모음에서 고르기</Add>
      </div>
    </div>
  );
}

/**
 * M05 탈퇴자·유지자·납입자 — 집단마다 유지자수 l 과 납입자수 l′ 를 정한다.
 * 집단은 따로 적는 항목이 아니라 "탈퇴 사유가 같은 담보들"이다: 여기서 탈퇴 사유를 고치면 그 집단을 쓰는 담보들이 함께 바뀌고,
 * 담보(B01)에서 집단을 바꾸면 그 담보만 옮겨 간다. 뒤 카드(보험금 현가)는 여기서 정한 l 을 가져다 쓴다.
 */
function GroupsBody({ groups, rates, spec, formulas, show }: { groups: GroupModel[]; rates: RateItem[]; spec: MethodSpec; formulas: FormulaSpec[]; show: boolean }) {
  const f = useForm();
  const [open, setOpen] = useState(0);
  const waiverIds = ((f.get(["basis", "waiverRateIds"]) as unknown[] | undefined) ?? []).map(String);
  const waiverOn = f.get(["basis", "waiver"]) === true;
  /**
   * 납입면제 사유 고르기 — 유형이 '납입면제'인 위험률은 그 자체로 사유이고, 다른 유형(예: 암 발생률 — 암진단 급부이면서 사망 담보의 납입면제 사유)은
   * 유형을 그대로 두고 basis.waiverRateIds 에 넣는다. 그 집단의 탈퇴 사유이기도 한 사유는 식이 알아서 다시 빼지 않는다.
   */
  const toggleWaiver = (i: number, v: boolean) => {
    const r = rates[i];
    if (r.role === "waiver") { if (!v) { const back = guessRole(r.name); f.edit([{ path: ["rates", i, "role"], value: back === "waiver" ? "other" : back }]); } return; }
    const next = rates.filter((x) => x.role !== "waiver" && (x.id === r.id ? v : waiverIds.includes(x.id))).map((x) => x.id);
    f.set(["basis", "waiverRateIds"], next.length ? next : undefined);
  };
  const setExits = (g: GroupModel, id: string, on: boolean) => {
    const ids = rates.map((r) => r.id).filter((x) => (x === id ? on : g.exits.some((e) => e.id === x)));
    f.edit(g.benefitIdx.map((i) => ({ path: ["benefits", i, "exitRateIds"], value: ids })));
  };
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        보험금·보험료의 바탕이 되는 사람 수입니다. 기준 인원 10만 명에서 <b>탈퇴 사유</b>가 생긴 만큼 줄여 <b>유지자수 l</b> 을,
        거기에 <b>납입만 면제되는 사유</b>까지 빼서 <b>납입자수 l′</b> 를 만듭니다. 탈퇴 사유가 같은 담보는 l·l′ 가 같으므로 한 집단으로 묶습니다.
      </p>
      {!groups.length && <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">담보가 없습니다 — 아래 [보장] 카드에서 담보를 먼저 더하세요.</p>}
      {groups.map((g, gi) => (
        <Fold key={g.id} open={open === gi} onToggle={() => setOpen(open === gi ? -1 : gi)}
          title={<>집단 {gi + 1} · {g.label}</>} chips={[`담보 ${g.benefitIdx.length}`, g.waivers.length ? `납입면제 ${g.waivers.length}` : "납입자수 = 유지자수"]}>
          <div data-path={g.benefitIdx.map((i) => `benefits[${i}].exitRateIds`).join("|")}>
            <p className="fld-label">탈퇴 위험률 — 이 집단을 줄이는 사유 전부</p>
            <p className="fld-hint mb-1">최초발생(진단)은 넣고, 반복지급(일당)은 넣지 않습니다. 고치면 이 집단의 담보 {g.benefitIdx.map((i) => `“${spec.benefits[i]?.name ?? i}”`).join(" · ")} 가 함께 바뀝니다.</p>
            <div className="flex flex-wrap gap-2">
              {rates.map((r) => (
                <label key={r.id} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs">
                  <input type="checkbox" className="accent-[var(--primary)]" checked={g.exits.some((e) => e.id === r.id)}
                    onFocus={() => f.select(`benefits[${g.benefitIdx[0]}].exitRateIds`)} onChange={(e) => setExits(g, r.id, e.target.checked)} />
                  {r.name}
                </label>
              ))}
            </div>
          </div>
          <Formulas items={formulas.filter((x) => x.key === `group:${g.id}`)} show={show} />
        </Fold>
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

/** B01 보장 — 담보를 한 카드에서 더하고 고친다. 유지자수는 앞 카드(M05)의 집단에서 가져온다 */
function BenefitsBody({ bens, rates, groups, spec, addBen }: { bens: Obj[]; rates: RateItem[]; groups: GroupModel[]; spec: MethodSpec; addBen: (role: string) => void }) {
  const f = useForm();
  const [open, setOpen] = useState(0);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= bens.length) return;
    f.edit([{ path: ["benefits", i], value: bens[j] }, { path: ["benefits", j], value: bens[i] }]);
    setOpen(j);
  };
  const copy = (i: number) => {
    const src = JSON.parse(JSON.stringify(bens[i])) as Obj;
    src.id = uniqueId("b", bens.map((x) => str(x.id)));
    src.name = `${str(bens[i].name)} (복사)`;
    f.edit([{ path: ["benefits"], add: true, value: src }]);
    setOpen(bens.length);
  };
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        보험금을 지급하는 담보들입니다. 담보마다 보장금액·보장 종료 나이·면책기간과 급부 위험률을 정하고, 유지자수는 앞의 <b>집단</b>에서 가져옵니다.
        담보를 더하면 산출방법서의 2. 담보 표와 5. 보험금의 현가 절이 함께 늘어납니다.
      </p>
      {bens.map((x, i) => {
        const s = spec.benefits[i], g = groups.find((y) => y.benefitIdx.includes(i));
        return (
          <Fold key={i} open={open === i} onToggle={() => setOpen(open === i ? -1 : i)}
            title={<>{i + 1}. {str(x.name) || `담보 ${i + 1}`}</>}
            chips={[BEN_ROLES.find(([k]) => k === str(x.role))?.[1], s?.amount !== undefined ? `${krw(s.amount)}${s.role === "recurring" ? "/일" : ""}` : "금액 없음",
              s?.endAge ? `~${s.endAge}세` : undefined, s?.waitDays ? `면책 ${s.waitDays}일` : undefined, g && `집단: ${g.label}`]}
            tools={<>
              <button type="button" className="card-icon" onClick={() => move(i, -1)} title="위로">▲</button>
              <button type="button" className="card-icon" onClick={() => move(i, 1)} title="아래로">▼</button>
              <button type="button" className="card-icon" onClick={() => copy(i)} title="이 담보를 복사해 새 담보로">복사</button>
              <Remove title="담보 삭제" onClick={() => { if (window.confirm(`담보 "${str(x.name)}" 를 지울까요?`)) f.edit([{ path: ["benefits", i] }]); }} />
            </>}>
            <BenefitBody i={i} rates={rates} groups={groups} />
          </Fold>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-2">
        <span className="text-xs text-muted-foreground">담보 추가</span>
        {BEN_ROLES.map(([k, l, h]) => <button key={k} type="button" className="btn" title={h} onClick={() => { addBen(k); setOpen(bens.length); }}>＋ {l}</button>)}
      </div>
    </div>
  );
}

function BenefitBody({ i, rates, groups }: { i: number; rates: RateItem[]; groups: GroupModel[] }) {
  const f = useForm();
  const base: YamlPath = ["benefits", i];
  const at = (k: string | number, ...rest: (string | number)[]): YamlPath => [...base, k, ...rest];
  const role = str(f.get(at("role"))) || "other";
  const exits = (f.get(at("exitRateIds")) as unknown[] | undefined)?.map(String) ?? [];
  const amount = num(f.get(at("amount"))), wait = num(f.get(at("waitDays")));
  const steps = list(f.get(at("steps"))), points = list(f.get(at("points")));
  const age = 40, end = num(f.get(at("endAge"))) ?? 80;       // 구간 첫 줄의 시작 나이 기본값
  const mine = groups.find((g) => g.benefitIdx.includes(i));
  const toggleExit = (id: string, on: boolean) => f.set(at("exitRateIds"), rates.map((r) => r.id).filter((x) => (x === id ? on : exits.includes(x))));
  return (
    <div className="space-y-3">
      <Grid>
        <F p={at("name")} label="담보 이름" wide />
        <Sel p={at("role")} label="급부 유형" options={BEN_ROLES.map(([k, l]) => [k, l])} hint={BEN_ROLES.find(([k]) => k === role)?.[2]}
          onPick={(v) => { const id = suggestRate(rates, String(v)); return [{ path: at("role"), value: v }, { path: at("rateId"), value: id }, { path: at("exitRateIds"), value: autoExit(rates, String(v), id) }]; }} />
        <F p={at("unit")} label="계약 단위" dl="dl-unit" placeholder="주계약" />
        <F p={at("trigger")} label="지급 사유" wide placeholder="예: 진단 확정 시" />
        <F p={at("amount")} label="보장금액" kind="num" unit={role === "recurring" ? "원/일" : "원"} hint={krw(amount)} />
        <F p={at("endAge")} label="보장 종료 나이" kind="num" unit="세" />
        <F p={at("waitDays")} label="면책기간" kind="num" unit="일" hint={wait ? `첫해 보험금은 (1 − ${waitMonths(wait)}/12) 배 — 약 ${waitMonths(wait)}개월` : "없음"} />
        <Sel p={at("rateId")} label="급부 위험률" options={[["", role === "death" ? "— 탈퇴 사유 전부 (사망형)" : "— 없음"], ...rates.map((r): [string, string] => [r.id, `${r.name} (${RATE_ROLE_LABEL[r.role]})`])]}
          onPick={(v) => [{ path: at("rateId"), value: v === "" ? undefined : v }, { path: at("exitRateIds"), value: autoExit(rates, role, v === "" ? undefined : String(v)) }]} />
      </Grid>
      <div data-path={`benefits[${i}].exitRateIds`}>
        <p className="fld-label">유지자수 집단 (탈퇴 위험률)</p>
        <p className="fld-hint mb-1">M05 에서 정한 집단 가운데 하나를 고르거나, 아래에서 이 담보의 탈퇴 사유를 직접 고릅니다(새 집단이 생깁니다).</p>
        <select className="inp mb-1.5" value={mine?.id ?? ""} onFocus={() => f.select(`benefits[${i}].exitRateIds`)}
          onChange={(e) => { const g = groups.find((y) => y.id === e.target.value); if (g) f.set(at("exitRateIds"), g.exits.map((r) => r.id)); }}>
          {!mine && <option value="">—</option>}
          {groups.map((g) => <option key={g.id} value={g.id}>{g.label}{g.benefitIdx.length > 1 ? ` (담보 ${g.benefitIdx.length}개)` : ""}</option>)}
        </select>
        <div className="flex flex-wrap gap-2">
          {rates.map((r) => (
            <label key={r.id} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs">
              <input type="checkbox" className="accent-[var(--primary)]" checked={exits.includes(r.id)} onFocus={() => f.select(`benefits[${i}].exitRateIds`)} onChange={(e) => toggleExit(r.id, e.target.checked)} />
              {r.name}
            </label>
          ))}
          {!rates.length && <span className="text-xs text-muted-foreground">M04 에서 위험률을 먼저 더하세요</span>}
        </div>
      </div>
      <div data-path={`benefits[${i}].steps`} className="border-t border-border pt-2">
        <div className="flex items-center justify-between"><p className="fld-label">보험금 증액·감액 (연령 구간 배수)</p>
          <button type="button" className="btn" onClick={() => f.edit([{ path: at("steps"), add: true, value: { fromAge: steps.length ? Math.min((num(steps[steps.length - 1].toAge) ?? age) + 1, end) : age, toAge: end, multiple: steps.length ? 0.5 : 1 } }])}>＋ 구간</button></div>
        {!steps.length && <p className="fld-hint">구간이 없으면 전 기간 1.0배. 겹치면 뒤 구간이 이기고, 구간을 두면 덮이지 않은 나이는 0배입니다.</p>}
        {steps.map((_, k) => (
          <div key={k} className="mt-1 flex items-center gap-1.5 text-xs">
            <F p={at("steps", k, "fromAge")} label="시작 나이" kind="num" bare /> <span>~</span>
            <F p={at("steps", k, "toAge")} label="끝 나이" kind="num" unit="세" bare />
            <F p={at("steps", k, "multiple")} label="배수" kind="num" unit="배" bare />
            <Remove onClick={() => f.edit([{ path: at("steps", k) }])} />
          </div>
        ))}
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

function NotesBody({ formulas, show }: { formulas: FormulaSpec[]; show: boolean }) {
  return (
    <div className="space-y-3">
      <Grid><F p={["surrender", "deductionYears"]} label="해약공제 기간" kind="num" unit="년" hint="납입기간과 이 기간 중 짧은 쪽에 걸쳐 균등하게 줄어듭니다" /></Grid>
      <StringList p={["surrender", "notes"]} label="해지환급금 관련 사항" placeholder="예: 해약공제 기준 신계약비는 …" />
      <StringList p={["reserve", "notes"]} label="책임준비금 관련 사항" placeholder="예: 연중 보간은 하지 않고 …" />
      <Formulas items={formulas} show={show} hint="책임준비금·해지환급금 식입니다. 이 앱은 값을 계산하지 않고 식만 싣습니다 — 계산은 자유설계보험이 합니다." />
    </div>
  );
}

/** M08 따로 적는 식 — 자동 식을 덮지 않는, 사용자가 새로 더한 식만 다룬다 */
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
      <p className="fld-hint">자동으로 만든 식에 더해 적을 식입니다. 표준 식을 고치는 것은 그 단계의 카드(집단·보험료 현가·보험금 현가·보험료)에서 합니다. 첨자는 <code>l_{"{x+t}"}</code> · <code>v^t</code> 처럼 적습니다.</p>
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

// ── 시산 — 식대로 계산해 본 값 ────────────────────────────────────────────────
/**
 * 지금 조건과 **지금 산출방법서에 실린 식**으로 계산한 보험료. 식을 고치면 여기 값이 바로 바뀐다 — 식이 계산에 쓰인다는 증거다.
 * 계약 한 점(가입나이·납입기간·주기)은 산출방법서의 정보가 아니므로 조건에 저장하지 않는다(화면에서만).
 */
function CalcPanel({ calc, on, set, cols, onSheet }: { calc: CalcResult; on: CalcContract; set: (c: CalcContract) => void; cols: ("pvb" | "nStar" | "net" | "gross")[]; onSheet: () => void }) {
  const put = (k: keyof CalcContract, v: string) => set({ ...on, [k]: k === "sex" ? (v as Sex) : Number(v) });
  return (
    <div className="calc-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-[#334155]">시산</span>
        <select className="inp w-auto py-0.5 text-xs" value={on.sex ?? "M"} onChange={(e) => put("sex", e.target.value)}><option value="M">남</option><option value="F">여</option></select>
        <select className="inp w-auto py-0.5 text-xs" value={on.age} onChange={(e) => put("age", e.target.value)}>{[0, 20, 30, 40, 50, 60].map((a) => <option key={a} value={a}>{a}세</option>)}</select>
        <select className="inp w-auto py-0.5 text-xs" value={on.payYears} onChange={(e) => put("payYears", e.target.value)}>{[5, 10, 15, 20, 30].map((a) => <option key={a} value={a}>{a}년납</option>)}</select>
        <select className="inp w-auto py-0.5 text-xs" value={on.freq} onChange={(e) => put("freq", e.target.value)}>{[[12, "월납"], [4, "3개월납"], [2, "6개월납"], [1, "연납"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <span className="fld-hint">조건에 저장하지 않습니다 — 식이 맞는지 보기 위한 값입니다</span>
        <button type="button" className="btn ml-auto" onClick={onSheet} title="한 해 한 줄의 표로 계산 과정을 봅니다">＝ 보험료 계산</button>
      </div>
      {calc.missingRates.length > 0 && <p className="mt-1 text-[11.5px] text-amber-700">값 표가 없어 0 으로 둔 위험률: {calc.missingRates.join(", ")} — [위험률 표] 에서 열을 이으세요</p>}
      <table className="calc-table mt-1.5">
        <thead><tr><th>담보</th><th>기간</th>
          {cols.includes("pvb") && <th>보험금 현가 PVB</th>}
          {cols.includes("nStar") && <th>납입기수 N*</th>}
          {cols.includes("net") && <th>순보험료 10만원당</th>}
          {cols.includes("gross") && <th>영업보험료 10만원당</th>}
          {cols.includes("gross") && <th>담보 보험료</th>}
        </tr></thead>
        <tbody>
          {calc.benefits.map((b) => (
            <tr key={b.id}>
              <td>{b.name}{b.error && <span className="fld-err"> — {b.error}</span>}</td>
              <td className="num">{b.n}년 / {b.m}년납</td>
              {cols.includes("pvb") && <td className="num">{won0(b.pvb)}</td>}
              {cols.includes("nStar") && <td className="num">{won0(b.nStar)}</td>}
              {cols.includes("net") && <td className="num">{won0(b.net * 1e5)}</td>}
              {cols.includes("gross") && <td className="num">{won0(b.per100k)}</td>}
              {cols.includes("gross") && <td className="num">{won0(b.premium)} 원</td>}
            </tr>
          ))}
          {calc.benefits.length > 1 && cols.includes("gross") && (
            <tr className="calc-sum"><td colSpan={4}>합계</td><td className="num">{won0(calc.benefits.reduce((s, b) => s + b.per100k, 0))}</td><td className="num">{won0(calc.premium)} 원</td></tr>
          )}
          {calc.benefits.length > 1 && cols.includes("pvb") && !cols.includes("gross") && (
            <tr className="calc-sum"><td colSpan={2}>보험금 현가의 합</td><td className="num">{won0(calc.benefits.reduce((s, b) => s + b.pvb, 0))}</td><td /></tr>
          )}
        </tbody>
      </table>
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
  /** 카드에 식을 보일지 (머리의 [수식] 단추) */
  showFormulas: boolean;
  /** 보험료 계산 화면(스프레드시트)을 연다 */
  onPremiumSheet: () => void;
}

export default function ConditionForm({ yaml, spec, errors, onEdit, highlight, changed, onSelect, open, setOpen, tableNote, noTableIds, onLibrary, onShowYaml, calc: calcOn, setCalc: setCalcOn, showFormulas, onPremiumSheet }: Props) {
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
  /** M06 에서 "M05 에서 보기" — 그 집단을 펼쳐 비춘다 */
  const onGroupCard = (gid: string) => { setOpen(() => ["M05"]); onSelect([`formula:group.${gid}`]); };
  const byKey = (re: RegExp) => full.formulas.filter((f) => f.key && re.test(f.key));
  /** 조건의 formulas 중 자동 식을 덮은 것(카드에서 고친 식)이 아닌 것 — M08 이 다룬다 */
  const autoKeys = new Set(full.formulas.filter((f) => f.key).map((f) => `${f.section}|${f.label}`));
  const ownIdxs = list(raw.formulas).map((f, i) => ({ f, i })).filter(({ f }) => !autoKeys.has(`${str(f.section)}|${str(f.label)}`)).map(({ i }) => i);

  const formulaAt = (f: FormulaSpec) => list(raw.formulas).findIndex((x) => str(x.section) === f.section && str(x.label) === f.label);
  const ctx: Ctx = {
    get: (p) => getIn(raw, p),
    set: (p, v) => onEdit([{ path: p, value: v }]),
    edit: onEdit,
    note: (p) => { const n = doc.getIn(p, true); return isScalar(n) && n.comment ? n.comment.trim() : undefined; },
    err: (key) => general.find((m) => m.startsWith(`${key} `) || m.startsWith(`${key}:`)),
    select: (key) => onSelect([key]),
    setFormula: (f, text) => {
      const i = formulaAt(f);
      if (i >= 0) onEdit([{ path: ["formulas", i, "text"], value: text }]);
      else onEdit([{ path: ["formulas"], add: true, value: { section: f.section, label: f.label, text, ...(f.note ? { note: f.note } : {}) } }]);
    },
    resetFormula: (f) => { const i = formulaAt(f); if (i >= 0) onEdit([{ path: ["formulas", i] }]); },
  };

  const m = (raw.meta ?? {}) as Obj, b = (raw.basis ?? {}) as Obj;
  const rates: RateItem[] = list(raw.rates).map((r, i) => {
    const id = str(r.id) || `r${i + 1}`;
    const role = (Object.keys(RATE_ROLE_LABEL).includes(str(r.role)) ? str(r.role) : spec.rates.find((x) => x.id === id)?.role ?? "other") as RateRole;
    return { id, name: str(r.name) || `위험률 ${i + 1}`, role };
  });
  const bens = list(raw.benefits);
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

  const errM01 = bad(/^meta\.|^contract/), errM03 = bad(/^basis\.(?!waiver)|해지율/), errM06 = bad(/^사업비/);
  const cards: CardDef[] = [
    { id: "M01", code: "M01", title: "상품 기본정보", paths: ["meta", "product"], status: status(errM01, !!str(m.productName)), message: errM01,
      summary: [str(m.productName) || "이름 없음", str(m.kind), sp.product?.terms?.length ? `가입 조건 ${sp.product.terms.length}행` : "",
        sp.product?.payFreqs?.join("·") ?? ""],
      help: "상품 이름·종류·작성일과 가입 조건(보험의 종류·보험종목·보험기간·납입기간·가입나이·납입주기·가입금액 한도·갱신)입니다. 가입 조건은 사업방법서의 판매 범위 표처럼 적어 산출방법서 개요에 싣는 정보입니다. 보험료를 계산할 계약 한 점(M02 계약정보 — 성별·가입나이·보험기간·납입기간·납입주기·가입금액)은 산출방법서의 정보가 아니어서 여기에 두지 않고, 자유설계보험 상품 만들기에서 기본값으로 시작해 고칩니다.",
      body: <ProductBody /> },
    { id: "M03", code: "M03", title: "이자율·저해지", paths: ["basis.interest", "basis.standardInterest", "basis.minGuaranteed", "basis.averagePublished", "basis.lapse", "basis.lowRatio"],
      status: status(errM03, sp.basis.interest !== undefined), message: errM03,
      summary: [sp.basis.interest !== undefined ? `i = ${pct(sp.basis.interest)}` : "", sp.basis.standardInterest !== undefined ? `표준 ${pct(sp.basis.standardInterest)}` : "",
        ...(sp.basis.lapse?.length ? [`해지율 ${sp.basis.lapse.map((l) => pct(l.rate)).join("·")}`, sp.basis.lowRatio !== undefined ? (sp.basis.lowRatio === 0 ? "무해지" : `환급률 ${pct(sp.basis.lowRatio)}`) : ""] : [])],
      help: "적용이율은 보험료·책임준비금에, 표준이율은 표준책임준비금과 해약공제 기준 신계약비에 씁니다. 저해지·무해지형은 적용해지율과 환급률을 넣습니다.", body: <BasisBody /> },
    { id: "M04", code: "M04", title: "위험률", paths: ["rates"], status: rates.length ? (noTable.length ? "editing" : "done") : "editing",
      message: noTable.length ? `값 표가 없는 위험률: ${noTable.join(", ")} — 아래 [위험률 표]에 같은 이름의 열을 붙여넣으면 이어집니다(계산 앱에서는 그때까지 0). 위험률을 더하면 표에 빈 열이 생깁니다.` : undefined,
      summary: [...rates.slice(0, 4).map((r) => r.name), rates.length > 4 ? `외 ${rates.length - 4}` : "", sp.rates.some((r) => r.table) ? `표 ${sp.rates.filter((r) => r.table).length}개 연결` : "", noTable.length ? `표 없음 ${noTable.length}` : ""],
      help: "위험률마다 이름·유형(사망·최초발생·반복지급·납입면제·해지·기타)·근거를 적습니다. 유형이 담보·납입면제와의 연결을 정합니다. 값 표는 아래 [위험률 표]에서 이어집니다 — 표를 올리면 같은 이름의 열이 자동으로 이어지고, 여기서 위험률을 더하면 표에 빈 열이 생깁니다. 이 표가 산출방법서 별첨과 자유설계보험 계산에 그대로 쓰입니다.",
      body: <RatesBody rates={rates} used={used} tableNote={tableNote} onLibrary={onLibrary} /> },
    { id: "B01", code: "B01", title: "보장 (담보)", paths: ["benefits"], status: status(benErr, bens.length > 0 && bens.every((x) => num(x.amount) !== undefined)), message: benErr,
      summary: [`담보 ${bens.length}개`, ...sp.benefits.slice(0, 3).map((x) => `${x.name} ${krw(x.amount)}`), sp.benefits.some((x) => x.waitDays) ? "면책 있음" : ""],
      help: "보험금을 지급하는 담보를 한 카드에서 더하고 고칩니다. 담보마다 보장금액·보장 종료 나이·면책기간·급부 위험률을 정하고, 유지자수는 M05 의 집단에서 가져옵니다. 담보를 복사해 비슷한 보장을 빨리 더할 수 있습니다.",
      body: <BenefitsBody bens={bens} rates={rates} groups={groups} spec={sp} addBen={(role) => addBen(role)} /> },
    { id: "M05", code: "M05", title: "보험료 — 유지자수·납입자수 (l · l′) · 보험료의 현가", paths: ["basis.waiver", "basis.waiverRateIds", "formula:group", "formula:pv"],
      status: waiverOff ? "error" : groups.length ? "done" : "editing",
      message: waiverOff ? "추가 납입면제 사유를 켰지만 고른 위험률이 없습니다. 아래에서 고르세요." : undefined,
      summary: [`집단 ${groups.length}개`, ...groups.slice(0, 2).map((g) => g.label), b.waiver === true ? `납입면제: ${waiverRates.map((r) => r.name).join(" · ") || "없음"}` : "납입자수 = 유지자수",
        "D′ · N′ · N*", editChip(edited(/^(group|pv):/))],
      help: "보험료를 내는 사람 쪽입니다. 기준 인원 10만 명에서 탈퇴 사유가 생긴 만큼 줄여 유지자수 l 을, 납입만 면제되는 사유까지 빼서 납입자수 l′ 를 만들고, 이를 현재 가치로 옮겨(D · D′) 누계(N · N′)와 납입기수 N* 를 냅니다. 탈퇴 사유가 같은 담보는 l·l′ 가 같으므로 한 집단으로 묶어 식을 한 번만 싣습니다. 식을 고치면 산출방법서와 계산에 함께 반영됩니다.",
      body: <><GroupsBody groups={groups} rates={rates} spec={sp} formulas={full.formulas} show={showFormulas} />
        <div className="border-t border-border pt-2">
          <p className="fld-label mb-1">보험료의 현가 — 담보마다 같은 식(기간 n·m 만 다르다)</p>
          <Formulas items={byKey(/^pv:/)} show={showFormulas} />
        </div>
        <CalcPanel calc={calc} on={calcOn} set={setCalcOn} cols={["nStar"]} onSheet={onPremiumSheet} /></> },
    { id: "M06", code: "M06", title: "보험금 — 급부 집단(l) · 보험금의 현가 (C · M)", paths: ["formula:benefit"], status: bens.length ? "done" : "editing",
      summary: [`담보 ${bens.length}개`, "l → d → C → M → PVB", sp.benefits.some((x) => x.waitDays) ? "면책 반영" : "", editChip(edited(/^benefit:/))],
      help: "보험금을 받는 사람 쪽입니다. 담보마다 유지자수 l 에서 시작해 지급자수 d, 그 현가 C, 누계 M 을 거쳐 보험금 현가 PVB 를 냅니다. l 은 M05 에서 정한 집단의 것을 그대로 가져옵니다 — 그 담보의 탈퇴 사유가 M05 의 어느 집단과 같은지 아래에 적혀 있습니다. 면책기간·보장금액은 B01 에서 정하고 여기 식에 그대로 나타납니다.",
      body: <><PvbBody models={benefitModels(sp)} formulas={full.formulas} show={showFormulas} onGroup={onGroupCard} />
        <CalcPanel calc={calc} on={calcOn} set={setCalcOn} cols={["pvb"]} onSheet={onPremiumSheet} /></> },
    { id: "M07", code: "M07", title: "사업비", paths: ["expenses"], status: status(errM06, nExp > 0), message: errM06,
      summary: [`${nExp}줄`, sp.expenses.some((e) => /^(α_S|α_P|β_S|β_G)$/.test(e.symbol)) ? "산출방법서형" : ""],
      help: "산출방법서형은 α_S·α_P·β_S·β_G·β′·γ 를 씁니다. 보장기간이 20년보다 짧으면 α_P 는 n/20 배로 줄입니다. 이 값들이 다음 카드의 영업보험료 식에 그대로 들어갑니다.", body: <ExpenseBody count={nExp} /> },
    { id: "M08", code: "M08", title: "보험료의 계산 (P · G)", paths: ["formula:premium"], status: calc.errors.length ? "error" : "done",
      message: calc.errors.length ? `식으로 계산할 수 없습니다 — ${calc.errors[0]}` : undefined,
      summary: ["P · 기준연납 · G", calc.benefits.length ? `10만원당 ${won0(calc.benefits.reduce((s, x) => s + x.per100k, 0))}원` : "", editChip(edited(/^premium:/))],
      help: "보험금 현가를 납입기수로 나눠 순보험료 P 를 내고, 사업비를 얹어 영업보험료 G 를 냅니다. 10만원당 보험료에서 한 번만 반올림하고 담보 보험료 = 10만원당 × (보장금액 ÷ 10만) 으로 합니다. 아래 시산은 지금 식으로 바로 계산한 값이고, [보험료 계산] 을 누르면 한 해 한 줄의 표로 그 과정을 다 볼 수 있습니다.",
      body: <><Formulas items={byKey(/^premium:/)} show={showFormulas} />
        <CalcPanel calc={calc} on={calcOn} set={setCalcOn} cols={["pvb", "nStar", "net", "gross"]} onSheet={onPremiumSheet} /></> },
    { id: "M09", code: "M09", title: "책임준비금·해지환급금", paths: ["reserve", "surrender", "formula:reserve", "formula:surrender"], status: status(undefined, nNotes > 0 || num(sr.deductionYears) !== undefined, true),
      summary: [sp.surrender.deductionYears ? `해약공제 ${sp.surrender.deductionYears}년` : "", nNotes ? `문장 ${nNotes}` : "", editChip(edited(/^(reserve|surrender):/))],
      help: "해약공제 기간과 책임준비금·해지환급금 절에 넣을 문장입니다. 식은 조건에서 자동으로 만들고 여기서 고칠 수 있습니다.", body: <NotesBody formulas={byKey(/^(reserve|surrender):/)} show={showFormulas} /> },
    { id: "M10", code: "M10", title: "따로 적는 식", paths: ["formulas"], status: status(undefined, ownIdxs.length > 0, true),
      summary: [ownIdxs.length ? `식 ${ownIdxs.length}개` : "없음"],
      help: "표준 식 말고 따로 적을 식입니다(새 절도 만들 수 있습니다). 표준 식을 고치는 것은 그 단계의 카드에서 합니다 — 고친 식은 이 목록에 나타나지 않습니다.", body: <FormulasBody idxs={ownIdxs} /> },
  ];

  const touches = (paths: string[]) => changed.some((s) => paths.some((p) => under(s, p) || under(p, s)));
  for (const c of cards) c.dirty = touches(c.paths);

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
    const ids = cards.filter((x) => highlight.some((s) => x.paths.some((p) => under(s, p) || under(p, s)))).map((x) => x.id);
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
    top[0]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlight, open]);

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

  /** 한 번에 한 카드만 — 지금 보는 단계에 집중하고, 열면 산출방법서의 그 자리를 비춘다 */
  const toggle = (c: CardDef) => {
    const was = open.includes(c.id);
    setOpen(() => (was ? [] : [c.id]));
    if (!was) onSelect(c.paths);
  };
  function addBen(role: string) {
    const id = uniqueId("b", bens.map((x) => str(x.id))), rateId = suggestRate(rates, role);
    const value = Object.fromEntries(Object.entries({ id, name: `담보 ${bens.length + 1}`, role, amount: role === "recurring" ? 100000 : 30000000, endAge: 80, rateId, exitRateIds: autoExit(rates, role, rateId) })
      .filter(([, v]) => v !== undefined));
    onEdit([{ path: ["benefits"], add: true, value }]);
  }
  const extra = [list(raw.units).length ? `계약 단위(units) ${list(raw.units).length}개` : "", list(raw.sections).length ? `추가 절(sections) ${list(raw.sections).length}개` : ""].filter(Boolean);

  return (
    <FormCtx.Provider value={ctx}>
      <div ref={box} className="form-body thin-scroll">
        {cards.map((card, i) => (
          <Card key={card.id} c={card} index={i} open={open.includes(card.id)} onToggle={() => toggle(card)} />
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
      {dl("dl-paylist", ["전기납", "일시납", "10년납", "20년납", "30년납", "10·15·20년납", "10·20·30년납", "5·10·15·20년납"])}
      {dl("dl-agerange", ["만15세 ~ 60세", "만15세 ~ 65세", "만15세 ~ 70세", "만15세 ~ (80-납입기간)세", "0세 ~ 60세", "20세 ~ 60세"])}
      {dl("dl-unit", ["주계약", "특약1", "특약2"])}
      {dl("dl-group", ["계약체결비용", "계약관리비용", "수금비용"])}
      {dl("dl-symbol", ["α_S", "α_P", "β_S", "β_G", "β′", "γ", "α", "β"])}
      {dl("dl-basis", ["보험가입금액", "기준연납순보험료", "매년 보험가입금액", "영업보험료"])}
      {dl("dl-phase", ["초년도", "납입중", "납입후"])}
      {dl("dl-section", ["계산기수", "보험료의 계산", "책임준비금의 계산", "해지환급금의 계산"])}
    </>
  );
}
