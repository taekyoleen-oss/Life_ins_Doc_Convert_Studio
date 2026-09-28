# Life_ins_Doc_Convert_Studio — 에이전트 지침

(2026-09-21 까지 이름은 MethodDoc Studio 였다. `lib/methoddoc/`·`MethodSpec`·`parseMethodDoc` 은 앱 이름이 아니라
flexible_insurance 와 함께 쓰는 공용 모듈·형식 이름이라 그대로 둔다.)

산출방법서 ↔ 조건 변환 독립 웹앱. 설계: `docs/설계.md`. 서버·DB 없음(localStorage 자동 저장).

## 핵심 규칙

- **MethodSpec 이 유일한 계약이다.** 조건 파일(YAML)·산출방법서(MD/TEX/HTML)·다른 앱(JSON)이 모두 이 형식을 거친다.
- `lib/methoddoc/` 는 앱에 의존하지 않는다(React·yaml 금지). flexible_insurance 에도 같은 모듈이 있고 **이쪽이 원본**이다 — 고치면 폴더째 `../flexible_insurance/lib/methoddoc/` 로 복사하고 그쪽 시험(`tests/methoddoc`·`tests/ui/roundtrip`·`tests/ui/spec-import`)도 돌린다.
- 산출방법서 블록에는 조건 경로(`path`, 표는 `rowPaths`)를 단다. "|" 로 여러 경로. 대응 위치 표시가 이것에 기댄다.
- 유지자수·납입자수: 탈퇴율 결합은 `Q = Σd − Σdᵢdⱼ/2`(잔존은 `1 − Q`). 따로 둔 납입면제율을 곱하지 않는다. 사망형은 급부 = 탈퇴 전부(`C = l·Q·v^{t+½}` — 엔진과 끝자리까지 같게 결합 탈퇴율로 쓴다).
- **식이 계산의 정의다.** 산출방법서에 싣는 평문 수식 표기가 곧 `calc.ts` 가 읽는 문법이고, `computeSpec(spec, 계약)` 이 그 식으로 보험료를 낸다 — 사용자가 카드·Word·한글에서 식을 고치면 계산이 바뀐다. **새 식을 만들 때는 calc.ts 의 문법을 벗어나지 않게 적는다**(아래첨자 `x`·`x+t`·`x+t+1`·`t`·`u`·수 / `Σ_{u≥t}`·`Σ_{u=t}^{n−1}` / `if(조건, 참, 거짓)` · `min` · `max` · 비교 사슬 `40 ≤ x+t ≤ 59` / 이름의 아래첨자는 `α_S`·`P_base` 처럼 자리(x·t·u·수)가 아닌 것). 읽히는지는 `checkFormula`, 식이 엔진과 같은 값을 내는지는 `tests/calc.test.ts` · flexible `tests/ui/default-product`(10만원당 보험료가 정확히 같아야 한다).
- 카드 순서 = 산출 순서 = 산출방법서 절 순서: **[시산보험료 조건]**(카드 밖 맨 위 `.trial-bar` — 성별·가입나이·납입기간·납입주기 + 10만원당·월 보험료 + [＝ 보험료 계산]) → M01 상품 → M03 이율 → M04 위험률 → **M05 보험료(집단마다 l·l′ + 현가 D·N·N\*)** → **B01 보장(담보 하나가 한 덩이 — 급부·금액·면책·집단·보험금의 현가 C·M·PVB 를 그 담보 안에서 다 본다)** → M06 사업비 → **M07 보험료의 계산(P·G)** → M08 준비금·환급금 → M09 따로 적는 식. 카드는 한 번에 하나만 펼치고(`open` 은 한 개), 열면 `onSelect(card.paths)` 로 오른쪽 그 자리를 비춘다. 머리의 [수식 숨기기/보이기]는 `layout.formulas`.
- **담보는 B01 한 군데서만 고친다**(사용자 요청 — 앞뒤 두 곳에 나뉘어 있어 담보를 더할 때 헷갈렸다). 그래서 `PvbBody` 는 없고 `BenefitsBody` 가 담보마다 급부·보장금액·면책·집단·보험금의 현가를 한 덩이로 보인다. `지급 사유`(`trigger`) 칸은 **없앴다** — 담보 이름과 같은 말이라 산출방법서에도 한 번만 나온다(비슷하게 겹치는 칸은 늘 하나만 둔다).
- **보험금의 현가는 유지자수 l 을 M05 에서 가져온다** — 담보의 탈퇴 사유가 같으면 같은 집단이므로 l 을 다시 정하지 않고 어느 집단인지만 밝히고([M05 에서 보기]) 지급자수 d 부터 적는다(암 진단과 암 입원·수술은 탈퇴 사유가 달라 곱하는 l 이 다르다 — 집단이 갈린다). `BenefitModel.payout` (`d_{x+t} = l_{x+t}·발생률`)은 **문서에 싣지 않는다** — 급부 현가 C 식의 한 부분이라 계산 표에서만 열로 보인다.
- **보험료 계산 화면**(`components/PremiumSheet.tsx` · `calc.ts` `calcSheets`) = 담보마다 한 해 한 줄의 엑셀식 표. 왼쪽에 계약·기초율(`CalcSheet.inputs`), 열은 위험률 → **현가율 v^t·v^{t+½}** → l·l′·d → D·D′·N·N′ → S·C·M, 옆에 N\*·PVB·P·P_base·G·10만원당·담보 보험료. 열·칸을 누르면 그 값을 만든 식과 그 해에 쓰인 값(`CalcColumn.parts`)을 보인다. **이 앱이 독자적으로 계산한다** — 다른 앱에 묻지 않는다.
- **엑셀 수식 내보내기**(`calc-xlsx.ts` · `xlsx.ts`) — 계약·기초율과 위험률만 값이고 **현가율부터는 모두 엑셀 수식**이다. 읽어 둔 식(`CalcColumn.eq`)의 AST 를 A1 수식으로 옮긴다(`Σ` → `SUM`/`SUMPRODUCT`, `if` → `IF`, `v^t`·`v^{t+½}` → 현가율 열). 이름(x_age·n_term·S_amt …)은 **장마다 따로**(`XName.local`) — 담보마다 기간·보장금액이 다르다. 모양을 바꾸면 `tests/calc-xlsx.test.ts` 를 고치고, **엑셀로 다시 계산해 값이 같은지 확인한다**(Excel COM — `scripts/check-verify-xlsx.ps1` 와 같은 방식).
- **집단(`groupModels`)은 조건에 따로 적는 항목이 아니다** — 탈퇴 위험률(`benefits[].exitRateIds`)이 같은 담보를 묶은 것이다. M05 에서 집단의 탈퇴 사유를 고치면 그 집단의 담보들이 함께 바뀌고, B01 에서 집단을 고르면 그 담보만 옮겨 간다. 그래서 MethodSpec 에 새 칸이 없다.
- 식 덩이는 `FormulaSpec.key`(`group:g1` · `benefit:b1` · `pv:N` · `premium:G` …)로 짝짓는다 — 조건 파일·JSON 에 싣지 않고 늘 다시 만든다. 사용자가 고친 식은 `formulas` 에 같은 `절|제목`으로 들어가 `withFormulas` 가 자동 식 위에 얹는다(`path`·`key` 는 자동 식 것을 지킨다). 산출방법서 블록에는 `formula:pv.N` 꼴 경로도 달려(조건 줄이 아니라 카드 짝짓기용) 카드가 자기 식만 짚는다.
- LaTeX·Markdown 을 고쳐 조건에 반영할 때는 `mergeSpec` → `patchYaml` — 조건 파일을 통째로 다시 쓰지 않는다(사용자 주석 보존).
- 입력 카드(`ConditionForm`)는 따로 상태를 두지 않는다 — 칸은 YAML 에서 읽고 `editYaml` 로 그 칸만 쓴다. 칸의 `data-path` 는 산출방법서 블록 경로와 같은 `pathKey`.
- 이 앱은 **산출방법서의 전체 정보만** 다룬다. `product`(M01 가입 조건 — 보험기간·납입기간·가입나이 표 등)는 산출방법서에 싣는 **정보**다. 계산하는 계약 한 점(`contract` — 성별·가입나이·기간·주기·가입금액)은 **이 앱에 없다**: parse 는 읽지 않고, 조건 파일·입력 카드에도 없으며(M02 카드 없음), render 는 `contract` 가 채워져 있을 때만(자유설계보험이 낸 문서) 시산 기준 표를 싣는다. 계약정보는 자유설계보험 상품 만들기 M02 에서 기본값(`CONTRACT_DEFAULTS`)으로 시작해 사용자가 바꾼다.
- 위험률 남·여 열은 두 벌 다 `RateRef.tables` 로 싣는다(`table` 은 옛 소비자용 한 벌). 계산하는 앱이 `rateTable(r, sex)` 로 고른다.
- **표준 산출방법서 v4** = 이 앱이 내는 산출방법서 모양(`render.ts` `STANDARD_FORMAT`). 실무 양식(`samples/02_실무양식_든든건강보험_산출방법서.md`)처럼 **큰 장 셋 + 별첨**이고 장 안을 `가.`·`나.` … 로 나눈다(`DocBlock` `{t:"p", kind:"sub"}`):

  ```
  개요
  1. 보험료의 계산에 관한 사항
     가. 예정기초율   나. 보장 내용   다. 기호의 정의
     라. 유지자수·납입자수   마. 계산기수 — 보험료   바. 계산기수 — 보험금   사. 순보험료 및 영업보험료
  2. 책임준비금의 계산에 관한 사항      3. 해지환급금의 계산에 관한 사항      4. 별첨 — 위험률 표
  ```

  개요 표 `양식` 행이 표시, 식은 `[식] 제목` + 설명 줄(위)·식 줄(아래) + `※ 덧붙임`(편집용 내보내기에만 — `kind: "label"`). `다. 기호의 정의`는 조건에 적는 항목이 아니라 **조건에서 늘 다시 만든다**(`symbolBlocks`) — 담보·집단·납입면제를 고치면 저절로 따라온다. l·l′ 은 집단마다 한 줄로 또박또박(`l_{x+t}` = t 시점 생존자수(기준인원 l_x = 100,000) — 사망하지 않은 생존자수 / `l′_{x+t}` = 그 가운데 납입면제 사유도 나지 않은 사람), 그 밖에 k·r·ρ·S·d·f 줄. 담보마다 세로 표(`집단` 행 포함). 2·3 장은 `※` 덧붙임을 **식보다 앞에** 싣는다(되읽을 때 마지막 식의 주석으로 빨려 들어갔다). Word 는 식 줄을 독립 수식(`m:oMathPara`)으로 — 한글은 글 속 수식(`m:oMath`)을 버린다. 모양을 바꾸면 `parse.ts` `readStandard`·`standards/README.md` 를 같이 고치고, `STANDARDS_UPDATE=1` 로 `standards/*.docx` 를 다시 만들고, `.hwpx` 는 한글로 다시 저장한다(시험이 되읽어 확인). 판을 바꾸면 옛 판도 읽게 둔다.
