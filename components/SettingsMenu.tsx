"use client";

import { DOC_FORMATS, type DocFormat, type Settings } from "@/lib/settings";

/** 머리의 [설정 ▾] — 문서 형식(Word 중심 / 한글 중심). 고르면 내보내기·견본·패키지·안내 글이 그 형식으로 바뀐다 */
export function SettingsMenu({ value, onChange }: { value: Settings; onChange: (s: Settings) => void }) {
  return (
    <details className="menu">
      <summary className="btn">설정 ▾</summary>
      <div className="menu-list right-0">
        <p className="menu-head">문서 형식 — 산출방법서를 주고받는 프로그램</p>
        <div role="radiogroup" aria-label="문서 형식" className="flex flex-col gap-1 px-3 py-2">
          {(Object.keys(DOC_FORMATS) as DocFormat[]).map((f) => (
            <label key={f} className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="radio" name="doc-format" className="mt-1" checked={value.docFormat === f} onChange={() => onChange({ ...value, docFormat: f })} />
              <span><b>{DOC_FORMATS[f].name} 중심</b> ({DOC_FORMATS[f].ext})<br /><small className="text-muted-foreground">{DOC_FORMATS[f].hint}</small></span>
            </label>
          ))}
        </div>
        <p className="px-3 pb-2 text-xs text-muted-foreground">어느 쪽을 골라도 Word · 한글 파일을 모두 내보내고 불러올 수 있습니다. 고른 형식이 내보내기 · 견본 · 패키지 저장에서 먼저 쓰입니다. 이 브라우저에만 기억합니다.</p>
      </div>
    </details>
  );
}
