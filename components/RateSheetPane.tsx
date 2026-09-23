"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { matchBlocks } from "@/lib/conditions/link";
import { RATE_ROLE_LABEL, type RateRef, type RateRole, type Sex } from "@/lib/methoddoc/spec";
import { baseName, colLetter, guessRole, hasNumbers, sexOf, usedColumns, type ColMap, type SheetState } from "@/lib/sheet";

const LIMIT = 400;            // 화면에 그리는 행 수 — 표에는 모두 들어간다

interface Props {
  state: SheetState | null;
  onMap: (map: ColMap[]) => void;
  onText: (text: string) => void;
  onFile: (file: File) => void;
  onClear: () => void;
  /** 조건의 위험률(M04) */
  rates: RateRef[];
  /** 조건에 위험률을 더하고 새 id 를 돌려준다 */
  onNewRates: (items: { name: string; role: RateRole }[]) => string[];
  /** 왼쪽에서 고른 조건 경로 → 그 위험률에 이은 열을 표시 */
  highlight: string[];
  onPick: (paths: string[]) => void;
  tools: ReactNode;
}

const enc = (m: ColMap) => (m.to === "rate" ? `rate:${m.rateId}` : m.to);
const NONE: ColMap[] = [];

/**
 * 위험률 표 — 붙여넣기·CSV·XLSX 를 올리면 첫 행을 열 이름으로 읽고, 열마다 조건(연령 · 위험률 · 성별)에 잇는다.
 * 이은 열은 RateRef.table 이 되어 산출방법서 위험률 표와 MethodSpec JSON(자유설계보험 입력)에 실린다.
 */
