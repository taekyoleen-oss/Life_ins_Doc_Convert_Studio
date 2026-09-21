import type { Evidence } from "../methoddoc/spec";

/**
 * 조건 경로로 세 곳을 잇는다: 조건 파일의 줄 ↔ 산출방법서 블록 ↔ 불러온 원문의 근거(본문 N줄·표 N).
 * 경로는 "basis.interest", "expenses[2]", "benefits[0].amount" 꼴. 블록은 "a|b" 로 여러 경로를 가질 수 있다.
 */

export const splitPaths = (p?: string | null) => (p ? p.split("|").filter(Boolean) : []);

/** child 가 parent 자신이거나 그 아래인지 */
export const under = (child: string, parent: string) =>
  child === parent || child.startsWith(`${parent}.`) || child.startsWith(`${parent}[`);

/** 줄 범위 → 그 줄들에 걸친 가장 깊은 조건 경로들 */
export function pathsAtLines(ranges: Map<string, [number, number]>, from: number, to: number): string[] {
  const hit = [...ranges].filter(([, [a, b]]) => a <= to && b >= from).map(([p]) => p);
  return hit.filter((p) => !hit.some((q) => q !== p && under(q, p)));
}

/**
 * 선택한 경로마다 짝이 되는 블록: 같거나 그 아래 경로를 가진 블록이 있으면 그것들,
 * 없으면 가장 가까운 윗 경로의 블록(예: benefits[0].amount → 담보 표의 그 행).
 */
export function matchBlocks(blockPaths: string[][], selected: string[]): Set<number> {
  const out = new Set<number>();
  for (const s of selected) {
    let found = false;
    blockPaths.forEach((ps, i) => { if (ps.some((p) => under(p, s))) { out.add(i); found = true; } });
    if (found) continue;
    let best = "";
    for (const ps of blockPaths) for (const p of ps) if (under(s, p) && p.length > best.length) best = p;
    if (best) blockPaths.forEach((ps, i) => { if (ps.includes(best)) out.add(i); });
  }
  return out;
}

/** 블록 경로 → 조건 파일의 줄 범위(없으면 가장 가까운 윗 경로의 범위) */
export function linesOfPaths(ranges: Map<string, [number, number]>, paths: string[]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of paths) {
    let q: string | undefined = p;
    while (q && !ranges.has(q)) q = q.includes("[") || q.includes(".") ? q.replace(/(\.[^.[\]]+|\[\d+\])$/, "") : undefined;
    const r = q ? ranges.get(q) : undefined;
    if (r && !out.some(([a, b]) => a === r[0] && b === r[1])) out.push(r);
  }
  return out;
}

/** 근거 출처 → 원문 위치 표지. "본문 55줄" → p-54, "표 14" → t-13 */
export function anchorOf(source: string): string | null {
  const p = /^본문\s*(\d+)\s*줄/.exec(source);
  if (p) return `p-${Number(p[1]) - 1}`;
  const t = /^표\s*(\d+)/.exec(source);
  if (t) return `t-${Number(t[1]) - 1}`;
  return null;
}

/** 선택한 조건 경로 → 원문에서 그 값을 읽어 온 자리 */
export function anchorsForPaths(evidence: Evidence[], selected: string[]): Set<string> {
  const out = new Set<string>();
  for (const e of evidence) {
    if (!selected.some((s) => under(e.path, s) || under(s, e.path))) continue;
    const a = anchorOf(e.source);
    if (a) out.add(a);
  }
  return out;
}

/** 원문 자리 → 거기서 읽은 조건 경로 */
export const pathsForAnchors = (evidence: Evidence[], anchors: Set<string>) =>
  evidence.filter((e) => { const a = anchorOf(e.source); return !!a && anchors.has(a); }).map((e) => e.path);
