// 브라우저가 받아 가는 파일을 public/ 으로 복사한다(둘 다 .gitignore — 원본만 커밋한다).
//  - pdfjs 워커: node_modules 에서. 브라우저는 workerSrc 경로가 있어야 PDF 를 연다(1.3MB).
//  (표준 산출방법서는 Word 로만 — .docx 는 앱이 조건에서 바로 만든다. 한글 견본은 두지 않는다)
import { copyFileSync, mkdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const src = join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "legacy/build/pdf.worker.min.mjs");
const dst = "public/pdf.worker.min.mjs";
if (!existsSync(src)) { console.error("pdfjs-dist 워커를 찾지 못했습니다:", src); process.exit(1); }
mkdirSync("public", { recursive: true });
copyFileSync(src, dst);
console.log(`${dst} (${Math.round(statSync(dst).size / 1024)}KB) 복사`);

// 사내 위험률 모음 — private/rate-library.json(scripts/import-rate-library.py, 외부 반출 금지)은 **개발할 때만**(predev: --dev) 싣는다.
// 빌드(prebuild — 배포·next start 로 남에게 여는 서버)는 이 PC 에서도 늘 빈 모음이다(404 없이 공개 기본 위험률만). 둘 다 .gitignore · .vercelignore
const lib = "private/rate-library.json";
const dev = process.argv.includes("--dev");
if (dev && existsSync(lib)) { copyFileSync(lib, "public/rate-library.json"); console.log(`public/rate-library.json 사내 위험률 모음 (${Math.round(statSync(lib).size / 1024)}KB) — 개발(next dev)에서만`); }
else { writeFileSync("public/rate-library.json", JSON.stringify({ title: "", rates: [] })); console.log(`public/rate-library.json 빈 모음 (${dev ? "private/rate-library.json 없음" : "빌드 — 사내 모음은 싣지 않는다"})`); }
