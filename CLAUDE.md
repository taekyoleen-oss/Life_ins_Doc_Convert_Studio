# MethodDoc Studio — 에이전트 지침

산출방법서 ↔ 조건 변환 독립 웹앱. 설계: `docs/설계.md`. 서버·DB 없음(localStorage 자동 저장).

## 핵심 규칙

- **MethodSpec 이 유일한 계약이다.** 조건 파일(YAML)·산출방법서(MD/TEX/HTML)·다른 앱(JSON)이 모두 이 형식을 거친다.
- `lib/methoddoc/` 는 앱에 의존하지 않는다(React·yaml 금지). flexible_insurance 에도 같은 모듈이 있고 **이쪽이 원본**이다 — 고치면 그쪽으로 옮겨야 한다.
- 산출방법서 블록에는 조건 경로(`path`, 표는 `rowPaths`)를 단다. "|" 로 여러 경로. 대응 위치 표시가 이것에 기댄다.
- 유지자수·납입자수: 탈퇴 사유 결합은 `1 − Σd + Σdᵢdⱼ/2`. 따로 둔 납입면제율을 곱하지 않는다. 사망형은 급부 = 탈퇴 전부.
- LaTeX·Markdown 을 고쳐 조건에 반영할 때는 `mergeSpec` → `patchYaml` — 조건 파일을 통째로 다시 쓰지 않는다(사용자 주석 보존).

## 함정

1. `npm install` 이 `edgesOut` 오류로 실패하면 `--legacy-peer-deps`.
2. RTK 훅이 `next`·`vitest`·`tsc` 출력을 삼킨다 → `node node_modules/next/dist/bin/next build --turbopack`, `node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.vitest-out.json`, `node node_modules/typescript/bin/tsc --noEmit > .tsc.txt`.
3. Bash heredoc 은 역슬래시를 먹는다 — LaTeX 문자열이 든 파일은 Write/Edit 도구로 고친다.
4. CodeMirror 는 보이는 줄만 DOM 에 그린다 — e2e 에서 innerText 로 전체 글을 읽지 말 것(찾아 바꾸기 패널을 쓴다).
5. PDF 워커는 `scripts/copy-pdf-worker.mjs` 가 predev/prebuild 에서 `public/` 으로 복사한다(커밋하지 않음).
6. OneDrive 한글 파일명은 NFD — 테스트는 `readdirSync` + `normalize("NFC")` 로 찾는다.

## 검증

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run      # 실제 PDF 테스트는 OneDrive 경로가 있을 때만
node node_modules/eslint/bin/eslint.js .
node node_modules/next/dist/bin/next build --turbopack
```

브라우저 확인(14항목: 양방향 강조·조건 수정·PDF 열기·원문 근거·LaTeX 반영·콘솔 오류):
`node node_modules/next/dist/bin/next start --port 3217` 을 띄운 뒤 `OUT=<폴더> node scripts/e2e.cjs` — npx 로 받아 둔 playwright-core 와 chromium 을 쓴다.