- **PDF 는 두 가지로 읽는다**(`pdf.ts`). 먼저 예전 방식(줄마다 x 간격으로 칸 나눔)으로 읽고, 글에 `표준 산출방법서 v\d` 가 있으면 **한 번 더** 읽는다(`build(pages, grid)`). 표준 양식 모드는 ① 열 경계를 표 덩이 전체의 빈 띠로 찾고(줄마다 나누면 좁은 칸이 붙고 오른쪽 맞춘 칸이 잘린다) ② 칸 안에서 줄바꿈된 줄·쪽마다 되풀이되는 머리글을 이어 붙이고 ③ 본문보다 작고 아래·위로 치우친 글자를 첨자(`l_{x+t}`·`v^{t+½}`·`Σ_{u=t}^{n−1}`)로 되살리고 ④ `※` 덧붙임의 이어진 줄을 한 사항으로 붙인다. Word 가 수식을 PDF 로 쓸 때 쓰는 수학 기울임 글자(𝑙 𝑥 𝛴 𝛼)는 `plainMathLetters` 가 되돌린다. **회사 산출방법서 PDF 는 예전 방식 그대로 둔다** — 그 문서들의 기호가 그 결과에 맞춰져 있다(α₁ 을 `α1` 로 읽는 것 등). 시험: `tests/pdf-vs-word.test.ts`(같은 문서의 .docx ↔ .pdf 가 글자까지 같은 조건 · 같은 보험료) · `tests/pdf-real.test.ts`(실제 PDF 7건은 그대로).
- `samples/10_기본상품_종신보험(암진단포함)_산출방법서.docx`·`.pdf` = 그 시험이 쓰는 한 쌍. 다시 만들 때 `DOCS_UPDATE=1 node node_modules/vitest/vitest.mjs run tests/pdf-vs-word.test.ts`(→ .docx) → `powershell -ExecutionPolicy Bypass -File scripts/make-sample-pdf.ps1`(→ .pdf, Word COM. PowerShell 5.1 에서 `DisplayAlerts` 를 건드리면 널 참조로 죽는다).
- **즉각 반응하게 만든 세 가지** — 조건 ↔ 산출방법서를 견주며 고치는 앱이라 한 번 고칠 때 멈추면 안 된다(고치기 전엔 한 글자에 2.5초, 다섯 글자에 11초 멈췄다).
  1. **값은 모델 하나에 한 번만 센다** — `valueOf` 가 캐시를 모델(`Model.cache`)에 둔다. 부를 때마다 새 캐시를 만들면 되돌이 정의(`l_{x+t+1} = l_{x+t} × …`)를 칸마다 t=0 부터 다시 세어 한 열이 O(n²) 이 된다(`calcSheets` 725 ms → 19 ms · `computeSpec` 18 → 8 ms). 시험이 고정한다 — `tests/calc.test.ts` "한 번에 계산한다".
  2. **칸을 누를 때만 만든다** — `CalcColumn.parts` 는 배열이 아니라 `(t) => …` 다. 72줄 × 열 19개를 미리 만들 이유가 없다.
  3. **바뀐 블록만 다시 그린다** — 산출방법서는 원소 6천 개가 넘는다(별첨 위험률 표만 700칸). `DocPreview` 는 내용이 같은 블록을 앞의 객체로 되쓰고(`JSON.stringify` 로 가린다) `Block` 을 `memo` 로 감싼다. 강조는 `hlKey`·`chKey` 글자(표 안 줄 번호)로 넘겨 원시값 비교가 되게 한다. 그리고 `.doc-body > section { content-visibility: auto }` 로 화면 밖 절은 브라우저가 배치·그리기를 건너뛴다 — **인쇄·PDF 는 `@media print` 에서 `visible` 로 되돌려 문서 전체를 담는다**.
  숫자로 확인할 때는 브라우저에서 긴 프레임(`long-animation-frame`)을 재 본다 — 한 글자 타자·카드 열기·산출방법서 줄 누르기가 각각 한두 프레임, 스크립트 100 ms 안쪽이어야 한다.
