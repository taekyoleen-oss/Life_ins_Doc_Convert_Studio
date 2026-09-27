// lib/base-rates.ts — 앱에 든 공개 기본 위험률 표(연령 0~110세, 남·여). 첫 화면·[샘플] 이 조건 + 위험률 표 한 세트로 열리게.
// 값은 자유설계보험(../flexible_insurance/lib/engine/data)의 공개 표 그대로다 — 두 앱이 같은 값으로 계산한다.
// 사내 위험률 모음(외부 반출 금지)은 여기에 넣지 않는다 — scripts/import-rate-library.py 가 이 PC 의 private/ 에만 둔다.
//   node scripts/make-base-rates.mjs
import { readFileSync, writeFileSync } from "node:fs";

const data = (f) => JSON.parse(readFileSync(new URL(`../../flexible_insurance/lib/engine/data/${f}`, import.meta.url), "utf8"));
const kli7 = data("rates-kli7.json"), dis80 = data("rates-dis80.json"), cancer = data("rates-cancer.json"), ci = data("rates-ci.json");
const at = (a, i) => a[i] ?? a[a.length - 1] ?? 0;                       // 표 끝 뒤 나이는 마지막 값 (자유설계보험과 같다)
const r10 = (x) => Math.round(x * 1e10) / 1e10;
const ages = Array.from({ length: 111 }, (_, i) => i);
const cols = [];
for (const [name, f] of [
  ["사망률", (s, a) => at(kli7[s].q, a)],
  ["80% 이상 장해율", (s, a) => at(dis80[s], a)],
  ["암발생률", (s, a) => at(cancer[s].q, a)],
  ["2대질병 발생률", (s, a) => at(ci.stroke[s], a) + at(ci.ami[s], a)],
  ["3대질병 발생률", (s, a) => at(cancer[s].q, a) + at(ci.stroke[s], a) + at(ci.ami[s], a)],
]) for (const [s, label] of [["M", "남"], ["F", "여"]]) cols.push([`${name}(${label})`, (a) => r10(f(s, a))]);
const lines = [["연령", ...cols.map((c) => c[0])].join(","), ...ages.map((a) => [a, ...cols.map(([, f]) => f(a))].join(","))];
const sources = {
  사망률: kli7.meta.name, "80% 이상 장해율": dis80.meta.source, 암발생률: cancer.meta.name, "2대질병 발생률": ci.meta.name, "3대질병 발생률": `${cancer.meta.name} + ${ci.meta.name}`,
};
writeFileSync(new URL("../lib/base-rates.ts", import.meta.url), `/** 생성 파일 — scripts/make-base-rates.mjs. 자유설계보험의 공개 위험률 표(0~110세, 남·여). 사내 위험률은 넣지 않는다 */
export const BASE_RATES_CSV = ${JSON.stringify(lines.join("\n"))};
/** 열 이름(성별 뺀) → 근거 */
export const BASE_RATES_SOURCE: Record<string, string> = ${JSON.stringify(sources, null, 2)};
`);
console.log(`lib/base-rates.ts: ${ages.length} rows × ${cols.length} columns`);
