"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { calcSheets, PAY_METHODS, sheetsByUnit, type CalcColumn, type CalcContract, type CalcSheet } from "@/lib/methoddoc/calc";
import { calcWorkbook } from "@/lib/methoddoc/calc-xlsx";
import { subSup } from "@/lib/methoddoc/render";
import type { MethodSpec } from "@/lib/methoddoc/spec";
import { formulaHtml } from "./DocPreview";
// 파이썬 창은 열 때만 받는다
const PythonPanel = dynamic(() => import("./PythonPanel"), { ssr: false });

const SUM_ASSURED: [number, string][] = [[1e7, "1천만원"], [3e7, "3천만원"], [5e7, "5천만원"], [1e8, "1억원"], [2e8, "2억원"], [3e8, "3억원"], [5e8, "5억원"]];

/**
 * 보험료 계산 — 엑셀처럼 한 해 한 줄.
 *
 * 값은 **이 앱이 산출방법서의 식을 그대로 읽어 낸 것**이다(`lib/methoddoc/calc.ts`) — 다른 앱에 물어보지 않는다.
 * 왼쪽부터 위험률 → 유지자수·납입자수·지급자수 → 그 현가와 누계 → 보장금액 배수·급부 현가·그 누계 → 책임준비금 V·해약공제·해지환급금 W·환급률로 가고,
 * 옆에서 납입기수 N* 로 나눠 순보험료·영업보험료(1원당 6자리 → 10만원당)를 낸다. 계약 단위(주계약·특약)마다 탭, 그 안에 담보 탭.
 * 열 제목이나 값을 누르면 **그 값을 만든 식과 쓰인 값**을 옆에 보여 준다 — 엑셀에서 칸을 눌러 수식을 보는 것과 같다.
 */

interface Props {
  spec: MethodSpec;
  contract: CalcContract;
  setContract: (c: CalcContract) => void;
  onClose: () => void;
}

