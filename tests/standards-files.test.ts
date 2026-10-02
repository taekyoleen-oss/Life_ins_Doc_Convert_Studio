import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { yamlView } from "@/lib/conditions/yaml";
import { extractDocx } from "@/lib/methoddoc/extract";
import { parseMethodDoc } from "@/lib/methoddoc/parse";
import { STANDARD_FORMAT } from "@/lib/methoddoc/render";
import { STANDARDS, standardFile, standardSpec, toStandardDocx } from "@/lib/standards";

/**
 * standards/ 의 표준 산출방법서 파일이 지금 양식과 같은지.
 * 양식(render·docx)을 바꾸면 이 시험이 깨진다 — `STANDARDS_UPDATE=1` 로 돌려 파일을 다시 만든다.
 * 표준 산출방법서는 Word(.docx) 로만 둔다 — 한글 견본(.hwpx)은 만들지 않는다.
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
  }
});
