import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const homeSource = fs.readFileSync(path.join(frontendRoot, "src/pages/auth/SuperAdminHome.jsx"), "utf8");
const serviceSource = fs.readFileSync(path.join(frontendRoot, "src/services/collegeRegistration.js"), "utf8");

test("Super Admin defaults to all application statuses and retains explicit filters", () => {
  assert.match(homeSource, /const \[filter, setFilter\] = useState\(""\)/);
  assert.match(homeSource, /<option value="">All statuses<\/option>/);
  for (const status of ["pending", "under_review", "approved", "rejected"]) {
    assert.match(homeSource, new RegExp(`<option value="${status}">`));
  }
  assert.match(homeSource, /listCollegeApplications\(filter, search\)/);
});

test("list request failures suppress the empty state and expose an explicit retry", () => {
  assert.match(homeSource, /const \[listError, setListError\] = useState\(""\)/);
  assert.match(homeSource, /listError \? <div[^>]*role="alert"/);
  assert.match(homeSource, /onClick=\{refresh\}>Retry loading applications/);
  assert.ok(homeSource.indexOf("listError ? <div") < homeSource.indexOf("applications.length === 0"));
  assert.match(homeSource, /: applications\.length === 0 \? <p>No applications in this status\.<\/p>/);
});

test("application list service sends the documented optional status and search parameters", () => {
  assert.match(serviceSource, /api\.get\("\/platform\/college-applications"/);
  assert.match(serviceSource, /params: \{ \.\.\.\(status \? \{ status \} : \{\}\), \.\.\.\(q \? \{ q \} : \{\}\) \}/);
});

test("approved application messaging reflects the actual provisioning state", () => {
  assert.match(homeSource, /selected\.status === "approved" && selected\.provisioning_status === "activated"/);
  assert.match(homeSource, /selected\.status === "approved" && selected\.provisioning_status === "pending_activation"/);
});
