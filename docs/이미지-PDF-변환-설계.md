# 스캔 PDF · 그림 파일 → 조건 변환

> 상태: **① 그림 받기 · ② 비전 읽기 구현됨 (2026-09-21)**. 정한 것: 회사 문서를 Anthropic API 로 보내도 된다 · API 키는 사용자가 앱에서 넣는다.
> 시험 자료는 `samples/07_스캔본_*` — 같은 내용의 글자 문서(`samples/02_*`)가 있어 정답과 맞대어 볼 수 있다.

## 1. 되는 것과 안 되는 것

| 올리는 것 | 지금 | 방법 |
|---|---|---|
| DOCX · HWPX · HWP(5.x) · TEX · MD · 글자 있는 PDF | ✅ 규칙으로 읽음 (무료 · 전송 없음) | `extract.ts` → `parse.ts` |
| 표준 산출방법서(Word·한글) | ✅ 값 + 수식 · 주석 · 절 | `parse.ts` 의 표준 양식 읽기 (`standards/README.md`) |
| 스캔한 PDF (글자 층 없음) | ✅ **그림으로 읽기** 창이 뜬다 | 쪽 그림 → Claude 가 옮겨 적기 → 같은 규칙 |
| PNG · JPG (사진·캡처) | ✅ 그림으로 읽기 | 위와 같음 |
| 글자 있는 PDF 인데 표가 깨지거나 수식이 그림 | ✅ [원문] 탭 **[그림으로 다시 읽기 (AI)]** | 위와 같음 |
| DRM 걸린 파일 · 한글 3.0 이하 | ❌ 이유를 알림 | 해제본 · 다시 저장이 필요 |

## 2. 흐름 — 모델은 옮겨 적기만, 해석은 앱이

```
 PDF(스캔) · PNG · JPG
        │  ① 쪽 그림 (브라우저 안 · pdf.js, 긴 변 2000px JPEG)            lib/pages.ts
        ▼
 그림으로 읽기 창 ── 쪽 고르기 · API 키 · 예상 비용 · "Anthropic API 로 보냅니다"   components/VisionDialog.tsx
        │  [N쪽 보내기] 전에는 아무것도 나가지 않는다
        ▼  ② 쪽마다 옮겨 적기 — 문단 · 식 줄 · 표(행×칸) JSON (구조화 출력)       lib/vision-client.ts
        ▼  ③ 쪽들을 한 문서로 (문단 목록 + 표 목록 — DOCX 를 읽은 것과 같은 모양)   lib/methoddoc/vision.ts
        ▼  ④ parseMethodDoc — 글자 있는 문서와 **같은 규칙**. 표준 산출방법서 스캔본이면 [식]·※ 까지
        ▼  ⑤ 조건(YAML) — 값 옆 주석 · [원문] 탭의 "옮겨 적은 글"과 "쪽 그림"으로 대조
```

처음 설계는 모델이 항목별 값(이율·사업비 …)을 JSON 으로 돌려주는 방식이었으나, **옮겨 적기**로 바꿨다.

- 단위 해석(2.5% → 0.025)·배수 판단(α_P "12% × MIN(보험기간,20)" → 2.4배)을 모델에 맡기지 않는다 — 규칙 하나가 모든 경로에 같다.
- 근거가 저절로 생긴다: 옮겨 적은 글의 줄·표가 [원문] 탭에 그대로 보이고, 규칙이 단 근거 딱지가 그 줄을 가리킨다.
- 양식이 늘어도 모델 쪽 지시문은 바뀌지 않는다(표준 산출방법서 v2 가 되어도 같은 옮겨 적기).

## 3. 만든 부품

| 파일 | 하는 일 |
|---|---|
| `lib/methoddoc/vision.ts` (공용) | `PAGE_SCHEMA`(쪽 = 블록 목록: text · formula · table) · `VISION_SYSTEM`(옮겨 적기 지시) · `readPage`(모양 검사) · `pagesToDoc` · `transcribe(images, ask)`(동시 3쪽, 쪽 순서 유지, 멈추기) · `estimate`(비용 어림). 호출은 `VisionAsk` 로 주입 — 앱에 딸리지 않는다 |
| `lib/vision-client.ts` (이 앱) | Anthropic TypeScript SDK 를 브라우저에서 직접(`dangerouslyAllowBrowser`). 사용자 키 보관(sessionStorage, 고르면 localStorage) · 오류를 사람 말로 |
| `lib/pages.ts` (이 앱) | PDF·그림 → 미리보기 · 보낼 그림 |
| `components/VisionDialog.tsx` | 쪽 고르기 · 키 · 예상 비용 · 진행 · 멈추기 |
| `components/OriginalPane.tsx` | [옮겨 적은 글] · [쪽 그림] 보기, 글자 있는 PDF 의 [그림으로 다시 읽기 (AI)] |

