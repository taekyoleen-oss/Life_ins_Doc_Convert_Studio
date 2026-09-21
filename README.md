# Life_ins_Doc_Convert_Studio — 산출방법서 ↔ 조건 변환기

**조건을 넣으면 산출방법서가, 산출방법서를 넣으면 조건이 나오는** 독립 웹앱.
왼쪽은 조건(YAML), 오른쪽은 그 조건으로 만든 산출방법서다(mdTeX Studio 와 같은 좌우 구성).

## 주요 기능

- ✏️ **조건 → 산출방법서** — 왼쪽 조건을 고치면 오른쪽 산출방법서가 바로 바뀐다. 유지자수·납입자수·보험료·준비금·해지환급금 식은 조건에서 자동으로 만든다(KaTeX).
- 📥 **산출방법서 → 조건** — PDF·DOCX·HWP(5.x)·HWPX·TEX·MD 를 열거나 창에 끌어다 놓으면 조건으로 옮긴다. 값 옆 주석이 원문 위치·확신도다.
- 🔗 **대응 위치** — 조건 한 줄을 고르면 그 조건이 만든 표의 행·수식·원문 근거 줄이 앰버색으로 표시되고, 오른쪽을 누르거나 끌어서 고르면 왼쪽 조건 줄이 표시된다.
- 📝 **LaTeX·Markdown 으로 고치기** — 탭에서 산출방법서 원문을 고친 뒤 [조건에 반영] 하면 바뀐 값만 조건에 들어간다. 조건 파일의 주석·순서는 지킨다.
- 📄 **원문 탭** — 불러온 문서를 본문 N줄·표 N 단위로 보여 주고, 줄마다 거기서 읽은 조건을 딱지로 단다. PDF 는 원본 보기도 된다.
- 📚 **샘플** — 종신(사망·80% 장해) · 2대질병 · 무해지 암 · 납입지원 조건, 그리고 LaTeX·Markdown 산출방법서 고쳐 보기.
- 📤 **내보내기** — 조건 `.yaml`, 다른 앱용 `MethodSpec .json`, 산출방법서 `.tex`(xelatex+kotex) · `.md` · `.html`(수식 포함) · 인쇄/PDF.
- 💾 브라우저 자동 저장(localStorage). 서버·로그인 없음.

## 실행

```bash
npm install --legacy-peer-deps   # npm 10 의 peer 계산 오류(edgesOut) 우회
npm run dev                      # http://localhost:3000
```

검증: `npm run typecheck && npm test && npm run build`

## 조건 파일 (YAML ↔ MethodSpec)

```yaml
meta:     { productName: 종신보험, kind: 표준형(완전 환급) }
contract: { age: 40, sex: M, termYears: 71, payYears: 20, freq: 12 }
basis:    { interest: 2.5%, standardInterest: 3.25%, waiver: false }
rates:
  - { id: q,   name: 제7회 경험생명표 사망률, role: death }
  - { id: k80, name: 80% 이상 장해율,        role: incidence }
expenses:
  - { group: 계약체결비용, symbol: α_S, basis: 보험가입금액, rate: 1% }
benefits:
  - { id: b1, name: 사망·80% 이상 장해, role: death, amount: 100000000, endAge: 110, exitRateIds: [q, k80] }
```

- 이율 `2.5%`, 사업비 `1.5/1000`, 배수 `1배` 처럼 실무 표기로 쓴다(읽을 때 소수로 바뀐다).
- 위험률 유형: `death` 사망 · `incidence` 최초발생 · `recurring` 반복지급 · `waiver` 납입면제 · `other`.
- 탈퇴 사유가 둘이면 유지자수·납입자수는 `l(1 − q − k + q·k/2)` — 따로 둔 납입면제율을 곱하지 않는다.
- 다른 앱과는 **MethodSpec JSON** 으로 주고받는다(`lib/methoddoc/spec.ts`).

## 구조

```
lib/methoddoc/     앱 독립 모듈 (flexible_insurance 와 같은 뿌리, 이쪽이 원본)
  spec.ts          MethodSpec · Evidence · validateSpec
  extract.ts pdf.ts  파일 → 문단·표 (DOCX·HWP·HWPX·PDF·Markdown)
  parse.ts         문단·표 → MethodSpec + 근거
  formulas.ts      MethodSpec → 산출식 (유지자수·납입자수·보험료·준비금·환급금)
  render.ts        MethodSpec → 산출방법서 블록 (블록마다 조건 경로)
  tex.ts           평문 수식 ↔ LaTeX, 산출방법서 ↔ .tex
lib/conditions/
  yaml.ts          조건 파일 ↔ MethodSpec, 줄 범위, 되읽은 값 병합, 주석 보존 패치
  link.ts          조건 줄 ↔ 산출방법서 블록 ↔ 원문 근거 대응
components/        Studio · CodeEditor · DocPreview · OriginalPane
docs/설계.md       설계·연동·LaTeX 변환 제안
```

## 문서

- 설계와 제안: [`docs/설계.md`](docs/설계.md)
- 모듈 설명: [`lib/methoddoc/README.md`](lib/methoddoc/README.md)
