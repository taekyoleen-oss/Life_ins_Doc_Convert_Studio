import { unzip } from "./methoddoc/extract";
import { zipStore } from "./methoddoc/docx";
import { withFormulas } from "./methoddoc/formulas";
import { docToMarkdown, renderMethodDoc } from "./methoddoc/render";
import type { MethodSpec } from "./methoddoc/spec";
import { jsonToSpec, specToYaml } from "./conditions/yaml";
import { docTitle, toStandardDocx } from "./standards";
import { parseDelimited, sanitizeSheet, type ColMap, type SheetState } from "./sheet";

/**
 * 패키지(.lidpkg) — 조건 · 산출방법서 · 위험률 표를 한 파일로.
 * 압축하지 않은 ZIP 이라 이름을 .zip 으로 바꾸면 안에 든 파일을 그대로 꺼내 쓸 수 있다:
 *   package.json      무엇이 들었는지 (양식 · 이름 · 저장 시각 · 위험률 표의 열 연결)
 *   조건.yaml         조건 파일 그대로(주석 포함) — 다시 열 때 이것을 쓴다
 *   위험률표.csv       위험률 표(있을 때만) — Excel 로 바로 열린다
 *   MethodSpec.json   다른 앱(자유설계보험) 입력 — 위험률 표 포함
 *   산출방법서.md · 산출방법서.docx   조건에서 만든 산출방법서(사람이 읽는 용 — 열 때는 쓰지 않는다)
 * 한 부분이 없어도(위험률 표가 없는 조건 등) 패키지가 된다 — 든 것만 되살린다.
 */
export const PACKAGE_EXT = ".lidpkg";
export const PACKAGE_FORMAT = "Life_ins_Doc_Convert_Studio 패키지 v1";
const F = { meta: "package.json", yaml: "조건.yaml", csv: "위험률표.csv", json: "MethodSpec.json", md: "산출방법서.md", docx: "산출방법서.docx" } as const;

export interface PackageMeta {
  format: string;
  name: string;
  savedAt: string;
  product: string;
  parts: string[];
  rates: number;
  tables: number;
  /** 위험률 표의 이름과 열 연결 — CSV 는 값만 담는다 */
  sheet?: { name: string; map: ColMap[] };
}

const csvCell = (c: string) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
const toCsv = (st: SheetState) => "﻿" + [st.sheet.head, ...st.sheet.rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

/** 조건(YAML 원문) · 위험률 표 · 표를 붙인 조건(specT) → 패키지 바이트 */
export function buildPackage(o: { yaml: string; sheet: SheetState | null; spec: MethodSpec; name?: string; now?: Date }): Uint8Array {
  const enc = new TextEncoder();
  const hasSheet = !!o.sheet && o.sheet.map.some((m) => m.to === "rate");
  const sections = renderMethodDoc(withFormulas(o.spec));
  const files: [string, Uint8Array][] = [];
  const parts: string[] = [];
  const put = (name: string, data: Uint8Array | string) => { files.push([name, typeof data === "string" ? enc.encode(data) : data]); parts.push(name); };
  const meta: PackageMeta = {
    format: PACKAGE_FORMAT, name: o.name ?? o.spec.meta.productName ?? "", savedAt: (o.now ?? new Date()).toISOString(), product: o.spec.meta.productName,
    parts, rates: o.spec.rates.length, tables: o.spec.rates.filter((r) => r.table || r.tables).length,
    ...(hasSheet ? { sheet: { name: o.sheet!.sheet.name, map: o.sheet!.map } } : {}),
  };
  put(F.yaml, o.yaml);
  if (hasSheet) put(F.csv, toCsv(o.sheet!));
  put(F.json, JSON.stringify(o.spec, null, 2));
  put(F.md, "﻿" + docToMarkdown(sections, docTitle(o.spec)));
  put(F.docx, toStandardDocx(o.spec, false));
  files.unshift([F.meta, enc.encode(JSON.stringify(meta, null, 2))]);
  parts.unshift(F.meta);
  return zipStore(files);
}

export const isPackage = (buf: Uint8Array) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;

/** 패키지 → 조건·위험률 표. 조건.yaml 이 없고 MethodSpec.json 만 있으면 거기서 조건을 만든다 */
export async function readPackage(buf: Uint8Array): Promise<{ meta: PackageMeta; yaml?: string; sheet?: SheetState | null }> {
  const files = await unzip(buf);
  const text = (n: string) => { const f = files.get(n); return f ? new TextDecoder().decode(f).replace(/^﻿/, "") : undefined; };
  const metaText = text(F.meta);
  if (!metaText) throw new Error("패키지(.lidpkg)가 아닙니다 — package.json 이 없습니다");
  const meta = JSON.parse(metaText) as PackageMeta;
  if (!/Life_ins_Doc_Convert_Studio 패키지/.test(meta.format ?? "")) throw new Error(`모르는 패키지 양식입니다: ${meta.format}`);
  let yaml = text(F.yaml);
  const json = text(F.json);
  if (yaml === undefined && json) yaml = specToYaml(jsonToSpec(json), [], ` ${meta.name} (패키지의 MethodSpec) 에서 만든 조건`);
  const csv = text(F.csv);
  let sheet: SheetState | null | undefined;
  if (csv) {
    const rows = parseDelimited(csv);
    const head = rows[0] ?? [];
    sheet = sanitizeSheet({ sheet: { name: meta.sheet?.name ?? meta.name, head, rows: rows.slice(1) }, map: meta.sheet?.map ?? head.map(() => ({ to: "skip" })) });
  }
  return { meta, yaml, sheet };
}