- LaTeX·Markdown 글(`docToLatex`·`docToMarkdown`)은 **그 탭을 볼 때만** 만든다(내보내기는 `lib/export.ts` 가 따로 만든다).
- **고른 곳은 창 한가운데로** — 조건을 고르면 산출방법서가(`DocPreview`), 산출방법서를 고르면 조건이(`ConditionForm`·CodeEditor) `scrollIntoView({ block: "center" })` 로 움직인다. 견주어 보는 앱이라 "가장 가까운 자리"로는 부족하다.
- **입력 칸은 이름과 칸이 한 줄**(`.fld` = `flex-wrap`, `.fld-box` = `flex: 1 1 7rem`) — 자리가 모자라면 칸이 저절로 아랫줄로 내려간다(긴 이름·좁은 창). 여러 줄 칸(`area`·`formula`)은 `.fld-tall` 로 늘 이름 아래. 설명·오류·주석은 늘 온전한 아랫줄.
- **카드의 식은 기본이 숨김**(`LAYOUT0.formulas = false`) — 값부터 보이고, 머리의 [수식 보이기]로 켠다. 기본값을 바꿀 때는 `Layout.v` 를 올린다 — 그래야 옛 저장본의 그 값을 한 번 버리고 새 기본으로 시작한다.
- 그림으로 읽기: 모델은 **옮겨 적기만**(`vision.ts`), 값은 `parseMethodDoc` 가 읽는다. API 키는 사용자가 앱에서 넣고 sessionStorage(고르면 localStorage)에만 — 내보내기·조건 파일에 절대 넣지 않는다. 실제 API 호출(비용)은 사용자 동의 없이 하지 않는다 — 시험은 가짜 ask·Playwright 경로 가로채기.
- 위험률 표는 조건 파일에 싣지 않는다(localStorage). `attachTables` 가 이은 열을 `RateRef.tables`·`table` 로 붙인다. 값 표가 붙은 위험률은 산출방법서 맨 뒤 "별첨 — 위험률 표"(`rateGrid`)로 나가고, 문서의 연령 × 값 표는 `sheetFromDoc` 이 위험률 표 창으로 가져온다(parse 는 `isRateValueTable` 로 뺀다).
- 위험률은 세 곳이 함께 움직인다: 표를 올리면 조건에 없는 이름의 열이 M04 에 새 위험률로(`unlinkedGroups`·`linkGroups`), M04 에서 더하면 표에 빈 열(`addEmptyColumn`)·지우면 연결 해제(`unlinkRate`), 문서 반영은 `syncSheetRates`. 값 표 없는 위험률은 `ratesWithoutTable` 로 알린다. 자유설계보험 `applySpecToPlan` 은 고른 위험률을 시트 열로 더한다. 시험: `tests/rates-flow.test.ts` · flexible `tests/ui/rates-from-studio.test.ts`(`samples/08_위험률표_종합_남녀.csv`).
- **기본 상품 = 종신보험(암진단 포함)**(`lib/samples.ts` `DEFAULT_SAMPLE_ID`): 사망·80% 장해(사망형 1억) + 암 진단(사망보험금의 50%, 90일 면책, 100세), 납입면제 사유 80% 장해·암(`basis.waiverRateIds`). 옛 종신보험은 샘플로 남는다. 조건·표·자유설계보험 계산·엑셀 검산은 `samples/09_종신보험(암진단포함)_*` 로 묶여 있고 시험이 서로 맞대어 본다 — 조건·식·엔진을 바꾸면 `VERIFY_UPDATE=1` 로 두 앱의 `default-product` 시험을 돌리고 `python scripts/make-verify-xlsx.py` → `scripts/check-verify-xlsx.ps1`(엑셀 재계산, 차이 0 확인).
- 납입면제 사유 = 유형 `waiver` 인 위험률 + `basis.waiverRateIds`(급부이기도 한 위험률 — 예: 암). 담보마다 그 담보의 탈퇴 사유인 사유는 f 에서 뺀다(formulas.ts · 자유설계보험 `tabPlanInput` 이 같은 규칙). 그래서 **f 는 한 값이 아니라 집단마다 다르다** — `가.(4) 납입면제 사유`는 사유 전부를 `f_x : 80% 이상 장해율 · 암발생률` 로 적고(되읽기용 표시) 뜻과 결합(`f_{x+t} = Σ 발생률 − Σ_{i<j} 두 사유의 곱/2`)을 밝히고, 집단 식은 저마다 `f_x : <남은 사유> — 납입만 면제되는 사유` 로 어느 사유가 남았는지 적는다.
- **위험률 출처는 가상으로만 적는다** — `경험생명표(가상) 사망률` · `경험생명표(가상) 80%이상 재해장해율 + 질병장해율` · `경험생명표(가상) 암발생률`. 두 저장소가 공개이므로 실제 출처(회사·호수·표 이름)는 코드·샘플·시험·문서·생성 스크립트에 **넣지 않는다**(`lib/base-rates.ts`·`lib/samples.ts`·`scripts/make-base-rates.mjs`, flexible 의 `lib/plan-rates.ts`·`lib/engine/data/*.json`·`scripts/build-*-rates.mjs`). 사용자 문서를 읽는 쪽(`parse.ts` 의 출처 알아보기, 실제 PDF 시험)은 실제 출처 글귀를 그대로 둔다 — 읽어야 하니까.
- 위험률 표 두 가지: `lib/base-rates.ts`(공개 — 자유설계보험의 공개 표, `node scripts/make-base-rates.mjs`) 와 **사내 위험률 모음**(`private/rate-library.json` ← `python scripts/import-rate-library.py`, 원본에 "외부 반출 금지"). 저장소가 공개이므로 사내 값은 **절대 커밋·배포하지 않는다**(`.gitignore` · `.vercelignore`) — 시험·문서·샘플에도 넣지 않는다. 앱은 `public/rate-library.json`(copy-public 이 복사, 없으면 빈 모음)을 읽어 [기본 위험률 모음] 창에 보인다.
- 패키지 `.lifepkg`(`lib/package.ts`) = 압축하지 않은 ZIP: `package.json`(양식·이름·저장 시각·표의 열 연결) · `조건.yaml`(원문 그대로) · `위험률표.csv`(있을 때만) · `MethodSpec.json` · `산출방법서.md`·`.docx`(파생 — 열 때 안 씀). 첫 화면·샘플은 `sampleSheet`(`lib/base-rates.ts` 공개 기본 위험률에서 이름이 맞는 열만)로 조건 + 표 한 세트. 최근 작업은 localStorage `…:recent`(조건·표 스냅샷 12개).
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
9. 그 COM 은 한 번 강제 종료(`Stop-Process Hwp`)하면 다음 `Open` 이 보이지 않는 대화상자에 막혀 **영원히 멈춘다** — 사용자가 한글을 한 번 직접 띄워 정리해야 풀린다. 그래서 `.hwpx` 를 다시 만들 때는 한 번에 끝내고, 글자 한 칸(예: 개요 표 `양식` 값)만 바꿀 때는 `.hwpx`(ZIP) 안 `Contents/section0.xml`·`Preview/PrvText.txt` 의 그 글자만 고쳐도 된다(본문·수식은 한글이 저장한 그대로 남는다).

