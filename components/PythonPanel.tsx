"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { calcPython, pythonScript, type PyCell } from "@/lib/methoddoc/calc-py";
import type { CalcContract } from "@/lib/methoddoc/calc";
import type { MethodSpec } from "@/lib/methoddoc/spec";

/**
 * Python 일괄 산출 — 산출방법서의 식을 단계마다 주석을 단 파이썬 셀로 만들고, 브라우저 안에서 실제로 실행한다.
 * 실행은 Pyodide(웹어셈블리 CPython)를 CDN 에서 처음 한 번 받아 쓴다 — 서버가 없고, 사용자 PC 에 파이썬이 없어도 된다.
 * 셀은 위에서부터 차례로 실행해야 한다(앞 셀의 변수를 뒤 셀이 쓴다). 코드를 .py 로 내려받아 밖에서 돌려도 같은 값이 나온다.
 */
const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";

interface Pyodide { runPython(code: string): unknown; setStdout(o: { batched: (s: string) => void }): void; setStderr(o: { batched: (s: string) => void }): void }
declare global { interface Window { loadPyodide?: (o: { indexURL: string }) => Promise<Pyodide> } }

let loading: Promise<Pyodide> | null = null;
function loadPyodide(): Promise<Pyodide> {
  if (loading) return loading;
  loading = new Promise<Pyodide>((resolve, reject) => {
    const go = () => window.loadPyodide!({ indexURL: PYODIDE_URL }).then(resolve, reject);
    if (window.loadPyodide) { go(); return; }
    const s = document.createElement("script");
    s.src = `${PYODIDE_URL}pyodide.js`;
    s.onload = go;
    s.onerror = () => { loading = null; reject(new Error("Pyodide 를 받지 못했습니다 — 인터넷 연결을 확인하세요 (cdn.jsdelivr.net)")); };
    document.head.appendChild(s);
  });
  return loading;
}

type Run = { state: "idle" | "running" | "done" | "error"; out: string };

export default function PythonPanel({ spec, contract, onClose }: { spec: MethodSpec; contract: CalcContract; onClose: () => void }) {
  const cells = useMemo(() => calcPython(spec, contract), [spec, contract]);
  const [runs, setRuns] = useState<Run[]>(() => cells.map(() => ({ state: "idle", out: "" })));
  const [status, setStatus] = useState<string>("");
  const py = useRef<Pyodide | null>(null);
  useEffect(() => { setRuns(cells.map(() => ({ state: "idle", out: "" }))); }, [cells]);

  const ensure = async () => {
    if (py.current) return py.current;
    setStatus("Pyodide(파이썬 실행기)를 처음 한 번 받는 중 — 10~20 MB, 이후엔 바로 실행됩니다…");
    py.current = await loadPyodide();
    setStatus("");
    return py.current;
  };
  /** 셀 하나 실행 — 앞 셀들이 아직이면 앞부터 차례로 */
  const runCell = async (upTo: number) => {
    try {
      const p = await ensure();
      const from = runs.findIndex((r) => r.state !== "done");
      const start = from < 0 || from > upTo ? upTo : Math.min(from, upTo);
      for (let i = start; i <= upTo; i++) {
        setRuns((rs) => rs.map((r, k) => (k === i ? { state: "running", out: "" } : k > i ? { state: "idle", out: "" } : r)));
        let out = "";
        p.setStdout({ batched: (s) => { out += `${s}\n`; } });
        p.setStderr({ batched: (s) => { out += `${s}\n`; } });
        try {
          await Promise.resolve();
          p.runPython(cells[i].code);
          setRuns((rs) => rs.map((r, k) => (k === i ? { state: "done", out } : r)));
        } catch (e) {
          setRuns((rs) => rs.map((r, k) => (k === i ? { state: "error", out: `${out}${e instanceof Error ? e.message : String(e)}` } : r)));
          return;
        }
      }
    } catch (e) { setStatus(e instanceof Error ? e.message : String(e)); }
  };
  const runAll = () => runCell(cells.length - 1);
  const reset = () => { setRuns(cells.map(() => ({ state: "idle", out: "" }))); };
  const download = () => {
    const url = URL.createObjectURL(new Blob([pythonScript(cells)], { type: "text/x-python;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${(spec.meta.productName || "상품").replace(/[\\/:*?"<>|]/g, "_")}_일괄산출.py`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const done = runs.filter((r) => r.state === "done").length;

  return (
    <div className="modal-back no-print" style={{ zIndex: 90 }} onClick={onClose}>
      <div className="modal py-modal" onClick={(e) => e.stopPropagation()}>
        <header className="calc-head">
          <h2>Python 일괄 산출 <span>{spec.meta.productName || "(이름 없음)"} — 산출방법서의 식을 단계마다 주석과 함께 파이썬으로 옮긴 것. 셀을 위에서부터 실행합니다</span></h2>
          <button className="btn-primary" onClick={runAll} title="모든 셀을 차례로 브라우저 안에서 실행합니다 (Pyodide)">▶ 전부 실행</button>
          <button className="btn" onClick={reset} disabled={!done}>처음부터</button>
          <button className="btn" onClick={download} title="셀을 한 파일(.py)로 — 바깥 파이썬으로 돌려도 같은 값">.py 내려받기</button>
          <button className="btn" onClick={onClose}>닫기</button>
        </header>
        <p className="fld-hint">계약: {contract.sex === "F" ? "여" : "남"} {contract.age}세 · {contract.payYears}년납 · k={contract.freq} · 가입금액 {(contract.sumAssured ?? 1e8).toLocaleString("ko-KR")}원 — 값은 계약·기초율·위험률뿐이고 나머지는 식입니다. {done}/{cells.length} 셀 실행됨.{status && <b className="ml-2 text-amber-700">{status}</b>}</p>
        <div className="py-cells thin-scroll">
          {cells.map((c, i) => <Cell key={i} i={i} cell={c} run={runs[i]} onRun={() => runCell(i)} />)}
        </div>
      </div>
    </div>
  );
}

function Cell({ i, cell, run, onRun }: { i: number; cell: PyCell; run: Run; onRun: () => void }) {
  const [open, setOpen] = useState(i < 3);
  return (
    <section className={`py-cell py-${run.state}`}>
      <div className="py-cell-head">
        <button type="button" className="py-run" onClick={onRun} title="이 셀까지 실행 (앞 셀이 아직이면 앞부터)">{run.state === "running" ? "…" : "▶"}</button>
        <span className="py-no">[{i + 1}]</span>
        <button type="button" className="py-title" onClick={() => setOpen((v) => !v)}>{cell.title}</button>
        <span className="py-state">{run.state === "done" ? "실행됨" : run.state === "error" ? "오류" : run.state === "running" ? "실행 중" : ""}</span>
      </div>
      {open && <pre className="py-code">{cell.code}</pre>}
      {run.out && <pre className={`py-out ${run.state === "error" ? "py-out-err" : ""}`}>{run.out}</pre>}
    </section>
  );
}
