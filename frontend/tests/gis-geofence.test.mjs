import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mapPath = new URL("../src/components/LocationMap.jsx", import.meta.url);
const adminClassesPath = new URL("../src/pages/auth/admin/Classes.jsx", import.meta.url);
const teacherPath = new URL("../src/pages/teacher/TeacherAttendance.jsx", import.meta.url);
const studentPath = new URL("../src/pages/student/StudentAttendance.jsx", import.meta.url);
const dashboardPath = new URL("../src/pages/student/StudentDashboard.jsx", import.meta.url);
const attendanceServicePath = new URL("../src/services/attendance.js", import.meta.url);

test("classroom map shows a radius circle and treats null coordinates as unconfigured", async () => {
  const source = await readFile(mapPath, "utf8");
  assert.match(source, /isValidCoordinatePair\(latitude, longitude\)/);
  assert.match(source, /L\.circle\(point,[\s\S]*?radius: effectiveRadius/);
  assert.match(source, /!hasCoordinates &&/);
  assert.match(source, /radiusM == null \? 100 : Number\(radiusM\)/);
  assert.match(source, /tileLayer\("https:\/\/\{s\}\.tile\.openstreetmap\.org/);
  assert.match(source, /openstreetmap\.org\/copyright/);
});

test("admin Classes management configures the authoritative geofence and Teacher explains GPS-off limits", async () => {
  const [admin, teacher] = await Promise.all([
    readFile(adminClassesPath, "utf8"),
    readFile(teacherPath, "utf8"),
  ]);
  assert.match(admin, /membership\.membership_role === "college_admin"/);
  assert.match(admin, /name="latitude"|Latitude/);
  assert.match(admin, /name="longitude"|Longitude/);
  assert.match(admin, /name="radius_m"|Geofence radius/);
  assert.match(admin, /activeCollegeId/);
  assert.match(teacher, /assignment\.location_name/);
  assert.match(teacher, /selectedSession\.latitude/);
  assert.match(teacher, /This map does not verify the Teacher when GPS is off/);
  assert.match(teacher, /QR attendance still checks GPS on the server/);
});

test("QR attendance sends measured GPS while face-only attendance does not require student GPS", async () => {
  const [student, dashboard, service] = await Promise.all([
    readFile(studentPath, "utf8"),
    readFile(dashboardPath, "utf8"),
    readFile(attendanceServicePath, "utf8"),
  ]);
  assert.match(student, /accuracy_m:\s*coordinates\?\.accuracy/);
  assert.match(student, /submitStudentFaceAttendance\(sessionId, capture, null, activeCollegeId\)/);
  assert.match(dashboard, /submitStudentFaceAttendance\(selectedAttendanceSession\.id, capture\.file, null, activeCollegeId\)/);
  assert.match(dashboard, /getFreshAttendanceLocation\(undefined, profile\.gps_accuracy_limit_m\)/);
  assert.match(service, /formData\.append\("accuracy_m", String\(coordinates\.accuracy\)\)/);
  const faceApi = await readFile(new URL("../../backend/app/api/tenant_face.py", import.meta.url), "utf8");
  assert.match(faceApi, /if method == "qr":[\s\S]*?College\.gps_accuracy_limit_m[\s\S]*?else:\s*# Face attendance relies on registered face verification, not student GPS\./);
});

test("student UI reports denied or unavailable location permissions", async () => {
  const [student, dashboard] = await Promise.all([
    readFile(studentPath, "utf8"),
    readFile(dashboardPath, "utf8"),
  ]);
  assert.match(dashboard, /getFreshAttendanceLocation\(undefined, profile\.gps_accuracy_limit_m\)/);
  const location = await readFile(new URL("../src/utils/attendanceLocation.js", import.meta.url), "utf8");
  assert.match(location, /Location permission was denied/);
  assert.match(location, /could not determine the current location/);
  assert.match(location, /timed out/);
});

test("accuracy uses the College setting while geofence distance remains independently enforced", async () => {
  const [location, backend, tenantFace] = await Promise.all([
    readFile(new URL("../src/utils/attendanceLocation.js", import.meta.url), "utf8"),
    readFile(new URL("../../backend/app/services/attendance_core.py", import.meta.url), "utf8"),
    readFile(new URL("../../backend/app/api/tenant_face.py", import.meta.url), "utf8"),
  ]);
  assert.match(location, /accuracy > limit/);
  assert.match(location, /accuracy\.toFixed\(1\)/);
  assert.match(location, /maximumAge: 0/);
  assert.match(backend, /accuracy_m > accuracy_limit_m/);
  assert.match(tenantFace, /College\.gps_accuracy_limit_m/);
  assert.match(backend, /haversine_m/);
});
