import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const monitorPath = new URL("../src/pages/auth/admin/AttendanceMonitor.jsx", import.meta.url);
const apiPath = new URL("../src/services/api.js", import.meta.url);
const attendancePath = new URL("../src/services/attendance.js", import.meta.url);

test("admin monitor session loader stays stable after selection changes", async () => {
  const source = await readFile(monitorPath, "utf8");
  const loadBlock = source.match(/const load = useCallback\(async \(\) =>[\s\S]*?\n  \}, (\[[^\]]*\])\);/);

  assert.ok(loadBlock, "session loader callback should be present");
  assert.equal(loadBlock[1], "[]");
});

test("API client honors the configured VITE_API_URL and monitor API paths", async () => {
  const [apiSource, attendanceSource] = await Promise.all([
    readFile(apiPath, "utf8"),
    readFile(attendancePath, "utf8"),
  ]);

  assert.match(apiSource, /VITE_API_BASE_URL\s*\|\|\s*import\.meta\.env\.VITE_API_URL/);
  assert.match(attendanceSource, /"\/attendance\/sessions"/);
  assert.match(attendanceSource, /`\/attendance\/sessions\/\$\{sessionId\}\/live`/);
});
