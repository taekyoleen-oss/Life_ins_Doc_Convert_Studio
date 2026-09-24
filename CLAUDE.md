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
- 이 앱은 **산출방법서의 전체 정보만** 다룬다. `product`(M01 가입 조건 — 보험기간·납입기간·가입나이 표 등)는 산출방법서에 싣는 **정보**다. 계산하는 계약 한 점(`contract` — 성별·가입나이·기간·주기·가입금액)은 **이 앱에 없다**: parse 는 읽지 않고, 조건 파일·입력 카드에도 없으며(M02 카드 없음), render 는 `contract` 가 채워져 있을 때만(자유설계보험이 낸 문서) 시산 기준 표를 싣는다. 계약정보는 자유설계보험 상품 만들기 M02 에서 기본값(`CONTRACT_DEFAULTS`)으로 시작해 사용자가 바꾼다.
- 위험률 남·여 열은 두 벌 다 `RateRef.tables` 로 싣는다(`table` 은 옛 소비자용 한 벌). 계산하는 앱이 `rateTable(r, sex)` 로 고른다.
- **표준 산출방법서 v2** = 이 앱이 내는 산출방법서 모양(`render.ts` `STANDARD_FORMAT`). 개요 표 `양식` 행이 표시, 식은 `[식] 제목` + 설명 줄(위)·식 줄(아래) + `※ 덧붙임`(편집용 내보내기에만 — `kind: "label"`). `기호의 정의` 절(k = 납입주기, r = 발생률, ρ = 저해지 비율), 담보마다 세로 표. Word 는 식 줄을 독립 수식(`m:oMathPara`)으로 — 한글은 글 속 수식(`m:oMath`)을 버린다. 모양을 바꾸면 `parse.ts` `readStandard`·`standards/README.md` 를 같이 고치고, `STANDARDS_UPDATE=1` 로 `standards/*.docx` 를 다시 만들고, `.hwpx` 는 한글로 다시 저장한다(시험이 되읽어 확인). 판을 바꾸면 옛 판도 읽게 둔다.
- 그림으로 읽기: 모델은 **옮겨 적기만**(`vision.ts`), 값은 `parseMethodDoc` 가 읽는다. API 키는 사용자가 앱에서 넣고 sessionStorage(고르면 localStorage)에만 — 내보내기·조건 파일에 절대 넣지 않는다. 실제 API 호출(비용)은 사용자 동의 없이 하지 않는다 — 시험은 가짜 ask·Playwright 경로 가로채기.
- 위험률 표는 조건 파일에 싣지 않는다(localStorage). `attachTables` 가 이은 열을 `RateRef.tables`·`table` 로 붙인다. 값 표가 붙은 위험률은 산출방법서 맨 뒤 "별첨 — 위험률 표"(`rateGrid`)로 나가고, 문서의 연령 × 값 표는 `sheetFromDoc` 이 위험률 표 창으로 가져온다(parse 는 `isRateValueTable` 로 뺀다).
- 고친 산출방법서 반영(`mergeSpec`)은 표준 양식이면 지운 것도 뺀다(담보 칸·담보가 안 쓰는 위험률 행). 문서의 식이 고치기 전 조건의 자동 식과 같으면 사람이 고친 식이 아니다 — 조건에 남기지 않는다.
- 결과는 자유설계보험(`../flexible_insurance`) 입력으로 쓸 수 있어야 한다: 카드 코드·모양은 그 빌더(`components/builder/steps.tsx`)와 맞추고, 주고받는 것은 MethodSpec JSON 뿐이다. 대응표는 `docs/설계.md` §6.

## 함정

1. `npm install` 이 `edgesOut` 오류로 실패하면 `--legacy-peer-deps`.
2. RTK 훅이 `next`·`vitest`·`tsc` 출력을 삼킨다 → `node node_modules/next/dist/bin/next build --turbopack`, `node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.vitest-out.json`, `node node_modules/typescript/bin/tsc --noEmit > .tsc.txt`.
3. Bash heredoc 은 역슬래시를 먹는다 — LaTeX 문자열이 든 파일은 Write/Edit 도구로 고친다.
4. CodeMirror 는 보이는 줄만 DOM 에 그린다 — e2e 에서 innerText 로 전체 글을 읽지 말 것(찾아 바꾸기 패널을 쓴다).
5. PDF 워커와 `standards/*.hwpx` 는 `scripts/copy-public.mjs` 가 predev/prebuild 에서 `public/` 으로 복사한다(커밋하지 않음). `node node_modules/next/dist/bin/next build` 로 바로 빌드할 때는 먼저 `node scripts/copy-public.mjs`.
6. OneDrive 한글 파일명은 NFD — 테스트는 `readdirSync` + `normalize("NFC")` 로 찾는다.
7. Bash heredoc 이 긴 파이썬 패치에서 깨질 때가 있다(RTK 훅) — 스크립트 파일로 써서 돌린다.
8. 한글 자동화: `HWPFrame.HwpObject` COM 으로 `.docx` → `.hwpx` 저장이 된다(한컴오피스 설치 PC). 한글은 Word 수식을 10pt 로 가져온다 — 저장 전에 수식 개체(`eqed`)마다 `BaseUnit` = 1200 으로 12pt.

## 검증

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run      # 실제 PDF 테스트는 OneDrive 경로가 있을 때만
node node_modules/eslint/bin/eslint.js .
node node_modules/next/dist/bin/next build --turbopack
```

브라우저 확인(52항목: 양방향 강조·조건 수정·PDF 열기·원문 근거·LaTeX 반영·입력 카드·가입 조건·위험률 표·JSON 표 내보내기·열기·수식 견본·바뀐 곳 표시·되돌리기·메뉴 닫힘·화면 조절·Word 표준 양식 고쳐 반영·한글 견본 열기·그림으로 읽기(가짜 API)·콘솔 오류):
`node node_modules/next/dist/bin/next start --port 3217` 을 띄운 뒤 `OUT=<폴더> node scripts/e2e.cjs` — npx 로 받아 둔 playwright-core 와 chromium 을 쓴다.
