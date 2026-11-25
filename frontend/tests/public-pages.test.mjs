import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, afterEach, before, test } from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { createIsolatedViteServer } from "./helpers/viteIsolated.js";

let vite;
let createRoot;
let MemoryRouter;
let AuthProvider;
const pages = {};
const globals = new Map();
let dom;
let root;

function setGlobal(name, value) {
  if (!globals.has(name)) globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

before(async () => {
  vite = await createIsolatedViteServer({
    root: process.cwd(),
    configFile: false,
    envFile: false,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
    resolve: {
      preserveSymlinks: true,
      alias: [
        { find: "react-router-dom", replacement: path.resolve("tests/fixtures/router-mock.jsx") },
        { find: /^\.\.\/\.\.\/services\/collegeRegistration$/, replacement: path.resolve("tests/fixtures/college-registration-service-mock.js") },
      ],
    },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const names = ["AboutPage", "FeaturesPage", "HowItWorksPage", "FounderPage", "ContactPage", "PrivacyPolicyPage", "TermsPage", "CollegeRegistrationPage"];
  for (const name of names) {
    pages[name] = (await vite.ssrLoadModule(`/src/pages/public/${name}.jsx`)).default;
  }
  ({ AuthProvider } = await vite.ssrLoadModule("/src/context/AuthContext.jsx"));
  ({ MemoryRouter } = await vite.ssrLoadModule("/tests/fixtures/router-mock.jsx"));
  ({ createRoot } = await import("react-dom/client"));
});

after(async () => { await vite?.close(); });

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  dom?.window.close();
  dom = null;
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  globals.clear();
});

async function renderPage(name) {
  dom = new JSDOM("<!doctype html><html><head><meta name='description' content='AttendX'></head><body><div id='root'></div></body></html>", {
    url: "https://attendx.test/",
    pretendToBeVisual: true,
  });
  for (const name of ["window", "document", "navigator", "HTMLElement", "Node", "CustomEvent", "localStorage", "IS_REACT_ACT_ENVIRONMENT"]) {
    setGlobal(name, name === "IS_REACT_ACT_ENVIRONMENT" ? true : name === "localStorage" ? dom.window.localStorage : dom.window[name]);
  }
  setGlobal("__collegeRegistrationMock", {
    submit: async () => ({ application_reference: "AXR-synthetic-reference", status: "pending", tracking_token: "synthetic-token-not-a-real-credential" }),
    checkStatus: async () => ({ application_reference: "AXR-synthetic-reference", status: "pending" }),
    list: async () => [], get: async () => ({}), history: async () => [],
    start: async () => ({}), approve: async () => ({}), reject: async () => ({}),
  });
  root = createRoot(dom.window.document.getElementById("root"));
  await act(async () => root.render(React.createElement(MemoryRouter, null,
    React.createElement(AuthProvider, null, React.createElement(pages[name])))));
  return dom.window.document;
}

test("About and Founder pages stay within verified facts", async () => {
  let doc = await renderPage("AboutPage");
  assert.match(doc.querySelector("h1").textContent, /higher education/i);
  assert.match(doc.body.textContent, /registration migrations remain drafts/i);
  assert.match(doc.title, /higher education.*AttendX/i);
  doc = await renderPage("FounderPage");
  assert.match(doc.body.textContent, /Founded and Owned by Bablu Kumar Yadav\./);
  assert.equal(doc.querySelector("img"), null);
  assert.doesNotMatch(doc.body.textContent, /award-winning|graduated from|years of founder experience/i);
});

test("Features and How It Works label incomplete workflows instead of implying end-to-end availability", async () => {
  let doc = await renderPage("FeaturesPage");
  assert.ok(doc.querySelectorAll(".public-status-list article").length >= 15);
  assert.match(doc.body.textContent, /NOT CONFIGURED/);
  assert.match(doc.body.textContent, /PARTIALLY AVAILABLE/);
  assert.match(doc.body.textContent, /liveness detection is not implemented/i);
  doc = await renderPage("HowItWorksPage");
  assert.equal(doc.querySelectorAll(".public-step-list li").length, 9);
  assert.match(doc.body.textContent, /not an operational guarantee/i);
  assert.match(doc.body.textContent, /tenant-safe session creation remains blocked/i);
});

test("Contact page has no fabricated channel or fake submission form", async () => {
  const doc = await renderPage("ContactPage");
  assert.match(doc.body.textContent, /verified public support email/i);
  assert.match(doc.body.textContent, /no message form is shown/i);
  assert.equal(doc.querySelector("form"), null);
  assert.equal(doc.querySelector('a[href^="mailto:"]'), null);
  assert.equal(doc.querySelector('a[href^="tel:"]'), null);
});

test("Privacy and Terms remain explicit owner/legal review drafts without unsupported legal promises", async () => {
  let doc = await renderPage("PrivacyPolicyPage");
  assert.match(doc.body.textContent, /DRAFT - OWNER AND LEGAL REVIEW REQUIRED/);
  assert.match(doc.body.textContent, /Face-verification data/);
  assert.match(doc.body.textContent, /Encryption at rest.*NOT VERIFIED/i);
  assert.match(doc.title, /Privacy Policy/);
  doc = await renderPage("TermsPage");
  assert.match(doc.body.textContent, /DRAFT - OWNER AND LEGAL REVIEW REQUIRED/);
  assert.match(doc.body.textContent, /not a contract, consent screen or approved set of terms/i);
  assert.match(doc.body.textContent, /No prices, refunds, arbitration, uptime guarantees/i);
  assert.equal(doc.querySelector("form"), null);
});

test("all public pages share working route links and preserve protected route declarations", async () => {
  const routes = await readFile("src/routes/AppRoutes.jsx", "utf8");
  const requiredPublicRoutes = ["/", "/login", "/about", "/features", "/how-it-works", "/founder", "/contact", "/privacy", "/terms", "/register-college"];
  for (const route of requiredPublicRoutes) assert.ok(routes.includes(`path="${route}"`), `missing route ${route}`);
  for (const route of ["/platform", "/admin", "/teacher", "/student"]) assert.ok(routes.includes(`path="${route}"`) && routes.includes("<ProtectedRoute"));
  assert.ok(routes.includes('path="/register-college"'));
  const doc = await renderPage("AboutPage");
  const allowed = new Set(requiredPublicRoutes);
  for (const link of doc.querySelectorAll("a[href]")) {
    const url = new URL(link.href, "https://attendx.test");
    if (url.origin === "https://attendx.test") assert.ok(allowed.has(url.pathname), `unregistered public link ${url.pathname}`);
  }
  assert.ok(doc.querySelector('a[href="/login"]'));
  assert.ok(doc.querySelector('a[href="/privacy"]'));
  assert.ok(doc.querySelector('a[href="/terms"]'));
});

test("College registration form is connected to backend service and exposes no local-only submission", async () => {
  const doc = await renderPage("CollegeRegistrationPage");
  const requiredNames = ["college_name", "college_type", "address", "city", "state", "postal_code", "country", "official_email", "contact_number", "admin_name", "admin_email", "admin_contact_number", "password", "password_confirmation"];
  for (const name of requiredNames) assert.ok(doc.querySelector(`[name="${name}"]`), `missing form field ${name}`);
  assert.equal(doc.querySelector('[name="admin_email"]').maxLength, 150, "admin email must fit the existing User model column");
  assert.ok(doc.querySelector('a[href="/register-college"]') || doc.querySelector("form.registration-form"));
  assert.equal(doc.querySelector(".registration-success"), null, "success waits for the backend response");
  assert.match(doc.body.textContent, /no invitation email is currently sent/i);
  assert.match(doc.body.textContent, /tracking token/i);
  assert.equal(doc.querySelector("form.registration-form").querySelectorAll("input").length, 15);
});

test("registration success appears only after backend confirmation and tracking token is not persisted locally", async () => {
  const doc = await renderPage("CollegeRegistrationPage");
  const values = {
    college_name: "Synthetic Academy", college_type: "University", address: "123 Sample Avenue",
    city: "Sample City", state: "Sample State", postal_code: "12345", country: "Exampleland",
    official_email: "office@example.test", contact_number: "+14155550123", website: "",
    admin_name: "Test Applicant", admin_email: "applicant@example.org", admin_contact_number: "+14155550124",
    password: "Synthetic!Registration123", password_confirmation: "Synthetic!Registration123",
  };
  for (const [name, value] of Object.entries(values)) {
    const input = doc.querySelector(`[name="${name}"]`);
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    await act(async () => {
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
  }
  let submittedPayload;
  globalThis.__collegeRegistrationMock.submit = async (payload) => {
    submittedPayload = payload;
    return { application_reference: "AXR-synthetic-reference", status: "pending", tracking_token: "synthetic-tracking-token" };
  };
  const form = doc.querySelector("form.registration-form");
  assert.equal(doc.querySelector('[name="college_name"]').value, "Synthetic Academy");
  await act(async () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  assert.equal(doc.querySelector(".registration-success [aria-label='Tracking token']"), null);
  assert.match(doc.querySelector(".registration-success").textContent, /AXR-synthetic-reference/);
  assert.match(doc.querySelector(".registration-success").textContent, /synthetic-tracking-token/);
  assert.equal(dom.window.localStorage.length, 0);
  assert.deepEqual(Object.keys(submittedPayload).sort(), Object.keys(values).sort());
  assert.equal(submittedPayload.website, null);
});

test("registration backend failure displays an error and never a success state", async () => {
  const doc = await renderPage("CollegeRegistrationPage");
  globalThis.__collegeRegistrationMock.submit = async () => {
    throw { response: { status: 503, data: { detail: "College application service is unavailable." } } };
  };
  const form = doc.querySelector("form.registration-form");
  await act(async () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  assert.equal(doc.querySelector(".registration-success"), null);
  assert.match(doc.querySelector('[role="alert"]').textContent, /storage is unavailable/i);
  assert.match(doc.querySelector('[role="alert"]').textContent, /contact support before retrying/i);
});

test("registration conflicts show an actionable safe message and never claim success", async () => {
  const doc = await renderPage("CollegeRegistrationPage");
  globalThis.__collegeRegistrationMock.submit = async () => {
    throw { response: { status: 409, data: { detail: "An application with these college or administrator details may already exist. Check the application status or review the submitted contact details." } } };
  };
  await act(async () => doc.querySelector("form.registration-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  assert.equal(doc.querySelector(".registration-success"), null);
  assert.match(doc.querySelector('[role="alert"]').textContent, /already exist/i);
});
