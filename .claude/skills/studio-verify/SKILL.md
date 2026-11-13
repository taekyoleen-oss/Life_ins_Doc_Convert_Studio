---
name: studio-verify
description: Life_ins_Doc_Convert_Studio 의 검증 명령 모음(tsc · vitest · eslint · build · 브라우저 e2e · flexible_insurance 동기화). 이 저장소에서 시험을 돌리거나, 빌드하거나, "검증해줘" · "테스트 돌려줘" · "e2e" · "통합 확인" 을 요청받으면 반드시 이 스킬을 따른다 — RTK 훅이 일반 명령의 출력을 삼키기 때문에 정해진 명령이 아니면 결과를 볼 수 없다.
---

# studio-verify — 검증 명령

RTK 훅이 `next` · `vitest` · `tsc` 의 출력을 삼킨다. 그래서 늘 `node` 로 바로 부르고 결과를 파일로 받는다.

## 한 갈래만 볼 때 (구현 중)

```bash
node node_modules/typescript/bin/tsc --noEmit > .tsc.txt; tail -30 .tsc.txt     # 자기 파일의 오류만 본다
node node_modules/vitest/vitest.mjs run tests/<내 시험>.test.ts --reporter=json --outputFile=.vitest-<갈래>.json
```

여럿이 한 폴더에서 일할 때는 **출력 파일 이름에 갈래를 붙인다**(`.vitest-hwpx.json`) — 서로 덮어쓰지 않게.
JSON 은 `numPassedTests` · `numFailedTests` · `testResults[].assertionResults[].failureMessages` 를 본다.

## 전체 (통합 검증 — 한 번에 한 에이전트만)

```bash
node node_modules/typescript/bin/tsc --noEmit > .tsc.txt
node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.vitest-out.json
node node_modules/eslint/bin/eslint.js . > .eslint.txt
node scripts/copy-public.mjs && node node_modules/next/dist/bin/next build --turbopack
```

브라우저 확인:

1. 3217 포트에 남은 서버를 끈다 — PowerShell `Get-NetTCPConnection -LocalPort 3217 -ErrorAction SilentlyContinue | % { Stop-Process -Id $_.OwningProcess -Force }`
2. `node node_modules/next/dist/bin/next start --port 3217` 을 백그라운드로 띄운다.
3. `OUT=$TMP/e2e-w node scripts/e2e.cjs` → `$TMP/e2e-w/e2e.txt` 의 PASS/FAIL 줄(깨지면 CRASH).
4. 끝나면 서버를 끈다.

e2e 에 항목을 더할 때: CodeMirror 는 보이는 줄만 그리므로 innerText 로 전체 글을 읽지 않는다. 공유 화면에서 숨긴 기능은 `?all` 주소로 연다.

## flexible_insurance 동기화

`lib/methoddoc/` 를 고쳤으면 폴더째 `../flexible_insurance/lib/methoddoc/` 로 복사하고 그쪽에서:

```bash
node node_modules/typescript/bin/tsc --noEmit > .tsc-flex.txt
node node_modules/vitest/vitest.mjs run tests/methoddoc tests/ui/roundtrip tests/ui/spec-import --reporter=json --outputFile=.vitest-out.json
```

## 엑셀 · 파이썬 대조

- 파이썬: `tests/calc-py.test.ts` 가 이 PC 의 python 으로 실제로 돌려 앱과 같은 값인지 본다.
- 엑셀: `XLSX_UPDATE=1 node node_modules/vitest/vitest.mjs run tests/calc-xlsx.test.ts` → `powershell -ExecutionPolicy Bypass -File scripts/check-calc-xlsx.ps1`(Excel COM, 차이 0).

## 함정

- Bash heredoc 은 역슬래시를 먹는다 — LaTeX·정규식이 든 파일은 Write/Edit 로 고친다. 긴 패치는 스크립트 파일로 써서 돌린다.
- PowerShell 스크립트는 UTF-8 BOM 으로 저장한다.
- 한글 COM 은 쓰지 않는다.
