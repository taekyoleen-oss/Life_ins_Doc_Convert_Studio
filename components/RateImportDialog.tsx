"use client";

import { useMemo, useState } from "react";
import { RATE_ROLE_LABEL, type RateRef, type RateRole, type Sex } from "@/lib/methoddoc/spec";
import { firstRowIsHead, guessAgeColumn, guessImportCols, importColumns, importedColumns, type ImportCol } from "@/lib/rate-process";
import { parseDelimited, readXlsx } from "@/lib/sheet";

/** 불러온 열 하나 — 이을 곳은 조건의 위험률 id, 또는 "new"(이름으로 새 위험률) */
export interface ImportPick { name: string; role: RateRole; head: string; ages: number[]; values: number[]; target: string }

interface Props {
  rates: RateRef[];
  onAdd: (picks: ImportPick[]) => void;
  onClose: () => void;
}

/**
 * 스프레드시트에서 위험률 불러오기 — 붙여넣기(Excel 복사)·CSV·XLSX 를 띄워
 * ① 첫 행이 제목인지 확인하고 ② 연령 열과 위험률 열을 고르고 ③ 열마다 이름·성별·유형(속성)을 정해
 * 위험률 표에 넣고 조건(M04)에 더하거나 이미 있는 위험률에 잇는다.
 */
