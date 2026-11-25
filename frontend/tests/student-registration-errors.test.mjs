import assert from "node:assert/strict";
import test from "node:test";

import { mapStudentRegistrationFailure, studentInvitationFailureMessage, studentStatusActionFailureMessage } from "../src/utils/studentRegistrationErrors.js";

test("structured duplicate errors attach only to the matching Student registration field", () => {
  const mapped = mapStudentRegistrationFailure({
    response: { status: 409, data: { detail: {
      code: "enrollment_number_already_used",
      field: "enrollment_number",
      message: "Enrollment number already exists in this College.",
    } } },
  });
  assert.deepEqual(mapped, {
    fieldErrors: { enrollment_number: "Enrollment number already exists in this College." },
    formError: "",
  });
});

test("Pydantic validation maps safe location/message fields and ignores input values", () => {
  const mapped = mapStudentRegistrationFailure({
    response: { status: 422, data: { detail: [
      { loc: ["body", "email"], msg: "Input should be a valid email address", input: "private-value@example.test" },
      { loc: ["body", "password"], msg: "Password confirmation does not match", input: "synthetic-sensitive-value" },
    ] } },
  });
  assert.equal(mapped.fieldErrors.email, "Input should be a valid email address");
  assert.equal(mapped.fieldErrors.password, "Password confirmation does not match");
  assert.equal(JSON.stringify(mapped).includes("private-value"), false);
  assert.equal(JSON.stringify(mapped).includes("synthetic-sensitive-value"), false);
});

test("unexpected server errors remain form-level and never render object details", () => {
  const mapped = mapStudentRegistrationFailure({
    response: { status: 503, data: { detail: "Student registration is temporarily unavailable." } },
  });
  assert.deepEqual(mapped, {
    fieldErrors: {},
    formError: "Student registration is temporarily unavailable.",
  });
});

test("generated Student ID collisions stay as form-level registration errors", () => {
  const mapped = mapStudentRegistrationFailure({
    response: { status: 409, data: { detail: {
      code: "student_code_collision",
      field: "student_code",
      message: "A generated Student ID conflicted with existing data. No account was created; retry registration.",
    } } },
  });
  assert.deepEqual(mapped, {
    fieldErrors: {},
    formError: "A generated Student ID conflicted with existing data. No account was created; retry registration.",
  });
});

test("invitation conflicts display the safe backend reason instead of an object or generic message", () => {
  assert.equal(studentInvitationFailureMessage({
    response: { status: 409, data: { detail: {
      code: "student_account_deactivated",
      message: "This Student account is deactivated and cannot receive a setup invitation.",
    } } },
  }), "This Student account is deactivated and cannot receive a setup invitation.");
  assert.equal(studentInvitationFailureMessage({
    response: { status: 409, data: { detail: "Legacy invitation conflict." } },
  }), "Legacy invitation conflict.");
  assert.equal(studentInvitationFailureMessage({
    response: { status: 503, data: { detail: { private: "ignored" } } },
  }), "Invitation service is temporarily unavailable. Try again later.");
});

test("Student activation and deactivation errors cover auth, tenant, conflict, validation and server statuses", () => {
  assert.match(studentStatusActionFailureMessage({ response: { status: 401 } }, "activated"), /session expired/i);
  assert.match(studentStatusActionFailureMessage({ response: { status: 403 } }, "deactivated"), /College Admin membership/i);
  assert.match(studentStatusActionFailureMessage({ response: { status: 404 } }, "activated"), /selected College/i);
  assert.match(studentStatusActionFailureMessage({ response: { status: 409 } }, "activated"), /conflicts with the current account or membership/i);
  assert.match(studentStatusActionFailureMessage({ response: { status: 422 } }, "deactivated"), /did not pass validation/i);
  assert.match(studentStatusActionFailureMessage({ response: { status: 500 } }, "activated"), /server could not complete/i);
  assert.equal(studentStatusActionFailureMessage({ response: { status: 409, data: { detail: "Membership is not eligible." } } }, "activated"), "Membership is not eligible.");
  assert.match(studentStatusActionFailureMessage(new Error("Network Error"), "deactivated"), /could not reach the server/i);
});
