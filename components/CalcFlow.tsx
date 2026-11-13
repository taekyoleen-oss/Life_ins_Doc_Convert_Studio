"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { calcFlow, compareFlow, pythonCompare, type FlowModule } from "@/lib/methoddoc/calc-flow";
import { pythonScript } from "@/lib/methoddoc/calc-py";
import { calcWorkbook, workbookResults } from "@/lib/methoddoc/calc-xlsx";
import { PAY_METHODS, sheetsByUnit, type CalcContract } from "@/lib/methoddoc/calc";
import { subSup } from "@/lib/methoddoc/render";
import type { MethodSpec } from "@/lib/methoddoc/spec";
import { download } from "@/lib/export";
import { readXlsxAll } from "@/lib/sheet";
import { formulaHtml } from "./DocPreview";
import { loadPyodide, type Pyodide } from "./PythonPanel";
import "./calc-flow.css";

/**
 * 산출 흐름 — 보험료 산출을 이어진 상자(모듈)로 보인다. 통계 프로그램의 흐름도처럼 상자를 누르면 그 단계의 설명 · 식 · 파이썬 코드 · 산출 값이 나온다.
 * 값은 앱이 식으로 낸 것(`calcFlow` ← calcSheets), 코드는 내려받는 .py 와 같은 셀(calcPython)이다 — 이 창은 새로 계산하지 않는다.
 * [▶ 차례로 실행]은 그 셀을 브라우저 안의 파이썬(Pyodide)으로 돌리고, [비교]는 앱 · 파이썬 · 엑셀(엑셀에서 열어 저장한 파일)을 맞댄다.
 */
type Run = { state: "idle" | "running" | "done" | "error"; out: string };
const IDLE: Run = { state: "idle", out: "" };

const W = 172, H = 60, GX = 14, GY = 34, GAP = 28, PAD = 16;
/** 보장 갈래 안의 자리 — [줄, 칸] */
const SPOT: Record<string, [number, number]> = { cond: [2, 0], surv: [3, 0], ben: [4, 0], pay: [4, 1], cover: [5, 0], prem: [6, 0], res: [7, 1], risk: [2, 0], parts: [3, 0], av: [4, 0], refund: [5, 0] };

const num = (v: number | string, digits = 6) => {
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return "—";
  if (v !== 0 && Math.abs(v) < 1e-7) return v.toExponential(2);
  return v.toLocaleString("ko-KR", { maximumFractionDigits: digits });
};

