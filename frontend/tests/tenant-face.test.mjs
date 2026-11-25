import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import api from "../src/services/api.js";
import {
  getActiveStudentSessions,
  getMyAttendance,
  getMyFaceStatus,
  registerMyFace,
  submitStudentFaceAttendance,
  submitStudentQrAttendance,
} from "../src/services/attendance.js";

test("Student face and attendance services send the AuthContext College explicitly", async () => {
  const calls = [];
  const oldAdapter = api.defaults.adapter;
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => key === "attendx_token" ? "synthetic-token" : null };
  api.defaults.adapter = async (config) => {
    calls.push({ method: config.method, url: config.url, params: config.params, headers: config.headers, data: config.data });
    return { data: { ok: true }, status: 200, statusText: "OK", headers: {}, config };
  };
  try {
    const file = new Blob(["synthetic image"], { type: "image/jpeg" });
    await getMyFaceStatus(81);
    await registerMyFace(file, 81, true);
    await getActiveStudentSessions(82);
    await getMyAttendance(82);
    await submitStudentQrAttendance(1, { token: "synthetic-qr-token" }, 83);
    await submitStudentFaceAttendance(1, file, null, 84);
    assert.deepEqual(calls.map(({ method, url, params }) => ({ method, url, params })), [
      { method: "get", url: "/tenant/face/me", params: { college_id: 81 } },
      { method: "post", url: "/tenant/face/me/register", params: { college_id: 81 } },
      { method: "get", url: "/tenant/face/student/sessions", params: { college_id: 82 } },
      { method: "get", url: "/tenant/face/student/attendance", params: { college_id: 82 } },
      { method: "post", url: "/tenant/face/student/sessions/1/qr", params: { college_id: 83 } },
      { method: "post", url: "/tenant/face/student/sessions/1/face", params: { college_id: 84 } },
    ]);
    assert.match(String(calls[1].headers["Content-Type"] || calls[1].headers["content-type"]), /multipart\/form-data/i);
    const serviceSource = await readFile(new URL("../src/services/attendance.js", import.meta.url), "utf8");
    assert.match(serviceSource, /formData\.append\("consent", consent \? "true" : "false"\)/);
    await assert.rejects(getMyFaceStatus(null), /Select an active College/);
    await assert.rejects(getActiveStudentSessions(null), /Select an active College/);
    assert.equal(calls.length, 6);
  } finally {
    api.defaults.adapter = oldAdapter;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});
