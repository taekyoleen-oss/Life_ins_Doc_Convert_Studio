// Life_ins_Doc_Convert_Studio 동작 확인 — 선택 연결·파일 열기·LaTeX 반영·입력 카드·위험률 표·수식 견본·화면 조절·Word·한글 표준 양식·그림으로 읽기(가짜 API)
/* eslint-disable @typescript-eslint/no-require-imports -- node 로 바로 돌리는 CommonJS 스크립트 */
const path = require("path"), fs = require("fs");
const PW = path.join(process.env.LOCALAPPDATA, "npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.js");
const CHROME = path.join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1234/chrome-win64/chrome.exe");
const { chromium } = require(PW);
const OUT = process.env.OUT;
const ROOT = "C:/Users/tklee/OneDrive - 코리안리재보험/0. 보험료 산출 방법서";
const dir = fs.readdirSync(ROOT).find((d) => d.normalize("NFC").includes("교직원 공제"));
const pdf = path.join(ROOT, dir, fs.readdirSync(path.join(ROOT, dir)).find((f) => f.normalize("NFC").includes("실속건강공제") && /\.pdf$/i.test(f)));

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
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForSelector(".doc-body h1");
  ok("첫 화면: 종신보험 산출방법서", (await p.textContent(".doc-body h1")).includes("종신보험"));
  ok("KaTeX 수식이 그려진다", (await p.locator(".doc-body .formula .katex").count()) >= 8);
  ok("첫 화면: 왼쪽은 입력 카드, 아래는 위험률 표", (await p.locator(".form-body .card").count()) >= 8 && (await p.locator(".sheet-empty").count()) === 1);
  await p.screenshot({ path: `${OUT}/s1_first.png` });
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

  // 3) 담보 금액 줄 → 담보 행 + 유지자수 식
  await p.locator(".cm-line", { hasText: "amount: 100000000" }).first().click();
  await p.waitForTimeout(400);
  const hl3 = await p.$$eval(".doc-body .doc-hl", (els) => els.map((e) => e.textContent.slice(0, 30)));
  ok("담보 금액 줄 → 담보 행과 유지자수·납입자수 식", hl3.length >= 2, hl3.join(" / "));

  // 4) 조건을 고치면 산출방법서가 바로 바뀐다
  await p.locator(".cm-line", { hasText: "interest: 2.5%" }).first().click();
  await p.keyboard.press("End");
  for (let i = 0; i < "2.5%      # 적용(예정)이율".length; i++) await p.keyboard.press("Backspace");
  await p.keyboard.type("3%");
  await p.waitForTimeout(600);
  const rate = await p.locator(".doc-body tr", { hasText: "적용이율" }).first().textContent();
  ok("조건 이율 3% → 산출방법서 3.000%", rate.includes("3.000%"), rate);

  // 5) PDF 열기 → 조건 + 원문 탭
  await p.setInputFiles("input[aria-label='열 파일']", pdf);
  await p.waitForSelector(".orig-list", { timeout: 60000 });
  await p.waitForTimeout(800);
  const yamlText = await p.$$eval(".cm-content .cm-line", (els) => els.map((e) => e.textContent).join("\n"));
  ok("PDF → 조건: 이율 4.25% 와 출처 주석", /interest: 4\.25% # 본문 55줄/.test(yamlText));
  ok("PDF → 원문 탭에 근거 딱지", (await p.locator(".orig-linked").count()) >= 5);
  await p.locator(".cm-line", { hasText: "interest: 4.25%" }).first().click();
  await p.waitForTimeout(500);
  const origHl = await p.$$eval(".doc-hl", (els) => els.map((e) => e.textContent.slice(0, 50)));
  ok("조건 이율 줄 → 원문 근거 줄(본문 55줄) 강조", origHl.some((t) => t.includes("4.25")), origHl.join(" / "));
  await p.screenshot({ path: `${OUT}/s4_pdf_original.png` });

  // 6) 원문의 표를 누르면 조건 줄로
  await p.locator(".orig-linked", { hasText: "신계약비" }).first().click();
  await p.waitForTimeout(400);
  const m2 = await p.$$eval(".cm-mirror-hl", (els) => els.map((e) => e.textContent));
  ok("원문 사업비 표 → 조건 사업비 줄 강조", m2.some((t) => /expenses|α|β|γ|group/.test(t)), m2.slice(0, 3).join(" / "));

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
  await replaceAll("100,000,000원", "70,000,000원");
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/s5a_latex_edited.png` });
  log.push("apply enabled: " + await p.locator("button.btn-primary:has-text('조건에 반영')").isEnabled());
  await p.click("button.btn-primary:has-text('조건에 반영')");
  await p.waitForTimeout(700);
  const toast = await p.locator(".toast").textContent().catch(() => "");
  const y2 = await p.$$eval(".cm-editor", (eds) => [...eds[0].querySelectorAll(".cm-line")].map((e) => e.textContent).join("\n"));
  ok("LaTeX 수정 → 조건 반영: 이율 3.5%", /interest: 3\.5%/.test(y2), toast);
  ok("LaTeX 수정 → 조건 반영: 금액 7천만", /amount: 70000000/.test(y2));
  ok("조건 파일 주석 유지", y2.includes("# 납입만 면제되는 추가 사유가 없으면"));
  await p.click("button.tab:has-text('산출방법서')");
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/s5_latex_applied.png` });

  // ── 입력 화면 · 위험률 표 · 수식 견본 · 화면 조절 ──────────────────────────
  await p.click("summary:has-text('샘플')");
  await p.click(".menu-list button:has-text('종신보험')");
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

  // 10) 담보 추가
  await p.click(".form-body button:has-text('＋ 진단형')");
  await p.waitForTimeout(600);
  ok("＋ 진단형 → 카드 C02 와 산출방법서 담보 행", (await p.locator(".card[data-card=C1]").count()) === 1 && (await p.locator(".doc-body tr", { hasText: "담보 2" }).count()) >= 1);

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
  const rateRow = await p.locator(".doc-body tr", { hasText: "제7회 경험생명표 사망률" }).first().textContent();
  ok("이은 열 → 산출방법서 위험률 표 '40~42세 3행'", rateRow.includes("40~42세 3행"), rateRow);
  const cancer = await p.locator(".doc-body tr", { hasText: "암발생률" }).first().textContent().catch(() => "");
  ok("새 위험률 '암발생률' 이 조건·산출방법서에 표와 함께", cancer.includes("40~42세 3행") && (await p.locator("[data-card='M04'] .card-head").textContent()).includes("암발생률"), cancer);
  ok("산출방법서 맨 뒤 '별첨 — 위험률 표' (연령 × 열)", (await p.locator(".doc-body h2", { hasText: "별첨 — 위험률 표" }).count()) === 1 && (await p.locator(".doc-body section:last-of-type tbody tr").count()) === 3);
  // 11-1) 조건 M04 에서 위험률을 더하면 표에 빈 열이 생기고(표 없음 안내), 지우면 연결이 풀린다
  await p.locator("[data-card='M04'] .card-head").click();
  await p.locator("[data-card='M04'] button:has-text('＋ 위험률')").click();
  await p.waitForTimeout(600);
  const heads = await p.$$eval("table.sheet th.sheet-name", (els) => els.map((e) => e.textContent.replace(/^[A-Z]\s*/, "").trim()));
  const sels = await p.$$eval("table.sheet select.sheet-sel", (els) => els.map((e) => e.value));
  ok("M04 [＋ 위험률] → 표에 '새 위험률' 빈 열이 그 위험률에 이어짐 · 상태줄 '표 없음 1'", heads.at(-1) === "새 위험률" && /^rate:/.test(sels.at(-2)) && (await p.textContent("footer")).includes("표 없음 1"), `${heads.join(",")} | ${sels.join(",")}`);
  ok("M04 카드가 '값 표 없음' 을 안내", (await p.locator("[data-card='M04']").textContent()).includes("값 표가 없는 위험률: 새 위험률"));
  await p.locator("[data-path^='rates['] .sub-x").last().click();
  await p.waitForTimeout(600);
  const sels2 = await p.$$eval("table.sheet select.sheet-sel", (els) => els.map((e) => e.value));
  ok("위험률을 지우면 그 열은 '쓰지 않음' (값은 남음)", sels2.at(-1) === "skip" && (await p.$$eval("table.sheet th.sheet-name", (els) => els.length)) === heads.length, sels2.join(","));
  await p.locator("th.sheet-name", { hasText: "사망률(남)" }).click();
  await p.waitForTimeout(500);
  const hlSheet = await p.$$eval(".doc-body .doc-hl", (els) => els.map((e) => e.textContent.slice(0, 20)));
  ok("표 열 머리 → 산출방법서 위험률 행 강조", hlSheet.some((t) => t.includes("사망률")), hlSheet.join(" / "));
  await p.screenshot({ path: `${OUT}/s8_sheet.png` });

  // 12) MethodSpec JSON — 자유설계보험 입력: 계약 성별(남)의 위험률 표가 실린다
  await p.click("summary:has-text('내보내기')");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("button:has-text('MethodSpec .json')")]);
  const spec = JSON.parse(fs.readFileSync(await dl.path(), "utf8").replace(/^﻿/, ""));
  const t0 = spec.rates[0].table;
  ok("MethodSpec JSON 에 위험률 표(RateRef.table)", t0 && t0.ages.length === 3 && t0.sex === "M" && t0.values[0] === 0.00103, JSON.stringify(t0));

  // 13) 수식 견본 → 조건 식(M08) → 산출방법서
  const before = await p.locator(".doc-body .formula").count();
  await p.click("button:has-text('＋ 수식 더하기')");
  await p.locator(".palette .pal-tile", { hasText: "순보험료" }).click();
  await p.waitForTimeout(700);
  ok("견본 '순보험료' → 조건 식 추가 → 산출방법서 수식 +1", (await p.locator(".doc-body .formula").count()) === before + 1);
  ok("M08 이 펼쳐지고 식 칸에 들어감", (await p.locator("[data-path='formulas[0].text'] textarea").inputValue()).includes("P = "));
  await p.screenshot({ path: `${OUT}/s9_palette.png` });
  // 13-0) 바뀐 곳 표시 — 더한 식의 칸·카드 딱지·산출방법서 블록·상태줄
  ok("바뀐 곳 표시: M08 카드 딱지 · 식 칸 · 산출방법서 식 블록 · 상태줄 개수",
    (await p.locator("[data-card='M08'] .chip-changed").count()) === 1 && (await p.locator(".form-changed[data-path^='formulas[0]']").count()) >= 1
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
  await p.locator(".doc-body h1").click();
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
  const OPEN = "input[aria-label='열 파일']", MERGE = "input[aria-label='고쳐 반영할 파일']";
  await p.click("details:has(summary:has-text('샘플')) summary");
  await p.click("details:has(summary:has-text('샘플')) .menu-list button:has-text('종신보험 (')");
  await p.waitForSelector(".doc-body h1:has-text('종신보험')");
  await p.click(".tab:has-text('Word·한글')");
  const [dlw] = await Promise.all([p.waitForEvent("download"), p.click("button:has-text('Word 내려받기')")]);
  const docx = fs.readFileSync(await dlw.path());
  ok("[Word·한글] Word 내려받기 → 표준 산출방법서 .docx", dlw.suggestedFilename().endsWith(".docx") && /표준 산출방법서 v\d/.test(docx.toString("utf8")), dlw.suggestedFilename());
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
  await p.click(".tab:has-text('Word·한글')"); await p.screenshot({ path: `${OUT}/s11_word.png` }); await p.click(".tab:has-text('산출방법서')");
  ok("반영 뒤 산출방법서 적용이율 3.000% · 고친 식이 나온다", row17.includes("3.000%") && (await p.locator(".doc-body .formula", { hasText: "25" }).count()) >= 1, row17);

  // 18) [Word·한글] 탭의 상품별 견본 — 한글(.hwpx) 견본을 받아 [열기] → 표준 산출방법서로 읽는다
  await p.click(".tab:has-text('Word·한글')");
  const [dh] = await Promise.all([p.waitForEvent("download"), p.click(".word-std tr:has-text('표준_산출방법서_질병보험') button:has-text('한글')")]);
  const hwpx = fs.readFileSync(await dh.path());
  ok("[Word·한글] 표준_산출방법서_질병보험.hwpx 내려받기", dh.suggestedFilename() === "표준_산출방법서_질병보험.hwpx" && hwpx.length > 20000, `${hwpx.length}B`);
  await p.setInputFiles(OPEN, { name: "표준_산출방법서_질병보험.hwpx", mimeType: "application/hwp+zip", buffer: hwpx });
  await p.waitForSelector(".toast:has-text('표준_산출방법서_질병보험.hwpx —')");
  const t18 = await p.textContent(".toast");
  ok("한글 표준 산출방법서 [열기] → 표준 산출방법서로 읽음", /표준 산출방법서 v\d/.test(t18), t18);

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

  ok("콘솔 오류 없음", errs.length === 0, errs.join(" | "));
  fs.writeFileSync(`${OUT}/e2e.txt`, log.join("\n"), "utf8");
  await b.close();
})().catch((e) => { fs.writeFileSync(`${OUT}/e2e.txt`, log.join("\n") + "\nCRASH " + e.stack, "utf8"); process.exit(1); });
