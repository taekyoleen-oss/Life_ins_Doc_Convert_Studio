// MethodDoc Studio 동작 확인 — 선택 연결·파일 열기·LaTeX 반영
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
  await p.goto("http://localhost:3217", { waitUntil: "networkidle" });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForSelector(".doc-body h1");
  ok("첫 화면: 종신보험 산출방법서", (await p.textContent(".doc-body h1")).includes("종신보험"));
  ok("KaTeX 수식이 그려진다", (await p.locator(".doc-body .formula .katex").count()) >= 8);
  await p.screenshot({ path: `${OUT}/s1_first.png` });

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
  p.once("dialog", (d) => d.accept());
  await p.setInputFiles("input[type=file]", pdf);
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
  p.once("dialog", (d) => d.accept());
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
  ok("조건 파일 주석 유지", y2.includes("# 가입나이"));
  await p.click("button.tab:has-text('산출방법서')");
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/s5_latex_applied.png` });

  ok("콘솔 오류 없음", errs.length === 0, errs.join(" | "));
  fs.writeFileSync(`${OUT}/e2e.txt`, log.join("\n"), "utf8");
  await b.close();
})().catch((e) => { fs.writeFileSync(`${OUT}/e2e.txt`, log.join("\n") + "\nCRASH " + e.stack, "utf8"); process.exit(1); });
