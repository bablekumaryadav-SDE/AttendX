import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import serviceApi, { TOKEN_KEY } from "../src/services/api.js";
import { getTenantUnreadNotificationCount, listTenantNotifications } from "../src/services/tenantNotifications.js";

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
    assert.match(service, new RegExp(`export (?:async )?function ${action}`));
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

test("concurrent notification reads deduplicate only while the same token and College request is pending", async () => {
  const originalGet = serviceApi.get;
  const originalLocalStorage = globalThis.localStorage;
  let token = "synthetic-token-a";
  let calls = 0;
  const resolvers = [];
  globalThis.localStorage = { getItem: (key) => key === TOKEN_KEY ? token : null };
  serviceApi.get = () => {
    calls += 1;
    return new Promise((resolve) => { resolvers.push(resolve); });
  };

  try {
    const first = getTenantUnreadNotificationCount(5);
    const duplicate = getTenantUnreadNotificationCount(5);
    assert.equal(calls, 1);
    token = "synthetic-token-b";
    const newSession = getTenantUnreadNotificationCount(5);
    assert.equal(calls, 2, "a changed token must start its own request");

    resolvers[0]({ data: { unread_count: 7 } });
    assert.deepEqual(await first, { unread_count: 7 });
    assert.deepEqual(await duplicate, { unread_count: 7 });
    assert.equal(calls, 2);
    resolvers[1]({ data: { unread_count: 8 } });
    assert.deepEqual(await newSession, { unread_count: 8 });
  } finally {
    serviceApi.get = originalGet;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  }
});

test("notification inbox reads coalesce identical pending filters but do not cache settled responses", async () => {
  const originalGet = serviceApi.get;
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => key === TOKEN_KEY ? "synthetic-inbox-token" : null };
  let calls = 0;
  let resolveRequest;
  serviceApi.get = () => {
    calls += 1;
    return new Promise((resolve) => { resolveRequest = resolve; });
  };

  try {
    const first = listTenantNotifications(5, { unread: true }, { limit: 10, offset: 0 });
    const duplicate = listTenantNotifications(5, { unread: true }, { limit: 10, offset: 0 });
    await Promise.resolve();
    assert.equal(calls, 1);
    resolveRequest({ data: { items: [] } });
    assert.deepEqual(await first, { items: [] });
    assert.deepEqual(await duplicate, { items: [] });

    const fresh = listTenantNotifications(5, { unread: true }, { limit: 10, offset: 0 });
    await Promise.resolve();
    assert.equal(calls, 2, "completed responses are not cached");
    resolveRequest({ data: { items: [{ id: 1 }] } });
    assert.deepEqual(await fresh, { items: [{ id: 1 }] });
  } finally {
    serviceApi.get = originalGet;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  }
});
