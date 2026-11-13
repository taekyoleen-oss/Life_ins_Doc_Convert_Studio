"use client";

import { useMemo, useState } from "react";
import { applyChanges, CHANGE_GROUPS, relinkSheet, renamedRates, type ChangeItem } from "@/lib/conditions/changes";
import { computeSavings, computeSpec, PAY_METHODS, type CalcContract } from "@/lib/methoddoc/calc";
import type { MethodSpec } from "@/lib/methoddoc/spec";
import { attachTables, autoMap, type SheetState } from "@/lib/sheet";

/** 고친 산출방법서를 읽은 결과 — 반영 확인 창에 넘긴다 */
export interface SyncInput {
  /** 파일 이름 · 양식(표준 산출방법서 v8 …, 없으면 다른 양식) · 읽은 항목 수 */
  name: string; format?: string; read: number;
  /** 지금 조건 · 문서를 모두 반영한 조건 · 바뀐 항목 */
  current: MethodSpec; merged: MethodSpec; items: ChangeItem[];
  /** 읽으면서 알린 것 · 못 읽은 것 */
  warnings: string[];
  /** 문서의 별첨 위험률 값 표가 지금 표와 다를 때 — 그 표 */
  newSheet: SheetState | null;
}
/** 별첨 위험률 값 표 줄의 id — 조건 항목이 아니라 위험률 표 창을 바꾼다 */
export const SHEET_CHANGE = "sheet";

interface Props {
  input: SyncInput;
  /** 지금 위험률 표 · 산출 조건(성별 · 나이 · 납입기간 …) — 보험료를 견주는 데 쓴다 */
  sheet: SheetState | null;
  contract: CalcContract;
  onApply: (ids: string[]) => void;
  onClose: () => void;
}

const won = (x: number) => `${Math.round(x).toLocaleString("ko-KR")}원`;
/** 그 조건의 보험료 — 보장마다 한 줄과 합계(적립형은 위험보험료 · 만기환급금) */
function premiumOf(spec: MethodSpec, sheet: SheetState | null, c: CalcContract): { rows: [string, string][]; total?: number; note?: string } {
  try {
    const s = attachTables(spec, sheet);
    if (s.savings) {
      const r = computeSavings(s, c);
      const last = r.rows[r.rows.length - 1];
      return { rows: [["위험보험료 (월)", won(r.risk)], ["만기환급금", last ? `${won(last.w)} (환급률 ${(last.ratio * 100).toFixed(1)}%)` : "—"]], note: r.error };
    }
    const r = computeSpec(s, c);
    return {
      rows: r.benefits.map((b) => [b.name, b.error ? "계산하지 못함" : `${won(b.premium)} (10만원당 ${b.per100k.toLocaleString("ko-KR")})`]), total: r.premium,
      note: [r.missingRates.length ? `값 표가 없는 위험률: ${r.missingRates.join(" · ")} (0 으로 계산)` : "", ...r.errors].filter(Boolean).join(" / ") || undefined,
    };
  } catch (e) { return { rows: [], note: e instanceof Error ? e.message : String(e) }; }
}

/** 손댄 조건이 있는데 산출방법서를 열 때 — 조건을 새로 만들지, 지금 조건에 바뀐 곳만 넣을지 */
export function OpenChoice({ name, onNew, onMerge, onClose }: { name: string; onNew: () => void; onMerge: () => void; onClose: () => void }) {
  return (
    <div className="modal-back no-print" onClick={onClose}>
      <div className="modal open-choice" role="dialog" aria-label="산출방법서 열기" onClick={(e) => e.stopPropagation()}>
        <h2>산출방법서를 어떻게 열까요?</h2>
        <p>지금 조건에 고친 내용이 있습니다. <b>{name}</b></p>
        <div className="mt-3 flex flex-col gap-2">
          <button className="btn-primary text-left" onClick={onMerge}>지금 조건에 반영하기 — 문서에서 바뀐 곳만 골라 넣습니다 (고친 내용 · 주석은 그대로)</button>
          <button className="btn text-left" onClick={onNew}>새 조건으로 열기 — 지금 조건을 이 문서에서 읽은 조건으로 바꿉니다</button>
          <button className="btn text-left" onClick={onClose}>취소</button>
        </div>
      </div>
    </div>
  );
}

