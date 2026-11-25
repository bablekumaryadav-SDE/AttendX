import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("College Admin sidebar follows the requested order and exposes read-only monitoring destinations", async () => {
  const [layout, routes] = await Promise.all([
    read("../src/layouts/DashboardLayout.jsx"),
    read("../src/routes/AppRoutes.jsx"),
  ]);
  const adminNavigation = layout.match(/if \(role === "admin" \|\| role === "college_admin"\) \{\s*return \[([\s\S]*?)\];/);
  assert.ok(adminNavigation, "College Admin navigation list exists");
  const labels = [...adminNavigation[1].matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(labels, [
    "Overview", "Students", "Teachers", "Attendance", "Classes", "Subjects",
    "Parents & Notifications", "Notifications", "Reports & Analytics", "Settings",
  ]);
  assert.doesNotMatch(adminNavigation[1], /Assignments/);
  assert.doesNotMatch(routes, /CourseworkMigrationRequired|path="assignments"/);
  assert.match(routes, /path="parents-notifications" element=\{<ParentsNotifications \/>\}/);
  assert.match(routes, /path="reports"\s+element=\{<TenantReports \/>\}/);
  assert.match(routes, /path="settings" element=\{<CollegeSettings \/>\}/);
});

test("College Admin sidebar collapse control is keyboard accessible and responsive", async () => {
  const [layout, styles] = await Promise.all([
    read("../src/layouts/DashboardLayout.jsx"),
    read("../src/layouts/DashboardLayout.css"),
  ]);
  assert.match(layout, /aria-label=\{sidebarCollapsed \? "Expand sidebar" : "Collapse sidebar"\}/);
  assert.match(layout, /aria-pressed=\{sidebarCollapsed\}/);
  assert.match(layout, /title=\{sidebarCollapsed \? item\.label : undefined\}/);
  assert.match(styles, /@media \(min-width: 981px\)[\s\S]*?\.sidebar-collapsed/);
  assert.match(styles, /@media \(max-width: 980px\)[\s\S]*?\.sidebar-collapse-button\s*\{\s*display: none/);
  assert.match(styles, /\.sidebar-admin-profile/);
});

test("Settings use the selected College API and limit editing to College profile and GPS policy", async () => {
  const [page, service, routes] = await Promise.all([
    read("../src/pages/auth/admin/CollegeSettings.jsx"),
    read("../src/services/tenant.js"),
    read("../src/routes/AppRoutes.jsx"),
  ]);
  assert.match(page, /const \{ activeCollegeId, collegeMemberships \} = useAuth\(\)/);
  assert.match(page, /const requestVersion = useRef\(0\)/);
  assert.match(page, /version !== requestVersion\.current/);
  assert.match(page, /membership\.membership_role === "college_admin"/);
  assert.match(page, /getTenantCollegeProfile\(activeCollegeId\)/);
  assert.match(page, /const collegeId = activeCollegeId/);
  assert.match(page, /updateTenantCollegeProfile\(collegeId/);
  assert.match(page, /gps_accuracy_limit_m: limit/);
  assert.match(page, /saved\.display_name !== \(nextDisplayName \|\| null\)/);
  assert.match(service, /api\.get\("\/tenant\/pilot\/college-profile"/);
  assert.match(service, /api\.patch\("\/tenant\/pilot\/college-profile"/);
  assert.match(page, /Account profile editing, password changes and notification preferences are not exposed/);
  assert.match(routes, /<ProtectedRoute allowedRoles=\{\["admin", "college_admin"\]\}>[\s\S]*?path="settings" element=\{<CollegeSettings \/>\}/);
  assert.doesNotMatch(page, /localStorage|\/assignments\/|\/notifications\/|api\.(?:post|put|delete)/i);
});
