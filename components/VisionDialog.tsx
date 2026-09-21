"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { estimate, transcribe, type PageImage } from "@/lib/methoddoc/vision";
import type { ExtractedDoc } from "@/lib/methoddoc/extract";
import { sourceOf, type PageSource } from "@/lib/pages";
import { VISION_MODEL, askWithKey, clearKey, explainError, loadKey, saveKey } from "@/lib/vision-client";

interface Props {
  file: File;
  /** 왜 이 창이 떴는지 — "글자 층이 없는 스캔 PDF 입니다" */
  reason: string;
  onDone: (doc: ExtractedDoc, pages: string[], usd: number) => void;
  onClose: () => void;
}

/** 그림으로 읽기 — 쪽 고르기 · API 키 · 예상 비용 · 보내기. 보내기 전에는 아무것도 나가지 않는다 */
export default function VisionDialog({ file, reason, onDone, onClose }: Props) {
  const [src, setSrc] = useState<PageSource | null>(null);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [key, setKey] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState<{ step: string; done: number; total: number } | null>(null);
  const [err, setErr] = useState("");
  const abort = useRef<AbortController | null>(null);

  useEffect(() => { const k = loadKey(); setKey(k.key); setRemember(k.remembered); }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const s = await sourceOf(file);
        if (!live) return;
        setSrc(s);
        setSel(new Set(Array.from({ length: Math.min(s.count, 30) }, (_, i) => i + 1)));
        for (let n = 1; n <= s.count && live; n++) {
          const t = await s.thumb(n);
          if (live) setThumbs((x) => { const y = [...x]; y[n - 1] = t; return y; });
        }
      } catch (e) { if (live) setErr(`그림을 만들지 못했습니다: ${explainError(e)}`); }
    })();
    return () => { live = false; abort.current?.abort(); };
  }, [file]);

  const pages = [...sel].sort((a, b) => a - b);
  const cost = useMemo(() => (src ? estimate(pages.map(() => src.size)) : null), [src, pages.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (n: number) => setSel((s) => { const t = new Set(s); if (t.has(n)) t.delete(n); else t.add(n); return t; });

  const send = async () => {
    if (!src || !pages.length) return;
    if (!/^sk-ant-/.test(key.trim())) { setErr("Anthropic API 키(sk-ant-…)를 넣어 주세요"); return; }
    saveKey(key.trim(), remember);
    setErr("");
    const ac = new AbortController();
    abort.current = ac;
    let usd = 0;
    try {
      const images: PageImage[] = [];
      for (const [i, n] of pages.entries()) {
        setBusy({ step: "쪽 그림 만드는 중", done: i, total: pages.length });
        images.push(await src.image(n));
        if (ac.signal.aborted) throw new Error("멈췄습니다");
      }
      setBusy({ step: "옮겨 적는 중", done: 0, total: pages.length });
      const doc = await transcribe(images, askWithKey(key.trim(), (u) => { usd += u.usd; }), {
        signal: ac.signal, onPage: (d) => setBusy({ step: "옮겨 적는 중", done: d, total: pages.length }),
      });
      onDone(doc, images.map((im) => `data:${im.mediaType};base64,${im.base64}`), usd);
    } catch (e) {
      setErr(`${explainError(e)}${usd ? ` — 쓴 비용 약 $${usd.toFixed(3)}` : ""}`);
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  return (
    <div className="modal-back no-print" onClick={() => !busy && onClose()}>
      <div className="modal vision" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="그림으로 읽기">
        <h2>그림으로 읽기 — {file.name}</h2>
        <p className="text-sm text-muted-foreground">{reason} 쪽 그림을 AI({VISION_MODEL})가 글로 옮겨 적고, 그 글을 앱의 규칙이 읽어 조건으로 만듭니다. 값 옆 주석과 [원문] 탭의 쪽 그림으로 대조하세요.</p>

        <div className="vision-bar">
          <b>보낼 쪽 {pages.length}{src ? ` / ${src.count}` : ""}</b>
          <button className="btn" disabled={!src || !!busy} onClick={() => src && setSel(new Set(Array.from({ length: src.count }, (_, i) => i + 1)))}>전체</button>
          <button className="btn" disabled={!src || !!busy} onClick={() => setSel(new Set())}>없음</button>
          <span className="text-xs text-muted-foreground">산출방법서 본문 쪽만 고르면 비용이 줄어듭니다</span>
        </div>
        <div className="vision-grid thin-scroll">
          {!src && !err && <p className="p-4 text-sm text-muted-foreground">쪽 그림을 만드는 중…</p>}
          {src && Array.from({ length: src.count }, (_, i) => i + 1).map((n) => (
            <label key={n} className={`vision-page ${sel.has(n) ? "vision-on" : ""}`}>
              <input type="checkbox" checked={sel.has(n)} disabled={!!busy} onChange={() => toggle(n)} />
              {/* eslint-disable-next-line @next/next/no-img-element -- 브라우저에서 만든 data URL 미리보기 */}
              {thumbs[n - 1] ? <img src={thumbs[n - 1]} alt={`${n}쪽`} /> : <span className="vision-wait" />}
              <span>{n}쪽</span>
            </label>
          ))}
        </div>

        <div className="vision-key">
          <label className="flex flex-1 items-center gap-2">
            <span className="whitespace-nowrap text-sm font-semibold">Anthropic API 키</span>
            <input type="password" className="inp flex-1" value={key} placeholder="sk-ant-…" autoComplete="off" disabled={!!busy}
              onChange={(e) => setKey(e.target.value)} />
          </label>
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={remember} disabled={!!busy} onChange={(e) => setRemember(e.target.checked)} />이 브라우저에 기억</label>
          <button className="btn" disabled={!!busy} onClick={() => { clearKey(); setKey(""); setRemember(false); }}>키 지우기</button>
        </div>
        <p className="text-xs text-muted-foreground">키는 이 브라우저에서 Anthropic API 로 바로 보낼 때만 씁니다 — 이 앱의 서버·조건 파일·내보내기에는 들어가지 않습니다. 키는 console.anthropic.com 에서 만듭니다.</p>

        <p className="vision-send">
          고른 <b>{pages.length}쪽</b> 그림을 <b>Anthropic API</b> 로 보냅니다.
          {cost && pages.length > 0 && <> 예상 비용 약 <b>${cost.usd.toFixed(2)}</b> (약 {Math.round(cost.tokens / 1000)}천 토큰, 실제 비용은 끝난 뒤 알림)</>}
        </p>
        {busy && (
          <div className="vision-progress">
            <div style={{ width: `${Math.round((busy.done / Math.max(1, busy.total)) * 100)}%` }} />
            <span>{busy.step} {busy.done}/{busy.total}쪽…</span>
          </div>
        )}
        {err && <p className="rounded bg-rose-100 px-2 py-1 text-sm text-rose-800">{err}</p>}
        <div className="mt-3 flex justify-end gap-2">
          {busy
            ? <button className="btn" onClick={() => abort.current?.abort()}>멈추기</button>
            : <button className="btn" onClick={onClose}>닫기</button>}
          <button className="btn-primary" disabled={!src || !pages.length || !!busy} onClick={() => void send()}>{pages.length}쪽 보내기</button>
        </div>
      </div>
    </div>
  );
}
