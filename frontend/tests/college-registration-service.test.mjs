import assert from "node:assert/strict";
import test from "node:test";

import api from "../src/services/api.js";
import {
  checkCollegeRegistrationStatus,
  submitCollegeRegistration,
} from "../src/services/collegeRegistration.js";

test("public registration and status requests explicitly suppress bearer-token attachment", async () => {
  const originalPost = api.post;
  const calls = [];
  api.post = async (...args) => {
    calls.push(args);
    return { data: { accepted: true } };
  };

  try {
    const registrationPayload = { college_name: "Synthetic College" };
    const statusPayload = { application_reference: "AXR-synthetic-reference", tracking_token: "synthetic-token" };
    assert.deepEqual(await submitCollegeRegistration(registrationPayload), { accepted: true });
    assert.deepEqual(await checkCollegeRegistrationStatus(statusPayload), { accepted: true });
    assert.deepEqual(calls, [
      ["/college-registration/applications", registrationPayload, { skipAuth: true }],
      ["/college-registration/status", statusPayload, { skipAuth: true }],
    ]);
  } finally {
    api.post = originalPost;
  }
});
