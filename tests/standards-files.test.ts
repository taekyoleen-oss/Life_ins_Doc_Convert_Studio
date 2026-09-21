import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { yamlView } from "@/lib/conditions/yaml";
import { extractDocx, extractHwpx } from "@/lib/methoddoc/extract";
import { parseMethodDoc } from "@/lib/methoddoc/parse";
import { STANDARD_FORMAT } from "@/lib/methoddoc/render";
import { STANDARDS, standardFile, standardSpec, toStandardDocx } from "@/lib/standards";

/**
 * standards/ 의 표준 산출방법서 파일이 지금 양식과 같은지.
 * 양식(render·docx)을 바꾸면 이 시험이 깨진다 — `STANDARDS_UPDATE=1` 로 돌려 파일을 다시 만든다.
 * .hwpx 는 한글에서 .docx 를 다른 이름으로 저장해 만든다(한글이 있을 때만) — 여기서는 되읽어 같은 조건인지만 본다.
 */
const DIR = "standards";

describe("표준 산출방법서 파일", () => {
  for (const s of STANDARDS) {
    const name = standardFile(s);
    it(`${name}.docx — 지금 양식으로 만든 것과 같고, 되읽으면 같은 조건`, async () => {
      const bytes = toStandardDocx(standardSpec(s));
      if (process.env.STANDARDS_UPDATE) { mkdirSync(DIR, { recursive: true }); writeFileSync(`${DIR}/${name}.docx`, bytes); }
      expect(Buffer.from(readFileSync(`${DIR}/${name}.docx`)).equals(Buffer.from(bytes))).toBe(true);
      const r = parseMethodDoc(await extractDocx(bytes));
      expect(r.format).toBe(STANDARD_FORMAT);
      expect(yamlView(r.spec)).toEqual(yamlView(standardSpec(s)));
    });
    it.runIf(existsSync(`${DIR}/${name}.hwpx`))(`${name}.hwpx — 한글로 저장한 문서도 같은 조건`, async () => {
      const r = parseMethodDoc(await extractHwpx(new Uint8Array(readFileSync(`${DIR}/${name}.hwpx`))));
      expect(r.format).toBe(STANDARD_FORMAT);
      expect(yamlView(r.spec)).toEqual(yamlView(standardSpec(s)));
    });
  }
});
