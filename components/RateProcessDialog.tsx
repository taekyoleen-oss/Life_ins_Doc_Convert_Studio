"use client";

import { useMemo, useState } from "react";
import { RATE_ROLE_LABEL, type RateRef, type RateRole, type Sex } from "@/lib/methoddoc/spec";
import { exprWithNames, processRates } from "@/lib/rate-process";
import { guessRole } from "@/lib/sheet";

/** 가공한 위험률 — 성별마다 연령·값 */
export interface ProcessPick { name: string; role: RateRole; source: string; cols: { sex?: Sex; ages: number[]; values: number[] }[] }

interface Props {
  /** 값 표가 붙은 조건의 위험률(attachTables 한 것) */
  rates: RateRef[];
  onAdd: (pick: ProcessPick) => void;
  onClose: () => void;
}

const EXAMPLES: [string, string][] = [
  ["× 상수", "rc × 0.8"],
  ["× 365 (1일 → 연간 일수)", "ch × 365"],
  ["둘 중 하나 (질병끼리 곱)", "1 − (1 − rs)(1 − ra)"],
  ["합", "rs + ra"],
];

/**
 * 위험률 가공 — 이미 있는 위험률 표를 연령마다 식으로 합치거나 곱해 새 위험률을 만든다(예: 암수술률 = 암발생률 × 0.8).
 * 결과는 위험률 표에 새 열(남·여)로 들어가고 조건(M04)에 새 위험률로 더해진다 — 근거 칸에 그 식이 남는다.
 * 기존 위험률을 고쳐 쓰지 않는다(예전 '보정' 칸 대신).
 */
export default function RateProcessDialog({ rates, onAdd, onClose }: Props) {
  const withTable = rates.filter((r) => r.tables?.M || r.tables?.F || r.table);
  const [expr, setExpr] = useState(withTable[0] ? `${withTable[0].id} × 0.8` : "");
  const [name, setName] = useState("");
  const [role, setRole] = useState<RateRole | "">("");
  const tables = (id: string) => {
    const r = withTable.find((x) => x.id === id);
    if (!r) return undefined;
    if (r.tables?.M || r.tables?.F) return { M: r.tables.M, F: r.tables.F };
    return r.table ? { any: r.table } : undefined;
  };
  const res = useMemo(() => { try { return { cols: processRates(expr, tables), err: "" }; } catch (e) { return { cols: [], err: e instanceof Error ? e.message : String(e) }; } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expr, rates]);
  const nameOf = (id: string) => withTable.find((x) => x.id === id)?.name;
  const label = exprWithNames(expr, nameOf);
  const finalName = name.trim() || label;
  const finalRole = role || guessRole(finalName);
  const at = (c: { ages: number[]; values: number[] }, a: number) => { const k = c.ages.indexOf(a); return k < 0 ? "—" : String(Number(c.values[k].toPrecision(6))); };
  const sample = res.cols[0]?.ages.filter((a) => [0, 20, 40, 60, 80].includes(a)) ?? [];

  return (
    <div className="modal-back no-print" onClick={onClose}>
      <div className="modal imp-modal" onClick={(e) => e.stopPropagation()}>
        <h2>위험률 가공</h2>
        <p className="text-xs text-muted-foreground">이미 있는 위험률 표를 연령마다 계산해 <b>새 위험률</b>을 만듭니다(기존 위험률은 그대로). 아래 기호로 식을 적습니다 — + − × ÷ 와 괄호, 수.</p>
        <div className="proc-ids">
          {withTable.map((r) => <button key={r.id} type="button" className="chip" onClick={() => setExpr((x) => `${x}${x && !/[\s(]$/.test(x) ? " " : ""}${r.id}`)} title={`${r.name} — 식에 넣기`}><b>{r.id}</b> {r.name}</button>)}
          {!withTable.length && <span className="text-xs text-rose-700">값 표가 붙은 위험률이 없습니다 — 먼저 기본 위험률 모음이나 스프레드시트에서 불러오세요.</span>}
        </div>
        <label className="fld-label mt-2 block" htmlFor="proc-expr">식</label>
        <input id="proc-expr" className="inp w-full font-mono" value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="예: rc × 0.8" />
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
          {EXAMPLES.map(([l, x]) => <button key={l} type="button" className="pane-tool" onClick={() => setExpr(x)}>{l}: {x}</button>)}
        </div>
        {res.err ? <p className="mt-1 text-xs text-rose-700">{res.err}</p> : <p className="mt-1 text-xs text-muted-foreground">= {label} · {res.cols.map((c) => `${c.sex === "M" ? "남" : c.sex === "F" ? "여" : "공통"} ${c.ages[0]}~${c.ages[c.ages.length - 1]}세`).join(" · ")}</p>}
        <div className="mt-2 grid grid-cols-[1fr_10rem] gap-2">
          <label className="text-xs">새 위험률 이름<input className="inp w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder={label} /></label>
          <label className="text-xs">유형<select className="inp w-full" value={role || finalRole} onChange={(e) => setRole(e.target.value as RateRole)}>{Object.entries(RATE_ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        </div>
        {sample.length > 0 && (
          <table className="calc-table mt-2">
            <thead><tr><th>연령</th>{res.cols.map((c, i) => <th key={i}>{c.sex === "M" ? "남" : c.sex === "F" ? "여" : "값"}</th>)}</tr></thead>
            <tbody>{sample.map((a) => <tr key={a}><td>{a}</td>{res.cols.map((c, i) => <td key={i} className="num">{at(c, a)}</td>)}</tr>)}</tbody>
          </table>
        )}
        <div className="mt-3 flex items-center gap-2">
          <span className="flex-1" />
          <button className="btn" onClick={onClose}>닫기</button>
          <button className="btn-primary" disabled={!!res.err || !res.cols.length} onClick={() => onAdd({ name: finalName, role: finalRole, source: `경험생명표(가상) ${finalName}${name.trim() ? ` (${label})` : ""}`, cols: res.cols })}>새 위험률로 만들기</button>
        </div>
      </div>
    </div>
  );
}
