# Life_ins_Doc_Convert_Studio — 산출방법서 ↔ 조건 변환기

**조건을 넣으면 산출방법서가, 산출방법서를 넣으면 조건이 나오는** 독립 웹앱.
위 왼쪽은 조건(입력 카드 · YAML), 위 오른쪽은 그 조건으로 만든 산출방법서, 아래는 위험률 표다. 창 사이 막대로 크기를 바꾸고 창마다 전체 보기·숨기기가 된다.

## 주요 기능

- 🗂️ **조건 입력 카드** — 자유설계보험(flexible_insurance) 빌더와 같은 단계 카드(M01 상품 기본정보 · M03 이자율·저해지 · M04 위험률 · M05 납입자수 · C01… 담보 · M06 사업비 · M07 책임준비금·해지환급금 · M08 수식 더하기). YAML 을 몰라도 칸을 채우고 ＋ 로 담보·위험률·사업비 행을 더한다. M01 에는 산출방법서에 싣는 **가입 조건**(보험의 종류·보험종목·보험기간·납입기간·가입나이·납입주기·가입금액 한도·갱신 — 사업방법서 판매 범위 표 모양)을 적는다. 이 앱은 **산출방법서의 전체 정보만** 다룬다 — 보험료를 계산할 계약 한 점(성별·가입나이·보험기간·납입기간·납입주기·가입금액)은 자유설계보험 상품 만들기의 **M02 계약정보**에서 기본값으로 시작해 정한다(그래서 여기는 M02 카드가 없다). [YAML] 탭은 같은 조건의 파일 보기 — 칸을 고치면 그 값만 파일에 들어가 주석·줄 맞춤이 남는다.
- ✏️ **조건 → 산출방법서** — 조건을 고치면 오른쪽 산출방법서가 바로 바뀐다. 유지자수·납입자수·보험료·준비금·해지환급금 식은 조건에서 자동으로 만든다(KaTeX).
- 📊 **위험률 표** — Excel 표 붙여넣기·CSV·TSV·XLSX 를 올리면 첫 행을 열 이름으로 읽고, 열마다 연령·위험률·성별로 조건에 잇는다(이름이 겹치면 자동). 이은 열은 산출방법서 위험률 표·맨 뒤 "별첨 — 위험률 표"와 MethodSpec JSON 에 실린다 — 남·여 열이 있으면 두 벌 다(`RateRef.tables`), 자유설계보험이 계약정보 성별의 표를 고른다. 산출방법서(PDF·Word·한글)에 연령 × 위험률 값 표가 있으면 열 때 이 창으로 들어온다.
- ∑ **수식·기호 견본** — 산출방법서 탭 [＋ 수식 더하기]는 견본 식(유지자수·계산기수·보험료·준비금·해지환급금)을 조건 식으로 더하고, LaTeX·Markdown 탭 [수식·기호 견본]은 커서 자리에 식·기호·절 제목·표를 넣는다.
- 📄 **표준 산출방법서 (Word·한글)** — 앱이 정확히 되읽는 양식(`표준 산출방법서 v1`). [표준 양식] 메뉴에서 상품별 견본(`표준_산출방법서_종신보험` · `_질병보험` · `_암보험`, .docx · .hwpx)을 받거나, 지금 조건을 [Word 내려받기] 해서 Word·한글에서 표의 값·행, `[식]` 아래 식 줄, `※` 설명을 고친 뒤 **[고친 Word·한글 올리기]** 하면 바뀐 값·식·주석만 조건에 들어간다. Word·한글 수식 편집기로 넣은 식도 읽는다. 쓰는 규칙: [`standards/README.md`](standards/README.md)
- 📥 **산출방법서 → 조건** — PDF·DOCX·HWP(5.x)·HWPX·TEX·MD 를 열거나 창에 끌어다 놓으면 조건으로 옮긴다. 표준 산출방법서는 식·주석·절까지, 다른 양식은 표·본문 규칙으로 읽히는 값을 읽는다. 값 옆 주석이 원문 위치·확신도다.
- 🖼️ **그림으로 읽기** — 스캔 PDF·PNG·JPG 는 쪽을 골라 **본인의 Anthropic API 키**로 보내면 Claude(claude-opus-5)가 쪽을 글로 옮겨 적고, 그 글을 같은 규칙이 읽어 조건으로 만든다(쪽당 약 $0.07, 보내기 전에 예상 비용 표시). 키는 이 브라우저에만 둔다.
- 🔗 **대응 위치** — 조건 한 줄을 고르면 그 조건이 만든 표의 행·수식·원문 근거 줄이 앰버색으로 표시되고, 오른쪽을 누르거나 끌어서 고르면 왼쪽 조건 줄이 표시된다.
- 📝 **LaTeX·Markdown 으로 고치기** — 탭에서 산출방법서 원문을 고친 뒤 [조건에 반영] 하면 바뀐 값만 조건에 들어간다. 조건 파일의 주석·순서는 지킨다.
- 📄 **원문 탭** — 불러온 문서를 본문 N줄·표 N 단위로 보여 주고, 줄마다 거기서 읽은 조건을 딱지로 단다. PDF 는 원본 보기도 된다.
- 📚 **샘플** — 종신(사망·80% 장해) · 2대질병 · 무해지 암 · 납입지원 조건, 그리고 LaTeX·Markdown 산출방법서 고쳐 보기.
- 📤 **내보내기** — 조건 `.yaml`, 다른 앱용 `MethodSpec .json`(위험률 표 포함 — 자유설계보험 `/method` 에서 열면 상품 만들기 설계 전체가 된다), 산출방법서 Word `.docx`(표준 산출방법서 — 한글에서도 열림) · `.tex`(xelatex+kotex) · `.md` · `.html`(수식 포함) · 인쇄/PDF.
- 🔁 **자유설계보험과 왕복** — 그쪽이 낸 MethodSpec JSON 을 여기서 열면 조건은 입력 카드로, 위험률 표는 아래 위험률 표 창으로 들어온다.
- 💾 브라우저 자동 저장(localStorage — 조건 · 위험률 표와 연결 · 화면 나눔). 서버·로그인 없음.

