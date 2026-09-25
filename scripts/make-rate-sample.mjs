// samples/08_위험률표_종합_남녀.csv — 가상의 위험률 표(시험·연습용). 실제 경험률이 아니다.
// 열 이름을 샘플 조건(종신·2대질병·3대질병·암)의 위험률 이름과 같게 두어, 올리면 바로 이어진다.
//   node scripts/make-rate-sample.mjs
import { writeFileSync } from "node:fs";

const ages = Array.from({ length: 66 }, (_, i) => 15 + i);                 // 15~80세
const gompertz = (a, b) => (x) => a * Math.exp(b * (x - 40));
const cols = [
  ["사망률(남)", gompertz(0.00086, 0.087)],
  ["사망률(여)", gompertz(0.00051, 0.083)],
  ["2대질병 발생률", gompertz(0.0016, 0.075)],
  ["3대질병 발생률", gompertz(0.0021, 0.078)],
  ["암발생률(남)", gompertz(0.0019, 0.070)],
  ["암발생률(여)", gompertz(0.0023, 0.045)],
  ["80% 이상 장해율", gompertz(0.00015, 0.06)],
];
const fmt = (v) => v.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
const lines = [["연령", ...cols.map((c) => c[0])].join(","), ...ages.map((x) => [x, ...cols.map(([, f]) => fmt(Math.min(f(x), 0.5)))].join(","))];
writeFileSync("samples/08_위험률표_종합_남녀.csv", "﻿" + lines.join("\n") + "\n");
console.log(`wrote ${ages.length} rows × ${cols.length} columns`);
