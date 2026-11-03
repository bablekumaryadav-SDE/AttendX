import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canStartFaceCamera,
  getCameraConstraints,
  getCameraErrorMessage,
  requestCameraStream,
  stopCameraStream,
} from "../src/utils/cameraAccess.js";

const adminPath = new URL("../src/pages/auth/admin/Students.jsx", import.meta.url);
const servicePath = new URL("../src/services/students.js", import.meta.url);
const backendPath = new URL("../../backend/app/api/students.py", import.meta.url);

test("camera requests use flexible real-video constraints without hard minimums", () => {
  const constraints = getCameraConstraints("user");
  assert.equal(constraints.video.facingMode.ideal, "user");
  assert.equal(constraints.video.width.ideal, 1280);
  assert.equal(constraints.video.height.ideal, 720);
  assert.equal("min" in constraints.video.width, false);
  assert.equal(constraints.audio, false);
});

test("camera cannot start before save or consent, but enables after both", () => {
  assert.equal(canStartFaceCamera({ studentId: null, consentAccepted: true }), false);
  assert.equal(canStartFaceCamera({ studentId: 41, consentAccepted: false }), false);
  assert.equal(canStartFaceCamera({ studentId: 41, consentAccepted: true }), true);
  assert.equal(canStartFaceCamera({ studentId: 41, consentAccepted: true, saving: true }), false);
  assert.equal(canStartFaceCamera({ studentId: 41, consentAccepted: true, cameraStarting: true }), false);
});

test("insecure and unsupported contexts fail before requesting a stream", async () => {
  let calls = 0;
  const mediaDevices = { getUserMedia: async () => { calls += 1; } };
  await assert.rejects(
    requestCameraStream({ mediaDevices, secureContext: false }),
    (error) => error.code === "insecure-context",
  );
  await assert.rejects(
    requestCameraStream({ mediaDevices: {}, secureContext: true }),
    (error) => error.code === "unsupported-browser",
  );
  assert.equal(calls, 0);
});

test("granted camera permission returns the actual browser stream", async () => {
  const stream = { getTracks: () => [] };
  let called = false;
  const actual = await requestCameraStream({
    secureContext: true,
    mediaDevices: {
      async getUserMedia(constraints) {
        called = true;
        assert.equal(constraints.video.width.ideal, 1280);
        return stream;
      },
    },
  });
  assert.equal(called, true);
  assert.equal(actual, stream);
});

test("overconstrained devices retry with browser-selected video dimensions", async () => {
  const constraints = [];
  const stream = { id: "real-stream" };
  const mediaDevices = {
    async getUserMedia(value) {
      constraints.push(value);
      if (constraints.length === 1) {
        const error = new Error("mode unavailable");
        error.name = "OverconstrainedError";
        throw error;
      }
      return stream;
    },
  };
  assert.equal(await requestCameraStream({ mediaDevices, secureContext: true }), stream);
  assert.equal(constraints.length, 2);
  assert.deepEqual(constraints[1], { video: { facingMode: { ideal: "user" } }, audio: false });
});

test("permission failures from getUserMedia propagate to the visible error handler", async () => {
  const denied = new Error("permission denied");
  denied.name = "NotAllowedError";
  await assert.rejects(
    requestCameraStream({
      mediaDevices: { getUserMedia: async () => { throw denied; } },
      secureContext: true,
    }),
    (error) => error === denied,
  );
  assert.match(getCameraErrorMessage(denied), /permission was denied/i);
});

test("camera permission, missing device, and busy device errors are actionable", () => {
  assert.match(getCameraErrorMessage({ name: "NotAllowedError" }), /permission was denied/i);
  assert.match(getCameraErrorMessage({ name: "NotFoundError" }), /No camera was found/i);
  assert.match(getCameraErrorMessage({ name: "NotReadableError" }), /in use/i);
  assert.match(getCameraErrorMessage({ code: "insecure-context" }), /HTTPS or localhost/i);
});

test("stopping a stream stops every media track", () => {
  let stopped = 0;
  stopCameraStream({ getTracks: () => [{ stop: () => stopped++ }, { stop: () => stopped++ }] });
  assert.equal(stopped, 2);
});

test("admin registration saves the profile before opening its camera and capture waits for video readiness", async () => {
  const source = await readFile(adminPath, "utf8");
  const createIndex = source.indexOf("await createStudent(");
  const switchToSavedIndex = source.indexOf("setEditingStudent(savedStudent)");
  const faceStep = source.indexOf("REGISTER / REPLACE FACE", switchToSavedIndex);
  assert.ok(createIndex >= 0);
  assert.ok(switchToSavedIndex > createIndex);
  assert.ok(faceStep > switchToSavedIndex);
  assert.match(source, /savedStudentIdRef\.current = savedStudent\.id/);
  assert.match(source, /onClick=\{\(\)\s*=>\s*void startCamera\(cameraFacingMode, registrationStudentId\)/);
  assert.match(source, /disabled=\{!canStartFaceCamera\(/);
  assert.match(source, /Confirm face consent, then click Start Camera/);
  assert.match(source, /if \(!savedStudent\?\.id\)/);
  assert.match(source, /video\.srcObject = stream/);
  assert.match(source, /await video\.play\(\)/);
  assert.match(source, /video\.addEventListener\("loadeddata", markReady\)/);
  assert.match(source, /if \(!cameraReady\)/);
  assert.match(source, /stopCameraStream\(streamRef\.current\)/);
  assert.match(source, /mountedRef\.current = false/);
  assert.match(source, /cameraRequestIdRef\.current/);
  const createStage = source.slice(source.indexOf("if (isCreateMode) {", createIndex), faceStep);
  assert.doesNotMatch(createStage, /startCamera\(/);
  assert.match(createStage, /void loadStudents\(\)/);
  assert.match(createStage, /setModalMode\("edit"\)/);
});

test("face upload sends an explicit consent field and requires backend acknowledgement", async () => {
  const [service, backend] = await Promise.all([
    readFile(servicePath, "utf8"),
    readFile(backendPath, "utf8"),
  ]);
  assert.match(service, /formData\.append\("consent", "true"\)/);
  assert.match(backend, /consent: Annotated\[bool, Form\(\.\.\.\)\]/);
  assert.match(backend, /if not consent:/);
});
