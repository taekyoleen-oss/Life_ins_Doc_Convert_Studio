# Life_ins_Doc_Convert_Studio — 에이전트 지침

(2026-09-21 까지 이름은 MethodDoc Studio 였다. `lib/methoddoc/`·`MethodSpec`·`parseMethodDoc` 은 앱 이름이 아니라
flexible_insurance 와 함께 쓰는 공용 모듈·형식 이름이라 그대로 둔다.)

산출방법서 ↔ 조건 변환 독립 웹앱. 설계: `docs/설계.md`. 서버·DB 없음(localStorage 자동 저장).

## 핵심 규칙

- **MethodSpec 이 유일한 계약이다.** 조건 파일(YAML)·산출방법서(MD/TEX/HTML)·다른 앱(JSON)이 모두 이 형식을 거친다.
- `lib/methoddoc/` 는 앱에 의존하지 않는다(React·yaml 금지). flexible_insurance 에도 같은 모듈이 있고 **이쪽이 원본**이다 — 고치면 폴더째 `../flexible_insurance/lib/methoddoc/` 로 복사하고 그쪽 시험(`tests/methoddoc`·`tests/ui/roundtrip`·`tests/ui/spec-import`)도 돌린다.
- 산출방법서 블록에는 조건 경로(`path`, 표는 `rowPaths`)를 단다. "|" 로 여러 경로. 대응 위치 표시가 이것에 기댄다.
- 유지자수·납입자수: 탈퇴 사유 결합은 `1 − Σd + Σdᵢdⱼ/2`. 따로 둔 납입면제율을 곱하지 않는다. 사망형은 급부 = 탈퇴 전부.
- LaTeX·Markdown 을 고쳐 조건에 반영할 때는 `mergeSpec` → `patchYaml` — 조건 파일을 통째로 다시 쓰지 않는다(사용자 주석 보존).
- 입력 카드(`ConditionForm`)는 따로 상태를 두지 않는다 — 칸은 YAML 에서 읽고 `editYaml` 로 그 칸만 쓴다. 칸의 `data-path` 는 산출방법서 블록 경로와 같은 `pathKey`.
- `product`(M01 가입 조건 — 보험기간·납입기간·가입나이 표 등)는 산출방법서에 싣는 **정보**, `contract`(M02)는 실제로 계산하는 **시산 기준** 한 점이다. 되읽을 때 `readProduct` 가 가입 조건 표를 먼저 떼어 본문 규칙에서 뺀다 — 새 규칙이 "110세만기·만15세" 를 계약으로 읽지 않게 할 것.
- 위험률 표는 조건 파일에 싣지 않는다(localStorage). `attachTables` 가 이은 열을 `RateRef.table` 로 붙인다 — 계약 성별의 열 하나.
- 결과는 자유설계보험(`../flexible_insurance`) 입력으로 쓸 수 있어야 한다: 카드 코드·모양은 그 빌더(`components/builder/steps.tsx`)와 맞추고, 주고받는 것은 MethodSpec JSON 뿐이다. 대응표는 `docs/설계.md` §6.

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

브라우저 확인(37항목: 양방향 강조·조건 수정·PDF 열기·원문 근거·LaTeX 반영·입력 카드·가입 조건·위험률 표·JSON 표 내보내기·열기·수식 견본·화면 조절·콘솔 오류):
`node node_modules/next/dist/bin/next start --port 3217` 을 띄운 뒤 `OUT=<폴더> node scripts/e2e.cjs` — npx 로 받아 둔 playwright-core 와 chromium 을 쓴다.