/** 엑셀처럼 A · B · … · AA 열 이름 */
const colName = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`);
const num = (v: number, digits: number) => {
  if (!Number.isFinite(v)) return "—";
  if (v !== 0 && Math.abs(v) < 1e-7) return v.toExponential(2);
  return v.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: digits });
};
const won = (v: number) => `${Math.round(v).toLocaleString("ko-KR")} 원`;
/** 열 제목의 자리 표기 — 현가율은 기호에 이미 자리가 있고, 보장금액 배수 S·생존 배수 E 는 경과기간 t 로 적는다(식도 S_t) */
const headOf = (sym: string) => (sym.startsWith("v^") ? sym : ["S", "E"].includes(sym) ? `${sym}_t` : `${sym}_{x+t}`);

/** 고른 칸 — 열만 고르면 t 는 없다 */
type Pick = { col: CalcColumn; t?: number } | { scalar: CalcSheet["scalars"][number] } | null;

export default function PremiumSheet({ spec, contract, setContract, onClose }: Props) {
  const calc = useMemo(() => calcSheets(spec, contract), [spec, contract]);
  const [at, setAt] = useState(0);
  const [pick, setPick] = useState<Pick>(null);
  const [python, setPython] = useState(false);
  const units = useMemo(() => sheetsByUnit(calc), [calc]);
  const [unitAt, setUnitAt] = useState(0);
  const unit = units[Math.min(unitAt, units.length - 1)];
  const sheet = unit?.sheets[Math.min(at, unit.sheets.length - 1)];
  const put = (k: keyof CalcContract, v: string) => { setContract({ ...contract, [k]: k === "sex" ? (v as "M" | "F") : Number(v) }); setPick(null); };

  const save = (name: string, data: Uint8Array | string, type: string) => {
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /**
   * 엑셀로 — **위험률과 계약·기초율만 값**이고 현가율부터 유지자수·납입자수·기수·보험료까지는 엑셀 수식이다.
   * 그래서 이 파일 하나만으로 산출 과정을 따라가고, 값을 바꿔 다시 계산해 볼 수 있다.
   */
  const xlsx = () => save(`${(spec.meta.productName || "상품").replace(/[\\/:*?"<>|]/g, "_")}_보험료계산.xlsx`,
    calcWorkbook(spec, contract), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

  /** 지금 보는 담보의 표만 값으로 (CSV) */
  const csv = () => {
    if (!sheet) return;
    const head = ["t", "연령", ...sheet.cols.map((c) => `${c.sym} ${c.label}`)];
    const rows = sheet.ages.map((age, t) => [t, age, ...sheet.cols.map((c) => c.values[t] ?? "")]);
    const foot = [[], ["계약 · 기초율"], ...sheet.inputs.map((x) => [x.label, x.value, x.note ?? ""]),
      [], ["식"], ...sheet.cols.map((c) => [c.sym, c.formula]), [], ...sheet.scalars.map((s) => [s.sym, s.label, s.value, s.formula])];
    const text = [head, ...rows, ...foot].map((r) => r.map((x) => (typeof x === "string" && /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(",")).join("\r\n");
    save(`${spec.meta.productName || "상품"}_${sheet.name}_계산과정.csv`, `﻿${text}`, "text/csv;charset=utf-8");   // BOM — 엑셀이 한글을 바로 읽게
  };

  return (
    <div className="modal-back no-print" onClick={onClose}>
      <div className="modal calc-modal" onClick={(e) => e.stopPropagation()}>
        <header className="calc-head">
          <h2>보험료 계산 <span>{spec.meta.productName || "(이름 없음)"} — 산출방법서의 식을 그대로 읽어 이 앱이 계산합니다</span></h2>
          <button className="btn-primary" onClick={xlsx} title="계약 단위마다 한 장 — 담보가 모두 한 장에, 맨 오른쪽에 결과. 위험률과 계약·기초율만 값이고 현가율부터는 엑셀 수식">엑셀로 내려받기 (수식 포함)</button>
          <button className="btn" onClick={() => setPython(true)} title="같은 계산을 단계마다 주석 단 파이썬 셀로 — 브라우저에서 실행하거나 .py 로 내려받습니다">Python 일괄 산출</button>
          <button className="btn" onClick={csv}>이 담보만 CSV (값)</button>
          <button className="btn" onClick={onClose}>닫기</button>
        </header>

        <div className="calc-bar">
          <span className="text-[12px] font-semibold text-[#334155]">계약</span>
          <select className="inp w-auto py-0.5 text-xs" value={contract.sex ?? "M"} onChange={(e) => put("sex", e.target.value)}><option value="M">남</option><option value="F">여</option></select>
          <select className="inp w-auto py-0.5 text-xs" value={contract.age} onChange={(e) => put("age", e.target.value)}>{[0, 20, 30, 40, 50, 60].map((a) => <option key={a} value={a}>{a}세</option>)}</select>
          <select className="inp w-auto py-0.5 text-xs" value={contract.payYears} onChange={(e) => put("payYears", e.target.value)}>{[5, 10, 15, 20, 30].map((a) => <option key={a} value={a}>{a}년납</option>)}</select>
          <select className="inp w-auto py-0.5 text-xs" value={contract.freq} onChange={(e) => put("freq", e.target.value)}>{PAY_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className="inp w-auto py-0.5 text-xs" value={contract.sumAssured ?? 1e8} title="보험가입금액 — 보장금액 = 가입금액 × 배수" onChange={(e) => put("sumAssured", e.target.value)}>
            {(SUM_ASSURED.some(([v]) => v === (contract.sumAssured ?? 1e8)) ? SUM_ASSURED : [...SUM_ASSURED, [contract.sumAssured ?? 1e8, `${(contract.sumAssured ?? 1e8).toLocaleString("ko-KR")}원`] as [number, string]]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span className="fld-hint">조건에 저장하지 않습니다 — 계약 한 점은 계산할 때만 씁니다</span>
          <span className="ml-auto calc-total">보험료 합계 <b>{won(calc.premium)}</b> <small>10만원당 {calc.per100k.toLocaleString("ko-KR")}원{units.length > 1 ? ` · ${units.map((u) => `${u.unit} ${won(u.premium)}`).join(" · ")}` : ""}</small></span>
        </div>

        {calc.missingRates.length > 0 && <p className="calc-warn">값 표가 없어 0 으로 둔 위험률: {calc.missingRates.join(", ")} — [위험률 표] 창에서 열을 이으세요</p>}
        {!calc.sheets.length && <p className="calc-warn">담보가 없습니다 — 조건의 [보장] 카드에서 담보를 먼저 더하세요.</p>}

        {units.length > 1 && (
          <div className="calc-tabs calc-units">
            {units.map((u, i) => (
              <button key={u.unit} className={i === unitAt ? "on" : ""} onClick={() => { setUnitAt(i); setAt(0); setPick(null); }}>
                {u.unit}<small>담보 {u.sheets.length} · 10만원당 {u.per100k.toLocaleString("ko-KR")}원 · {won(u.premium)}</small>
              </button>
            ))}
          </div>
        )}
        {unit && unit.sheets.length > 1 && (
          <div className="calc-tabs">
            {unit.sheets.map((s, i) => (
              <button key={s.id} className={i === at ? "on" : ""} onClick={() => { setAt(i); setPick(null); }}>
                {s.name}<small>{s.n}년 / {s.m}년납 · {s.multiple !== undefined ? `${s.multiple}배 · ` : ""}10만원당 {s.per100k.toLocaleString("ko-KR")}원</small>
              </button>
            ))}
          </div>
        )}

        {sheet && (
          <div className="calc-body">
            <div className="calc-left thin-scroll">
              <p className="calc-sum-title">계약 · 기초율</p>
              <p className="fld-hint">계산에 앞서 정한 값입니다. 이것과 위험률만 값이고, 오른쪽 <b>현가율부터는 모두 식</b>에서 나옵니다 — 내려받은 엑셀도 그렇습니다.</p>
              <table className="calc-inputs">
                <tbody>
                  {sheet.inputs.map((x, i) => (
                    <tr key={i} className={x.formula ? "calc-derived" : ""}>
                      <th>{x.label}{x.note ? <small>{x.note}</small> : null}</th>
                      <td className="num">{typeof x.value === "number" ? num(x.value, x.digits ?? 6) : x.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="calc-grid-wrap thin-scroll">
              {sheet.warnings.length > 0 && <p className="calc-warn">식으로 세우지 못한 열 — {sheet.warnings.join(" · ")}</p>}
              {sheet.error ? <p className="calc-warn">식으로 계산할 수 없습니다 — {sheet.error}</p> : (
                <table className="calc-grid">
                  <thead>
                    <tr className="calc-abc">
                      <th className="calc-corner" />
                      <th>A</th><th>B</th>
                      {sheet.cols.map((c, i) => <th key={c.sym}>{colName(i + 2)}</th>)}
                    </tr>
                    <tr>
                      <th className="calc-corner" />
                      <th className="calc-fix">t<small>경과</small></th>
                      <th className="calc-fix">연령<small>x+t</small></th>
                      {sheet.cols.map((c) => (
                        <th key={c.sym} className={`calc-col ${c.kind} ${pick && "col" in pick && pick.col.sym === c.sym ? "on" : ""}`}
                          onClick={() => setPick({ col: c })} title="누르면 이 열을 만든 식을 보여 줍니다">
                          <span dangerouslySetInnerHTML={{ __html: subSup(headOf(c.sym)) }} />
                          <small>{c.label}</small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.ages.map((age, t) => (
                      <tr key={t}>
                        <th className="calc-row">{t + 1}</th>
                        <td className="calc-fix num">{t}</td>
                        <td className="calc-fix num">{age}</td>
                        {sheet.cols.map((c) => (
                          <td key={c.sym} className={`num ${pick && "col" in pick && pick.col.sym === c.sym && pick.t === t ? "on" : ""}`}
                            onClick={() => setPick({ col: c, t })} title={`${c.sym} (${age}세) — 누르면 식과 쓰인 값`}>
                            {num(c.values[t] ?? 0, c.digits)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="calc-side thin-scroll">
              <div className="calc-sum">
                <p className="calc-sum-title">{sheet.name} — 보험료</p>
                <table>
                  <tbody>
                    {sheet.scalars.map((s) => (
                      <tr key={s.sym} className={pick && "scalar" in pick && pick.scalar.sym === s.sym ? "on" : ""} onClick={() => setPick({ scalar: s })}>
                        <th dangerouslySetInnerHTML={{ __html: subSup(s.sym) }} />
                        <td>{s.label}</td>
                        <td className="num">{num(s.value, s.digits)}</td>
                      </tr>
                    ))}
                    <tr className="calc-sum-hi"><th>10만원당</th><td>G₁(6자리) × 100,000 을 원으로 반올림</td><td className="num">{sheet.per100k.toLocaleString("ko-KR")}</td></tr>
                    <tr className="calc-sum-hi"><th>담보 보험료</th><td>10만원당 × (보장금액 {sheet.multiple !== undefined ? `= 가입금액 × ${sheet.multiple} ` : ""}÷ 100,000{sheet.amount ? ` = ${(sheet.amount / 1e5).toLocaleString("ko-KR")}` : ""})</td><td className="num">{won(sheet.premium)}</td></tr>
                  </tbody>
                </table>
              </div>

              <div className="calc-pop">
                {!pick && <p className="fld-hint">열 제목이나 값을 누르면 그 값을 만든 식과 쓰인 값이 여기 나옵니다.</p>}
                {pick && "scalar" in pick && (
                  <>
                    <p className="calc-pop-title"><span dangerouslySetInnerHTML={{ __html: subSup(pick.scalar.sym) }} /> {pick.scalar.label}</p>
                    <div className="formula-preview" dangerouslySetInnerHTML={{ __html: formulaHtml(pick.scalar.formula) }} />
                    <p className="calc-pop-val">= {num(pick.scalar.value, pick.scalar.digits)}</p>
                  </>
                )}
                {pick && "col" in pick && (
                  <>
                    <p className="calc-pop-title">
                      <span dangerouslySetInnerHTML={{ __html: subSup(pick.t === undefined || pick.col.sym.startsWith("v^") ? headOf(pick.col.sym) : `${pick.col.sym}_{${["S", "E"].includes(pick.col.sym) ? pick.t : sheet.ages[pick.t]}}`) }} /> {pick.col.label}
                      {pick.t !== undefined && <small> · {pick.t}년 뒤 ({sheet.ages[pick.t]}세)</small>}
                    </p>
                    {pick.col.kind === "rate"
                      ? <p className="fld-hint">{pick.col.formula}</p>
                      : <div className="formula-preview" dangerouslySetInnerHTML={{ __html: formulaHtml(pick.col.formula) }} />}
                    {pick.t !== undefined && (
                      <>
                        {pick.col.parts(pick.t).length > 0 && (
                          <table className="calc-parts">
                            <tbody>
                              {pick.col.parts(pick.t).map((p, i) => (
                                <tr key={i}><th dangerouslySetInnerHTML={{ __html: subSup(p.ref.replace("(", "_{").replace(")", "}")) }} /><td className="num">{num(p.value, 8)}</td></tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        <p className="calc-pop-val">= {num(pick.col.values[pick.t] ?? 0, pick.col.digits)}</p>
                      </>
                    )}
                    {pick.t === undefined && <p className="fld-hint">값을 누르면 그 해에 쓰인 값까지 보여 줍니다.</p>}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {python && <PythonPanel spec={spec} contract={contract} onClose={() => setPython(false)} />}
    </div>
  );
}
