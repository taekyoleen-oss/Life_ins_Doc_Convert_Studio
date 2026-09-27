"use client";

import { useMemo, useState } from "react";
import { RATE_ROLE_LABEL, type RateRef } from "@/lib/methoddoc/spec";
import { itemSummary, libraryItems, suggestTarget, type LibItem, type RateLibrary } from "@/lib/rate-library";

/** 고른 항목과 이을 곳 — 조건의 위험률 id, 또는 "new"(이름으로 새 위험률) */
export interface LibPick { item: LibItem; target: string }

interface Props {
  library: RateLibrary | null;
  rates: RateRef[];
  onAdd: (picks: LibPick[]) => void;
  onClose: () => void;
}

/**
 * 기본 위험률 모음에서 고르기 — 공개 기본 위험률 + (이 PC 에 있으면) 사내 위험률 모음.
 * 고른 항목은 위험률 표 창에 남·여 열로 들어가고, 고른 조건 위험률에 이어진다(이미 이은 열은 새 열로 바뀐다) — 새 위험률이면 M04 에 더한다.
 */
export default function RateLibraryDialog({ library, rates, onAdd, onClose }: Props) {
  const items = useMemo(() => libraryItems(library), [library]);
  const cats = useMemo(() => [...new Set(items.map((x) => x.category))], [items]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("");
  const [picked, setPicked] = useState<Record<string, string>>({});      // key → target
  const shown = items.filter((x) => (!cat || x.category === cat) && (!q.trim() || `${x.name} ${x.company ?? ""} ${x.category}`.includes(q.trim())));
  const priv = items.some((x) => x.private);
  const n = Object.keys(picked).length;
  const toggle = (it: LibItem, on: boolean) => setPicked((p) => {
    const next = { ...p };
    if (on) next[it.key] = suggestTarget(it, rates) ?? "new"; else delete next[it.key];
    return next;
  });

  return (
    <div className="modal-back no-print" onClick={onClose}>
      <div className="modal lib-modal" onClick={(e) => e.stopPropagation()}>
        <h2>기본 위험률 모음</h2>
        <p className="text-xs text-muted-foreground">
          고른 위험률은 아래 위험률 표 창에 남·여 열로 들어가 조건의 위험률에 이어집니다 — 산출방법서 별첨·JSON(자유설계보험 계산)에 그 값이 실립니다.
          {priv
            ? <> <b className="text-rose-700">사내 위험률 모음</b>({library?.source}, {library?.rates.length}개)은 <b>외부 반출 금지</b> 자료입니다 — 이 PC 에서만 읽고, 내보낸 파일도 사내에서만 쓰세요.</>
            : <> 사내 위험률 모음은 이 PC 에 없습니다 — <code>python scripts/import-rate-library.py</code> 로 만들면(깃·배포 제외) 여기에 보입니다. 지금은 공개 기본 위험률만.</>}
        </p>
        <div className="lib-bar">
          <input className="inp" placeholder="이름·회사로 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="위험률 찾기" />
          <select className="inp" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="분류">
            <option value="">전체 분류 ({items.length})</option>
            {cats.map((c) => <option key={c} value={c}>{c} ({items.filter((x) => x.category === c).length})</option>)}
          </select>
        </div>
        <div className="lib-list thin-scroll">
          {shown.map((it) => {
            const on = it.key in picked;
            return (
              <div key={it.key} className={`lib-item ${on ? "lib-on" : ""}`}>
                <label className="flex min-w-0 flex-1 items-start gap-2">
                  <input type="checkbox" className="mt-1 accent-[var(--primary)]" checked={on} onChange={(e) => toggle(it, e.target.checked)} aria-label={`${it.name} 고르기`} />
                  <span className="min-w-0">
                    <span className="lib-name">{it.name}</span>
                    <span className="lib-meta">{it.category}{it.private ? " · 사내" : ""} · {it.source || "—"} · {itemSummary(it)}</span>
                  </span>
                </label>
                {on && (
                  <select className="inp lib-target" value={picked[it.key]} onChange={(e) => setPicked((p) => ({ ...p, [it.key]: e.target.value }))} aria-label={`${it.name} 이을 곳`}>
                    <option value="new">＋ 새 위험률로 조건에 더하기</option>
                    {rates.map((r) => <option key={r.id} value={r.id}>{r.name} ({RATE_ROLE_LABEL[r.role]}) 의 표로</option>)}
                  </select>
                )}
              </div>
            );
          })}
          {!shown.length && <p className="p-3 text-sm text-muted-foreground">찾는 위험률이 없습니다.</p>}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{n ? `${n}개 고름` : "위험률을 고르세요"}</span>
          <span className="flex-1" />
          <button className="btn" onClick={onClose}>닫기</button>
          <button className="btn-primary" disabled={!n} onClick={() => onAdd(items.filter((x) => x.key in picked).map((item) => ({ item, target: picked[item.key] })))}>표에 넣기 ({n})</button>
        </div>
      </div>
    </div>
  );
}
