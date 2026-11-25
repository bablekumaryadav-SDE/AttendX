import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeApiBaseUrl, resolveApiBaseUrl } from "../src/services/apiBaseUrl.js";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("API base URL normalization trims whitespace and removes trailing slashes", () => {
  assert.equal(
    normalizeApiBaseUrl("  https://api.example.invalid/v1///  "),
    "https://api.example.invalid/v1",
  );
});

test("development defaults to loopback only when no API URL is configured", () => {
  assert.equal(
    resolveApiBaseUrl({ DEV: true }, { developmentDefault: "http://127.0.0.1:8000" }),
    "http://127.0.0.1:8000",
  );
  assert.equal(
    resolveApiBaseUrl({ DEV: true, VITE_API_URL: "http://localhost:9000/" }),
    "http://localhost:9000",
  );
});

test("conflicting API URL variables fail with an actionable configuration error", () => {
  assert.throws(
    () => resolveApiBaseUrl({
      DEV: true,
      VITE_API_BASE_URL: "http://127.0.0.1:8001",
      VITE_API_URL: "http://127.0.0.1:8000",
    }),
    /must use the same API base URL/,
  );
  assert.equal(
    resolveApiBaseUrl({
      DEV: true,
      VITE_API_BASE_URL: "http://127.0.0.1:8000/",
      VITE_API_URL: "http://127.0.0.1:8000",
    }),
    "http://127.0.0.1:8000",
  );
});

test("login forwards the shared API client's safe no-response diagnostic", () => {
  const authSource = fs.readFileSync(path.join(frontendRoot, "src/services/auth.js"), "utf8");
  const apiSource = fs.readFileSync(path.join(frontendRoot, "src/services/api.js"), "utf8");
  assert.match(authSource, /error\.userMessage\s*\|\|/);
  assert.match(apiSource, /returned no response/);
});

test("production fails closed when API configuration is missing", () => {
  assert.throws(() => resolveApiBaseUrl({ DEV: false }), /required for production/);
  assert.throws(() => resolveApiBaseUrl({ MODE: "production" }), /required for production/);
});

test("production accepts only non-loopback HTTPS API configuration", () => {
  assert.equal(
    resolveApiBaseUrl({ DEV: false, VITE_API_BASE_URL: "https://api.example.invalid/" }),
    "https://api.example.invalid",
  );
  for (const value of ["http://api.example.invalid", "http://127.0.0.1:8000", "https://localhost/api"]) {
    assert.throws(
      () => resolveApiBaseUrl({ DEV: false, VITE_API_BASE_URL: value }),
      /non-loopback HTTPS/,
    );
  }
});

test("production accepts the deployment same-origin API proxy prefix", () => {
  assert.equal(resolveApiBaseUrl({ DEV: false, VITE_API_URL: "/api" }), "/api");
  assert.equal(resolveApiBaseUrl({ DEV: false, VITE_API_URL: "/api/v1/" }), "/api/v1");
  for (const value of ["api", "//api.example.invalid", "/api?x=1", "/api#fragment", "/api/../admin", "/api\\admin"]) {
    assert.throws(() => resolveApiBaseUrl({ DEV: false, VITE_API_URL: value }));
  }
  assert.throws(() => resolveApiBaseUrl({ DEV: true, VITE_API_URL: "/api" }));
});