export default function RateSheetPane({ state, onMap, onText, onFile, onClear, rates, onNewRates, highlight, onPick, tools }: Props) {
  const file = useRef<HTMLInputElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const sh = state?.sheet, map = state?.map ?? NONE;

  const colPaths = useMemo(() => map.map((m) => {
    const i = m.to === "rate" ? rates.findIndex((r) => r.id === m.rateId) : -1;
    return i >= 0 ? [`rates[${i}]`] : [];
  }), [map, rates]);
  const hl = useMemo(() => matchBlocks(colPaths, highlight), [colPaths, highlight]);
  useEffect(() => { wrap.current?.querySelector("th.col-hl")?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [hl]);

  const setOne = (i: number, m: ColMap) => onMap(map.map((x, k) => (k === i ? m : x.to === "age" && m.to === "age" ? { to: "skip" } : x)));
  const choose = (i: number, v: string) => {
    if (!sh) return;
    if (v === "skip" || v === "age") return setOne(i, { to: v });
    const h = sh.head[i];
    let id = v.slice(5);
    if (v === "new") id = rates.find((r) => r.name === baseName(h))?.id ?? onNewRates([{ name: baseName(h), role: guessRole(h) }])[0];
    if (id) setOne(i, { to: "rate", rateId: id, ...(sexOf(h) ? { sex: sexOf(h) } : {}) });      // 조건 파일 오류로 못 더하면 그대로
  };
  /** 아직 잇지 않은 수 열을 이름(성별을 뺀)마다 위험률 하나로 — 남·여 열은 같은 위험률에 성별만 달리 */
  const linkRest = () => {
    if (!sh) return;
    const todo = map.flatMap((m, i) => (m.to === "skip" && hasNumbers(sh, i) ? [i] : []));
    const byName = new Map(rates.map((r) => [r.name, r.id]));
    const fresh = [...new Set(todo.map((i) => baseName(sh.head[i])))].filter((n) => !byName.has(n));
    const ids = fresh.length ? onNewRates(fresh.map((n) => ({ name: n, role: guessRole(n) }))) : [];
    if (ids.length !== fresh.length) return;
    ids.forEach((id, k) => byName.set(fresh[k], id));
    onMap(map.map((m, i) => {
      if (!todo.includes(i)) return m;
      const s = sexOf(sh.head[i]);
      return { to: "rate", rateId: byName.get(baseName(sh.head[i]))!, ...(s ? { sex: s } : {}) };
    }));
  };

  const ageCol = map.findIndex((m) => m.to === "age");
  const linked = new Set(map.flatMap((m) => (m.to === "rate" ? [m.rateId] : [])));
  const cls = (i: number) => {
    const m = map[i];
    const idle = m.to === "rate" && state && !Object.values(usedColumns(state, m.rateId)).includes(i);
    return `${m.to === "age" ? "col-age" : m.to === "rate" ? (idle ? "col-idle" : "col-rate") : "col-skip"} ${hl.has(i) ? "col-hl" : ""}`;
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\n")) return;           // 한 칸 붙여넣기는 기본 동작에 맡긴다
    e.preventDefault();
    onText(text);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" onPaste={onPaste}>
      <div className="pane-head flex-wrap">
        <b>위험률 표</b>
        {sh ? (
          <span className="truncate text-muted-foreground">
            {sh.name} · {sh.rows.length}행 × {sh.head.length}열 · {ageCol >= 0 ? `연령 ${colLetter(ageCol)}열` : <span className="text-amber-700">연령 열을 정하세요</span>}
            {" · "}위험률 {linked.size}개 연결 · 남·여 열은 두 벌 다 싣습니다
          </span>
        ) : <span className="text-muted-foreground">연령 × 위험률 표를 올려 조건의 위험률에 잇습니다</span>}
        <span className="flex-1" />
        <button className="btn" onClick={() => file.current?.click()}>파일 올리기</button>
        <input ref={file} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        {sh && <button className="btn" onClick={linkRest} title="아직 잇지 않은 수 열을 위험률로 더해 잇습니다(남·여 열은 한 위험률로)">안 이은 열 → 새 위험률</button>}
        {sh && <button className="btn" onClick={() => { if (window.confirm("위험률 표를 지울까요? (조건의 위험률은 남습니다)")) onClear(); }}>지우기</button>}
        {tools}
      </div>
      {!sh ? (
        <div className="sheet-empty">
          <p>Excel 표를 복사해 아래 칸에 붙여넣거나(<b>Ctrl+V</b>) CSV·XLSX 파일을 올리세요. <b>첫 행은 열 이름</b>(연령 · 사망률(남) · 사망률(여) · 암발생률 …) — 조건의 위험률 이름과 겹치면 바로 잇습니다.
            산출방법서(PDF·Word·한글)에 든 별첨 위험률 표는 [열기]만 해도 여기로 들어옵니다.</p>
          <textarea className="inp h-24 font-mono text-xs" aria-label="위험률 표 붙여넣기" placeholder={"연령\t사망률(남)\t사망률(여)\n40\t0.00103\t0.00052\n41\t0.00112\t0.00056"} />
        </div>
      ) : (
        <div ref={wrap} className="sheet-wrap thin-scroll" tabIndex={0} title="표를 누르고 Ctrl+V 로 새 표를 붙여넣을 수 있습니다">
          <table className="sheet">
            <thead>
              <tr>
                <th className="sheet-no">#</th>
                {sh.head.map((h, i) => (
                  <th key={i} className={`sheet-name ${cls(i)}`} onClick={() => colPaths[i].length && onPick(colPaths[i])} title={colPaths[i].length ? "누르면 이 열을 이은 위험률을 조건·산출방법서에서 표시합니다" : undefined}>
                    <span className="font-mono text-[10px] text-muted-foreground">{colLetter(i)}</span> {h}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="sheet-no">잇기</th>
                {sh.head.map((h, i) => {
                  const m = map[i];
                  const known = m.to !== "rate" || rates.some((r) => r.id === m.rateId);
                  return (
                    <th key={i} className={`sheet-map ${cls(i)}`}>
                      <select value={enc(m)} onChange={(e) => choose(i, e.target.value)} className="sheet-sel" aria-label={`${h} 열 잇기`}>
                        <option value="skip">— 쓰지 않음</option>
                        <option value="age">연령(나이)</option>
                        {rates.map((r) => <option key={r.id} value={`rate:${r.id}`}>{r.name} ({RATE_ROLE_LABEL[r.role]})</option>)}
                        {!known && m.to === "rate" && <option value={enc(m)}>없는 위험률 {m.rateId}</option>}
                        <option value="new">＋ 새 위험률로 더하기</option>
                      </select>
                      {m.to === "rate" && (
                        <select value={m.sex ?? ""} onChange={(e) => setOne(i, { ...m, sex: (e.target.value || undefined) as Sex | undefined })} className="sheet-sel mt-0.5" aria-label={`${h} 열 성별`}>
                          <option value="">남녀 공통</option><option value="M">남</option><option value="F">여</option>
                        </select>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sh.rows.slice(0, LIMIT).map((r, ri) => (
                <tr key={ri}>
                  <td className="sheet-no">{ri + 2}</td>
                  {r.map((c, ci) => <td key={ci} className={cls(ci)}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {sh.rows.length > LIMIT && <p className="px-2 py-1 text-xs text-muted-foreground">… {sh.rows.length - LIMIT}행 더 — 화면에만 줄였고 표에는 모두 들어갑니다</p>}
        </div>
      )}
    </div>
  );
}
