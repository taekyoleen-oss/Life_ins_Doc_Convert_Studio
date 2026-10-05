// Life_ins_Doc_Convert_Studio 동작 확인 — 선택 연결·파일 열기·LaTeX 반영·입력 카드·위험률 표·수식 견본·화면 조절·Word 표준 양식·그림으로 읽기(가짜 API)
/* eslint-disable @typescript-eslint/no-require-imports -- node 로 바로 돌리는 CommonJS 스크립트 */
const path = require("path"), fs = require("fs");
const PW = path.join(process.env.LOCALAPPDATA, "npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.js");
const CHROME = path.join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1234/chrome-win64/chrome.exe");
const { chromium } = require(PW);
const OUT = process.env.OUT;
// 회사 산출방법서 PDF(OneDrive)가 있으면 그것으로, 없으면 samples/02 실무 양식 PDF 로 (읽는 값이 다르다 — 아래 5) 에서 가른다)
const ROOT = "C:/Users/tklee/OneDrive - 코리안리재보험/0. 보험료 산출 방법서";
const company = fs.existsSync(ROOT) ? (() => {
  const dir = fs.readdirSync(ROOT).find((d) => d.normalize("NFC").includes("교직원 공제"));
  const f = dir && fs.readdirSync(path.join(ROOT, dir)).find((f) => f.normalize("NFC").includes("실속건강공제") && /\.pdf$/i.test(f));
  return f ? path.join(ROOT, dir, f) : null;
})() : null;
const SAMPLES_DIR = path.join(__dirname, "../samples");
const pdf = company ?? path.join(SAMPLES_DIR, fs.readdirSync(SAMPLES_DIR).find((f) => f.normalize("NFC").startsWith("02_") && /\.pdf$/i.test(f)));
const PDF_RATE = company ? "4.25%" : "2.75%", PDF_EXP = company ? "신계약비" : "계약체결비용";