/**
 * 반영 확인 — 고친 산출방법서(Word · 한글 · PDF)에서 무엇이 바뀌는지 줄마다 보이고, 고른 것만 조건에 넣는다.
 * ① 문서를 읽음 → ② 바뀐 곳(묶음별 · 줄마다 고르기) → ③ 보험료가 어떻게 달라지는지 → ④ 반영.
 */
export default function SyncDialog({ input, sheet, contract, onApply, onClose }: Props) {
  const rows = useMemo<ChangeItem[]>(() => [...input.items, ...(input.newSheet
    ? [{ id: SHEET_CHANGE, group: "위험률", label: "위험률 값 표 (별첨)", before: "지금 위험률 표", after: `${input.newSheet.sheet.head.length - 1}열 × ${input.newSheet.sheet.rows.length}행`, kind: "고침" as const }] : [])], [input]);
  const [pick, setPick] = useState<Set<string>>(() => new Set(rows.map((r) => r.id)));
  const toggle = (ids: string[], on: boolean) => setPick((p) => { const n = new Set(p); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; });
  const groups = [...CHANGE_GROUPS, ...new Set(rows.map((r) => r.group).filter((g) => !CHANGE_GROUPS.includes(g)))]
    .map((g) => [g, rows.filter((r) => r.group === g)] as const).filter(([, l]) => l.length);

  const before = useMemo(() => premiumOf(input.current, sheet, contract), [input, sheet, contract]);
  const after = useMemo(() => {
    const spec = applyChanges(input.current, input.merged, [...pick].filter((id) => id !== SHEET_CHANGE));
    // 반영할 때와 같은 표로 센다 — 새 값 표는 반영 뒤의 위험률에 다시 잇고, 지금 표는 기호를 바꾼 위험률의 열 잇기를 옮긴다
    const st = pick.has(SHEET_CHANGE) && input.newSheet ? { sheet: input.newSheet.sheet, map: autoMap(input.newSheet.sheet, spec.rates) }
      : relinkSheet(sheet, renamedRates(input.current.rates, spec.rates));
    return premiumOf(spec, st, contract);
  }, [input, sheet, contract, pick]);
  const names = [...new Set([...before.rows, ...after.rows].map(([n]) => n))];
  const cell = (p: typeof before, n: string) => p.rows.find(([k]) => k === n)?.[1] ?? "—";
  const pay = PAY_METHODS.find(([k]) => k === contract.freq)?.[1] ?? "";
  const diff = before.total !== undefined && after.total !== undefined ? after.total - before.total : undefined;

  return (
    <div className="modal-back no-print" onClick={onClose}>
      <div className="modal imp-modal sync-modal flex flex-col" role="dialog" aria-label="고친 산출방법서 반영" onClick={(e) => e.stopPropagation()}>
        <h2>고친 산출방법서 반영</h2>

        <p className="sync-step mt-1 text-sm"><b>① 문서를 읽었습니다</b> — {input.name} · {input.format ?? "표준 양식이 아닌 문서(읽힌 값만 견줍니다)"} · 읽은 항목 {input.read}개</p>

        <div className="mt-2 flex items-center gap-2 text-sm">
          <b>② 바뀐 곳</b>
          <span className="text-muted-foreground">{rows.length ? `${rows.length}곳 가운데 ${pick.size}곳을 반영합니다` : ""}</span>
          <span className="flex-1" />
          {rows.length > 1 && <>
            <button type="button" className="pane-tool" onClick={() => toggle(rows.map((r) => r.id), true)}>모두 고르기</button>
            <button type="button" className="pane-tool" onClick={() => toggle(rows.map((r) => r.id), false)}>모두 풀기</button>
          </>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {!rows.length && <p className="sync-same my-3 rounded border border-dashed p-3 text-sm">조건과 같습니다 — 문서에서 조건으로 옮길 바뀐 값이 없습니다. (문장만 고친 것은 조건에 들어가지 않습니다)</p>}
          {rows.length > 0 && (
            <table className="calc-table sync-table w-full text-left">
              <thead><tr><th className="w-8" /><th>항목</th><th>지금 조건</th><th>문서 값</th><th className="w-12">구분</th></tr></thead>
              {groups.map(([g, list]) => (
                <tbody key={g} data-group={g}>
                  <tr className="sync-group">
                    <th><input type="checkbox" aria-label={`${g} 모두`} checked={list.every((r) => pick.has(r.id))} onChange={(e) => toggle(list.map((r) => r.id), e.target.checked)} /></th>
                    <th colSpan={4} className="text-left">{g} <span className="font-normal text-muted-foreground">{list.length}곳</span></th>
                  </tr>
                  {list.map((r) => (
                    <tr key={r.id} data-change={r.id} className={pick.has(r.id) ? "" : "opacity-50"}>
                      <td><input type="checkbox" aria-label={`${r.label} 반영`} checked={pick.has(r.id)} onChange={(e) => toggle([r.id], e.target.checked)} /></td>
                      <td>{r.label}</td>
                      <td className="break-all">{r.before}</td>
                      <td className="break-all font-semibold">{r.after}</td>
                      <td>{r.kind}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          )}
          {input.warnings.length > 0 && (
            <div className="sync-warn mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <b>확인이 필요한 곳 {input.warnings.length}건</b> — 문서에서 읽지 못했거나 어긋난 곳입니다. 반영 뒤 조건에서 직접 확인하세요.
              <ul className="mt-1 list-disc pl-5">{input.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}

          {rows.length > 0 && (
            <div className="sync-prem mt-3 text-sm">
              <b>③ 보험료 변화</b> <span className="text-muted-foreground">— 지금 [산출 조건]({contract.sex === "F" ? "여" : "남"} {contract.age}세 · {pay})으로 다시 계산했습니다</span>
              <table className="calc-table mt-1 w-full">
                <thead><tr><th className="text-left">구분</th><th>지금 조건</th><th>고른 것을 반영하면</th></tr></thead>
                <tbody>
                  {names.map((n) => <tr key={n}><td>{n}</td><td className="num">{cell(before, n)}</td><td className={`num ${cell(before, n) !== cell(after, n) ? "font-semibold" : ""}`}>{cell(after, n)}</td></tr>)}
                  {before.total !== undefined && after.total !== undefined && (
                    <tr className="sync-total"><th className="text-left">{pay} 보험료</th><th className="num">{won(before.total)}</th>
                      <th className="num">{won(after.total)}{diff ? ` (${diff > 0 ? "+" : "−"}${Math.abs(diff).toLocaleString("ko-KR")}원)` : " (같음)"}</th></tr>
                  )}
                </tbody>
              </table>
              {[before.note, after.note].filter((x, i, a) => x && a.indexOf(x) === i).map((x) => <p key={x} className="mt-1 text-xs text-amber-800">※ {x}</p>)}
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{rows.length ? "④ 고르지 않은 곳은 지금 조건 그대로 둡니다. 반영한 뒤에도 ↶ 되돌리기로 돌아갈 수 있습니다." : ""}</span>
          <span className="flex-1" />
          <button className="btn" onClick={onClose}>{rows.length ? "취소" : "닫기"}</button>
          {rows.length > 0 && <button className="btn-primary" disabled={!pick.size} onClick={() => onApply([...pick])}>고른 것 반영 ({pick.size})</button>}
        </div>
      </div>
    </div>
  );
}
