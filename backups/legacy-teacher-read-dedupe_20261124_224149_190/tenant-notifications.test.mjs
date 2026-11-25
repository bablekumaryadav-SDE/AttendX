import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("In-app notification inbox remains recipient-scoped and independent of Coursework", () => {
  const page = read("src/pages/TenantNotificationInbox.jsx");
  const service = read("src/services/tenantNotifications.js");
  const styles = read("src/pages/TenantNotificationInbox.css");
  const backend = read("../backend/app/api/tenant_notifications.py");
  const main = read("../backend/app/main.py");
  const routes = read("src/routes/AppRoutes.jsx");
  const layout = read("src/layouts/DashboardLayout.jsx");

  for (const action of ["listTenantNotifications", "markTenantNotificationRead", "markAllTenantNotificationsRead", "getTenantUnreadNotificationCount"]) {
    assert.match(page, new RegExp(action));
    assert.match(service, new RegExp(`export async function ${action}`));
  }
  assert.match(page, /page\?\.items/);
  assert.match(page, /tenant-notification-pages/);
  assert.match(page, /does not claim email or SMS delivery/);
  assert.doesNotMatch(page, /coursework/i);
  assert.match(styles, /tenant-notification-card/);
  assert.doesNotMatch(styles, /coursework/i);
  assert.match(backend, /Recipient-scoped in-app notification API/);
  assert.match(main, /app\.include_router\(tenant_notifications_router\)/);
  assert.match(layout, /getTenantUnreadNotificationCount/);
  assert.match(layout, /notification-unread-badge/);
  assert.equal((routes.match(/element=\{<TenantNotificationInbox \/>\}/g) || []).length, 3);
});

test("Coursework routes and router are absent while academic mapping routes remain", () => {
  const routes = read("src/routes/AppRoutes.jsx");
  const layout = read("src/layouts/DashboardLayout.jsx");
  const main = read("../backend/app/main.py");
  const tenantTeachers = read("../backend/app/api/tenant_teachers.py");

  assert.doesNotMatch(routes, /Coursework|TeacherAssignments|StudentAssignments|path="assignments"/);
  assert.doesNotMatch(layout, /label: "Assignments"|coursework/i);
  assert.doesNotMatch(main, /tenant_coursework|coursework_router/);
  assert.match(tenantTeachers, /teacher_id}\/assignments/);
  assert.match(layout, /Subject Assignments/);
});