test("shared API client isolates loopback fallback in Vite's removable development branch", () => {
  const apiSource = fs.readFileSync(path.join(frontendRoot, "src/services/api.js"), "utf8");
  assert.match(apiSource, /if\s*\(import\.meta\.env\?\.DEV !== false\)/);
  assert.match(apiSource, /developmentDefault:\s*"http:\/\/127\.0\.0\.1:8000"/);
  assert.match(apiSource, /else\s*\{[\s\S]*?resolveApiBaseUrl\(\{ \.\.\.API_ENV, DEV: false \}\)/);
});

test("invalid, relative, credential-bearing, query, and fragment URLs are rejected", () => {
  for (const value of [
    "/api",
    "ftp://api.example.invalid",
    "https://user:pass@api.example.invalid",
    "https://api.example.invalid?token=synthetic",
    "https://api.example.invalid#fragment",
  ]) {
    assert.throws(() => normalizeApiBaseUrl(value), /URL/);
  }
});

test("tenant services use the configured shared API client without College localStorage authorization", () => {
  const services = [
    "src/services/tenant.js",
    "src/services/tenantStudents.js",
    "src/services/tenantAttendance.js",
    "src/services/tenantDashboard.js",
    "src/services/academic.js",
    "src/services/teachers.js",
  ];
  for (const relativePath of services) {
    const source = fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
    assert.match(source, /from ["']\.\/api(?:\.js)?["']/,
      `${relativePath} must use the shared configured API client`);
    if (relativePath !== "src/services/tenant.js") {
      assert.doesNotMatch(source, /localStorage/,
        `${relativePath} must not read a College authorization value from localStorage`);
    }
  }

  const apiSource = fs.readFileSync(path.join(frontendRoot, "src/services/api.js"), "utf8");
  assert.match(apiSource, /localStorage\.getItem\(TOKEN_KEY\)/);
  assert.match(apiSource, /Authorization\s*=\s*`Bearer \$\{token\}`/);
});

test("frontend source contains no backend-only configuration variable references", () => {
  const sourceRoot = path.join(frontendRoot, "src");
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const current = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(current);
      else if (/\.(?:js|jsx|ts|tsx)$/.test(entry.name)) files.push(current);
    }
  };
  visit(sourceRoot);

  const forbidden = /\b(?:DATABASE_URL|ATTENDX_TEST_DATABASE_URL|POSTGRES(?:QL)?_[A-Z0-9_]*|JWT_SECRET|SECRET_KEY|PRIVATE_KEY)\b/;
  const findings = files.filter((file) => forbidden.test(fs.readFileSync(file, "utf8")));
  assert.equal(findings.length, 0, "backend-only configuration identifiers found in frontend source");
});

test("frontend source contains no credential-bearing URLs or recognizable private-key material", () => {
  const sourceRoot = path.join(frontendRoot, "src");
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const current = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(current);
      else if (/\.(?:js|jsx|ts|tsx)$/.test(entry.name)) files.push(current);
    }
  };
  visit(sourceRoot);

  const credentialPattern = /https?:\/\/[^\s/@]+:[^\s/@]+@|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b/;
  const findings = files.filter((file) => credentialPattern.test(fs.readFileSync(file, "utf8")));
  assert.equal(findings.length, 0, "credential-like material found in frontend source");
});

function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const current = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(current) : [current];
  });
}

const applicationDiagnosticMarkers = [
  "AttendX workspace render failed",
  "QR detection error:",
  "Camera start failed:",
  "Camera error:",
  "Face capture error:",
  "QR frame decode failed:",
];

test("production build artifacts contain no obvious secret/config leaks or debug source maps", (context) => {
  const assets = process.env.ATTENDX_FRONTEND_ARTIFACT_DIR || path.join(frontendRoot, "dist");
  const files = listFiles(assets);
  if (files.length === 0) {
    context.skip("run the production build before inspecting generated artifacts");
    return;
  }

  const issues = [];
  for (const file of files) {
    const name = path.relative(assets, file);
    if (file.endsWith(".map")) issues.push(`${name}:source-map`);
    const content = fs.readFileSync(file, "utf8");
    if (/\b(?:DATABASE_URL|ATTENDX_TEST_DATABASE_URL|POSTGRES(?:QL)?_[A-Z0-9_]*|JWT_SECRET|SECRET_KEY|PRIVATE_KEY)\b/.test(content)) {
      issues.push(`${name}:backend-config-identifier`);
    }
    if (/https?:\/\/[^\s/@]+:[^\s/@]+@/i.test(content)) issues.push(`${name}:credential-bearing-url`);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b/.test(content)) {
      issues.push(`${name}:recognizable-secret-material`);
    }
    if (/(?:[A-Za-z]:\\(?:Users|Windows|AttendX)\\|\/home\/[^\s"']+\/)/i.test(content)) {
      issues.push(`${name}:internal-filesystem-path`);
    }
    if (/sourceMappingURL=.*\.map/.test(content)) issues.push(`${name}:source-map-reference`);
    if (applicationDiagnosticMarkers.some((marker) => content.includes(marker))) {
      issues.push(`${name}:development-error-diagnostic`);
    }
    if (content.includes("http://127.0.0.1:8000")) issues.push(`${name}:production-loopback-fallback`);
  }

  assert.equal(issues.length, 0, `build artifact audit findings: ${issues.join(", ")}`);
});