const log = [];
const ok = (name, cond, extra = "") => log.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ["--headless=new"] });
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push("pageerror " + e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push("console " + m.text()); });
  p.on("response", (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
  p.on("dialog", (d) => { d.accept().catch(() => {}); });      // 덮어쓰기·지우기 확인은 모두 "예"
  await p.goto("http://localhost:3217", { waitUntil: "networkidle" });
  await p.evaluate(() => localStorage.clear());
  await p.waitForTimeout(900);                                   // 자동 저장 타이머(300·500ms)가 지난 뒤 한 번 더 지운다
  await p.evaluate(() => localStorage.clear());
  // 아래 확인은 검산 기준 상품(종신보험(암진단 포함))과 숨긴 샘플까지 쓴다 — ?sample · ?all. 공유 화면(첫 화면 종신보험 · 샘플 둘)은 맨 끝에서 새 창으로 본다
  await p.goto("http://localhost:3217/?sample=wholeCancer&all", { waitUntil: "networkidle" });
  await p.waitForSelector(".doc-body h1");
  if (await p.locator(".guide-bar").count()) await p.click(".guide-bar button:has-text('안내 닫기')");
  const OPEN = "input[aria-label='열 파일']", MERGE = "input[aria-label='고쳐 반영할 파일']";
  ok("첫 화면: 종신보험 산출방법서", (await p.textContent(".doc-body h1")).includes("종신보험"));
  ok("KaTeX 수식이 그려진다", (await p.locator(".doc-body .formula .katex").count()) >= 8);
  const heads0 = await p.$$eval("table.sheet th.sheet-name", (els) => els.map((e) => e.textContent.replace(/^[A-Z]\s*/, "").trim()));
  ok("첫 화면: 기본 상품 종신보험(암진단 포함) — 입력 카드와 위험률 표 한 세트(사망률·장해율·암발생률 모두 남·여)",
    (await p.textContent(".doc-body h1")).includes("종신보험(암진단 포함)") && (await p.locator(".form-body .card").count()) >= 9
    && heads0.join(",") === "연령,사망률(남),사망률(여),80% 이상 장해율(남),80% 이상 장해율(여),암발생률(남),암발생률(여)", heads0.join(","));
  ok("첫 화면: 보장 표에 암 진단(0.5배 · 90일 면책) · [납입] 유지자(D′) = 사망·80% 장해·암", (await p.locator(".doc-body tr", { hasText: "암 진단" }).allTextContents()).some((t) => t.includes("90일") && t.includes("0.5"))
    && (await p.locator(".doc-body tr", { hasText: "현가누계" }).allTextContents()).some((t) => t.includes("D′")));
  ok("첫 화면: 산출방법서에 별첨 위험률 표 · 상태줄 '표 없음' 없음", (await p.locator(".doc-body h2", { hasText: "별첨" }).count()) === 1 && !(await p.textContent("footer")).includes("표 없음"));
  await p.screenshot({ path: `${OUT}/s1_first.png` });

  // 0-1) 카드 흐름 — 유지자(S01: lx·Dx·Nx) → 보험금(B01: 대상자수·d·Cx·Mx) → 보장(B02: 배수·면책·삭감 → PVB) → 보험료의 계산(M07)
  const codes = await p.$$eval(".form-body [data-card]", (els) => els.map((e) => e.dataset.card));
  ok("카드 순서가 산출방법서 차례다 — 문서 정보 · 개요 · 이율 · 위험률 · 사업비 → 위험률 합성 → 유지자 → 보험금 → 보장 → 보험료 계산 → 준비금 → 따로 적는 식", codes.join(",") === "M00,M01,M03,M04,M06,C01,S01,B01,B02,M07,M08,M09", codes.join(","));
  const trial = (await p.textContent(".trial-bar")).replace(/\s+/g, " ");
  ok("맨 위 [산출 조건] — 계약 한 점(가입금액 포함)과 그 보험료, 조건에 저장하지 않는다고 알린다",
    trial.includes("산출 조건") && trial.includes("342,000") && trial.includes("조건 파일에 저장하지 않습니다") && (await p.locator(".trial-bar select").count()) === 5, trial.slice(0, 80));
  const payCols = await p.$$eval(".trial-pay th", (e) => e.map((x) => x.textContent.trim()));
  const payVals = await p.$$eval(".trial-pay td", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  ok("납입방법별 보험료 — 월납·3개월납·6개월납·연납 넷, 월납이 342,000원이고 연납이 월납 × 11 보다 크다",
    payCols.join(",") === "월납,3개월납,6개월납,연납" && payVals[0].startsWith("342,000원") && Number(payVals[3].replace(/[^0-9]/g, "").slice(0, 9)) > 342000 * 11, payVals.join(" | "));
  ok("계약 단위 탭 — 주계약 하나와 [＋ 특약]", (await p.locator(".unit-tabs .unit-tab").count()) === 1 && (await p.textContent(".unit-tabs")).includes("주계약") && (await p.locator(".unit-tabs button:has-text('＋ 특약')").count()) === 1);
  ok("머리의 [보기]는 묶음 제목으로 따로 보인다(단추와 다른 모양)", (await p.locator("header .seg-label").count()) === 1
    && (await p.$eval("header .seg-label", (e) => getComputedStyle(e).backgroundColor)) !== (await p.$eval("header .seg > button", (e) => getComputedStyle(e).backgroundColor)));
  // 위험률 합성 카드 — 산출방법서 나. 기호의 정의 아래 위험률 합성 표와 같다: 합성마다 기호 Q(j)·R(j) · 이름 · 묶는 위험률
  await p.click(".card[data-card=C01] .card-head");
  await p.waitForTimeout(700);
  const hlCombo = await p.$$eval(".doc-body .doc-hl", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").slice(0, 60)));
  const docAll = (await p.textContent(".doc-body")).replace(/\s+/g, " ");
  ok("C01 위험률 합성 — 합성 셋(Q(1) 사망·80% 장해 · Q(2) 사망·암 · Q(3) 셋 — 안의 R(3)), 열면 기호의 정의 아래 위험률 합성 표가 강조된다",
    (await p.locator(".card[data-card=C01] .sub").count()) === 3 && hlCombo.some((t) => t.startsWith("Q(1)x사망·80% 이상 장해 결합")) && hlCombo.some((t) => t.startsWith("R(3)x"))
    && !hlCombo.some((t) => t.includes("아닌 유지자")), hlCombo.join(" / ").slice(0, 300));
  ok("산출방법서: 유지자 표의 대상 위험률은 합성 기호만(식은 위험률 합성 표에) · 질병 발생률 행 없음 · 보험금 표 셋째 행은 '현가 및 누계'",
    docAll.includes("대상 위험률Q(1)x+t계산기수") && !docAll.includes("질병 발생률") && docAll.includes("현가 및 누계") && !/계산기수C/.test(docAll), docAll.slice(docAll.indexOf("대상 위험률"), docAll.indexOf("대상 위험률") + 60));
  ok("산출방법서 표의 머리(1행)는 가운데 정렬", (await p.$$eval(".doc-body th", (els) => els.every((e) => getComputedStyle(e).textAlign === "center"))));
  await p.fill(".card[data-card=C01] input[aria-label='위험률 합성 (1) 이름']", "사망·장해 탈퇴율");
  await p.waitForTimeout(700);
  ok("합성에 이름을 붙이면 산출방법서 위험률 합성 표 · 보험금 대상 위험률 콤보에 그 이름", (await p.textContent(".doc-body")).includes("사망·장해 탈퇴율"));
  await p.fill(".card[data-card=C01] input[aria-label='위험률 합성 (1) 이름']", "");
  await p.waitForTimeout(500);
  // 유지자 카드 — 산출방법서 다. 유지자와 같다: lx(k) 마다 대상 위험률 → lx · Dx · Nx, 보험료 납입기수(N*)에 쓰는 유지자에 [납입](문서의 D′)
  await p.click(".card[data-card=S01] .card-head");
  await p.waitForTimeout(700);
  const hlS = await p.$$eval(".doc-body .doc-hl", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").slice(0, 50)));
  ok("S01 유지자 — lx(1)·lx(2)·lx(3) 셋, 열면 유지자 표만 강조(보험금 표·순보험료 식은 아니다)",
    (await p.locator(".card[data-card=S01] .sub").count()) === 3 && hlS.filter((t) => /^\(\d\) l\(\d\)x — .*아닌 유지자/.test(t)).length === 3
    && !hlS.some((t) => t.startsWith("대상자수")) && !hlS.some((t) => t.includes("순보험료")), hlS.join(" / ").slice(0, 300));
  const payOn = await p.$$eval(".card[data-card=S01] .sub", (els) => els.map((e) => e.querySelector("label[title^='[납입]'] input").checked));
  ok("[납입] 은 계약 단위마다 하나 — lx(3) 사망, 80% 이상 장해, 암 아닌 유지자", JSON.stringify(payOn) === "[false,false,true]"
    && (await p.textContent(".card[data-card=S01] .sub >> nth=2")).includes("주계약"), JSON.stringify(payOn));
  const box5 = await p.$eval(".card[data-card=S01]", (e) => { const r = e.getBoundingClientRect(), f = e.closest(".form-body").getBoundingClientRect(); return Math.abs((r.top + r.bottom) / 2 - (f.top + f.bottom) / 2); });
  ok("카드를 열면 그 카드가 조건 창의 한가운데로 온다", box5 < 160, `가운데에서 ${Math.round(box5)}px`);
  await p.$eval(".doc-body", (e) => { let x = e; while (x && x.scrollHeight <= x.clientHeight) x = x.parentElement; if (x) x.scrollTop = 0; });
  await p.waitForTimeout(300);
  await p.click(".card[data-card=S01] .card-doc");
  await p.waitForTimeout(900);
  const back = await p.$eval(".doc-body .doc-hl", (e) => { const r = e.getBoundingClientRect(); return r.top > 0 && r.top < window.innerHeight; }).catch(() => false);
  ok("카드 머리 [산출방법서] → 산출방법서를 옮겨 본 뒤에도 그 카드의 자리(유지자 표)로 돌아간다", back && (await p.locator(".card .card-doc").count()) >= 10);  ok("유지자 산출 결과(lx · Dx · Nx)는 접혀 있다", (await p.locator(".card[data-card=S01] details.calc-fold").count()) === 3 && (await p.locator(".card[data-card=S01] details.calc-fold[open]").count()) === 0);
  await p.click(".card[data-card=S01] details.calc-fold >> nth=0 >> summary");
  await p.waitForTimeout(300);
  const survRows = await p.$$eval(".card[data-card=S01] details.calc-fold[open] tbody tr", (rs) => rs.map((r) => [...r.cells].map((c) => c.textContent.trim())));
  ok("펼치면 연령마다 lx · Dx · Nx — 40세 lx = 100,000", survRows.length >= 60 && survRows[0][1] === "40" && survRows[0][2] === "100,000.00" && Number(survRows[1][2].replace(/,/g, "")) < 100000, JSON.stringify(survRows.slice(0, 2)));
  const survPick = await p.$$eval(".card[data-card=S01] select[aria-label$='대상 위험률'] option:checked", (o) => o.map((x) => x.textContent));
  ok("S01 대상 위험률은 콤보 — 이름 뒤에 기호: lx(1) = 사망·80% 이상 장해 결합(Q⁽¹⁾ₓ)", survPick[0] === "사망·80% 이상 장해 결합(Q⁽¹⁾ₓ)" && survPick.length === 3, survPick.join(" / "));
  await p.focus(".card[data-card=S01] select[aria-label='lx(1) 대상 위험률']");
  await p.waitForTimeout(400);
  const hlR = await p.$$eval(".doc-body .doc-hl", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").slice(0, 40)));
  ok("대상 위험률 칸을 누르면 그 유지자 표가 선택된다(위험률 표·합성 표로 옮겨 가지 않는다)", hlR.some((t) => t.startsWith("(1) l(1)x")) && !hlR.some((t) => t.startsWith("사망률q") || t.startsWith("Q(1)x")), hlR.join(" / ").slice(0, 300));
  await p.locator(".card[data-card=S01] .pane-tool", { hasText: "＋ 위험률" }).first().click();
  await p.waitForTimeout(500);
  ok("S01 [＋ 위험률] → 기본 위험률 모음 창이 열린다(위험률 더하기의 기본)", (await p.locator(".modal.lib-modal").count()) === 1);
  await p.click(".modal.lib-modal button:has-text('닫기')");

  await p.click(".card[data-card=M07] .card-head");
  await p.waitForTimeout(700);
  const calc0 = await p.$$eval(".card[data-card=M07] .calc-table tbody tr", (rows) => rows.map((r) => [...r.cells].map((c) => c.textContent.trim())));
  ok("M07: 산출방법서의 식을 그대로 읽어 산출 — 1원당 6자리(0.002606 · 0.001624) → 10만원당 261 · 162 → 담보 보험료 합 342,000원",
    calc0[0].includes("0.002606") && calc0[0].includes("261") && calc0[1].includes("0.001624") && calc0[1].includes("162") && calc0[2].includes("342,000 원"), JSON.stringify(calc0));

  // 0-1b) 카드의 식은 기본이 숨김 — 값부터 보게 한다. 뒤의 식 확인을 위해 켠다
  ok("카드의 식은 기본이 숨김 — 식이 있는 카드(S01·B01·B02·M07·M08)에만 머리에 [수식 보이기], 없는 카드(M01·M04·M06)에는 없다",
    (await p.locator(".card[data-card=S01] .formula-card").count()) === 0
    && (await p.locator(".card[data-card=M07] .card-fx").textContent()).includes("수식 보이기")
    && (await p.locator(".card .card-fx").count()) === 5 && (await p.locator(".card[data-card=M04] .card-fx").count()) === 0);
  await p.click(".card[data-card=M07] .card-fx");
  await p.waitForTimeout(400);
  ok("[수식 보이기] → 그 카드의 식만 보인다 (N* · P · 기준연납 · G · 반올림)", (await p.locator(".card[data-card=M07] .formula-card").count()) === 5
    && (await p.locator(".card[data-card=M07] .card-fx").textContent()).includes("수식 숨기기") && (await p.locator(".card[data-card=S01] .card-fx").textContent()).includes("수식 보이기"));

  // 0-2) 보험금 카드 — 보험금마다 대상자수(유지자 lx 콤보) + 급부 위험률(콤보) → d · Cx · Mx
  await p.click(".card[data-card=B01] .card-head");
  await p.waitForTimeout(700);
  const hlB = await p.$$eval(".doc-body .doc-hl", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").slice(0, 40)));
  ok("B01 을 열면 라. 보험금의 표만 비친다 (유지자 표·보장 표·순보험료 식은 아니다)",
    hlB.some((t) => t.startsWith("(2) 암 진단")) && hlB.some((t) => t.startsWith("대상자수")) && !hlB.some((t) => t.includes("아닌 유지자"))
    && !hlB.some((t) => t.startsWith("암 진단100")) && !hlB.some((t) => t.includes("순보험료")), hlB.join(" / ").slice(0, 300));
  await p.click(".card[data-card=B01] .card-fx");                              // 이 카드의 식을 켠다
  await p.waitForTimeout(400);
  const lxFrom = (await p.textContent(".card[data-card=B01] .lx-from")).replace(/\s+/g, " ");
  const survOpts = await p.$$eval(".card[data-card=B01] .sub-open select[aria-label='대상자수'] option", (o) => o.map((x) => x.textContent));
  ok("B01: 대상자수는 앞의 유지자 lx 를 콤보로 고른다(탈퇴 사유 체크 없음) — lx(1)·lx(2)·lx(3), 첫 보험금은 lx(1)",
    (await p.locator(".card[data-card=B01] .sub-open [data-path$='.exitRateIds'] input[type=checkbox]").count()) === 0 && survOpts.length === 3
    && (await p.locator(".card[data-card=B01] .sub-open select[aria-label='대상자수'] option:checked").textContent()).startsWith("lx(1) 사망, 80% 이상 장해 아닌 유지자")
    && lxFrom.includes("유지자 카드에서 보기"), `${survOpts.join(" / ")} · ${lxFrom.slice(0, 80)}`);
  ok("담보 이름과 겹치던 [지급 사유] 칸은 없앴다 · 계약 단위 칸도 없다(탭에서) · 증액·감액 구간도 없다 · 배수·면책은 B02 로",
    (await p.locator("[data-path$='.trigger']").count()) === 0 && (await p.locator("[data-path$='.unit']").count()) === 0 && (await p.locator("[data-path$='.steps']").count()) === 0
    && (await p.locator(".card[data-card=B01] [data-path$='.multiple']").count()) === 0);
  // 대상 위험률 — 앞 카드에서 정한 위험률(M04)과 위험률 합성(C01)만 고른다. 사망형 첫 보험금은 대상자수 lx(1) 의 Q(1)
  const rateOpts = await p.$$eval(".card[data-card=B01] .sub-open [data-path$='.rateId'] select option", (o) => o.map((x) => x.textContent));
  const ratePick = await p.$eval(".card[data-card=B01] .sub-open select[aria-label='대상 위험률']", (e) => e.selectedOptions[0]?.textContent ?? "");
  const b1 = (await p.textContent(".card[data-card=B01] .sub-open")).replace(/\s+/g, " ");
  ok("B01 대상 위험률 콤보: M04 위험률 셋 + C01 위험률 합성 셋만(다른 문구 없음) — 이름 뒤에 기호(사망률(qₓ)) · 고른 것 사망·80% 이상 장해 결합(Q⁽¹⁾ₓ) · 결합 위험률 넣기 단추 없음",
    rateOpts.join("|") === "사망률(qₓ)|80% 이상 장해율(r⁽¹⁾ₓ)|암발생률(r⁽²⁾ₓ)|사망·80% 이상 장해 결합(Q⁽¹⁾ₓ)|사망·암 결합(Q⁽²⁾ₓ)|사망·80% 이상 장해·암 결합(Q⁽³⁾ₓ)" && ratePick === "사망·80% 이상 장해 결합(Q⁽¹⁾ₓ)" && !b1.includes("결합 위험률을 위험률 표에 넣기"), `${rateOpts.join(" / ")} · ${ratePick}`);
  const benRes = (await p.textContent(".card[data-card=B01] .calc-panel .calc-table")).replace(/\s+/g, " ");
  ok("B01 산출 결과: 대상자수 · 대상 위험률 열(Q(1) 사망·80% 이상 장해 결합)", benRes.includes("대상 위험률") && benRes.includes("사망·80% 이상 장해 결합(Q⁽¹⁾ₓ)"), benRes.slice(0, 160));
  ok("보험금 산출 결과(Cx · Mx)는 접혀 있다", (await p.locator(".card[data-card=B01] .sub-open details.calc-fold").count()) === 1 && (await p.locator(".card[data-card=B01] details.calc-fold[open]").count()) === 0);
  await p.click(".card[data-card=B01] .sub-open details.calc-fold summary");
  await p.waitForTimeout(300);
  const cmHead = await p.$$eval(".card[data-card=B01] details.calc-fold[open] thead th", (e) => e.map((x) => x.textContent.trim()));
  const cmRows = await p.locator(".card[data-card=B01] details.calc-fold[open] tbody tr").count();
  ok("펼치면 연령마다 Cx · Mx (종신 — 72줄)", cmHead.join("|") === "t|연령|Cx|Mx" && cmRows === 72, `${cmHead.join("|")} · ${cmRows}줄`);
  ok("보험금 칸: 이름 · 급부 유형 · 보험기간(M01 에서) · 대상자수 · 대상 위험률",
    ["급부 유형", "보험기간", "대상자수", "대상 위험률"].every((t) => b1.includes(t))
    && (await p.locator(".card[data-card=B01] .sub-open [data-path$='.endAge'] input").count()) === 0
    && (await p.textContent(".card[data-card=B01] .sub-open [data-path$='.endAge'] .ben-term")).includes("종신"), b1.slice(0, 120));
  ok("보험기간은 보험금에서 고치지 않는다 — 맨 위 산출 조건에 보이고(종신은 고정), M01 가입 조건에서 정한다",
    (await p.locator(".trial-bar .trial-fixed").count()) === 1 && (await p.textContent(".trial-bar .trial-fixed")).includes("담보별"));
  const fldRows = await p.$$eval(".card[data-card=B01] .fld:not(.ben-grid .fld)", (els) => els.map((f) => {
    const lab = f.querySelector(".fld-label"), box = f.querySelector(".fld-box");
    if (!lab || !box) return null;
    const a = lab.getBoundingClientRect(), c = box.getBoundingClientRect();
    return Math.abs((a.top + a.height / 2) - (c.top + c.height / 2)) < 6;
  }).filter((x) => x !== null));
  ok("입력 칸은 이름과 칸이 한 줄 (자리가 모자랄 때만 두 줄)", fldRows.length >= 2 && fldRows.every(Boolean), `${fldRows.filter(Boolean).length}/${fldRows.length}`);
  await p.click(".card[data-card=B01] .lx-from button:has-text('유지자 카드에서 보기')");
  await p.waitForTimeout(600);
  ok("[유지자 카드에서 보기] → S01 이 펼쳐지고 [납입] 유지자 lx(3) 표가 강조된다",
    (await p.locator(".card.card-open").getAttribute("data-card")) === "S01"
    && (await p.$$eval(".doc-body .doc-hl", (e) => e.map((x) => x.textContent))).some((t) => t.startsWith("(3) l(3)x")));

  // 0-2b) 보장 카드 — 산출방법서 마. 보장 표: 보장마다 배수 · 면책 · 삭감기간 · 삭감 시 지급률
  await p.click(".card[data-card=B02] .card-head");
  await p.waitForTimeout(700);
  const covHead = await p.$$eval(".card[data-card=B02] .cover-table thead th", (e) => e.map((x) => x.textContent.trim()));
  const hlC = await p.$$eval(".doc-body .doc-hl", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").slice(0, 40)));
  ok("B02 보장: 표 칸 = 산출방법서 마. 보장(구분 · 보장금액 배수 · 면책 · 삭감기간 · 삭감 시 지급률), 보장 둘 · 열면 보장 표와 PVB 식이 비친다",
    covHead.join("|") === "구분|보장금액 배수|면책|삭감기간|삭감 시 지급률" && (await p.locator(".card[data-card=B02] .cover-table tbody tr").count()) === 2
    && hlC.some((t) => t.startsWith("암 진단")) && (await p.$$eval(".doc-body .doc-hl", (els) => els.some((e) => e.textContent.includes("PVB")))), hlC.join(" / ").slice(0, 200));
  ok("암 진단 행 — 0.5배 · 90일 면책 · 삭감 없음", (await p.inputValue(".card[data-card=B02] tbody tr >> nth=1 >> [aria-label='면책']")) === "90"
    && (await p.inputValue(".card[data-card=B02] tbody tr >> nth=1 >> [aria-label='삭감기간']")) === "0" && (await p.locator(".card[data-card=B02] tbody tr >> nth=1 >> [aria-label='삭감 시 지급률']").isDisabled()));
  const prem0 = (await p.textContent(".trial-bar")).replace(/\s+/g, " ");
  await p.selectOption(".card[data-card=B02] tbody tr >> nth=1 >> [aria-label='삭감기간']", "730");     // 면책 90일 + 2년 50% 삭감을 함께
  await p.waitForTimeout(900);
  const covRow = await p.locator(".doc-body tr", { hasText: "암 진단" }).filter({ hasText: "2년" }).first().textContent().catch(() => "");
  const prem1 = (await p.textContent(".trial-bar")).replace(/\s+/g, " ");
  ok("면책과 삭감을 함께 — 문서 보장 표에 '90일 · 2년 · 50%' · 보험료가 내려간다", /90일2년50%/.test(covRow.replace(/\s+/g, "")) && prem1 !== prem0, `${covRow} · ${prem1.slice(0, 60)}`);
  await p.selectOption(".card[data-card=B02] tbody tr >> nth=1 >> [aria-label='삭감기간']", "0");
  await p.waitForTimeout(900);
  ok("삭감을 없애면 처음 보험료로", (await p.textContent(".trial-bar")).replace(/\s+/g, " ") === prem0);
  // ＋ 보장 → 새 행의 구분(이름)을 보장 표에서 바로 고친다 · 대상자수·급부 위험률은 B01 에서 확인하라는 안내
  await p.click(".card[data-card=B02] button:has-text('＋ 보장')");
  await p.waitForTimeout(700);
  await p.fill(".card[data-card=B02] tbody tr >> nth=2 >> td >> nth=0 >> input", "암 수술");
  await p.waitForTimeout(800);
  const addMsg = (await p.textContent(".card[data-card=B02] .cover-added").catch(() => "")).replace(/\s+/g, " ");
  ok("＋ 보장 → 구분(이름)을 보장 표에서 고친다 — 문서 보장 표·보험금 머리에 함께 · B01 에서 확인하라는 안내",
    (await p.locator(".doc-body tr", { hasText: "암 수술" }).count()) >= 1 && (await p.locator(".doc-body p", { hasText: "(3) 암 수술" }).count()) === 1 && addMsg.includes("B01 보험금"), addMsg);
  await p.click(".card[data-card=B02] .cover-added button:has-text('보험금 카드에서 보기')");
  await p.waitForTimeout(700);
  ok("[보험금 카드에서 보기] → B01 이 펼쳐진다", (await p.locator(".card.card-open").getAttribute("data-card")) === "B01");
  for (let k = 0; k < 4 && (await p.locator(".doc-body p", { hasText: /^\(3\) (암 수술|담보)/ }).count()) > 0; k++) { await p.locator(".pane-tool", { hasText: "↶ 되돌리기" }).click(); await p.waitForTimeout(600); }
  await p.click(".card[data-card=B02] .card-head");                         // 다음 단계가 B01 을 여는 데서 시작하게(B02 를 펼친 처음 상태로)
  await p.waitForTimeout(500);
  const back3 = await p.$$eval(".doc-body p", (e) => e.map((x) => x.textContent).filter((t) => /^\(3\) /.test(t)));
  ok("되돌려 보장 둘로", !back3.some((t) => /^\(3\) (암 수술|담보)/.test(t)) && (await p.textContent(".trial-bar")).replace(/\s+/g, " ") === prem0, `${back3.join(" / ")} · ${(await p.textContent(".trial-bar")).replace(/\s+/g, " ").slice(0, 120)} · 처음 ${prem0.slice(0, 120)}`);

  // 0-3) 식을 고치면 산출방법서와 시산이 함께 바뀐다 → 되돌리기
  await p.click(".card[data-card=B01] .card-head");
  await p.waitForTimeout(600);
  const docCancer = () => p.locator(".doc-body .formula", { hasText: "PVB" }).first().textContent();   // 마. 보장의 S_t · PVB
  const pvb2 = async () => (await p.textContent(".card[data-card=B01] .calc-panel .calc-table")).replace(/\s+/g, " ");
  const was = await pvb2();
  const docWas = await docCancer();                                            // 암 진단의 식 덩이 — 면책이 보장금액 배수 S 로 들어 있다
  await p.click(".card[data-card=B01] .fold-head >> nth=1");                   // 둘째 담보(암 진단)
  await p.waitForTimeout(500);
  const box2 = p.locator(".card[data-card=B01] .sub-open .formula-card").last();
  ok("B01: 보험금마다 식 한 덩이 · 마. 보장의 PVB = 1·M_x + 0.5·( M_{x+0.25} − M_{x+n} ) — 90일 면책이 M 의 시작에 나타난다",
    (await p.locator(".card[data-card=B01] .sub-open .formula-card").count()) === 1 && /x\+0\.25/.test(docWas) && /PVB/.test(docWas), docWas);
  await box2.locator("button:has-text('식 고치기')").click();
  const ta2 = box2.locator("textarea");
  await ta2.fill((await ta2.inputValue()).replace("if( t = 0, 1 − 3/12, 1 )", "1"));
  await p.waitForTimeout(1000);
  const [chip2, doc2, now2] = [await box2.locator(".chip-changed").count(), await docCancer(), await pvb2()];
  ok("B01 에서 식을 고치면 '고친 식' 딱지 · 산출방법서의 식 · 시산 PVB 가 함께 바뀐다",
    chip2 === 1 && doc2 !== docWas && now2 !== was, `딱지 ${chip2} · 문서 ${doc2 !== docWas ? "바뀜" : "그대로"} · PVB ${now2 !== was ? "바뀜" : "그대로"}`);
  await box2.locator("button:has-text('되돌리기')").click();
  await p.waitForTimeout(1000);
  ok("[되돌리기] → 자동 식으로 돌아가고 시산도 처음 값", (await docCancer()) === docWas && (await pvb2()) === was);

  // 0-4) 수식 숨기기/보이기 · 표준 산출방법서의 장 구성
  const nBox = await p.locator(".card[data-card=B01] .formula-card").count();
  await p.click(".card[data-card=B01] .card-fx");
  await p.waitForTimeout(400);
  const hid = await p.locator(".card[data-card=B01] .formula-card").count();
  await p.click(".card[data-card=B01] .card-fx");
  await p.waitForTimeout(400);
  ok("카드의 [수식 숨기기] → 그 카드의 식이 사라지고, [수식 보이기] 로 돌아온다",
    nBox > 0 && hid === 0 && (await p.locator(".card[data-card=B01] .formula-card").count()) === nBox, `${nBox} → ${hid} → 되돌림`);
  // 0-4b) M08 책임준비금·해지환급금 — 식과 시산(V · W · 환급률)
  await p.click(".card[data-card=M08] .card-head");
  await p.waitForTimeout(900);
  const m8 = (await p.textContent(".card[data-card=M08]")).replace(/\s+/g, " ");
  ok("M08: 계산에 반영되는 조건 표(해약공제 기간 · 해약공제 신계약비 · 결산 적립금 max(V, V^{표준}) 식) + 10만원당 V · W · 환급률 산출 결과(담보 둘)", m8.includes("계산에 반영되는 조건") && (await p.locator(".card[data-card=M08] .note-item .katex").count()) === 3 && (await p.locator(".card[data-card=M08] .note-item").count()) === 4 && (await p.locator(".card[data-card=M08] .calc-table").count()) === 2
    && /준비금 V \(10만원당\)[\d,]+/.test(m8) && /환급률[\d.]+%/.test(m8), m8.slice(0, 100));
  await p.click(".card[data-card=M08] .card-fx");
  await p.waitForTimeout(400);
  ok("M08 의 식: P_β · V · 해약공제 신계약비 · 해약공제 · W · 납입누계 · 환급률", (await p.locator(".card[data-card=M08] .formula-card").count()) === 7);
  const outline = await p.$$eval("#print-area h2, #print-area h3", (e) => e.map((x) => x.textContent));
  ok("산출방법서가 v8 장 구성 — 1. 보험료(가. 기초율 · 나. 기호 · 다. 유지자 · 라. 보험금 · 마. 보장 · 바. 순보험료) · 2. 책임준비금 · 3. 해지환급금",
    outline.join(" | ") === "개요 | 1. 보험료의 계산에 관한 사항 | 가. 예정기초율 | 나. 기호의 정의 | 다. 유지자 | 라. 보험금 | 마. 보장 | 바. 순보험료 및 영업보험료 | 2. 책임준비금의 계산에 관한 사항 | 3. 해지환급금의 계산에 관한 사항 | 4. 별첨 — 위험률 표",
    outline.join(" | "));
  await p.screenshot({ path: `${OUT}/s1b_cards.png` });

  // 0-5) 보험료 계산 — 엑셀처럼 한 해 한 줄, 열·칸을 누르면 그 식
  await p.click("header button:has-text('보험료 계산')");
  await p.waitForSelector(".calc-modal .calc-grid");
  const cHead = await p.$$eval(".calc-modal thead tr:nth-child(2) th", (e) => e.map((x) => x.textContent.trim()));
  ok("보험료 계산 표: 위험률 → 현가율 둘 → 유지자 lx(k)·Dx·Nx → 이 담보의 l·지급자수 → 현가·누계 → 보장금액 배수·급부 현가",
    /사망률/.test(cHead[3]) && cHead.filter((t) => t.includes("현가율")).length === 2
    && cHead.some((t) => t.includes("유지자수 lx(1)")) && cHead.some((t) => t.includes("유지자수 lx(3)")) && cHead.some((t) => t.includes("[납입]"))
    && cHead.some((t) => t.includes("지급자수")) && cHead.some((t) => t.includes("현가의 누계")) && cHead.some((t) => t.includes("책임준비금")) && cHead.some((t) => t.includes("환급률")), `${cHead.length}열 ${cHead.slice(0, 12).join("|")}`);
  const inputs = (await p.textContent(".calc-modal .calc-left")).replace(/\s+/g, " ");
  ok("왼쪽에 계약·기초율 — 가입나이·가입금액·보장기간·납입기간·납입주기·이율·현가율·배수·보장금액·사업비",
    ["가입나이 x", "보험가입금액", "보장기간 n", "납입기간 m", "납입주기 k", "적용이율 i", "현가율 v", "보장금액 배수", "보장금액", "α_S", "γ"].every((t) => inputs.includes(t)), inputs.slice(0, 120));
  const nRow = await p.locator(".calc-modal .calc-grid tbody tr").count();
  const sums = (await p.textContent(".calc-modal .calc-sum")).replace(/\s+/g, " ");
  ok("담보 하나가 보장기간 만큼 한 해 한 줄(72줄) · 표 아래 N*·PVB·P·G·10만원당 261 · 담보 보험료 261,000원",
    nRow === 72 && /N\*/.test(sums) && sums.includes("261") && sums.includes("261,000 원"), `${nRow}줄 · ${sums.slice(0, 80)}`);
  ok("보험료 합계 — 이 앱이 독자적으로 낸 값", (await p.textContent(".calc-total")).replace(/\s+/g, " ").includes("342,000 원"));
  ok("표 옆 보험료: G₁(6자리) · 10만원당 · P_β · 표준기초율·해약공제 신계약비까지", /G₁/.test(sums) && /P_?β/.test(sums) && /α/.test(sums) && sums.includes("준비금 산출용"), sums.slice(0, 160));
  await p.click(".calc-modal th.calc-col:has-text('유지자수 lx(1)') >> nth=0");
  await p.waitForTimeout(300);
  ok("열 제목을 누르면 그 열을 만든 식이 팝업으로", (await p.textContent(".calc-pop")).includes("l^{(1)}_{x+t+1} = l^{(1)}_{x+t}"), (await p.textContent(".calc-pop")).slice(0, 120));
  await p.click(".calc-modal tbody tr:nth-child(2) td:nth-child(10)");         // 2줄 · 유지자수 lx(1) (위험률 열: 사망·장해·암 → 현가율 둘 → Q⁽¹⁾ → l⁽¹⁾)
  await p.waitForTimeout(300);
  const cell = (await p.textContent(".calc-pop")).replace(/\s+/g, " ");
  ok("값을 누르면 그 해에 쓰인 값까지 — l⁽¹⁾(41) = l⁽¹⁾(40) × (1 − Q⁽¹⁾(40))", cell.includes("1년 뒤 (41세)") && cell.includes("100,000"), cell.slice(0, 120));
  await p.click(".calc-tabs button:nth-child(2)");
  await p.waitForTimeout(500);
  ok("담보 탭으로 담보마다 따로 본다 (암 진단 100세 만기 — 60년)", (await p.locator(".calc-modal .calc-grid tbody tr").count()) === 61);
  await p.screenshot({ path: `${OUT}/s1c_premium.png` });
  // 0-5b) Python 일괄 산출 — 셀마다 주석 단 코드 (실행은 Pyodide 를 받아야 하므로 여기서는 열어 보기만)
  await p.click(".calc-modal button:has-text('Python 일괄 산출')");
  await p.waitForSelector(".py-modal .py-cell");
  const pyTitles = await p.$$eval(".py-modal .py-title", (e) => e.map((x) => x.textContent));
  const pyCode = await p.textContent(".py-modal .py-cell:nth-child(3) .py-code").catch(() => "");
  ok("Python 일괄 산출: 계약·기초율 → 위험률 표 → 담보마다 조건/유지자/현가/보험료/준비금 → 합계 13셀, 식이 주석으로",
    pyTitles.length === 13 && pyTitles[0] === "계약·기초율" && pyTitles[12] === "합계" && pyTitles.some((t) => t.includes("책임준비금·해지환급금")) && pyCode.includes("# 담보 하나를 독립된"), pyTitles.join(" | ").slice(0, 120));
  ok("Python 창에 [▶ 전부 실행] · [.py 내려받기]", (await p.locator(".py-modal button:has-text('전부 실행')").count()) === 1 && (await p.locator(".py-modal button:has-text('.py 내려받기')").count()) === 1);
  await p.click(".py-modal button:has-text('닫기')");
  await p.waitForTimeout(300);
  await p.click(".calc-modal button:has-text('닫기')");
  await p.waitForTimeout(300);

  await p.click(".seg button:has-text('YAML')");           // 아래 1)~7)은 YAML 편집기로
  await p.waitForSelector(".cm-editor");

  // 1) 왼쪽 이율 줄 클릭 → 오른쪽 이율 행 강조
  const line = p.locator(".cm-line", { hasText: "interest: 2.5%" }).first();
  await line.click();
  await p.waitForTimeout(400);
  const hl = await p.$$eval(".doc-body .doc-hl", (els) => els.map((e) => e.textContent.slice(0, 40)));
  ok("조건 이율 줄 → 산출방법서 적용이율 행 강조", hl.some((t) => t.includes("적용이율")), hl.join(" / "));
  await p.screenshot({ path: `${OUT}/s2_left_to_right.png` });

  // 2) 오른쪽 β_G 행 클릭 → 왼쪽 β_G 줄 강조
  await p.locator(".doc-body tr", { hasText: "β" }).filter({ hasText: "4.50%" }).first().click();
  await p.waitForTimeout(400);
  const mirrored = await p.$$eval(".cm-mirror-hl", (els) => els.map((e) => e.textContent));
  ok("산출방법서 β_G 행 → 조건 β_G 줄 강조", mirrored.some((t) => t.includes("β_G")), mirrored.join(" / "));
  await p.screenshot({ path: `${OUT}/s3_right_to_left.png` });

  // 3) 담보 배수 줄 → 보험금 행 + 보험금 식
  await p.locator(".cm-line", { hasText: "multiple: 1 " }).first().click();
  await p.waitForTimeout(400);
  const hl3 = await p.$$eval(".doc-body .doc-hl", (els) => els.map((e) => e.textContent.slice(0, 30)));
  ok("담보 금액 줄 → 보험금 표의 행과 보험금 식", hl3.length >= 2, hl3.join(" / "));

  // 4) 조건을 고치면 산출방법서가 바로 바뀐다
  const iLine = p.locator(".cm-line", { hasText: "interest: 2.5%" }).first();
  const iText = (await iLine.textContent()).trimStart();           // 줄 맞춤은 남기고 값·주석만 다시 적는다(주석 자리가 달라져도 흔들리지 않게)
  await iLine.click();
  await p.keyboard.press("End");
  for (let i = 0; i < iText.length; i++) await p.keyboard.press("Backspace");
  await p.keyboard.type("interest: 3%");
  await p.waitForTimeout(600);
  const rate = await p.locator(".doc-body tr", { hasText: "적용이율" }).first().textContent();
  ok("조건 이율 3% → 산출방법서 3.000%", rate.includes("3.000%"), rate);

  // 5) PDF 열기 → 조건 + 원문 탭
  await p.setInputFiles("input[aria-label='열 파일']", pdf);
  await p.waitForSelector(".orig-list", { timeout: 60000 });
  await p.waitForTimeout(800);
  const yamlText = await p.$$eval(".cm-content .cm-line", (els) => els.map((e) => e.textContent).join("\n"));
  ok(`PDF → 조건: 이율 ${PDF_RATE} 와 출처 주석${company ? "" : " (샘플 02 — 회사 PDF 폴더가 없어 대신)"}`, new RegExp(`interest: ${PDF_RATE.replace(".", "\\.")} # (본문|표)`).test(yamlText), yamlText.split("\n").find((l) => l.includes("interest")));
  ok("PDF → 원문 탭에 근거 딱지", (await p.locator(".orig-linked").count()) >= 5);
  await p.locator(".cm-line", { hasText: `interest: ${PDF_RATE}` }).first().click();
  await p.waitForTimeout(500);
  const origHl = await p.$$eval(".doc-hl", (els) => els.map((e) => e.textContent.slice(0, 50)));
  ok("조건 이율 줄 → 원문 근거 줄 강조", origHl.some((t) => t.includes(PDF_RATE.replace("%", ""))), origHl.join(" / "));
  await p.screenshot({ path: `${OUT}/s4_pdf_original.png` });

  // 6) 원문의 표를 누르면 조건 줄로
  await p.locator(".orig-linked", { hasText: PDF_EXP }).first().click();
  await p.waitForTimeout(400);
  const m2 = await p.$$eval(".cm-mirror-hl", (els) => els.map((e) => e.textContent));
  ok("원문 사업비 표 → 조건 사업비 줄 강조", m2.some((t) => /expenses|α|β|γ|group/.test(t)), m2.slice(0, 3).join(" / "));

  // 5-2) 고른 곳이 창 가운데로 — 조건 → 산출방법서, 산출방법서 → 조건
  await p.click("button.tab:has-text('산출방법서')");
  await p.click("button[title^='카드의 칸을 채우면']");
  await p.waitForTimeout(600);
  await p.click(".card[data-card=M04] .card-head");
  await p.waitForTimeout(900);
  const midOff = async (sel, paneSel) => p.evaluate(([s2, ps]) => {
    const el = document.querySelector(s2), pane = ps === "doc" ? document.querySelector("#print-area").closest(".overflow-auto") : document.querySelector(ps);
    if (!el || !pane) return 9999;
    const a = el.getBoundingClientRect(), b = pane.getBoundingClientRect();
    return Math.round(Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)));
  }, [sel, paneSel]);
  const off1 = await midOff(".doc-hl", "doc");
  ok("조건을 고르면 산출방법서의 그 자리가 창 가운데로 온다", off1 <= 60, `가운데에서 ${off1}px`);
  await p.evaluate(() => { const r = [...document.querySelectorAll("#print-area tr[data-path]")]; r[r.length - 1]?.click(); });
  await p.waitForTimeout(1200);
  const off2 = await midOff(".form-hl", ".form-body");
  ok("산출방법서를 고르면 조건의 그 자리가 창 가운데로 온다", off2 <= 60, `가운데에서 ${off2}px`);
  await p.click("button[title^='같은 조건을 MethodSpec']");
  await p.waitForTimeout(400);

  // 6-1) 표준 양식 PDF 열기 — Word 와 같은 조건이 되고 보험료까지 나온다
  const sdir10 = path.join(__dirname, "../samples");
  const stdPdf = path.join(sdir10, fs.readdirSync(sdir10).find((f) => f.normalize("NFC").startsWith("10_기본상품") && /\.pdf$/i.test(f)));
  await p.setInputFiles(OPEN, stdPdf);
  await p.waitForSelector(".toast:has-text('표준 산출방법서 v')", { timeout: 60000 });
  await p.waitForTimeout(1200);
  const t10 = (await p.textContent(".toast")).replace(/\s+/g, " ");
  ok("표준 양식 PDF 열기 → 표준 산출방법서로 읽고 별첨 위험률 표까지 가져온다", /표준 산출방법서 v\d/.test(t10) && /위험률 값 표 6열/.test(t10), t10.slice(0, 140));
  await p.click("button[title^='카드의 칸을 채우면']");
  await p.waitForTimeout(1200);
  const trial10 = (await p.textContent(".trial-bar")).replace(/\s+/g, " ");
  ok("PDF 로 가져온 조건에서도 시산 보험료가 같다 — 월 342,000원", trial10.includes("342,000"), trial10.slice(0, 90));
  const sheet10 = await p.locator("table.sheet tbody tr").count();
  ok("PDF 의 별첨 위험률 표 = 연령 0~110세 111줄", sheet10 === 111, `${sheet10}줄`);
  await p.click("button[title^='같은 조건을 MethodSpec']");            // 다음 확인을 위해 [YAML] 탭으로 되돌린다
  await p.waitForTimeout(500);

  // 7) 샘플 → LaTeX 탭에서 이율·금액을 고쳐 조건에 반영
  await p.click("summary:has-text('샘플')");
  await p.click("button:has-text('LaTeX 산출방법서 고쳐 보기')");
  await p.waitForSelector(".cm-editor >> nth=1");
  await p.waitForTimeout(500);
  const texEditor = p.locator(".cm-editor").nth(1);
  // 편집기의 찾아 바꾸기(Ctrl+F)로 고친다 — 화면 밖 줄도 바뀐다
  const replaceAll = async (from, to) => {
    await texEditor.locator(".cm-content").click();
    await p.keyboard.press("Control+f");
    await p.waitForSelector(".cm-search input[name=search]");
    await p.fill(".cm-search input[name=search]", from);
    await p.fill(".cm-search input[name=replace]", to);
    await p.click(".cm-search button[name=replaceAll]");
    await p.keyboard.press("Escape");
  };
  await replaceAll("적용이율 i & 2.500", "적용이율 i & 3.500");
  await replaceAll("사망 & 1 &", "사망 & 0.7 &");                         // v8 — 마. 보장 표의 배수 칸
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/s5a_latex_edited.png` });
  log.push("apply enabled: " + await p.locator("button.btn-primary:has-text('조건에 반영')").isEnabled());
  await p.click("button.btn-primary:has-text('조건에 반영')");
  await p.waitForTimeout(700);
  const toast = await p.locator(".toast").textContent().catch(() => "");
  const y2 = await p.$$eval(".cm-editor", (eds) => [...eds[0].querySelectorAll(".cm-line")].map((e) => e.textContent).join("\n"));
  ok("LaTeX 수정 → 조건 반영: 이율 3.5%", /interest: 3\.5%/.test(y2), toast);
  ok("LaTeX 수정 → 조건 반영: 배수 0.7배", /multiple: 0\.7/.test(y2));
  ok("조건 파일 주석 유지", y2.includes("# 납입면제 — 80% 이상 장해"));
  await p.click("button.tab:has-text('산출방법서')");
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/s5_latex_applied.png` });

  // ── 입력 화면 · 위험률 표 · 수식 견본 · 화면 조절 ──────────────────────────
  await p.click("summary:has-text('샘플')");
  await p.click("details[open] .menu-list button:has-text('종신보험 (사망')");
  await p.click(".seg button:has-text('입력')");
  await p.waitForSelector(".form-body .card");

  // 8) 입력 칸 → 산출방법서 바로, YAML 은 그 칸만(주석·줄 맞춤 유지)
  await p.click(".card[data-card=M03] .card-head");
  await p.locator("[data-path='basis.interest'] input").fill("3.5%");
  await p.waitForTimeout(600);
  const r1 = await p.locator(".doc-body tr", { hasText: "적용이율" }).first().textContent();
  ok("입력 칸 이율 3.5% → 산출방법서 3.500%", r1.includes("3.500%"), r1);
  const hlF = await p.$$eval(".doc-body .doc-hl", (els) => els.map((e) => e.textContent.slice(0, 30)));
  ok("입력 칸(이율)을 고르면 산출방법서 적용이율 행 강조", hlF.some((t) => t.includes("적용이율")), hlF.join(" / "));
  await p.screenshot({ path: `${OUT}/s6_form.png` });
  await p.click(".seg button:has-text('YAML')");
  await p.waitForSelector(".cm-editor");
  const yl = await p.locator(".cm-line", { hasText: "interest: 3.5%" }).first().textContent();
  ok("입력 칸 → YAML 은 그 값만 바뀜(주석·줄 맞춤 유지)", yl === "  interest: 3.5%      # 적용(예정)이율", JSON.stringify(yl));
  await p.click(".seg button:has-text('입력')");
  await p.waitForSelector(".form-body .card");

  // 9) 산출방법서 → 입력 칸
  await p.locator(".doc-body tr", { hasText: "β" }).filter({ hasText: "4.50%" }).first().click();
  await p.waitForTimeout(600);
  const formHl = await p.$$eval(".form-hl", (els) => els.map((e) => e.getAttribute("data-path")));
  ok("산출방법서 β_G 행 → 입력 화면 사업비 행 강조(M06 펼침)", formHl.includes("expenses[3]"), formHl.join(" / "));
  await p.screenshot({ path: `${OUT}/s7_form_mirror.png` });

  // 10) 보장 카드(B01) — 한 카드에서 담보를 더하고 복사한다
  await p.click(".card[data-card=B01] .card-head");
  await p.waitForTimeout(400);
  ok("카드는 한 번에 하나만 펼쳐진다 (아코디언)", (await p.locator(".card.card-open").count()) === 1 && (await p.locator(".card.card-open").getAttribute("data-card")) === "B01");
  const b01Hl = await p.$$eval(".doc-body .doc-hl", (els) => els.map((e) => e.textContent.slice(0, 24)));
  ok("카드를 열면 산출방법서의 그 항목이 강조된다", b01Hl.length >= 2, b01Hl.join(" / "));
  await p.click(".card[data-card=B01] button:has-text('＋ 진단형')");
  await p.waitForTimeout(700);
  ok("＋ 진단형 → 보험금 카드에 하나 늘고 산출방법서 보험금 표·보장 표의 행도 늘어난다",
    (await p.locator(".card[data-card=B01] .sub").count()) >= 2 && (await p.locator(".doc-body tr", { hasText: "담보 2" }).count()) >= 1
    && (await p.locator(".doc-body p", { hasText: "(2) 담보 2" }).count()) === 1);
  await p.click(".card[data-card=B01] .sub-open button[title^='이 담보를 복사']");
  await p.waitForTimeout(700);
  ok("담보 복사 → '담보 2 (복사)' 가 조건·산출방법서에 함께",
    (await p.locator(".card[data-card=B01] .sub").count()) >= 3 && (await p.locator(".doc-body tr", { hasText: "담보 2 (복사)" }).count()) >= 1);
  await p.locator(".card[data-card=B01] .sub-open .sub-x").click();          // 복사한 것을 지운다(확인창은 자동 수락)
  await p.waitForTimeout(700);
  ok("담보 삭제 → 조건·산출방법서에서 함께 빠진다", (await p.locator(".doc-body tr", { hasText: "담보 2 (복사)" }).count()) === 0);
  // 10-0) 특약 — [＋ 특약] 은 그 이름의 담보를 만들고 탭이 된다(이름은 확인창 기본값). 보장 카드가 그 단위의 담보만 보인다
  await p.evaluate(() => { window.prompt = () => "특약1"; });                   // 이름 확인창은 "특약1"
  await p.click(".unit-tabs button:has-text('＋ 특약')");
  await p.waitForTimeout(900);
  const unitTabs = await p.$$eval(".unit-tabs .unit-tab", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ")));
  ok("＋ 특약 → 탭 둘(주계약·특약1) · 특약 탭에는 담보 하나 · 산출방법서 담보 표에 '단위 | 특약1'",
    unitTabs.length === 2 && unitTabs[1].includes("특약1") && (await p.locator(".card[data-card=B01] .sub").count()) === 1
    && (await p.locator(".doc-body tr", { hasText: "특약1" }).count()) >= 1, unitTabs.join(" | "));
  await p.click(".unit-tabs .unit-tab.on .sub-x");                               // 특약 삭제 (확인창은 자동 수락)
  await p.waitForTimeout(700);
  ok("특약 삭제 → 주계약 탭만 남고 담보도 원래대로", (await p.locator(".unit-tabs .unit-tab").count()) === 1 && (await p.locator(".card[data-card=B01] .sub").count()) === 2);

  // 10-1) M01 가입 조건(정보) → 산출방법서 개요 표 · 계약(시산 기준)은 이 앱에 없다
  if (!(await p.locator("[data-path='product.terms[1].age'] input").count())) await p.click(".card[data-card=M01] .card-head");   // M01 은 처음부터 펼쳐져 있다
  await p.locator("[data-path='product.terms[1].age'] input").fill("만15세 ~ 55세");
  await p.click("[data-path='product.payFreqs'] label:has-text('일시납') input");
  await p.waitForTimeout(600);
  const termRow = await p.locator(".doc-body tr", { hasText: "30년납" }).first().textContent();
  const freqRow = await p.locator(".doc-body tr", { hasText: "보험료 납입주기" }).first().textContent();
  ok("M01 가입 조건 칸 → 산출방법서 개요 가입 조건 표", termRow.includes("만15세 ~ 55세") && freqRow.includes("일시납"), `${termRow} / ${freqRow}`);
  ok("입력 카드에 M02(계약) 없음 — 계약정보는 자유설계보험 상품 만들기에서", (await p.locator(".card[data-card=M02]").count()) === 0);
  ok("산출방법서에 시산 기준(피보험자) 표 없음 — 전체 정보만", (await p.locator(".doc-body tr", { hasText: /^피보험자/ }).count()) === 0 && !(await p.textContent(".doc-body")).includes("시산 기준"));
  await p.screenshot({ path: `${OUT}/s7b_product.png` });

  // 11) 위험률 표: CSV → 첫 행 열 이름 → 자동 잇기 → 산출방법서 위험률 표
  const csv = "연령,사망률(남),사망률(여),80% 이상 장해율,암발생률(남)\n40,0.00103,0.00052,0.0012,0.0021\n41,0.00112,0.00056,0.0013,0.0023\n42,0.00121,0.00061,0.0014,0.0025\n";
  await p.setInputFiles("input[accept='.csv,.tsv,.txt,.xlsx,.xls']", { name: "위험률.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await p.waitForSelector("table.sheet");
  await p.waitForTimeout(600);
  const mapped = await p.$$eval("table.sheet select.sheet-sel", (els) => els.map((e) => e.value));
  ok("CSV 첫 행 → 연령·사망률(남·여)·장해율은 이름으로 잇고, 조건에 없는 '암발생률' 은 새 위험률로 조건에 더해 잇는다",
    /^age,rate:q,M,rate:q,F,rate:r80,,rate:r\w*,M$/.test(mapped.join(",")), mapped.join(","));
  const rateRow = await p.locator(".doc-body tr", { hasText: "사망률" }).first().textContent();
  ok("이은 열 → 산출방법서 위험률 표 '40~42세 3행'", rateRow.includes("40~42세 3행"), rateRow);
  const cancer = await p.locator(".doc-body tr", { hasText: "암발생률" }).first().textContent().catch(() => "");
  ok("새 위험률 '암발생률' 이 조건·산출방법서에 표와 함께", cancer.includes("40~42세 3행") && (await p.locator("[data-card='M04'] .card-head").textContent()).includes("암발생률"), cancer);
  ok("산출방법서 맨 뒤 '별첨 — 위험률 표' (연령 × 열)", (await p.locator(".doc-body h2", { hasText: "별첨 — 위험률 표" }).count()) === 1 && (await p.locator(".doc-body section:last-of-type tbody tr").count()) === 3);
  // 11-1) M04 — 산출방법서 예정위험률 표와 같은 칸 · 출처 콤보 · 스프레드시트에서 불러오기 · 위험률 가공 · 지우면 연결이 풀린다
  await p.locator("[data-card='M04'] .card-head").click();
  await p.waitForTimeout(400);
  const m4head = (await p.textContent("[data-card='M04'] .rate-head")).replace(/\s+/g, " ");
  ok("M04 = 산출방법서 예정위험률 표의 칸(위험률 · 기호 · 유형 · 근거·출처 · 표), 보정 칸 없음 · 출처 콤보가 지금 이은 표의 열",
    ["위험률", "기호", "유형", "근거·출처", "표"].every((t) => m4head.includes(t)) && (await p.locator("[data-card='M04'] [data-path$='.adjustment']").count()) === 0
    && (await p.inputValue("[data-card='M04'] [data-path='rates[0].source'] select")) === "col:사망률", m4head);
  await p.click("[data-card='M04'] button:has-text('스프레드시트에서 불러오기')");
  await p.setInputFiles(".imp-modal input[type=file]", { name: "뇌졸중.csv", mimeType: "text/csv", buffer: Buffer.from("연령,뇌졸중(남),뇌졸중(여)\n40,0.0011,0.0009\n41,0.0012,0.0010\n42,0.0013,0.0011") });
  await p.waitForSelector(".imp-modal .imp-cols");
  ok("불러오기 창: 첫 행은 제목으로 알아보고 · 연령 열 · 남·여 열을 한 위험률(뇌졸중)로", await p.isChecked(".imp-modal .imp-bar input[type=checkbox]")
    && (await p.locator(".imp-modal .imp-cols tbody tr").count()) === 2 && (await p.inputValue(".imp-modal .imp-cols tbody tr >> nth=0 >> input.inp")) === "뇌졸중");
  await p.click(".imp-modal button:has-text('위험률 표에 넣기')");
  await p.waitForTimeout(800);
  const stroke = await p.locator(".doc-body tr", { hasText: "뇌졸중" }).first().textContent().catch(() => "");
  ok("→ 조건 M04 와 산출방법서 예정위험률에 '뇌졸중' (경험생명표(가상) · 40~42세 3행 · 남·여)", stroke.includes("경험생명표(가상) 뇌졸중") && stroke.includes("40~42세 3행"), stroke);
  await p.click("[data-card='M04'] button:has-text('위험률 가공')");
  await p.fill("#proc-expr", "");
  await p.click(".imp-modal .proc-ids .chip:has-text('뇌졸중')");
  await p.fill("#proc-expr", `${await p.inputValue("#proc-expr")} × 0.5`);   // 기호 단추가 넣은 뒤에 이어 적는다
  await p.fill(".imp-modal input[placeholder]:not(#proc-expr)", "뇌졸중 절반");
  await p.screenshot({ path: `${OUT}/s7c_process.png` });
  ok("가공 창: 식 → 남·여 표 미리보기", (await p.textContent(".imp-modal")).includes("남 40~42세") && (await p.locator(".imp-modal table.calc-table tbody tr").count()) >= 1);
  await p.click(".imp-modal button:has-text('새 위험률로 만들기')");
  await p.waitForTimeout(800);
  const half = await p.locator(".doc-body tr", { hasText: "뇌졸중 절반" }).first().textContent().catch(() => "");
  ok("위험률 가공 → 새 위험률 '뇌졸중 절반'(근거에 식) · 표에 남·여 열", half.includes("뇌졸중 × 0.5") && half.includes("남·여"), half);
  const heads = await p.$$eval("table.sheet th.sheet-name", (els) => els.map((e) => e.textContent.replace(/^[A-Z]\s*/, "").trim()));
  await p.locator("[data-path^='rates['] .sub-x").last().click();
  await p.waitForTimeout(600);
  const sels2 = await p.$$eval("table.sheet select.sheet-sel", (els) => els.map((e) => e.value));
  ok("위험률을 지우면 그 열은 '쓰지 않음' (값은 남음)", sels2.at(-1) === "skip" && (await p.$$eval("table.sheet th.sheet-name", (els) => els.length)) === heads.length, sels2.join(","));
  // 11-2) 표 창에서 바로 고치기 — 칸 값(→ 별첨 표) · 열 이름 · 이은 위험률의 유형(→ 조건 M04 · 산출방법서)
  await p.locator("table.sheet tbody tr").nth(2).locator("td.sheet-cell").nth(3).click();        // 42세 · D열(80% 이상 장해율) 0.0014
  await p.fill(".sheet-inp", "0.00999"); await p.keyboard.press("Enter");
  await p.waitForTimeout(700);
  ok("칸을 눌러 값 고침 → 산출방법서 별첨 표에 반영", (await p.locator(".doc-body section:last-of-type tbody tr").nth(2).textContent()).includes("0.00999"));
  await p.locator("table.sheet th.sheet-name").nth(4).dblclick();
  await p.fill(".sheet-inp", "암 발생률(남)"); await p.keyboard.press("Enter");
  await p.waitForTimeout(400);
  ok("머리를 두 번 눌러 열 이름 고침", (await p.locator("table.sheet th.sheet-name").nth(4).textContent()).includes("암 발생률(남)"));
  const roleSel = p.locator("table.sheet select.sheet-role").nth(3);                               // E열(암발생률)에 이은 위험률
  await roleSel.selectOption("recurring");
  await p.waitForTimeout(700);
  ok("열의 [유형] 고침 → 조건 M04 의 유형 칸과 산출방법서 위험률 표", (await p.locator(".doc-body tr", { hasText: "암발생률" }).first().textContent()).includes("반복지급")
    && (await p.locator("[data-path='rates[2].role'] select").inputValue()) === "recurring");
  await roleSel.selectOption("incidence");
  await p.waitForTimeout(400);
  await p.locator("th.sheet-name", { hasText: "사망률(남)" }).click();
  await p.waitForTimeout(500);
  const hlSheet = await p.$$eval(".doc-body .doc-hl", (els) => els.map((e) => e.textContent.slice(0, 20)));
  ok("표 열 머리 → 산출방법서 위험률 행 강조", hlSheet.some((t) => t.includes("사망률")), hlSheet.join(" / "));
  await p.screenshot({ path: `${OUT}/s8_sheet.png` });

  // 11-3) 기본 위험률 모음 — 공개 기본 위험률(+ 이 PC 의 사내 위험률 모음)에서 골라 표에 넣고 조건에 잇는다
  await p.click("button.btn-primary:has-text('기본 위험률 모음')");
  await p.waitForSelector(".lib-modal");
  const libItems = await p.locator(".lib-item").count();
  const privNote = (await p.textContent(".lib-modal")).includes("외부 반출 금지");
  ok("[기본 위험률 모음] 창 — 공개 기본 위험률 7계열(사망·80% 장해·암·뇌출혈·급성심근경색증·암입원·암수술)" + (privNote ? " + 사내 위험률 모음(외부 반출 금지 안내)" : ""), libItems >= 7, `${libItems}개`);
  await p.fill(".lib-bar input", "뇌출혈");
  await p.locator(".lib-item", { hasText: "뇌출혈 발생률" }).first().locator("input[type=checkbox]").check();
  await p.click("button:has-text('표에 넣기 (1)')");
  await p.waitForTimeout(700);
  const heads3 = await p.$$eval("table.sheet th.sheet-name", (els) => els.map((e) => e.textContent.replace(/^[A-Z]{1,2}\s*/, "").trim()));
  ok("고른 위험률 → 표에 남·여 열 + 조건 M04 에 새 위험률 + 산출방법서 위험률 표", heads3.includes("뇌출혈 발생률(남)") && heads3.includes("뇌출혈 발생률(여)")
    && (await p.locator(".doc-body tr", { hasText: "뇌출혈 발생률" }).count()) >= 1, heads3.join(","));
  ok("모음에서 더한 위험률의 근거는 가상 이름 — 경험생명표(가상) 뇌출혈 발생률", (await p.locator(".doc-body tr", { hasText: "경험생명표(가상) 뇌출혈 발생률" }).count()) >= 1);

  // 12) MethodSpec JSON — 자유설계보험 입력: 계약 성별(남)의 위험률 표가 실린다
  await p.click("summary:has-text('내보내기')");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("button:has-text('MethodSpec .json')")]);
  const spec = JSON.parse(fs.readFileSync(await dl.path(), "utf8").replace(/^﻿/, ""));
  const t0 = spec.rates[0].table;
  ok("MethodSpec JSON 에 위험률 표(RateRef.table)", t0 && t0.ages.length === 3 && t0.sex === "M" && t0.values[0] === 0.00103, JSON.stringify(t0));

  // 12-1) 패키지(.lifepkg) — 조건 · 산출방법서 · 위험률 표를 한 파일로 저장 → 다른 샘플로 바꾼 뒤 열면 그대로 · 최근 작업에 남는다
  const before12 = { heads: await p.$$eval("table.sheet th.sheet-name", (els) => els.map((e) => e.textContent)), sels: await p.$$eval("table.sheet select.sheet-sel", (els) => els.map((e) => e.value)), h1: await p.textContent(".doc-body h1") };
  await p.click("summary:has-text('패키지')");
  const [dp] = await Promise.all([p.waitForEvent("download"), p.click("details[open] .menu-list button:has-text('패키지로 저장')")]);
  const pkg = fs.readFileSync(await dp.path());
  ok("[패키지로 저장] → 종신보험_패키지.lifepkg (ZIP: package.json · 조건.yaml · 위험률표.csv · MethodSpec.json · 산출방법서.md · .docx)",
    dp.suggestedFilename() === "종신보험_패키지.lifepkg" && pkg.slice(0, 2).toString("latin1") === "PK" && ["package.json", "위험률표.csv", "산출방법서.docx"].every((n) => pkg.includes(Buffer.from(n))), dp.suggestedFilename());
  await p.click("summary:has-text('샘플')"); await p.click("details[open] .menu-list button:has-text('2대질병')");
  await p.waitForTimeout(500);
  const heads2 = await p.$$eval("table.sheet th.sheet-name", (els) => els.map((e) => e.textContent));
  ok("다른 샘플 세트로 바뀜(2대질병 + 그 위험률 표 — 뇌출혈·급성심근경색증 열)", (await p.textContent(".doc-body h1")).includes("2대질병") && heads2.some((h) => h.includes("뇌출혈")) && heads2.some((h) => h.includes("급성심근경색증")), heads2.join(","));
  const twoDoc = await p.textContent(".doc-body");
  ok("2대질병: 보험금 둘(뇌출혈 진단 · 급성심근경색증 진단) · [납입] 유지자는 위험률 합성(질병끼리 곱 R · 사망과 결합 Q)", twoDoc.includes("뇌출혈 진단") && twoDoc.includes("급성심근경색증 진단")
    && twoDoc.includes("사망, 뇌출혈, 급성심근경색증 아닌 유지자") && twoDoc.includes("위험률 합성") && /Q.*min/.test(twoDoc));
  const srcCells = await p.$$eval(".doc-body table", (ts) => ts.filter((t) => [...t.querySelectorAll("th")].some((h) => h.textContent.includes("근거"))).flatMap((t) => [...t.querySelectorAll("tbody tr")].map((r) => r.children[3]?.textContent ?? "")));
  ok("산출방법서의 위험률 근거는 모두 경험생명표(가상)", srcCells.length >= 3 && srcCells.every((c) => c.startsWith("경험생명표(가상)")), srcCells.join(" / "));
  await p.click("summary:has-text('샘플')");
  const sampleNames = await p.$$eval("details[open] .menu-list button", (bs) => bs.map((b) => b.textContent));
  ok("?all — 샘플 여덟 모두 (종신 둘 · 암진단 · 2대질병 · 입원특약 · 수술특약 · 보험료납입지원특약 · 암보험)", ["종신보험 (", "종신보험(암진단", "암진단 보장보험", "2대질병", "입원보험(특약)", "수술보험(특약)", "보험료납입지원특약", "암보험 ("].every((n) => sampleNames.some((b) => b.includes(n))), sampleNames.length + "개");
  await p.click("details[open] .menu-list button:has-text('입원보험(특약)')");
  await p.waitForTimeout(600);
  const tabSel = await p.locator(".unit-tabs button[aria-selected=true]").textContent().catch(() => "");
  ok("특약만 있는 샘플은 그 특약 탭으로 열린다(빈 주계약 탭이 아니라)", tabSel.startsWith("암입원특약"), tabSel);
  await p.click("summary:has-text('샘플')"); await p.click("details[open] .menu-list button:has-text('2대질병')");
  await p.waitForTimeout(500);
  await p.setInputFiles(OPEN, { name: "종신보험_패키지.lifepkg", mimeType: "application/zip", buffer: pkg });
  await p.waitForSelector(".toast:has-text('종신보험_패키지.lifepkg —')");
  await p.waitForTimeout(500);
  const after12 = { heads: await p.$$eval("table.sheet th.sheet-name", (els) => els.map((e) => e.textContent)), sels: await p.$$eval("table.sheet select.sheet-sel", (els) => els.map((e) => e.value)), h1: await p.textContent(".doc-body h1") };
  ok("패키지 [열기] → 조건·산출방법서·위험률 표(열 연결까지)가 저장 때 그대로", JSON.stringify(after12) === JSON.stringify(before12), JSON.stringify(after12).slice(0, 200));
  await p.click("summary:has-text('패키지')");
  ok("[패키지] 메뉴의 최근 작업에 남는다", (await p.locator("details[open] .menu-list button", { hasText: "종신보험_패키지.lifepkg" }).count()) >= 1);
  await p.keyboard.press("Escape");                              // 열린 메뉴가 산출방법서 제목을 가리므로 Esc 로 닫는다
  ok("Esc 로 메뉴가 닫힌다", (await p.locator("details[open] .menu-list").count()) === 0);

  // 13) 수식 견본 → 조건 식(M09) → 산출방법서
  const before = await p.locator(".doc-body .formula").count();
  await p.click("button:has-text('＋ 수식 더하기')");
  await p.locator(".palette .pal-tile", { hasText: "순보험료" }).click();
  await p.waitForTimeout(700);
  ok("견본 '순보험료' → 조건 식 추가 → 산출방법서 수식 +1", (await p.locator(".doc-body .formula").count()) === before + 1);
  ok("M09 이 펼쳐지고 식 칸에 들어감", (await p.locator("[data-path='formulas[0].text'] textarea").inputValue()).includes("P = "));
  await p.screenshot({ path: `${OUT}/s9_palette.png` });
  // 13-0) 바뀐 곳 표시 — 더한 식의 칸·카드 딱지·산출방법서 블록·상태줄
  ok("바뀐 곳 표시: M09 카드 딱지 · 식 칸 · 산출방법서 식 블록 · 상태줄 개수",
    (await p.locator("[data-card='M09'] .chip-changed").count()) === 1 && (await p.locator(".form-changed[data-path^='formulas[0]']").count()) >= 1
    && (await p.locator(".doc-body .formula.doc-changed").count()) >= 1 && /바뀐 곳 \d+/.test(await p.textContent(".changed-note")));
  // 13-1) 되돌리기 · 다시 — 더한 식이 빠졌다가 돌아온다 (Ctrl+Z 는 칸 밖에서)
  await p.locator(".pane-tool", { hasText: "되돌리기" }).click();
  await p.waitForTimeout(500);
  ok("[↶ 되돌리기] → 더한 식이 빠진다", (await p.locator(".doc-body .formula").count()) === before && (await p.locator("[data-path='formulas[0].text']").count()) === 0);
  await p.locator(".doc-body h1").click();
  await p.keyboard.press("Control+Shift+Z");
  await p.waitForTimeout(500);
  ok("Ctrl+Shift+Z → 다시 실행", (await p.locator(".doc-body .formula").count()) === before + 1);
  // 13-2) 메뉴는 바깥을 누르면 닫힌다
  await p.click("details:has(summary:has-text('내보내기')) summary");
  ok("[내보내기] 메뉴 열림", (await p.locator("details[open] .menu-list").count()) === 1);
  await p.locator("footer").click({ position: { x: 5, y: 5 } });            // 메뉴가 덮지 않는 바깥(맨 아래 상태줄)
  ok("바깥을 누르면 메뉴가 닫힌다", (await p.locator("details[open] .menu-list").count()) === 0);

  // 14) LaTeX 탭 견본 → 커서 자리에 기호
  await p.click("button.tab:has-text('LaTeX')");
  await p.waitForSelector(".cm-editor");
  await p.locator(".cm-editor .cm-line").nth(3).click();
  // 왼쪽 [＋ 수식 더하기] 견본(식만)은 따로다 — 기호 줄이 있는 편집 탭 견본을 연다
  const latexPane = p.locator("section:has(.cm-editor)").last();
  if (!(await latexPane.locator(".palette .pal-sym").count())) await latexPane.locator("button:has-text('수식·기호 견본')").click();
  await latexPane.locator(".palette .pal-sym", { hasText: "α" }).first().click();
  await p.waitForTimeout(300);
  ok("LaTeX 견본 α → 편집기에 \\alpha, 탭에 ●", (await p.locator(".cm-line", { hasText: "\\alpha" }).count()) >= 1 && (await p.locator("button.tab", { hasText: "LaTeX" }).textContent()).includes("●"));
  await p.click("button.tab:has-text('산출방법서')");

  // 15) 화면 조절 — 전체 · 복원 · 숨기기 · 보기 · 막대
  await p.locator("section:has(.form-body) .pane-tool", { hasText: "전체" }).click();
  ok("조건 [⤢ 전체] → 다른 창 숨김", (await p.locator(".doc-body").count()) === 0 && (await p.locator("table.sheet").count()) === 0);
  await p.locator(".pane-tool", { hasText: "복원" }).click();
  ok("[⤡ 복원] → 세 창", (await p.locator(".doc-body").count()) === 1 && (await p.locator("table.sheet").count()) === 1);
  await p.locator("section:has(table.sheet) .pane-tool", { hasText: "숨기기" }).click();
  ok("위험률 표 [– 숨기기]", (await p.locator("table.sheet").count()) === 0);
  await p.click(".seg button:has-text('위험률 표')");
  ok("[보기 → 위험률 표]로 다시 켜기", (await p.locator("table.sheet").count()) === 1);
  const cond = p.locator("section:has(.form-body)");
  const w0 = (await cond.boundingBox()).width, bar = await p.locator(".split-x").boundingBox();
  await p.mouse.move(bar.x + 2, bar.y + 100); await p.mouse.down();
  await p.mouse.move(bar.x + 202, bar.y + 100, { steps: 6 }); await p.mouse.up();
  const w1 = (await cond.boundingBox()).width;
  ok("막대를 끌어 조건 창 넓히기", w1 > w0 + 150, `${Math.round(w0)} → ${Math.round(w1)}`);
  await p.screenshot({ path: `${OUT}/s10_layout.png` });

  // 16) 자유설계보험 등이 낸 MethodSpec JSON — 위험률 표는 위험률 표 창으로 (조건 파일에는 표가 없다)
  const fiSpec = { specVersion: "1.0", meta: { productName: "JSON 표 시험" }, contract: { age: 40, sex: "M", termYears: 3, payYears: 3, freq: 12 },
    basis: { interest: 0.025, standardInterest: 0.0325 }, expenses: [], units: [], reserve: { notes: [] }, surrender: { notes: [] }, formulas: [], sections: [],
    rates: [{ id: "t1:r1", name: "사망률", role: "death", table: { ages: [40, 41, 42], values: [0.001, 0.0011, 0.0012], sex: "M" } }],
    benefits: [{ id: "t1:c1", name: "사망", role: "death", amount: 1e8, endAge: 42, exitRateIds: ["t1:r1"] }] };
  await p.setInputFiles("input[aria-label='열 파일']", { name: "fi.methodspec.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fiSpec)) });
  await p.waitForSelector(".doc-body h1:has-text('JSON 표 시험')");
  await p.waitForTimeout(400);
  const fiRow = await p.locator(".doc-body tr", { hasText: "사망률" }).first().textContent();
  ok("MethodSpec JSON 의 위험률 표 → 위험률 표 창 · 산출방법서 '40~42세 3행'",
    (await p.locator("th.sheet-name", { hasText: "사망률(남)" }).count()) === 1 && fiRow.includes("40~42세 3행"), fiRow);

  // 17) 표준 산출방법서 — Word 로 받아 고친 뒤 올리면 바뀐 값·식만 조건에 (조건을 통째로 바꾸지 않는다)
  await p.click("details:has(summary:has-text('샘플')) summary");
  await p.click("details:has(summary:has-text('샘플')) .menu-list button:has-text('종신보험 (')");
  await p.waitForSelector(".doc-body h1:has-text('종신보험')");
  await p.click(".tab:has-text('Word')");
  const [dlw] = await Promise.all([p.waitForEvent("download"), p.click("button:has-text('Word 내려받기')")]);
  const docx = fs.readFileSync(await dlw.path());
  ok("[Word] Word 내려받기 → 표준 산출방법서 .docx", dlw.suggestedFilename().endsWith(".docx") && /표준 산출방법서 v\d/.test(docx.toString("utf8")), dlw.suggestedFilename());
  // Word 에서 고쳤다고 친다 — 압축 없는 ZIP 이라 같은 길이의 글자는 바로 바꿀 수 있다: 적용이율 2.5→3, 기준연납순보험료 식(Word 수식)의 20→25
  const swap = (buf, from, to) => { const i = buf.indexOf(Buffer.from(from)); if (i < 0) throw new Error(`없음: ${from}`); const b = Buffer.from(buf); Buffer.from(to).copy(b, i); return b; };
  let edited = swap(docx, ">2.500%<", ">3.000%<");
  edited = swap(edited, 'preserve">20</m:t>', 'preserve">25</m:t>');   // 식은 Word 수식 — 기준연납순보험료의 min(n,20) 안의 20
  await p.setInputFiles(MERGE, { name: "종신_고침.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: edited });
  await p.waitForSelector(".word-log");
  const wlog = await p.textContent(".word-log");
  ok("고친 Word 올리기 → 이율과 고친 식만 조건에 반영", /basis\.interest/.test(wlog) && /formulas/.test(wlog) && !/expenses|benefits|rates/.test(wlog), wlog.slice(0, 200));
  await p.click(".tab:has-text('산출방법서')");
  const row17 = await p.locator(".doc-body tr", { hasText: "적용이율" }).first().textContent();
  await p.click(".tab:has-text('Word')"); await p.screenshot({ path: `${OUT}/s11_word.png` }); await p.click(".tab:has-text('산출방법서')");
  ok("반영 뒤 산출방법서 적용이율 3.000% · 고친 식이 나온다", row17.includes("3.000%") && (await p.locator(".doc-body .formula", { hasText: "25" }).count()) >= 1, row17);

  // 18) [Word] 탭의 상품별 견본 — Word 견본을 받아 [열기] → 표준 산출방법서로 읽는다 (한글 견본은 두지 않는다)
  await p.click(".tab:has-text('Word')");
  ok("[Word] 상품별 견본에 한글 단추가 없다 — 표준 양식은 Word 로만", (await p.locator(".word-std button", { hasText: "한글" }).count()) === 0);
  const [dw] = await Promise.all([p.waitForEvent("download"), p.click(".word-std tr:has-text('표준_산출방법서_질병보험') button:has-text('Word')")]);
  const stdDocx = fs.readFileSync(await dw.path());
  ok("[Word] 표준_산출방법서_질병보험.docx 내려받기", dw.suggestedFilename() === "표준_산출방법서_질병보험.docx" && stdDocx.length > 10000, `${stdDocx.length}B`);
  await p.setInputFiles(OPEN, { name: "표준_산출방법서_질병보험.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: stdDocx });
  await p.waitForSelector(".toast:has-text('표준_산출방법서_질병보험.docx —')");
  const t18 = await p.textContent(".toast");
  ok("Word 표준 산출방법서 [열기] → 표준 산출방법서로 읽음", /표준 산출방법서 v\d/.test(t18), t18);

  // 19) 그림으로 읽기 — 스캔 PDF → 쪽 고르기 → Anthropic API(여기서는 가짜 응답) → 옮겨 적은 글을 규칙이 읽어 조건
  const page1 = { blocks: [
    { kind: "text", text: "무배당 든든건강보험 보험료 및 책임준비금 산출방법서", rows: [] },
    { kind: "text", text: "1. 예정기초율에 관한 사항", rows: [] },
    { kind: "text", text: "(1) 예정이율 : 연 2.75% 복리", rows: [] },
    { kind: "table", text: "", rows: [["구분", "기준", "비율"], ["계약체결비용", "초년도 보험가입금액", "8/1,000"], ["계약관리비용", "영업보험료", "7.5%"]] },
  ], unreadable: "" };
  const sent = [];
  const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
  await p.route("https://api.anthropic.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    sent.push({ headers: req.headers(), body: JSON.parse(req.postData() || "{}") });
    const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const body = ev("message_start", { message: { id: "msg_e2e", type: "message", role: "assistant", model: "claude-opus-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3800, output_tokens: 1 } } })
      + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } })
      + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: JSON.stringify(page1) } })
      + ev("content_block_stop", { index: 0 })
      + ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 600 } })
      + ev("message_stop", {});
    return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "text/event-stream" }, body });
  });
  const sdir = path.join(__dirname, "../samples");
  const scan = path.join(sdir, fs.readdirSync(sdir).find((f) => f.normalize("NFC").startsWith("07_") && f.endsWith(".pdf")));
  await p.setInputFiles(OPEN, scan);
  await p.waitForSelector(".modal.vision .vision-page img", { timeout: 20000 });
  ok("스캔 PDF 열기 → [그림으로 읽기] 창 · 쪽 미리보기 · 예상 비용", /예상 비용 약 \$/.test(await p.textContent(".modal.vision .vision-send")));
  await p.screenshot({ path: `${OUT}/s12_vision.png` });
  await p.fill(".modal.vision input[type=password]", "sk-ant-e2e-test-key");
  await p.click(".modal.vision .btn-primary");
  await p.waitForSelector(".modal.vision", { state: "detached", timeout: 30000 });
  const req = sent[0] || { headers: {}, body: {} };
  const content = req.body.messages?.[0]?.content ?? [];
  ok("보낸 요청: claude-opus-5 · 쪽 그림 · 구조화 출력 · 대체 모델(fallbacks)",
    req.body.model === "claude-opus-5" && content.some((c) => c.type === "image" && c.source?.media_type === "image/jpeg") &&
    req.body.output_config?.format?.type === "json_schema" && req.body.fallbacks === "default" && /server-side-fallback-2026-07-01/.test(req.headers["anthropic-beta"] || ""),
    `${sent.length}건 · ${req.body.model} · beta ${req.headers["anthropic-beta"]}`);
  await p.click(".tab:has-text('산출방법서')");
  const r19 = await p.locator(".doc-body tr", { hasText: "적용이율" }).first().textContent();
  ok("옮겨 적은 글 → 규칙 → 조건: 적용이율 2.750% · 사업비 2줄", r19.includes("2.750%") && (await p.locator(".doc-body tr", { hasText: "8/1000" }).count() + await p.locator(".doc-body tr", { hasText: "8.00/1,000" }).count()) >= 1, r19);
  await p.click(".tab:has-text('원문')");
  await p.click("button:has-text('쪽 그림')");
  ok("[원문] 탭 쪽 그림으로 대조", (await p.locator(".orig-pages img").count()) === 1);
  await p.screenshot({ path: `${OUT}/s13_vision_pages.png` });
  const kept = await p.evaluate(() => ({ local: localStorage.getItem("life_ins_doc_convert_studio:anthropic-key"), yaml: localStorage.getItem("life_ins_doc_convert_studio:yaml") || "" }));
  ok("API 키는 이 창에만 — localStorage·조건 파일에 없음", kept.local === null && !kept.yaml.includes("sk-ant"));

  // 20) 공유 화면 — 처음 여는 사람(저장된 작업 없음): 첫 화면 종신보험, [샘플] 메뉴는 종신보험 · 암보험 둘
  const q = await b.newPage({ viewport: { width: 1500, height: 900 } });
  q.on("pageerror", (e) => errs.push("pageerror(공유) " + e.message));
  q.on("console", (m) => { if (m.type() === "error") errs.push("console(공유) " + m.text()); });
  await q.goto("http://localhost:3217", { waitUntil: "networkidle" });
  await q.waitForSelector(".doc-body h1");
  const guideT = (await q.textContent(".guide-bar").catch(() => "")) || "";
  ok("공유 화면: 처음 열면 테스트 안내(할 일 · 저장은 이 브라우저에만 · 패키지로 보내기 · PC 권장 · 의견은 GitHub 이슈)",
    guideT.includes("패키지로 저장") && guideT.includes("이 브라우저에만") && guideT.includes("1280px") && (await q.locator(".guide-bar a[href*='github.com']").count()) === 1, guideT.slice(0, 60));
  await q.click(".guide-bar button:has-text('안내 닫기')");
  await q.reload({ waitUntil: "networkidle" });
  ok("안내를 닫으면 다시 열어도 펼쳐지지 않고, [테스트 안내] 단추로 다시 본다", (await q.locator(".guide-bar").count()) === 0 && (await q.locator("header button:has-text('테스트 안내')").count()) === 1);
  await q.setViewportSize({ width: 900, height: 900 });
  ok("좁은 화면(900px) — PC 화면 기준이라는 알림", await q.locator(".narrow-warn").isVisible());
  await q.setViewportSize({ width: 1500, height: 900 });
  ok("넓은 화면 — 알림 없음", !(await q.locator(".narrow-warn").isVisible()));
  const h1 = await q.textContent(".doc-body h1");
  ok("공유 화면: 첫 화면은 종신보험(사망 보장 · 유지자 둘 · 80% 장해 납입면제) — 월 250,000원", h1.includes("종신보험") && !h1.includes("암진단") && (await q.textContent(".trial-bar")).includes("250,000"), h1);
  await q.click("summary:has-text('내보내기')");
  const expItems = await q.$$eval("details[open] .menu-list button", (bs) => bs.map((x) => [x.firstChild.textContent.trim(), x.disabled || !!x.closest("fieldset:disabled")]));
  ok("공유 화면: 내보내기 = Word .docx · Word (작성 안내 없이) · 조건 .yaml 이 먼저, 나머지는 추가기능(개발중)으로 비활성",
    JSON.stringify(expItems.slice(0, 3).map((x) => x[0])) === JSON.stringify(["Word .docx", "Word .docx (작성 안내 없이)", "조건 파일 .yaml"]) && expItems.slice(0, 3).every((x) => !x[1])
    && expItems.length === 9 && expItems.slice(3).every((x) => x[1]) && (await q.textContent("details[open] .menu-list")).includes("추가기능 (개발중)"), JSON.stringify(expItems));
  ok("[열기] 는 [불러오기]", (await q.locator("header > button.btn-primary", { hasText: /^불러오기$/ }).count()) === 1 && (await q.locator("header button", { hasText: /^열기$/ }).count()) === 0);
  await q.keyboard.press("Escape");
  await q.click("summary:has-text('샘플')");
  const shared = await q.$$eval("details[open] .menu-list button", (bs) => bs.map((x) => x.textContent));
  const sets = shared.filter((t) => t.startsWith("종신보험") || t.startsWith("암보험") || t.startsWith("암진단") || t.startsWith("2대") || t.startsWith("입원") || t.startsWith("수술") || t.startsWith("보험료납입"));
  ok("공유 화면: [샘플] 메뉴는 종신보험 · 암보험 둘뿐", sets.length === 2 && sets[0].startsWith("종신보험 (") && sets[1].startsWith("암보험 ("), sets.join(" / "));
  await q.click("details[open] .menu-list button:has-text('암보험 (')");
  await q.waitForTimeout(800);
  const tabs = await q.$$eval(".unit-tabs .unit-tab", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  const trialC = (await q.textContent(".trial-bar")).replace(/\s+/g, " ");
  ok("암보험: 탭 셋(주계약 · 암입원특약 · 암수술특약) · 사망률 없음 · 보험료가 나온다", tabs.length === 3 && tabs[1].includes("암입원특약") && tabs[2].includes("암수술특약")
    && (await q.locator(".doc-body tr", { hasText: "사망률" }).count()) === 0 && trialC.includes("240,520"), `${tabs.join(" / ")} · ${trialC.slice(0, 120)}`);
  await q.click(".unit-tabs .unit-tab:has-text('암입원특약')");
  await q.click(".card[data-card=B01] .card-head");                     // 보장 카드를 펼쳐야 담보 덩이가 그려진다
  await q.waitForTimeout(600);
  const docC = await q.textContent(".doc-body");
  const payRow = (await q.locator(".doc-body tr", { hasText: "납입:" }).allTextContents()).find((t) => t.includes("암입원특약")) ?? "";
  const wait90 = await q.locator(".doc-body tr", { hasText: "90일" }).count();
  ok("암보험: 암입원특약 탭 — 보험금 하나(암 입원) · 암 아닌 유지자 하나가 세 단위의 [납입](D′) · 보장 셋 모두 90일 면책", (await q.locator(".card[data-card=B01] .sub").count()) === 1
    && docC.includes("암 아닌 유지자") && /주계약.*암입원특약.*암수술특약/.test(payRow) && wait90 === 3,
    `보험금 ${await q.locator(".card[data-card=B01] .sub").count()} · 납입 ${payRow} · 90일 행 ${wait90}`);
  await q.screenshot({ path: `${OUT}/s14_shared_cancer.png` });
  await q.close();

  ok("콘솔 오류 없음", errs.length === 0, errs.join(" | "));
  fs.writeFileSync(`${OUT}/e2e.txt`, log.join("\n"), "utf8");
  await b.close();
})().catch((e) => { fs.writeFileSync(`${OUT}/e2e.txt`, log.join("\n") + "\nCRASH " + e.stack, "utf8"); process.exit(1); });
