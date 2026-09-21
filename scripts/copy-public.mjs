// 브라우저가 받아 가는 파일을 public/ 으로 복사한다(둘 다 .gitignore — 원본만 커밋한다).
//  - pdfjs 워커: node_modules 에서. 브라우저는 workerSrc 경로가 있어야 PDF 를 연다(1.3MB).
//  - 표준 산출방법서 한글 파일(standards/*.hwpx): [표준 양식] 메뉴가 내려받게 한다. .docx 는 앱이 조건에서 바로 만든다.
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const src = join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "legacy/build/pdf.worker.min.mjs");
const dst = "public/pdf.worker.min.mjs";
if (!existsSync(src)) { console.error("pdfjs-dist 워커를 찾지 못했습니다:", src); process.exit(1); }
mkdirSync("public", { recursive: true });
copyFileSync(src, dst);
console.log(`${dst} (${Math.round(statSync(dst).size / 1024)}KB) 복사`);

mkdirSync("public/standards", { recursive: true });
const hwpx = existsSync("standards") ? readdirSync("standards").filter((f) => f.endsWith(".hwpx")) : [];
for (const f of hwpx) copyFileSync(join("standards", f), join("public/standards", f.normalize("NFC")));
console.log(`public/standards/ 한글 표준 산출방법서 ${hwpx.length}개 복사`);