## 검증

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run      # 실제 PDF 테스트는 OneDrive 경로가 있을 때만
node node_modules/eslint/bin/eslint.js .
node node_modules/next/dist/bin/next build --turbopack
```

브라우저 확인(98항목: 기본 상품 종신보험(암진단 포함)·시산보험료 조건 바(성별·나이·기간·주기 → 10만원당·월)·카드 순서(M05 보험료 → B01 보장)·담보 칸에 지급사유 없음·아코디언·카드의 식 기본 숨김·입력 칸 한 줄·카드를 열면 산출방법서 강조·고른 곳이 창 가운데로(양방향)·산출방법서 벼리(1 보험료 / 가.~사. / 2 책임준비금 / 3 해지환급금 / 4 별첨)·집단 둘·보험금의 lx 가져오기·식 고치기 → 문서·시산 함께 바뀜·되돌리기·수식 숨기기/보이기·시산 261·162·342,000원·보험료 계산 표(왼쪽 계약·기초율·열 19개(현가율 둘 포함)·72줄·열·칸 팝업·담보 탭)·양방향 강조·조건 수정·PDF 열기·원문 근거·표준 양식 PDF 열기(별첨 위험률 표 111줄·월 342,000원)·LaTeX 반영·입력 카드·가입 조건·담보 더하기·복사·삭제·위험률 표(조건 ↔ 표 자동 연결·별첨·칸·열 이름·유형 고치기)·기본 위험률 모음·JSON 표 내보내기·열기·패키지 저장·열기·최근 작업·수식 견본·바뀐 곳 표시·되돌리기·메뉴 닫힘·화면 조절·Word 표준 양식 고쳐 반영·한글 견본 열기·그림으로 읽기(가짜 API)·콘솔 오류):
`node node_modules/next/dist/bin/next start --port 3217` 을 띄운 뒤 `OUT=<폴더> node scripts/e2e.cjs` — npx 로 받아 둔 playwright-core 와 chromium 을 쓴다.
