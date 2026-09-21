"use client";

import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";

/**
 * 조건 파일(YAML)과 LaTeX·Markdown 원문을 고치는 편집기.
 * 반대편에서 고른 부분은 줄 단위 앰버색(cm-mirror-hl), 조건 오류 줄은 붉은색(cm-error-line)으로 비춘다.
 * (mdTeX Studio 의 SourceEditor 와 같은 방식)
 */

type Lines = [number, number][];
const setMarks = StateEffect.define<{ mirror: Lines; errors: number[] }>();
const mirrorLine = Decoration.line({ class: "cm-mirror-hl" });
const errorLine = Decoration.line({ class: "cm-error-line" });

const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setMarks)) continue;
      const doc = tr.state.doc, last = doc.lines;
      const byLine = new Map<number, Decoration>();
      for (const n of e.value.errors) if (n >= 1 && n <= last) byLine.set(n, errorLine);
      for (const [a, b] of e.value.mirror) for (let n = Math.max(1, a); n <= Math.min(b, last); n++) if (!byLine.has(n)) byLine.set(n, mirrorLine);
      return Decoration.set([...byLine].sort((x, y) => x[0] - y[0]).map(([n, d]) => d.range(doc.line(n).from)));
    }
    return tr.docChanged ? deco.map(tr.changes) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export interface EditorApi {
  scrollToLine(line: number): void;
  /** 커서 자리에 글을 넣는다(고른 글은 바꾼다) — 수식·기호 견본 */
  insert(text: string): void;
}

interface Props {
  value: string;
  onChange: (text: string) => void;
  language?: "yaml" | "plain";
  mirror?: Lines;
  errors?: number[];
  /** 고른 줄 범위. 선택이 없으면 커서가 있는 줄 하나 */
  onSelectLines?: (from: number, to: number) => void;
  apiRef?: React.MutableRefObject<EditorApi | null>;
  readOnly?: boolean;
}

export default function CodeEditor({ value, onChange, language = "plain", mirror = [], errors = [], onSelectLines, apiRef, readOnly }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange), onSelRef = useRef(onSelectLines);
  onChangeRef.current = onChange;
  onSelRef.current = onSelectLines;

  useEffect(() => {
    if (!host.current) return;
    const ext: Extension[] = [
      basicSetup, marksField, EditorView.lineWrapping,
      EditorState.readOnly.of(!!readOnly),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        if (u.selectionSet || u.docChanged) {
          const s = u.state.selection.main;
          onSelRef.current?.(u.state.doc.lineAt(s.from).number, u.state.doc.lineAt(s.to).number);
        }
      }),
    ];
    if (language === "yaml") ext.push(yamlLang());
    const v = new EditorView({ doc: value, parent: host.current, extensions: ext });
    view.current = v;
    if (apiRef) apiRef.current = {
      scrollToLine: (n) => {
        const line = v.state.doc.line(Math.max(1, Math.min(n, v.state.doc.lines)));
        v.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
      },
      insert: (text) => { v.dispatch(v.state.replaceSelection(text), { scrollIntoView: true }); v.focus(); },
    };
    return () => { v.destroy(); view.current = null; if (apiRef) apiRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly]);

  // 밖에서 내용을 바꾼 경우(파일 열기·조건 반영)만 통째로 교체 — 타이핑 중에는 같은 글이라 건너뛴다
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: setMarks.of({ mirror, errors }) });
  }, [mirror, errors]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
