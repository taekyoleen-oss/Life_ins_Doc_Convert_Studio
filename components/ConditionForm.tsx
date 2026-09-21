"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isMap, isScalar, parseDocument } from "yaml";
import { pathKey, pct, type YamlEdit, type YamlPath } from "@/lib/conditions/yaml";
import { matchBlocks, splitPaths, under } from "@/lib/conditions/link";
import { parseRate, parseTimes } from "@/lib/methoddoc/parse";
import { generateFormulas } from "@/lib/methoddoc/formulas";
import { subSup } from "@/lib/methoddoc/render";
import { RATE_ROLE_LABEL, type MethodSpec, type RateRole } from "@/lib/methoddoc/spec";
import { guessRole } from "@/lib/sheet";
import { EXPENSE_PRESET } from "@/lib/samples";
import { SECTION_OF } from "@/lib/snippets";
import { formulaHtml } from "./DocPreview";
import FormulaPalette from "./FormulaPalette";

/**
 * 조건 입력 화면 — YAML 을 몰라도 칸을 채워 조건을 만든다.
 * 자유설계보험(flexible_insurance) 빌더의 단계 카드와 같은 모양·코드(M01 상품 기본정보 … C01 담보 … M06 사업비)다.
 *
 * 따로 상태를 두지 않는다: 칸은 조건 파일(YAML)에서 읽고, 고치면 editYaml 로 그 칸만 파일에 쓴다.
 * 그래서 YAML 탭과 늘 같고, 사용자가 적은 주석·순서가 남는다. 칸의 경로(pathKey)는 산출방법서 블록 경로와 같아
 * 칸을 고르면 오른쪽에서 그 조건이 만든 곳이, 오른쪽을 고르면 여기서 그 칸이 표시된다.
 */

type Obj = Record<string, unknown>;
type Status = "done" | "editing" | "error" | "optional";
interface CardDef { id: string; code: string; title: string; paths: string[]; status: Status; summary: string[]; help: string; message?: string; body: ReactNode; benefit?: number }

