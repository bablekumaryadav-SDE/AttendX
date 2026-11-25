import assert from "node:assert/strict";
import test from "node:test";

import { getProtectedRouteDecision, getRoleHome } from "../src/routes/roleAccess.js";

test("unauthenticated and loading states never grant protected route access", () => {
  assert.deepEqual(getProtectedRouteDecision({
    loading: true,
    isAuthenticated: false,
    user: null,
    allowedRoles: ["super_admin"],
  }), { type: "loading" });

  assert.deepEqual(getProtectedRouteDecision({
    loading: false,
    isAuthenticated: false,
    user: null,
    allowedRoles: ["super_admin"],
  }), { type: "redirect", to: "/login" });
});

test("only the Super Admin role is allowed on its platform route", () => {
  assert.deepEqual(getProtectedRouteDecision({
    loading: false,
    isAuthenticated: true,
    user: { role: "super_admin" },
    allowedRoles: ["super_admin"],
  }), { type: "allow" });

  for (const role of ["admin", "teacher", "student"]) {
    assert.deepEqual(getProtectedRouteDecision({
      loading: false,
      isAuthenticated: true,
      user: { role },
      allowedRoles: ["super_admin"],
    }), { type: "redirect", to: getRoleHome(role) });
  }
});

test("Super Admin does not inherit the existing college Admin route", () => {
  assert.deepEqual(getProtectedRouteDecision({
    loading: false,
    isAuthenticated: true,
    user: { role: "super_admin" },
    allowedRoles: ["admin"],
  }), { type: "redirect", to: "/platform" });

  assert.deepEqual(getProtectedRouteDecision({
    loading: false,
    isAuthenticated: true,
    user: { role: "admin" },
    allowedRoles: ["super_admin"],
  }), { type: "redirect", to: "/admin" });
});

test("new College Admin role remains distinct from legacy admin while sharing the tenant workspace route", () => {
  assert.equal(getRoleHome("college_admin"), "/admin");
  assert.deepEqual(getProtectedRouteDecision({
    loading: false,
    isAuthenticated: true,
    user: { role: "college_admin" },
    allowedRoles: ["admin", "college_admin"],
  }), { type: "allow" });
  assert.deepEqual(getProtectedRouteDecision({
    loading: false,
    isAuthenticated: true,
    user: { role: "admin" },
    allowedRoles: ["college_admin"],
  }), { type: "redirect", to: "/admin" });
});

test("role matching is normalized and unknown roles fail closed", () => {
  assert.deepEqual(getProtectedRouteDecision({
    loading: false,
    isAuthenticated: true,
    user: { role: " SUPER_ADMIN " },
    allowedRoles: ["super_admin"],
  }), { type: "allow" });
  assert.equal(getRoleHome("unexpected"), "/login");
});
