import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routesPath = new URL("../src/routes/AppRoutes.jsx", import.meta.url);
const unavailablePath = new URL("../src/pages/FeatureUnavailable.jsx", import.meta.url);
const legacyAttendancePath = new URL("../src/pages/attendance/AttendancePage.jsx", import.meta.url);

test("legacy attendance screen stays dormant and cannot dispatch its unscoped request", async () => {
  const [routes, unavailable, legacyPage] = await Promise.all([
    readFile(routesPath, "utf8"),
    readFile(unavailablePath, "utf8"),
    readFile(legacyAttendancePath, "utf8"),
  ]);

  assert.match(routes, /path="attendance\/legacy" element=\{<FeatureUnavailable name="Legacy attendance" \/>\}/);
  assert.match(unavailable, /not available yet/i);
  assert.match(legacyPage, /api\.get\("\/attendance-records\/"\)/);
  assert.doesNotMatch(routes, /import AttendancePage from/);
});