interface Ctx {
  get(p: YamlPath): unknown;
  set(p: YamlPath, v: unknown): void;
  edit(e: YamlEdit[]): void;
  /** 그 칸에 사용자가 단 YAML 주석(불러온 문서면 원문 위치·확신도) */
  note(p: YamlPath): string | undefined;
  err(key: string): string | undefined;
  select(key: string): void;
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
const FREQS: [number, string][] = [[12, "월납"], [4, "3개월납"], [2, "6개월납"], [1, "연납"]];
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

function Card({ c, index, open, onToggle, move, remove }: { c: CardDef; index: number; open: boolean; onToggle: () => void; move?: (dir: -1 | 1) => void; remove?: () => void }) {
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
          </div>
          {!open && c.summary.some(Boolean) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {c.summary.filter(Boolean).map((t, i) => <span key={i} className="chip">{t}</span>)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button type="button" className={`card-icon ${help ? "text-primary" : ""}`} onClick={() => setHelp((v) => !v)} title="설명 보기">ⓘ</button>
          {move && <><button type="button" className="card-icon" onClick={() => move(-1)} title="위로">▲</button><button type="button" className="card-icon" onClick={() => move(1)} title="아래로">▼</button></>}
          {remove && <button type="button" className="card-icon hover:text-rose-700" onClick={remove} title="삭제">삭제</button>}
        </div>
        <button type="button" className="card-toggle" aria-expanded={open} onClick={(e) => { e.stopPropagation(); onToggle(); }}>{open ? "▾ 접기" : "▸ 펼치기"}</button>
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

// ── 카드 본문 ────────────────────────────────────────────────────────────────
function ProductBody() {
  return (
    <Grid>
      <F p={["meta", "productName"]} label="상품 이름" wide placeholder="예: 2대질병 진단보험" />
      <F p={["meta", "insurer"]} label="회사" />
      <F p={["meta", "kind"]} label="종류" dl="dl-kind" placeholder="표준형(완전 환급)" />
      <F p={["meta", "version"]} label="판" />
      <F p={["meta", "date"]} label="작성일" placeholder="비우면 오늘" />
      <F p={["meta", "note"]} label="비고" kind="area" wide />
    </Grid>
  );
}

function ContractBody() {
  const f = useForm();
  const age = num(f.get(["contract", "age"])), term = num(f.get(["contract", "termYears"])), sum = num(f.get(["contract", "sumAssured"]));
  return (
    <Grid>
      <Sel p={["contract", "sex"]} label="성별" options={[["M", "남"], ["F", "여"]]} hint="피보험자 — 위험률 표는 이 성별의 열을 씁니다" />
      <F p={["contract", "age"]} label="가입나이" kind="num" unit="세" />
      <F p={["contract", "termYears"]} label="보험기간" kind="num" unit="년" hint={age !== undefined && term ? `${age + term - 1}세 만기` : "비우면 만기 나이로"} />
      <F p={["contract", "termAge"]} label="만기 나이" kind="num" unit="세" hint="보험기간 대신 적을 때" />
      <F p={["contract", "payYears"]} label="납입기간" kind="num" unit="년납" dl="dl-pay" />
      <F p={["contract", "payAge"]} label="납입 만기 나이" kind="num" unit="세" hint="납입기간 대신 적을 때" />
      <Sel p={["contract", "freq"]} label="납입주기" options={FREQS} />
      <F p={["contract", "sumAssured"]} label="보험가입금액" kind="num" unit="원" hint={krw(sum)} />
    </Grid>
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

function RatesBody({ rates, used, tableNote }: { rates: RateItem[]; used: (id: string) => string[]; tableNote: (id: string) => string | undefined }) {
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
      <Add onClick={() => f.edit([{ path: ["rates"], add: true, value: { id: uniqueId("k", rates.map((r) => r.id)), name: "새 위험률", role: "incidence" } }])}>＋ 위험률</Add>
    </div>
  );
}

function WaiverBody({ rates }: { rates: RateItem[] }) {
  const f = useForm();
  const on = f.get(["basis", "waiver"]) === true;
  const setRole = (i: number, waiver: boolean) => {
    const back = guessRole(rates[i].name);
    f.edit([{ path: ["rates", i, "role"], value: waiver ? "waiver" : back === "waiver" ? "other" : back }]);
  };
  return (
    <div className="space-y-2">
      <Check p={["basis", "waiver"]} label="추가 납입면제 사유 적용" />
      <p className="text-xs leading-relaxed text-muted-foreground">
        납입자수 l′ 는 담보의 탈퇴 사유로 유지자수 l 과 똑같이 줄어듭니다(사망만이면 1 − q, 사망과 진단이면 1 − q − k + q·k/2).
        보장은 이어지고 납입만 면제되는 사유(예: 80% 이상 장해)가 있을 때만 켜고, 그 위험률을 &apos;납입면제&apos;로 표시합니다 — 따로 둔 납입면제율을 곱하지 않습니다.
      </p>
      {on && (
        <div className="flex flex-wrap gap-2">
          {rates.map((r, i) => (
            <label key={i} data-path={`rates[${i}]`} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs">
              <input type="checkbox" className="accent-[var(--primary)]" checked={r.role === "waiver"} onChange={(e) => setRole(i, e.target.checked)} />
              {r.name} <span className="text-muted-foreground">({RATE_ROLE_LABEL[r.role]})</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function BenefitBody({ i, rates, spec }: { i: number; rates: RateItem[]; spec: MethodSpec }) {
  const f = useForm();
  const base: YamlPath = ["benefits", i];
  const at = (k: string | number, ...rest: (string | number)[]): YamlPath => [...base, k, ...rest];
  const role = str(f.get(at("role"))) || "other";
  const exits = (f.get(at("exitRateIds")) as unknown[] | undefined)?.map(String) ?? [];
  const amount = num(f.get(at("amount"))), wait = num(f.get(at("waitDays")));
  const steps = list(f.get(at("steps"))), points = list(f.get(at("points")));
  const age = num(f.get(["contract", "age"])) ?? 40, end = num(f.get(at("endAge"))) ?? 80;
  const formula = useMemo(() => generateFormulas(spec).find((x) => x.path?.split("|")[0] === `benefits[${i}]`)?.text
    .split("\n").filter((l) => /유지자수|납입자수|급부/.test(l)) ?? [], [spec, i]);
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
        <F p={at("waitDays")} label="면책기간" kind="num" unit="일" hint={wait ? `약 ${Math.round(wait / 30)}개월 (자유설계보험은 개월로 받습니다)` : "없음"} />
        <Sel p={at("rateId")} label="급부 위험률" options={[["", role === "death" ? "— 탈퇴 사유 전부 (사망형)" : "— 없음"], ...rates.map((r): [string, string] => [r.id, `${r.name} (${RATE_ROLE_LABEL[r.role]})`])]}
          onPick={(v) => [{ path: at("rateId"), value: v === "" ? undefined : v }, { path: at("exitRateIds"), value: autoExit(rates, role, v === "" ? undefined : String(v)) }]} />
      </Grid>
      <div data-path={`benefits[${i}].exitRateIds`}>
        <p className="fld-label">탈퇴 위험률 (유지자수·납입자수)</p>
        <p className="fld-hint mb-1">이 담보를 소멸시키는 사유 전부. 최초발생은 넣고, 반복지급은 넣지 않습니다.</p>
        <div className="flex flex-wrap gap-2">
          {rates.map((r) => (
            <label key={r.id} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs">
              <input type="checkbox" className="accent-[var(--primary)]" checked={exits.includes(r.id)} onFocus={() => f.select(`benefits[${i}].exitRateIds`)} onChange={(e) => toggleExit(r.id, e.target.checked)} />
              {r.name}
            </label>
          ))}
          {!rates.length && <span className="text-xs text-muted-foreground">M04 에서 위험률을 먼저 더하세요</span>}
        </div>
        {formula.length > 0 && <div className="mt-2 rounded bg-muted/60 px-2 py-1 font-mono text-[11.5px] leading-5">{formula.map((l, k) => <div key={k} dangerouslySetInnerHTML={{ __html: subSup(l) }} />)}</div>}
      </div>
      <div data-path={`benefits[${i}].steps`} className="border-t border-border pt-2">
        <div className="flex items-center justify-between"><p className="fld-label">보험금 증액·감액 (연령 구간 배수)</p>
          <button type="button" className="btn" onClick={() => f.edit([{ path: at("steps"), add: true, value: { fromAge: steps.length ? Math.min((num(steps[steps.length - 1].toAge) ?? age) + 1, end) : age, toAge: end, multiple: steps.length ? 0.5 : 1 } }])}>＋ 구간</button></div>
        {!steps.length && <p className="fld-hint">구간이 없으면 전 기간 1.0배. 겹치면 뒤 구간이 이깁니다.</p>}
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

function NotesBody() {
  return (
    <div className="space-y-3">
      <Grid><F p={["surrender", "deductionYears"]} label="해약공제 기간" kind="num" unit="년" hint="납입기간과 이 기간 중 짧은 쪽에 걸쳐 균등하게 줄어듭니다" /></Grid>
      <StringList p={["surrender", "notes"]} label="해지환급금 관련 사항" placeholder="예: 해약공제 기준 신계약비는 …" />
      <StringList p={["reserve", "notes"]} label="책임준비금 관련 사항" placeholder="예: 연중 보간은 하지 않고 …" />
    </div>
  );
}

function FormulasBody({ count }: { count: number }) {
  const f = useForm();
  const [pal, setPal] = useState(false);
  const target = useRef<{ i: number; ta: HTMLTextAreaElement } | null>(null);
  const insert = (text: string) => {
    const t = target.current;
    if (!t || t.i >= count) { f.edit([{ path: ["formulas"], add: true, value: { section: "계산기수", label: "새 식", text } }]); return; }
    const cur = t.ta.value, a = t.ta.selectionStart, b = t.ta.selectionEnd;
    f.set(["formulas", t.i, "text"], cur.slice(0, a) + text + cur.slice(b));
    requestAnimationFrame(() => { t.ta.focus(); t.ta.setSelectionRange(a + text.length, a + text.length); });
  };
  return (
    <div className="space-y-2">
      <p className="fld-hint">자동으로 만든 식에 더해 적을 식입니다. 절·제목이 자동 식과 같으면(예: 보험료의 계산 · 영업보험료) 그 식을 바꿉니다. 첨자는 <code>l_{"{x+t}"}</code> · <code>v^t</code> 처럼 적습니다.</p>
      {Array.from({ length: count }, (_, i) => {
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
        onInline={insert} onFormula={(s) => (target.current && target.current.i < count ? insert(s.text)
          : f.edit([{ path: ["formulas"], add: true, value: { section: SECTION_OF[s.group] ?? "계산기수", label: s.label, text: s.text } }]))} />}
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
  /** 칸을 골랐을 때 */
  onSelect: (paths: string[]) => void;
  open: string[];
  setOpen: (f: (open: string[]) => string[]) => void;
  tableNote: (rateId: string) => string | undefined;
  onShowYaml: () => void;
}

export default function ConditionForm({ yaml, spec, errors, onEdit, highlight, onSelect, open, setOpen, tableNote, onShowYaml }: Props) {
  const { doc, syntax, raw } = useMemo(() => {
    const doc = parseDocument(yaml);
    const syntax = doc.errors[0] ?? (doc.contents !== null && !isMap(doc.contents)
      ? { linePos: [{ line: 1 }], message: "맨 위는 meta:, basis: 같은 항목이어야 합니다" } : undefined);
    return { doc, syntax, raw: syntax ? {} : ((doc.toJS() ?? {}) as Obj) };
  }, [yaml]);
  const general = errors.filter((e) => !e.line).map((e) => e.message);
  const box = useRef<HTMLDivElement | null>(null);

  const ctx: Ctx = {
    get: (p) => getIn(raw, p),
    set: (p, v) => onEdit([{ path: p, value: v }]),
    edit: onEdit,
    note: (p) => { const n = doc.getIn(p, true); return isScalar(n) && n.comment ? n.comment.trim() : undefined; },
    err: (key) => general.find((m) => m.startsWith(`${key} `) || m.startsWith(`${key}:`)),
    select: (key) => onSelect([key]),
  };

  const m = (raw.meta ?? {}) as Obj, c = (raw.contract ?? {}) as Obj, b = (raw.basis ?? {}) as Obj;
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
  const waiverRates = rates.filter((r) => r.role === "waiver");
  const waiverOff = b.waiver === true && !waiverRates.length;
  const nExp = list(raw.expenses).length, nForm = list(raw.formulas).length;
  const sr = (raw.surrender ?? {}) as Obj, rs = (raw.reserve ?? {}) as Obj;
  const nNotes = (Array.isArray(sr.notes) ? sr.notes.length : 0) + (Array.isArray(rs.notes) ? rs.notes.length : 0);

  const errM01 = bad(/^meta\./), errM02 = bad(/^contract\.|납입기간/), errM03 = bad(/^basis\.(?!waiver)|해지율/), errM06 = bad(/^사업비/);
  const cards: CardDef[] = [
    { id: "M01", code: "M01", title: "상품 기본정보", paths: ["meta"], status: status(errM01, !!str(m.productName)), message: errM01,
      summary: [str(m.productName) || "이름 없음", str(m.kind)],
      help: "상품 이름·종류·작성일입니다. 산출방법서 표지(개요 표)에 들어갑니다.", body: <ProductBody /> },
    { id: "M02", code: "M02", title: "계약조건", paths: ["contract"],
      status: status(errM02, num(c.age) !== undefined && !!str(c.sex) && (num(c.termYears) ?? num(c.termAge)) !== undefined && (num(c.payYears) ?? num(c.payAge)) !== undefined), message: errM02,
      summary: [sp.contract.age !== undefined ? `${sp.contract.age}세 ${sp.contract.sex === "F" ? "여" : "남"}` : "",
        `${sp.contract.termYears ? `${sp.contract.termYears}년` : sp.contract.termAge ? `${sp.contract.termAge}세` : "?"} 만기 / ${sp.contract.payYears ?? "?"}년납`,
        FREQS.find(([v]) => v === sp.contract.freq)?.[1] ?? ""],
      help: "피보험자(성별·가입나이)와 보험기간·납입기간·납입주기입니다. 보험기간은 연수 또는 만기 나이 중 하나만 적어도 됩니다.", body: <ContractBody /> },
    { id: "M03", code: "M03", title: "이자율·저해지", paths: ["basis.interest", "basis.standardInterest", "basis.minGuaranteed", "basis.averagePublished", "basis.lapse", "basis.lowRatio"],
      status: status(errM03, sp.basis.interest !== undefined), message: errM03,
      summary: [sp.basis.interest !== undefined ? `i = ${pct(sp.basis.interest)}` : "", sp.basis.standardInterest !== undefined ? `표준 ${pct(sp.basis.standardInterest)}` : "",
        ...(sp.basis.lapse?.length ? [`해지율 ${sp.basis.lapse.map((l) => pct(l.rate)).join("·")}`, sp.basis.lowRatio !== undefined ? (sp.basis.lowRatio === 0 ? "무해지" : `환급률 ${pct(sp.basis.lowRatio)}`) : ""] : [])],
      help: "적용이율은 보험료·책임준비금에, 표준이율은 표준책임준비금과 해약공제 기준 신계약비에 씁니다. 저해지·무해지형은 적용해지율과 환급률을 넣습니다.", body: <BasisBody /> },
    { id: "M04", code: "M04", title: "위험률", paths: ["rates"], status: status(undefined, rates.length > 0),
      summary: [...rates.slice(0, 4).map((r) => r.name), rates.length > 4 ? `외 ${rates.length - 4}` : "", sp.rates.some((r) => r.table) ? `표 ${sp.rates.filter((r) => r.table).length}개 연결` : ""],
      help: "위험률마다 이름·유형(사망·최초발생·반복지급·납입면제·해지·기타)·근거를 적습니다. 유형이 담보·납입면제와의 연결을 정합니다. 값 표는 아래 [위험률 표]에서 열을 이어 붙입니다.",
      body: <RatesBody rates={rates} used={used} tableNote={tableNote} /> },
    { id: "M05", code: "M05", title: "납입자수", paths: ["basis.waiver"], status: waiverOff ? "error" : "done",
      message: waiverOff ? "추가 납입면제 사유를 켰지만 유형이 '납입면제'인 위험률이 없습니다. 아래에서 고르세요." : undefined,
      summary: [b.waiver === true ? `추가 사유: ${waiverRates.map((r) => r.name).join(" · ") || "없음"}` : "납입자수 = 유지자수"],
      help: "납입자수 l′ 는 담보의 탈퇴 사유로 유지자수와 똑같이 줄어듭니다. 보장은 이어지고 납입만 면제되는 사유가 있을 때만 켭니다.", body: <WaiverBody rates={rates} /> },
    ...bens.map((x, i): CardDef => {
      const name = str(x.name) || `담보 ${i + 1}`, s = sp.benefits[i];
      const err = general.find((g) => g.includes(`"${name}"`));
      return {
        id: `C${i}`, code: `C${String(i + 1).padStart(2, "0")}`, title: name, paths: [`benefits[${i}]`], benefit: i, message: err,
        status: status(err, num(x.amount) !== undefined && !!str(x.role)),
        summary: [BEN_ROLES.find(([k]) => k === str(x.role))?.[1] ?? "", s?.amount !== undefined ? `${krw(s.amount)}${s.role === "recurring" ? "/일" : ""}` : "", s?.endAge ? `~${s.endAge}세` : "", s?.unit ?? ""],
        help: "담보 하나를 독립된 소형 상품으로 산출합니다. 급부 위험률·탈퇴 위험률·보장금액·만기·면책·증액감액 구간을 정합니다.",
        body: <BenefitBody i={i} rates={rates} spec={sp} />,
      };
    }),
    { id: "M06", code: "M06", title: "사업비", paths: ["expenses"], status: status(errM06, nExp > 0), message: errM06,
      summary: [`${nExp}줄`, sp.expenses.some((e) => /^(α_S|α_P|β_S|β_G)$/.test(e.symbol)) ? "산출방법서형" : ""],
      help: "산출방법서형은 α_S·α_P·β_S·β_G·β′·γ 를 씁니다. 보장기간이 20년보다 짧으면 α_P 는 n/20 배로 줄입니다.", body: <ExpenseBody count={nExp} /> },
    { id: "M07", code: "M07", title: "책임준비금·해지환급금", paths: ["reserve", "surrender"], status: status(undefined, nNotes > 0 || num(sr.deductionYears) !== undefined, true),
      summary: [sp.surrender.deductionYears ? `해약공제 ${sp.surrender.deductionYears}년` : "", nNotes ? `문장 ${nNotes}` : ""],
      help: "해약공제 기간과 책임준비금·해지환급금 절에 넣을 문장입니다. 식은 조건에서 자동으로 만듭니다.", body: <NotesBody /> },
    { id: "M08", code: "M08", title: "수식 더하기", paths: ["formulas"], status: status(undefined, nForm > 0, true),
      summary: [nForm ? `식 ${nForm}개` : "자동 식만"],
      help: "유지자수·계산기수·보험료·준비금·해지환급금 식은 조건에서 자동으로 만듭니다. 여기에 적은 식은 그 뒤에 붙고, 절·제목이 같으면 자동 식을 바꿉니다.", body: <FormulasBody count={nForm} /> },
  ];

  // 오른쪽에서 고른 조건이 든 카드를 펼친다
  useEffect(() => {
    if (!highlight.length) return;
    const ids = cards.filter((x) => highlight.some((s) => x.paths.some((p) => under(s, p) || under(p, s)))).map((x) => x.id);
    if (ids.some((id) => !open.includes(id))) setOpen((o) => [...new Set([...o, ...ids])]);
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

  const toggle = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const moveBen = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= bens.length) return;
    onEdit([{ path: ["benefits", i], value: bens[j] }, { path: ["benefits", j], value: bens[i] }]);
  };
  const addBen = (role: string) => {
    const id = uniqueId("b", bens.map((x) => str(x.id))), rateId = suggestRate(rates, role);
    const value = Object.fromEntries(Object.entries({ id, name: `담보 ${bens.length + 1}`, role, amount: role === "recurring" ? 100000 : 30000000, endAge: 80, rateId, exitRateIds: autoExit(rates, role, rateId) })
      .filter(([, v]) => v !== undefined));
    onEdit([{ path: ["benefits"], add: true, value }]);
    setOpen((o) => [...o, `C${bens.length}`]);
  };
  const extra = [list(raw.units).length ? `계약 단위(units) ${list(raw.units).length}개` : "", list(raw.sections).length ? `추가 절(sections) ${list(raw.sections).length}개` : ""].filter(Boolean);

  return (
    <FormCtx.Provider value={ctx}>
      <div ref={box} className="form-body thin-scroll">
        {cards.map((card, i) => (
          <Card key={card.id} c={card} index={i} open={open.includes(card.id)} onToggle={() => toggle(card.id)}
            move={card.benefit !== undefined ? (dir) => moveBen(card.benefit!, dir) : undefined}
            remove={card.benefit !== undefined ? () => { if (window.confirm(`담보 "${card.title}" 를 지울까요?`)) onEdit([{ path: ["benefits", card.benefit!] }]); } : undefined} />
        ))}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-2">
          <span className="text-xs text-muted-foreground">담보 추가</span>
          {BEN_ROLES.map(([k, l, h]) => <button key={k} type="button" className="btn" title={h} onClick={() => addBen(k)}>＋ {l}</button>)}
        </div>
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
      {dl("dl-pay", [5, 7, 10, 12, 15, 20, 25, 30])}
      {dl("dl-unit", ["주계약", "특약1", "특약2"])}
      {dl("dl-group", ["계약체결비용", "계약관리비용", "수금비용"])}
      {dl("dl-symbol", ["α_S", "α_P", "β_S", "β_G", "β′", "γ", "α", "β"])}
      {dl("dl-basis", ["보험가입금액", "기준연납순보험료", "매년 보험가입금액", "영업보험료"])}
      {dl("dl-phase", ["초년도", "납입중", "납입후"])}
      {dl("dl-section", ["계산기수", "보험료의 계산", "책임준비금의 계산", "해지환급금의 계산"])}
    </>
  );
}