## 4. API 호출 (claude-opus-5)

```ts
client.beta.messages.stream({
  model: "claude-opus-5", max_tokens: 16000,
  betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",   // 안전 분류기가 거절하면 서버가 권장 모델로 다시
  output_config: { effort: "low", format: { type: "json_schema", schema: PAGE_SCHEMA } },
  system: VISION_SYSTEM,
  messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }, { type: "text", text: "N쪽을 옮겨 적어 주세요." }] }],
}).finalMessage()
```

- 결과를 읽기 전에 `stop_reason` 을 본다 — `refusal`(대체 모델까지 거절) · `max_tokens`(잘림)는 그 쪽 오류로 알린다.
- 옮겨 적기는 판단이 거의 필요 없어 `effort: "low"`. 표가 빽빽한 쪽이 잘 안 읽히면 `medium` 으로 올려 본다.
- 스트리밍(`stream` → `finalMessage`)으로 받는다 — 긴 응답에서 요청 시간 초과를 피한다.
- 쪽 하나를 한 요청으로 보낸다 — 쪽 고르기·진행 표시·실패한 쪽만 다시 보내기가 쉽다. 동시에 3쪽.

**비용** (입력 $5 · 출력 $25 / 100만 토큰)

| | 쪽당 | 20쪽 |
|---|---|---|
| 입력: 그림(1414×2000 ≈ 3,800 토큰) + 지시문 | 약 4,200 토큰 · $0.021 | $0.42 |
| 출력: 옮겨 적은 글 + 생각 | 약 2,000 토큰 · $0.05 | $1.00 |
| **합계** | **약 $0.07** | **약 $1.4** |

창에 예상 비용을, 끝나면 응답의 `usage` 로 잰 실제 비용을 알린다. 산출방법서 본문 쪽만 고르면 줄어든다.

## 5. 보안 · 개인정보

- **보내기 전에 보여 준다**: 보낼 쪽 그림 · 쪽 수 · 예상 비용 · "Anthropic API 로 보냅니다" → [N쪽 보내기].
- **API 키**: 사용자가 창에서 넣는다. 기본은 이 창에서만 기억(sessionStorage), [이 브라우저에 기억]을 고르면 localStorage. 조건 파일 · JSON · 내보내기에 들어가지 않는다(e2e 가 확인).
- 키가 브라우저에 있으므로 **사용자 본인 키**만 쓴다. 여러 사람이 쓰는 회사 배포라면 작은 서버 함수로 회사 키를 감추는 방법이 있다 — "서버 없음" 원칙에서 벗어나므로 그때 정한다.

## 6. 시험

| 시험 | 무엇을 |
|---|---|
| `tests/vision.test.ts` | 가짜 모델(ask)로 — 02 실무양식을 옮겨 적은 글이 DOCX 와 **같은 조건** · 표준 산출방법서 스캔본은 식까지 · 모양 틀린 응답 거르기 · 멈추기 · 비용 어림 |
| `scripts/e2e.cjs` 19) | 브라우저에서 스캔 PDF → 창 → (Playwright 가 api.anthropic.com 을 가짜 SSE 로 대답) → 조건 · 보낸 요청(모델 · 그림 · 구조화 출력 · fallbacks) · 키가 localStorage 에 없음 |

실제 API 로 재어 볼 것(키가 있을 때 사람이): `samples/07_스캔본_든든건강보험.pdf` → 02 와 같은 값이 나오는지, 실제 스캔본 4건(63멀티CI · 암진단추가보장특약 · 치아사랑특약 · 퓨처30 퍼펙트통합보장).

## 7. 다음 단계 (필요하면)

| 단계 | 내용 |
|---|---|
| 브라우저 OCR | 전송이 허락되지 않는 문서용 Tesseract.js(한국어) — 글자 좌표로 `pdf.ts` 의 표 되살리기를 그대로 쓴다 |
| 자유설계보험 | 서버 라우트에 같은 `vision.ts` 를 연결(서버 키) |
| 실패한 쪽만 다시 | 지금은 한 쪽이 실패하면 전체를 다시 보낸다 — 쪽별 결과를 남겨 두고 실패한 쪽만 |
