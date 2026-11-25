import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import path from "node:path";
import { createIsolatedViteServer } from "./helpers/viteIsolated.js";

let vite;
let createRoot;
let Page;
let AuthContext;
let dom;
let root;
const originals = new Map();

function setGlobal(name, value) {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

before(async () => {
  vite = await createIsolatedViteServer({
    root: process.cwd(), configFile: false, envFile: false, appType: "custom", logLevel: "silent",
    server: { middlewareMode: true },
    resolve: { preserveSymlinks: true, alias: [
      { find: "react-router-dom", replacement: path.resolve("tests/fixtures/router-mock.jsx") },
      { find: /^\.\.\/\.\.\/services\/collegeRegistration$/, replacement: path.resolve("tests/fixtures/college-registration-service-mock.js") },
    ] },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  Page = (await vite.ssrLoadModule("/src/pages/auth/SuperAdminColleges.jsx")).default;
  AuthContext = (await vite.ssrLoadModule("/src/context/AuthContext.jsx")).default;
  ({ createRoot } = await import("react-dom/client"));
});

after(async () => { await vite?.close(); });

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  dom?.window.close();
  dom = null;
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  originals.clear();
});

function college(status = "active") {
  return {
    id: 11, slug: "synthetic-college", official_name: "Synthetic College", display_name: "Synthetic",
    status, created_at: "2026-11-10T10:00:00Z", updated_at: "2026-11-10T10:00:00Z",
    application_reference: "AXR-synthetic", application_status: "approved", provisioning_status: "pending_activation",
    application_id: 12, college_type: "University", address: "1 Example Road", city: "Sample City",
    state: "Sample State", postal_code: "12345", country: "Exampleland", official_email: "office@example.test",
    contact_number: "+14155550123", website: null, admin_name: "Synthetic Admin", admin_email: "admin@example.test",
    admin_contact_number: "+14155550124", admins: [{ user_id: 22, name: "Synthetic Admin", email: "admin@example.test", account_active: false, membership_id: 32, membership_status: "pending" }],
  };
}

async function mount(mock) {
  dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://attendx.test/platform/colleges", pretendToBeVisual: true });
  for (const name of ["window", "document", "navigator", "HTMLElement", "Node", "CustomEvent", "IS_REACT_ACT_ENVIRONMENT"]) {
    setGlobal(name, name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name]);
  }
  setGlobal("__collegeRegistrationMock", mock);
  root = createRoot(dom.window.document.getElementById("root"));
  const value = { user: { name: "Synthetic Super Admin", email: "platform@example.test" }, logout: async () => {} };
  await act(async () => root.render(React.createElement(AuthContext.Provider, { value }, React.createElement(Page))));
  return dom.window.document;
}

test("Super Admin directory loads backend Colleges, displays details/history and submits permitted profile updates", async () => {
  const calls = [];
  const doc = await mount({
    listColleges: async (params) => { calls.push(["list", params]); return [college()]; },
    getCollege: async () => college(),
    collegeHistory: async () => [{ id: 1, actor_user_id: 1, action: "provisioned_pending", previous_status: null, new_status: "pending", reason: "Approved; activation pending.", created_at: "2026-11-10T10:00:00Z" }],
    updateCollege: async (_id, payload) => { calls.push(["update", payload]); return college(); },
    setCollegeStatus: async (_id, status, reason) => { calls.push(["status", status, reason]); return college(status); },
    list: async () => [], get: async () => ({}), history: async () => [], start: async () => ({}), approve: async () => ({}), reject: async () => ({}),
    submit: async () => ({}), checkStatus: async () => ({}),
  });
  assert.ok(calls.some(([method]) => method === "list"));
  const row = [...doc.querySelectorAll(".platform-application-list button")].find((button) => button.textContent.includes("synthetic-college"));
  await act(async () => row.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.match(doc.body.textContent, /pending activation/i);
  assert.match(doc.body.textContent, /admin@example.test/);
  assert.match(doc.body.textContent, /provisioned pending/i);
  assert.equal(doc.querySelector('[name="slug"]'), null);
  await act(async () => doc.querySelector(".platform-college-edit").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  assert.ok(calls.some(([method, payload]) => method === "update" && payload.official_name === "Synthetic College"));
});

test("College directory shows API errors and does not invent rows", async () => {
  const doc = await mount({
    listColleges: async () => { throw { response: { status: 503, data: { detail: "College management service is unavailable." } } }; },
    getCollege: async () => ({}), collegeHistory: async () => [], updateCollege: async () => ({}), setCollegeStatus: async () => ({}),
    list: async () => [], get: async () => ({}), history: async () => [], start: async () => ({}), approve: async () => ({}), reject: async () => ({}),
    submit: async () => ({}), checkStatus: async () => ({}),
  });
  assert.match(doc.querySelector('[role="alert"]').textContent, /unavailable/i);
  assert.equal(doc.querySelector(".platform-application-list li"), null);
});