export default function CalcFlow({ spec, contract, onClose }: { spec: MethodSpec; contract: CalcContract; onClose: () => void }) {
  const flow = useMemo(() => calcFlow(spec, contract), [spec, contract]);
  const units = useMemo(() => sheetsByUnit(flow.calc), [flow]);
  const [unitAt, setUnitAt] = useState(0);
  /** 고른 상자의 id — "compare" 면 비교 표 */
  const [view, setView] = useState("doc");
  const [runs, setRuns] = useState<Run[]>(() => flow.cells.map(() => IDLE));
  const [status, setStatus] = useState("");
  const [xl, setXl] = useState<{ name: string; values: Record<string, number> } | null>(null);
  const [xlNote, setXlNote] = useState("");
  const py = useRef<Pyodide | null>(null);
  useEffect(() => { setRuns(flow.cells.map(() => IDLE)); setXl(null); setXlNote(""); }, [flow]);

  const unit = units[Math.min(unitAt, units.length - 1)];
  const lanes = useMemo(() => (unit?.sheets ?? []).map((s) => s.id), [unit]);
  const shown = useMemo(() => flow.modules.filter((m) => !m.lane || lanes.includes(m.lane)), [flow, lanes]);
  const place = useMemo(() => {
    const laneW = flow.savings ? W : 2 * W + GX, last = flow.savings ? 6 : 8;
    const lanesW = Math.max(lanes.length * (laneW + GAP) - GAP, 0);
    const width = Math.max(lanesW, 2 * W + GX) + 2 * PAD, mid = width / 2, x0 = (width - lanesW) / 2;
    const y = (row: number) => PAD + row * (H + GY);
    const pos = new Map<string, { x: number; y: number }>();
    for (const m of shown) {
      if (m.id === "doc") pos.set(m.id, { x: mid - W / 2, y: y(0) });
      else if (m.id === "basis") pos.set(m.id, { x: mid - W - GX / 2, y: y(1) });
      else if (m.id === "rates") pos.set(m.id, { x: mid + GX / 2, y: y(1) });
      else if (m.id === "total") pos.set(m.id, { x: mid - W / 2, y: y(last) });
      else { const [row, col] = SPOT[m.kind]; pos.set(m.id, { x: x0 + lanes.indexOf(m.lane!) * (laneW + GAP) + col * (W + GX), y: y(row) }); }
    }
    return { pos, width, height: y(last) + H + PAD, laneX: (i: number) => x0 + i * (laneW + GAP), laneY: y(2) - 17 };
  }, [flow, lanes, shown]);

  const last = runs[runs.length - 1];
  const pyVals = last?.state === "done" ? pythonCompare(last.out) : undefined;
  const cmp = useMemo(() => compareFlow(flow.compare, pyVals, xl?.values), [flow, pyVals, xl]);
  const done = runs.filter((r) => r.state === "done").length;
  const sel = flow.modules.find((m) => m.id === view);

  /**
   * 처음(계약·기초율)부터 그 셀까지 차례로 실행 — 늘 처음부터라 앞서 돌린 값(이 창 · 보험료 계산 창의 Python)이 섞이지 않는다.
   * 실행 중에는 다시 누르지 못한다(두 실행이 섞이면 합계가 틀려진다)
   */
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const runTo = async (upTo: number) => {
    if (running.current) return;
    running.current = true; setBusy(true);
    try {
      if (!py.current) {
        setStatus("파이썬 실행기를 처음 한 번 받는 중입니다 (10~20 MB) — 다음부터는 바로 실행됩니다…");
        py.current = await loadPyodide();
        setStatus("");
      }
      const p = py.current;
      for (let i = 0; i <= upTo; i++) {
        setRuns((rs) => rs.map((r, k) => (k === i ? { state: "running", out: "" } : k > i ? IDLE : r)));
        let out = "";
        p.setStdout({ batched: (s) => { out += `${s}\n`; } });
        p.setStderr({ batched: (s) => { out += `${s}\n`; } });
        try {
          await new Promise((r) => setTimeout(r));   // 상자의 상태 점이 한 단계씩 바뀌어 보이게
          p.runPython(flow.cells[i].code);
          setRuns((rs) => rs.map((r, k) => (k === i ? { state: "done", out } : r)));
        } catch (e) {
          setRuns((rs) => rs.map((r, k) => (k === i ? { state: "error", out: `${out}${e instanceof Error ? e.message : String(e)}` } : r)));
          const bad = flow.modules.find((m) => m.cell === i);
          if (bad) setView(bad.id);
          return;
        }
      }
    } catch (e) { setStatus(e instanceof Error ? e.message : String(e)); }
    finally { running.current = false; setBusy(false); }
  };

  const file = (spec.meta.productName || "상품").replace(/[\\/:*?"<>|]/g, "_");
  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = workbookResults(flow.calc, await readXlsxAll(new Uint8Array(await f.arrayBuffer())));
      const got = flow.compare.some((x) => x.key in r.values);
      setXl(got ? { name: f.name, values: r.values } : null);
      setXlNote([...r.problems, ...(r.empty || !got ? ["이 파일에는 아직 계산값이 없습니다 — 엑셀에서 한 번 열어 저장한 뒤 올리세요 (앱이 만든 파일에는 수식만 있고, 엑셀이 열 때 계산합니다)"] : [])].join(" / "));
    } catch (e) { setXl(null); setXlNote(`엑셀 파일을 읽지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`); }
  };

  const dot = (m: FlowModule) => {
    const r = m.cell < 0 ? undefined : runs[m.cell];
    return m.status === "error" || r?.state === "error" || cmp.first?.module === m.id ? "err" : r?.state === "running" ? "run" : r?.state === "done" ? "done" : m.status === "warn" ? "warn" : "idle";
  };

  return (
    <div className="modal-back calc-full-back no-print" style={{ zIndex: 85 }} onClick={onClose}>
      <div className="modal calc-modal calc-full" role="dialog" aria-label="산출 흐름" onClick={(e) => e.stopPropagation()}>
        <header className="calc-head">
          <h2>산출 흐름 <span>{spec.meta.productName || "(이름 없음)"} — 보험료가 나오는 차례를 상자로 이었습니다. 상자를 누르면 그 단계의 설명 · 식 · 파이썬 코드 · 값이 오른쪽에 나옵니다</span></h2>
          <button className="btn-primary" disabled={busy} onClick={() => runTo(flow.cells.length - 1)} title="모든 단계를 위에서부터 브라우저 안의 파이썬으로 실행합니다">{busy ? "실행 중…" : "▶ 차례로 실행"}</button>
          <button className="btn" onClick={() => download(`${file}_보험료계산.xlsx`, calcWorkbook(spec, contract), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")} title="같은 계산을 엑셀 수식으로 — 엑셀에서 열면 계산됩니다">엑셀 내려받기 (수식)</button>
          <button className="btn" onClick={() => download(`${file}_일괄산출.py`, pythonScript(flow.cells), "text/x-python")} title="모든 단계를 한 파일로 — 파이썬이 있는 PC 에서 그대로 실행됩니다">파이썬 내려받기 (.py)</button>
          <button className={view === "compare" ? "btn-primary" : "btn"} onClick={() => setView("compare")}>앱 · 파이썬 · 엑셀 비교</button>
          <button className="btn" onClick={onClose}>닫기</button>
        </header>
        <p className="fld-hint">
          계약: {contract.sex === "F" ? "여" : "남"} {contract.age}세 · {flow.savings
            ? `${contract.payYears}년 만기 · 월 기본보험료 ${(contract.basePremium ?? 300000).toLocaleString("ko-KR")}원`
            : `${contract.payYears}년납 · ${PAY_METHODS.find(([k]) => k === contract.freq)?.[1] ?? ""} · 가입금액 ${(contract.sumAssured ?? 1e8).toLocaleString("ko-KR")}원`} — 맨 위 [산출 조건]에서 고른 그대로입니다. 단계 {done}/{flow.cells.length} 실행됨.
          <span className="flow-legend"><i className="flow-dot flow-idle" />실행 전 <i className="flow-dot flow-run" />실행 중 <i className="flow-dot flow-done" />파이썬으로 실행함 <i className="flow-dot flow-warn" />확인할 것 <i className="flow-dot flow-err" />오류 · 값이 갈림</span>
          {status && <b className="ml-2 text-amber-700">{status}</b>}
        </p>
        {units.length > 1 && (
          <div className="calc-tabs" role="tablist" aria-label="계약 단위">
            {units.map((u, i) => <button key={u.unit} role="tab" aria-selected={u === unit} className={u === unit ? "on" : ""} onClick={() => setUnitAt(i)}>{u.unit}<small>{u.sheets.length}개 {flow.savings ? "예시" : "보장"}</small></button>)}
          </div>
        )}
        <div className="calc-body">
          <div className="flow-map thin-scroll">
            <div className="flow-canvas" style={{ width: place.width, height: place.height }}>
              <svg width={place.width} height={place.height} aria-hidden>
                <defs><marker id="flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#7c93ab" /></marker></defs>
                {flow.links.map(([a, b]) => {
                  const p = place.pos.get(a), q = place.pos.get(b);
                  if (!p || !q) return null;
                  const x1 = p.x + W / 2, y1 = p.y + H, x2 = q.x + W / 2, y2 = q.y - 2, my = (y1 + y2) / 2;
                  return <path key={`${a}>${b}`} d={`M${x1} ${y1}C${x1} ${my} ${x2} ${my} ${x2} ${y2}`} fill="none" stroke="#7c93ab" strokeWidth="1.4" markerEnd="url(#flow-arrow)" />;
                })}
              </svg>
              {(unit?.sheets ?? []).map((s, i) => <span key={s.id} className="flow-lane" style={{ left: place.laneX(i), top: place.laneY }}>{s.name}</span>)}
              {shown.map((m) => {
                const p = place.pos.get(m.id)!;
                return (
                  <button key={m.id} type="button" data-flow={m.id} className={`flow-box flow-k-${m.lane ? "lane" : "common"} ${view === m.id ? "on" : ""}`} style={{ left: p.x, top: p.y, width: W, height: H }}
                    aria-label={`${m.laneName ? `${m.laneName} — ` : ""}${m.name}`} aria-pressed={view === m.id} onClick={() => setView(m.id)}>
                    <b><i className={`flow-dot flow-${dot(m)}`} />{m.name}</b>
                    <small>{m.headline}</small>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flow-side thin-scroll">
            {view === "compare" ? (
              <Compare cmp={cmp} ran={!!pyVals} xl={xl} note={xlNote} onUpload={upload} onPick={setView} />
            ) : sel ? (
              <Detail key={sel.id} m={sel} run={sel.cell < 0 ? undefined : runs[sel.cell]} name={(id) => { const x = flow.modules.find((o) => o.id === id); return x ? `${x.laneName ? `${x.laneName} — ` : ""}${x.name}` : id; }}
                onPick={setView} onRun={() => runTo(sel.cell)} busy={busy} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({ m, run, name, onPick, onRun, busy }: { m: FlowModule; run?: Run; name: (id: string) => string; onPick: (id: string) => void; onRun: () => void; busy: boolean }) {
  const [all, setAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const rows = Math.max(0, ...m.cols.map((c) => c.values.length));
  return (
    <>
      <h3 className="flow-title">{m.laneName && <span>{m.unit} · {m.laneName}</span>}{m.name}</h3>
      <p className="flow-desc">{m.desc}</p>
      <dl className="flow-facts">
        <dt>받는 값</dt><dd>{m.takes}</dd>
        <dt>내는 값</dt><dd>{m.gives}</dd>
        <dt>산출방법서</dt><dd>{m.section}</dd>
        {m.inputs.length > 0 && <><dt>앞 단계</dt><dd>{m.inputs.map((id) => <button key={id} type="button" className="flow-link" onClick={() => onPick(id)}>{name(id)}</button>)}</dd></>}
      </dl>
      {m.notes.map((n) => <p key={n} className="calc-warn">{n}</p>)}

      {m.formulas.length > 0 && (
        <section>
          <h4>식 <small>산출방법서에 실린 그대로 — 이 식이 곧 계산입니다</small></h4>
          {m.formulas.map((f, i) => <div key={i} className="formula-preview" dangerouslySetInnerHTML={{ __html: formulaHtml(f) }} />)}
        </section>
      )}

      {(m.values.length > 0 || m.cols.length > 0) && (
        <section>
          <h4>산출 값 <small>앱이 위의 식으로 낸 값</small></h4>
          {m.values.length > 0 && (
            <table className="calc-table">
              <tbody>{m.values.map((v, i) => <tr key={i}><td>{v.sym && <b dangerouslySetInnerHTML={{ __html: subSup(v.sym) }} />} {v.label}</td><td className="num">{num(v.value, v.digits)}</td></tr>)}</tbody>
            </table>
          )}
          {m.cols.length > 0 && (
            <>
              <div className="flow-grid thin-scroll">
                <table className="calc-table">
                  <thead><tr><th>t</th><th>연령</th>{m.cols.map((c) => <th key={c.sym} title={c.label}><span dangerouslySetInnerHTML={{ __html: subSup(c.sym) }} /><small>{c.label}</small></th>)}</tr></thead>
                  <tbody>
                    {Array.from({ length: all ? rows : Math.min(rows, 12) }, (_, t) => (
                      <tr key={t}><td>{t}</td><td className="num">{m.ages[t] ?? (m.ages[0] ?? 0) + t}</td>{m.cols.map((c) => <td key={c.sym} className="num">{c.values[t] === undefined ? "" : num(c.values[t], c.digits)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows > 12 && <button type="button" className="btn flow-more" onClick={() => setAll((v) => !v)}>{all ? "앞 12줄만 보기" : `모두 보기 (${rows}줄)`}</button>}
            </>
          )}
        </section>
      )}

      {m.code && (
        <section>
          <h4>파이썬 코드 <small>내려받는 .py 의 {m.cell + 1}번째 단계와 같습니다</small>
            <button type="button" className="btn flow-copy" onClick={() => { void navigator.clipboard.writeText(m.code).then(() => setCopied(true)); }}>{copied ? "복사됨" : "복사"}</button>
            <button type="button" className="btn flow-copy" disabled={busy} onClick={onRun} title="처음 단계부터 이 단계까지 차례로 실행합니다">▶ 이 단계까지 실행</button>
          </h4>
          <pre className="py-code flow-code">{m.code.split("\n").map((l, i) => <span key={i} className="flow-ln">{l}{"\n"}</span>)}</pre>
          <h4>실행 결과</h4>
          {run?.out ? <pre className={`py-out flow-out ${run.state === "error" ? "py-out-err" : ""}`}>{run.out.split("\n").filter((l) => !/^(RESULT|COMPARE) /.test(l)).join("\n")}</pre>
            : <p className="fld-hint">{run?.state === "running" ? "실행 중…" : run?.state === "done" ? "실행했습니다 (화면에 찍는 값이 없는 단계)" : "아직 실행하지 않았습니다 — 위의 [▶ 이 단계까지 실행]이나 맨 위 [▶ 차례로 실행]을 누르세요"}</p>}
        </section>
      )}
    </>
  );
}

function Compare({ cmp, ran, xl, note, onUpload, onPick }: { cmp: ReturnType<typeof compareFlow>; ran: boolean; xl: { name: string } | null; note: string; onUpload: (f?: File) => void; onPick: (id: string) => void }) {
  const any = ran || !!xl;
  return (
    <>
      <h3 className="flow-title">앱 · 파이썬 · 엑셀 비교</h3>
      <p className="flow-desc">같은 식을 세 가지로 계산해 값이 같은지 봅니다. 앱은 산출방법서의 식을 바로 읽어 낸 값입니다.</p>
      <ol className="flow-steps">
        <li><b>파이썬</b> — 맨 위 [▶ 차례로 실행]을 누르면 채워집니다. {ran ? "실행했습니다." : "아직 실행 전입니다."}</li>
        <li><b>엑셀</b> — [엑셀 내려받기 (수식)]로 받은 파일을 엑셀에서 한 번 열어 저장한 뒤 여기에 올리세요.{" "}
          <label className="btn flow-upload">엑셀 파일 올리기<input type="file" accept=".xlsx" aria-label="엑셀 계산 파일" hidden onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = ""; }} /></label>
          {xl && <em> {xl.name}</em>}</li>
      </ol>
      {note && <p className="calc-warn">{note}</p>}
      {any && (cmp.first
        ? <p className="calc-warn flow-verdict">값이 갈립니다 — 처음 갈리는 곳은 <button type="button" className="flow-link" onClick={() => onPick(cmp.first!.module)}>{cmp.first.group} · {cmp.first.label}</button> 입니다. 그 단계의 식과 코드를 확인하세요.</p>
        : <p className="flow-verdict flow-same">견준 값이 모두 같습니다.</p>)}
      <table className="calc-table flow-cmp">
        <thead><tr><th>값</th><th>앱 (식)</th><th>파이썬</th><th>엑셀</th><th>차이</th></tr></thead>
        <tbody>
          {cmp.rows.map((r, i) => (
            <FragmentRow key={r.key} head={i === 0 || cmp.rows[i - 1].group !== r.group ? r.group : undefined}>
              <tr className={r.ok ? "" : r === cmp.first ? "flow-bad flow-first" : "flow-bad"} data-key={r.key}>
                <td><button type="button" className="flow-link" onClick={() => onPick(r.module)} title="이 값이 나오는 단계 보기">{r.label}</button></td>
                <td className="num">{num(r.app, r.digits)}</td>
                <td className="num">{r.py !== undefined ? num(r.py, r.digits) : ran ? "—" : "실행 전"}</td>
                <td className="num">{r.xl !== undefined ? num(r.xl, r.digits) : xl ? "—" : "올리기 전"}</td>
                <td className="num">{r.diff === undefined ? "" : r.ok ? "같음" : r.diff.toExponential(2)}</td>
              </tr>
            </FragmentRow>
          ))}
        </tbody>
      </table>
    </>
  );
}

function FragmentRow({ head, children }: { head?: string; children: ReactNode }) {
  return <>{head !== undefined && <tr className="flow-group"><th colSpan={5} className="txt">{head}</th></tr>}{children}</>;
}