export default function RateImportDialog({ rates, onAdd, onClose }: Props) {
  const [rows, setRows] = useState<string[][]>([]);
  const [src, setSrc] = useState("");
  const [head, setHead] = useState(true);
  const [ageCol, setAgeCol] = useState(-1);
  const [cols, setCols] = useState<(ImportCol & { target: string })[]>([]);
  const [err, setErr] = useState("");

  const view = useMemo(() => importColumns(rows, head), [rows, head]);
  /** 표를 읽으면(또는 제목 행을 바꾸면) 연령 열·위험률 열을 다시 어림한다 */
  const guess = (r: string[][], h: boolean) => {
    const v = importColumns(r, h);
    const age = guessAgeColumn(v.heads, v.body);
    setAgeCol(age);
    setCols(guessImportCols(v.heads, v.body, age).map((c) => {
      const same = rates.find((x) => x.name === c.name);
      return { ...c, target: same?.id ?? "new" };
    }));
  };
  const load = (r: string[][], name: string) => {
    if (r.length < 2) { setErr(`${name}: 값이 든 행이 둘 이상 있어야 합니다`); return; }
    const h = firstRowIsHead(r);
    setErr(""); setRows(r); setSrc(name); setHead(h); guess(r, h);
  };
  const readFile = async (f: File) => {
    try {
      const ext = (f.name.split(".").pop() ?? "").toLowerCase();
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (ext === "xlsx") return load(await readXlsx(bytes), f.name);
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { text = new TextDecoder("euc-kr").decode(bytes); }
      load(parseDelimited(text), f.name);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const setCol = (i: number, p: Partial<ImportCol & { target: string }>) => setCols((cs) => cs.map((c, k) => (k === i ? { ...c, ...p } : c)));
  const out = ageCol >= 0 ? importedColumns(view.body, ageCol, cols) : [];
  const picks: ImportPick[] = out.map((c) => ({ ...c, target: cols.find((x) => x.use && x.name.trim() === c.name && (x.sex ? c.head.endsWith(x.sex === "M" ? "(남)" : "(여)") : c.head === c.name))?.target ?? "new" }));
  const ok = ageCol >= 0 && picks.length > 0 && picks.every((p) => p.ages.length);

  return (
    <div className="modal-back no-print" onClick={onClose}>
      <div className="modal imp-modal" onClick={(e) => e.stopPropagation()}>
        <h2>스프레드시트에서 위험률 불러오기</h2>
        <p className="text-xs text-muted-foreground">Excel 에서 복사해 붙여넣거나 CSV·XLSX 를 고릅니다. 첫 행이 제목(열 이름)인지 확인하고, 연령 열과 위험률 열의 이름·성별·유형을 정하면 위험률 표와 조건(M04)에 함께 들어갑니다.</p>
        <div className="imp-src">
          <textarea className="inp" rows={3} placeholder={"여기에 붙여넣기 — 예:\n연령\t뇌졸중(남)\t뇌졸중(여)\n40\t0.00123\t0.00098"} aria-label="표 붙여넣기"
            onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t) { e.preventDefault(); load(parseDelimited(t), "붙여넣기"); } }} />
          <label className="btn">파일 고르기 (CSV · XLSX)<input type="file" accept=".csv,.tsv,.txt,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ""; }} /></label>
        </div>
        {err && <p className="mt-1 text-xs text-rose-700">{err}</p>}
        {rows.length > 0 && (
          <>
            <div className="imp-bar">
              <b>{src}</b> · {view.body.length}행 × {view.heads.length}열
              <label className="flex items-center gap-1"><input type="checkbox" className="accent-[var(--primary)]" checked={head} onChange={(e) => { setHead(e.target.checked); guess(rows, e.target.checked); }} />첫 행은 제목(열 이름)</label>
              <label className="flex items-center gap-1">연령 열
                <select className="inp" value={ageCol} onChange={(e) => { const a = Number(e.target.value); setAgeCol(a); setCols(guessImportCols(view.heads, view.body, a).map((c) => ({ ...c, target: rates.find((x) => x.name === c.name)?.id ?? "new" }))); }}>
                  <option value={-1}>— 고르세요</option>
                  {view.heads.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </label>
            </div>
            <div className="imp-preview thin-scroll">
              <table className="calc-table">
                <thead><tr>{view.heads.map((h, i) => <th key={i} className={i === ageCol ? "imp-age" : cols.some((c) => c.col === i && c.use) ? "imp-use" : ""}>{h}</th>)}</tr></thead>
                <tbody>{view.body.slice(0, 5).map((r, k) => <tr key={k}>{r.map((c, i) => <td key={i} className="num">{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <table className="calc-table imp-cols">
              <thead><tr><th>쓰기</th><th>열</th><th>위험률 이름</th><th>성별</th><th>유형</th><th>이을 곳</th></tr></thead>
              <tbody>
                {cols.map((c, i) => (
                  <tr key={c.col}>
                    <td><input type="checkbox" className="accent-[var(--primary)]" checked={c.use} onChange={(e) => setCol(i, { use: e.target.checked })} aria-label={`${view.heads[c.col]} 쓰기`} /></td>
                    <td>{view.heads[c.col]}</td>
                    <td><input className="inp" value={c.name} onChange={(e) => setCol(i, { name: e.target.value })} aria-label={`${view.heads[c.col]} 이름`} /></td>
                    <td><select className="inp" value={c.sex ?? ""} onChange={(e) => setCol(i, { sex: (e.target.value || undefined) as Sex | undefined })}><option value="">공통</option><option value="M">남</option><option value="F">여</option></select></td>
                    <td><select className="inp" value={c.role} onChange={(e) => setCol(i, { role: e.target.value as RateRole })}>{Object.entries(RATE_ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                    <td><select className="inp" value={c.target} onChange={(e) => setCol(i, { target: e.target.value })}>
                      <option value="new">＋ 새 위험률</option>
                      {rates.map((r) => <option key={r.id} value={r.id}>{r.name} 의 표로</option>)}
                    </select></td>
                  </tr>
                ))}
                {!cols.length && <tr><td colSpan={6} className="text-muted-foreground">값이 수인 열이 없습니다 — 제목 행·연령 열을 확인하세요.</td></tr>}
              </tbody>
            </table>
          </>
        )}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{ok ? `${picks.length}열 → ${new Set(picks.map((p) => p.name)).size}개 위험률` : rows.length ? "연령 열과 쓸 열을 정하세요" : "표를 붙여넣거나 파일을 고르세요"}</span>
          <span className="flex-1" />
          <button className="btn" onClick={onClose}>닫기</button>
          <button className="btn-primary" disabled={!ok} onClick={() => onAdd(picks)}>위험률 표에 넣기</button>
        </div>
      </div>
    </div>
  );
}
