import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cssUrl = new URL("../src/pages/auth/admin/Teachers.css", import.meta.url);
const pageUrl = new URL("../src/pages/auth/admin/Teachers.jsx", import.meta.url);

test("Teacher detail modal scrolls to the Admin verification controls", async () => {
  const [css, page] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(pageUrl, "utf8"),
  ]);
  const viewRule = css.match(/\.teacher-view\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(viewRule, /overflow-y:\s*auto\s*;/);
  assert.doesNotMatch(viewRule, /overflow:\s*hidden\s*;/);
  assert.match(page, /Teacher profile verification/);
  assert.match(page, /Profile verification<\/span><strong>\{teacherVerification\.verification_status\}/);
  assert.match(page, /onClick=\{\(\) => void updateTeacherVerification\("verified"\)\}/);
  assert.match(page, /onClick=\{\(\) => void updateTeacherVerification\("rejected"\)\}/);
  assert.match(page, /Verification history/);
});
