"use client";

import { FORMULA_SAMPLES, PIECES, SYMBOLS, type FormulaSample } from "@/lib/snippets";
import { formulaHtml } from "./DocPreview";

interface Props {
  /** 산출식 견본을 고름 */
  onFormula: (f: FormulaSample) => void;
  /** 기호·조각을 고름 — 없으면 그 줄을 숨긴다(조건에 식으로 더할 때) */
  onInline?: (text: string) => void;
  /** 편집 탭의 문서 요소(절 제목·표·비고) */
  parts?: { label: string; text: string }[];
  onPart?: (text: string) => void;
  hint: string;
}

const GROUPS = [...new Set(FORMULA_SAMPLES.map((f) => f.group))];

/**
 * 수식·기호 견본. 누르면 호출한 쪽이 정한 곳(커서 자리 · 조건의 식)에 넣는다.
 * 버튼을 눌러도 편집기 포커스·커서가 그대로 있게 mousedown 기본 동작을 막는다.
 */
export default function FormulaPalette({ onFormula, onInline, parts, onPart, hint }: Props) {
  return (
    <div className="palette thin-scroll no-print" onMouseDown={(e) => { if ((e.target as HTMLElement).closest("button")) e.preventDefault(); }}>
      <p className="palette-hint">{hint}</p>
      {onInline && (
        <div className="palette-row">
          <b>기호</b>
          {SYMBOLS.map((s) => <button key={s} className="pal-sym" onClick={() => onInline(s)}>{s}</button>)}
          <b className="ml-2">조각</b>
          {PIECES.map((p) => <button key={p.label} className="pal-btn" title={p.text} onClick={() => onInline(p.text)}>{p.label}</button>)}
        </div>
      )}
      {parts && onPart && (
        <div className="palette-row">
          <b>문서</b>
          {parts.map((p) => <button key={p.label} className="pal-btn" onClick={() => onPart(p.text)}>{p.label}</button>)}
        </div>
      )}
      {GROUPS.map((g) => (
        <div key={g} className="palette-row items-stretch">
          <b className="self-center">{g}</b>
          {FORMULA_SAMPLES.filter((f) => f.group === g).map((f) => (
            <button key={f.label} className="pal-tile" title={f.text} onClick={() => onFormula(f)}>
              <small>{f.label}</small>
              <span dangerouslySetInnerHTML={{ __html: formulaHtml(f.text) }} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