## 실행

```bash
npm install --legacy-peer-deps   # npm 10 의 peer 계산 오류(edgesOut) 우회
npm run dev                      # http://localhost:3000
```

검증: `npm run typecheck && npm test && npm run build`

## 조건 파일 (YAML ↔ MethodSpec)

```yaml
meta:     { productName: 종신보험, kind: 표준형(완전 환급) }
basis:    { interest: 2.5%, standardInterest: 3.25%, waiver: false }
rates:
  - { id: q,   name: 제7회 경험생명표 사망률, role: death }
  - { id: r80, name: 80% 이상 장해율,        role: incidence }
expenses:
  - { group: 계약체결비용, symbol: α_S, basis: 보험가입금액, rate: 1% }
benefits:
  - { id: b1, name: 사망·80% 이상 장해, role: death, amount: 100000000, endAge: 110, exitRateIds: [q, r80] }
```

- 이율 `2.5%`, 사업비 `1.5/1000`, 배수 `1배` 처럼 실무 표기로 쓴다(읽을 때 소수로 바뀐다).
- 위험률 유형: `death` 사망 · `incidence` 최초발생 · `recurring` 반복지급 · `waiver` 납입면제 · `other`.
- 탈퇴 사유가 둘이면 유지자수·납입자수는 `l(1 − q − r + q·r/2)` — 따로 둔 납입면제율을 곱하지 않는다.
- 다른 앱과는 **MethodSpec JSON** 으로 주고받는다(`lib/methoddoc/spec.ts`).

## 구조

```
lib/methoddoc/     앱 독립 모듈 (flexible_insurance 와 같은 뿌리, 이쪽이 원본)
  spec.ts          MethodSpec · Evidence · validateSpec
  extract.ts pdf.ts  파일 → 문단·표 (DOCX·HWP·HWPX·PDF·Markdown)
  parse.ts         문단·표 → MethodSpec + 근거
  formulas.ts      MethodSpec → 산출식 (유지자수·납입자수·보험료·준비금·환급금)
  render.ts        MethodSpec → 산출방법서 블록 (블록마다 조건 경로) = 표준 산출방법서 v1
  tex.ts           평문 수식 ↔ LaTeX, 산출방법서 ↔ .tex
  docx.ts          산출방법서 → Word(.docx) — 의존성 없이 직접 쓴다
  vision.ts        스캔 PDF·그림 → 옮겨 적은 문단·표 (모델 호출은 주입)
lib/conditions/
  yaml.ts          조건 파일 ↔ MethodSpec, 줄 범위, 되읽은 값 병합, 주석 보존 패치, 입력 칸 한 칸 고치기(editYaml)
  link.ts          조건 줄·칸 ↔ 산출방법서 블록 ↔ 원문 근거 대응
lib/sheet.ts       위험률 표 읽기(TSV·CSV·XLSX) · 열 → 조건 잇기 · RateRef.table 붙이기
lib/snippets.ts    수식·기호·문서 요소 견본
lib/standards.ts   표준 산출방법서 목록(상품별 견본) · 작성 안내 — 한 줄 더하면 새 상품
lib/pages.ts       PDF·그림 → 쪽 그림(브라우저)
lib/vision-client.ts  Anthropic SDK 호출(사용자 키, 브라우저)
components/        Studio · ConditionForm(입력 카드) · RateSheetPane · FormulaPalette · CodeEditor · DocPreview · OriginalPane · VisionDialog
standards/         표준_산출방법서_*.docx · .hwpx · 쓰는 규칙(README)
docs/설계.md       설계·연동·LaTeX 변환 제안
```

## 문서

- 올려 볼 샘플과 시험 순서: [`samples/README.md`](samples/README.md)
- 표준 산출방법서 쓰는 규칙: [`standards/README.md`](standards/README.md)
- 스캔 PDF · 그림 → 조건 (그림으로 읽기): [`docs/이미지-PDF-변환-설계.md`](docs/이미지-PDF-변환-설계.md)
- 설계와 제안: [`docs/설계.md`](docs/설계.md)
- 모듈 설명: [`lib/methoddoc/README.md`](lib/methoddoc/README.md)
