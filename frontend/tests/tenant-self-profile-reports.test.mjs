import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Teacher and Student profile routes render API-backed self profile pages", async () => {
  const routes = await read("../src/routes/AppRoutes.jsx");
  const page = await read("../src/pages/ProfilePage.jsx");
  const teacherApi = await read("../src/services/teachers.js");
  const studentApi = await read("../src/services/attendance.js");
  assert.match(routes, /path="profile" element=\{<ProfilePage profileKind="teacher" \/>\}/);
  assert.match(routes, /path="profile" element=\{<ProfilePage profileKind="student" \/>\}/);
  assert.match(page, /getMyTeacherProfile/);
  assert.match(page, /getMyStudentProfile/);
  assert.match(page, /getApiErrorMessage/);
  assert.match(teacherApi, /\/teachers\/me\/profile/);
  assert.match(studentApi, /\/tenant\/face\/student\/profile/);
});

test("role reports read actual scoped attendance APIs and expose loading, error and empty states", async () => {
  const teacher = await read("../src/pages/teacher/TeacherReports.jsx");
  const student = await read("../src/pages/student/StudentReports.jsx");
  const routes = await read("../src/routes/AppRoutes.jsx");
  const layout = await read("../src/layouts/DashboardLayout.jsx");
  assert.match(routes, /path="reports"[\s\S]{0,100}<TeacherReports \/>/);
  assert.match(routes, /path="reports" element=\{<StudentReports \/>\}/);
  assert.match(layout, /path: "\/student\/reports"/);
  assert.match(teacher, /getTenantTeacherAttendanceSummary\(activeCollegeId, userId/);
  assert.match(teacher, /getTenantAttendanceSessions\(activeCollegeId, userId/);
  assert.match(teacher, /getTenantLiveAttendance\(selectedSession\.id, activeCollegeId\)/);
  assert.match(teacher, /No attendance sessions yet/);
  assert.match(teacher, /role="alert"/);
  assert.match(student, /getMyAttendance\(activeCollegeId\)/);
  assert.match(student, /No attendance data yet/);
  assert.match(student, /Export CSV/);
  assert.match(student, /dataStatus === "error"/);
});

test("profile and report APIs remain tied to active linked self identity", async () => {
  const teacher = await read("../../backend/app/api/tenant_teachers.py");
  const student = await read("../../backend/app/api/tenant_face.py");
  assert.match(teacher, /@router\.get\("\/me\/profile"[\s\S]*?context\.membership_role != "teacher"[\s\S]*?TeacherAccountLink\.user_id == context\.user_id[\s\S]*?TeacherAccountLink\.college_id == context\.college_id[\s\S]*?TeacherAccountLink\.link_status == "active"/);
  assert.match(student, /@router\.get\("\/student\/profile"[\s\S]*?_eligible_student_context\(db, current_user, college_id\)/);
  assert.doesNotMatch(student, /student_id: int = Query/);
});
