import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardPath = new URL("../src/pages/student/StudentDashboard.jsx", import.meta.url);
const routesPath = new URL("../src/routes/AppRoutes.jsx", import.meta.url);

test("student dashboard declares its notification state used by JSX and handlers", async () => {
  const source = await readFile(dashboardPath, "utf8");
  assert.match(source, /const\s+\[notice\s*,\s*setNotice\]\s*=\s*useState\(/);
});

test("admin home route renders the API-backed admin dashboard", async () => {
  const source = await readFile(routesPath, "utf8");
  assert.match(source, /import AdminDashboard from ["']\.\.\/pages\/auth\/admin\/AdminDashboard["']/);
  assert.match(source, /<Route index element=\{<AdminDashboard \/>\} \/>/);
});
