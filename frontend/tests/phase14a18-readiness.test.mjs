import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Reports navigation uses tenant summaries while legacy reports remain unavailable", () => {
  const layout = read("src/layouts/DashboardLayout.jsx");
  const routes = read("src/routes/AppRoutes.jsx");

  assert.match(layout, /label:\s*["']Reports & Analytics["'],\s*path:\s*["']\/admin\/reports["']/);
  assert.match(routes, /path="reports"\s+element=\{<TenantReports \/>\}/);
  assert.doesNotMatch(routes, /ReportsPage/);
  assert.match(layout, /Reports & Analytics/);
  const tenantReports = read("src/pages/auth/admin/TenantReports.jsx");
  assert.match(tenantReports, /Date-range, class, subject and student-level reports are unavailable/);
});

test("Notifications route uses the tenant inbox and preserves an explicit API-unavailable state", () => {
  const layout = read("src/layouts/DashboardLayout.jsx");
  const routes = read("src/routes/AppRoutes.jsx");
  const inbox = read("src/pages/TenantNotificationInbox.jsx");

  assert.match(layout, /aria-label=\{unreadNotifications == null \? "Open notifications inbox"/);
  assert.match(routes, /path="notifications" element=\{<TenantNotificationInbox \/>\}/);
  assert.match(inbox, /tenant notification API or required College schema is not deployed and verified/);
  assert.match(inbox, /does not claim email or SMS delivery/);
});

test("legacy Reports and Notifications API pages are not mounted by the route tree", () => {
  const routes = read("src/routes/AppRoutes.jsx");
  assert.doesNotMatch(routes, /pages\/reports\/ReportsPage/);
  assert.doesNotMatch(routes, /pages\/auth\/admin\/Notifications/);
  assert.doesNotMatch(routes, /pages\/auth\/admin\/AdminDashboard/);
});

test("unavailable page is inert and cannot dispatch API requests", () => {
  const unavailable = read("src/pages/FeatureUnavailable.jsx");
  assert.doesNotMatch(unavailable, /services\/|api\.(get|post|put|patch|delete)|fetch\(/i);
});
