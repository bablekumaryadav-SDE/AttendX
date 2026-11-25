import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "../../context/AuthContext";
import { getTenantCollegeProfile } from "../../services/tenant";
import { getFreshAttendanceLocation, haversineDistanceMeters, validateFreshAttendanceFix } from "../../utils/attendanceLocation";

import {
  closeTenantAttendanceSession,
  createTenantAttendanceSession,
  getTenantAttendanceSessions,
  getTenantLiveAttendance,
  getTenantSessionQr,
  getTenantTeacherAssignments,
  refreshTenantSessionQr,
} from "../../services/tenantAttendanceSessions";
import { getApiErrorMessage } from "../../utils/errors";
import LocationMap from "../../components/LocationMap";

import "./TeacherAttendance.css";

/* =========================================================
   HELPERS
   ========================================================= */

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset();
  const local = new Date(
    date.getTime() - offset * 60000
  );

  return local.toISOString().slice(0, 16);
}

function getDefaultForm() {
  const start = new Date();
  const end = new Date(
    start.getTime() + 55 * 60000
  );

  return {
    subject_id: "",
    class_id: "",
    title: "",
    starts_at: localDateTimeValue(start),
    ends_at: localDateTimeValue(end),
    latitude: "",
    longitude: "",
    radius_m: 100,
  };
}

function getErrorMessage(error, fallback) {
  return getApiErrorMessage(error, fallback);
}

function formatDateTime(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatTime(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/* =========================================================
   COMPONENT
   ========================================================= */

export default function TeacherAttendance() {
  const { user, activeCollegeId, collegeMemberships, membershipsLoading } = useAuth();
  const authenticatedUserId = user?.user_id ?? user?.id;
  const selectedCollegeMembership = (collegeMemberships || []).find(
    (membership) => String(membership.college_id) === String(activeCollegeId),
  );
  const selectedMembershipIsTeacher = selectedCollegeMembership?.membership_role === "teacher";
  const requestVersion = useRef(0);
  const [sessions, setSessions] = useState([]);
  const [assignments, setAssignments] = useState([]);

  const [form, setForm] = useState(
    getDefaultForm
  );
  const [locationVerificationMode, setLocationVerificationMode] = useState("gps_on");

  const [selectedSession, setSelectedSession] =
    useState(null);

  const [liveRows, setLiveRows] = useState([]);
  const [qr, setQr] = useState(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshingQr, setRefreshingQr] =
    useState(false);
  const [closing, setClosing] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [teacherLocationDiagnostic, setTeacherLocationDiagnostic] = useState(null);
  const [dataScope, setDataScope] = useState(null);

  /* =======================================================
     LOAD PAGE DATA
     ======================================================= */

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    const requestScope = `${authenticatedUserId ?? ""}:${activeCollegeId ?? ""}`;
    if (membershipsLoading) {
      setLoading(true);
      return;
    }
    if (!activeCollegeId) {
      setSessions([]);
      setAssignments([]);
      setSelectedSession(null);
      setLiveRows([]);
      setQr(null);
      setDataScope(null);
      setLoading(false);
      return;
    }
    if (!selectedMembershipIsTeacher) {
      setSessions([]);
      setAssignments([]);
      setSelectedSession(null);
      setLiveRows([]);
      setQr(null);
      setDataScope(null);
      setLoading(false);
      setError("The selected College membership is not a Teacher membership. Ask the College Admin to verify your account's Teacher membership.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [sessionResult, teacherResult] = await Promise.allSettled([
        getTenantAttendanceSessions(activeCollegeId),
        getTenantTeacherAssignments(activeCollegeId),
      ]);
      if (version !== requestVersion.current || requestScope !== `${authenticatedUserId ?? ""}:${activeCollegeId ?? ""}`) return;

      if (sessionResult.status === "fulfilled") {
        const data = sessionResult.value;
        const rows = Array.isArray(data) ? data : Array.isArray(data?.sessions) ? data.sessions : [];
        setSessions(rows.filter((item) => item && (item.id != null || item.session_id != null)));
      }

      if (teacherResult.status === "fulfilled") {
        setAssignments(Array.isArray(teacherResult.value) ? teacherResult.value : []);
      }
      setDataScope(requestScope);

      const failures = [];
      if (sessionResult.status === "rejected") {
        failures.push(getErrorMessage(sessionResult.reason, "Attendance sessions could not be loaded."));
      }
      if (teacherResult.status === "rejected") {
        failures.push(getErrorMessage(teacherResult.reason, "Teacher assignments could not be loaded."));
      }
      if (failures.length) setError(failures.join(" "));
    } catch (err) {
      if (version === requestVersion.current && requestScope === `${authenticatedUserId ?? ""}:${activeCollegeId ?? ""}`) {
        setError(getErrorMessage(err, "Teacher attendance could not be loaded."));
        setDataScope(requestScope);
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [activeCollegeId, authenticatedUserId, membershipsLoading, selectedMembershipIsTeacher]);

  const classes = useMemo(() => {
    const unique = new Map();
    assignments.filter((assignment) => assignment.is_active !== false).forEach((assignment) => {
      unique.set(assignment.class_id, {
        id: assignment.class_id,
        name: assignment.class_name,
        section: assignment.section,
        location_name: assignment.location_name,
        latitude: assignment.latitude,
        longitude: assignment.longitude,
        radius_m: assignment.radius_m,
      });
    });
    return [...unique.values()];
  }, [assignments]);

  const subjects = useMemo(() => assignments
    .filter((assignment) => assignment.is_active !== false)
    .filter((assignment) => String(assignment.class_id) === String(form.class_id))
    .map((assignment) => ({
      id: assignment.subject_id,
      name: assignment.subject_name,
      code: assignment.subject_code,
      semester: assignment.semester,
      academicYear: assignment.academic_year,
    }))
    .filter((subject, index, list) => list.findIndex((item) => String(item.id) === String(subject.id)) === index),
  [assignments, form.class_id]);

  const selectedClass = useMemo(
    () => classes.find((item) => String(item.id) === String(form.class_id)) || null,
    [classes, form.class_id],
  );
  const classLocationConfigured = (() => {
    const latitude = selectedClass?.latitude;
    const longitude = selectedClass?.longitude;
    const radius = Number(selectedClass?.radius_m);
    return latitude != null
      && longitude != null
      && Number.isFinite(Number(latitude))
      && Number.isFinite(Number(longitude))
      && Number(latitude) >= -90
      && Number(latitude) <= 90
      && Number(longitude) >= -180
      && Number(longitude) <= 180
      && Number.isFinite(radius)
      && radius > 0;
  })();

  const selectedAssignmentIsValid = assignments.some((assignment) =>
    assignment.is_active !== false
    && String(assignment.class_id) === String(form.class_id)
    && String(assignment.subject_id) === String(form.subject_id)
  );

  /* =======================================================
     INITIAL LOAD
     ======================================================= */

  useLayoutEffect(() => {
    setSessions([]);
    setAssignments([]);
    setSelectedSession(null);
    setLiveRows([]);
    setQr(null);
    setDataScope(null);
    setLoading(true);
    load();
  }, [load]);

  /* =======================================================
     LIVE ATTENDANCE POLLING
     ======================================================= */

  useEffect(() => {
    if (!selectedSession?.id) {
      setLiveRows([]);
      return undefined;
    }

    let active = true;

    const poll = async () => {
      try {
        const rows = await getTenantLiveAttendance(
          selectedSession.id,
          activeCollegeId,
        );

        if (!active) {
          return;
        }

        setLiveRows(
          Array.isArray(rows)
            ? rows
            : []
        );
      } catch (err) {
        if (!active) {
          return;
        }

        setError(
          getErrorMessage(
            err,
            "Unable to refresh live attendance."
          )
        );
      }
    };

    poll();

    const timer = window.setInterval(
      poll,
      5000
    );

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedSession, activeCollegeId, authenticatedUserId]);

  /* =======================================================
     DERIVED COUNTS
     ======================================================= */

  const presentCount = useMemo(() => {
    return liveRows.filter(
      (row) =>
        row.status === "present" ||
        row.status === "late"
    ).length;
  }, [liveRows]);

  const absentCount = useMemo(() => {
    return liveRows.filter(
      (row) => row.status === "absent"
    ).length;
  }, [liveRows]);

  const totalLiveCount = liveRows.length;

  /* =======================================================
     FORM HANDLER
     ======================================================= */

  const updateForm = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  /* =======================================================
     CREATE ATTENDANCE SESSION
     ======================================================= */

  const handleCreate = async (event) => {
    event.preventDefault();
    if (saving) return;

    setError("");
    setNotice("");
    setTeacherLocationDiagnostic(null);

    if (!form.class_id) {
      setError("Please select a class.");
      return;
    }

    if (!form.subject_id || !selectedAssignmentIsValid) {
      setError("Select a subject assigned to the selected class.");
      return;
    }

    if (locationVerificationMode === "gps_on" && !classLocationConfigured) {
      setError("The College Admin must configure valid classroom coordinates and a positive geofence radius for this class before a lecture can start.");
      return;
    }

    if (form.title.trim().length < 2) {
      setError(
        "Session title must contain at least 2 characters."
      );
      return;
    }

    const startDate = new Date(
      form.starts_at
    );

    const endDate = new Date(
      form.ends_at
    );

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime())
    ) {
      setError(
        "Please provide valid start and end times."
      );
      return;
    }

    if (endDate <= startDate) {
      setError(
        "Session end time must be after the start time."
      );
      return;
    }

    const radius = Number(selectedClass?.radius_m ?? 100);

    if (locationVerificationMode === "gps_on" && (
      !Number.isFinite(radius) ||
      radius < 10 ||
      radius > 5000
    )) {
      setError(
        "Geo-fence radius must be between 10 and 5000 metres."
      );
      return;
    }



    try {
      setSaving(true);
      const collegeId = Number(activeCollegeId);
      const classId = Number(form.class_id);
      const subjectId = Number(form.subject_id);
      if (![collegeId, classId, subjectId].every((value) => Number.isSafeInteger(value) && value > 0)) {
        throw new Error("The selected College, Class, or Subject is no longer valid. Refresh assignments and retry.");
      }

      let teacherFix = null;
      if (locationVerificationMode === "gps_on") {
        const collegeProfile = await getTenantCollegeProfile(activeCollegeId);
        const accuracyLimit = Number(collegeProfile?.gps_accuracy_limit_m);
        if (!Number.isInteger(accuracyLimit) || accuracyLimit < 1 || accuracyLimit > 150) {
          throw new Error("College GPS accuracy setting is unavailable or invalid. Contact your College Admin.");
        }
        const capturedFix = await getFreshAttendanceLocation(
          navigator.geolocation,
          accuracyLimit,
          { requireStableFix: true },
        );
        teacherFix = validateFreshAttendanceFix(capturedFix, accuracyLimit);
        setTeacherLocationDiagnostic({
          className: selectedClass.name,
          locationName: selectedClass.location_name,
          classLatitude: Number(selectedClass.latitude),
          classLongitude: Number(selectedClass.longitude),
          radiusM: radius,
          teacherLatitude: teacherFix.latitude,
          teacherLongitude: teacherFix.longitude,
          accuracyM: teacherFix.accuracy,
          distanceM: haversineDistanceMeters(
            selectedClass.latitude,
            selectedClass.longitude,
            teacherFix.latitude,
            teacherFix.longitude,
          ),
        });
      }

      const payload = {
        subject_id: subjectId,

        class_id: classId,

        title: form.title.trim(),

        starts_at:
          startDate.toISOString(),

        ends_at:
          endDate.toISOString(),
        location_verification_mode: locationVerificationMode,
        ...(locationVerificationMode === "gps_on" ? {
          radius_m: radius,
          teacher_latitude: teacherFix.latitude,
          teacher_longitude: teacherFix.longitude,
          teacher_accuracy_m: teacherFix.accuracy,
        } : {}),
      };

      const created =
        await createTenantAttendanceSession(
          payload,
          collegeId,
        );

      const session = created?.session || created;
      const sessionId = session?.id ?? session?.session_id;
      if (!sessionId || !Number.isFinite(Number(sessionId))) {
        throw new Error("The server created a response without a valid session ID. Refresh the session list before retrying.");
      }
      const expectedLocationStatus = locationVerificationMode === "gps_on" ? "verified" : "not_verified";
      if (session.location_verification_status !== expectedLocationStatus) {
        throw new Error("The server did not confirm the requested location-verification status. Refresh sessions and contact your administrator before retrying.");
      }
      const usableSession = { ...session, id: Number(sessionId) };

      setNotice("Attendance session created. Loading its QR code…");
      setSelectedSession(usableSession);
      setSessions((current) => [
        usableSession,
        ...current.filter((item) => Number(item.id ?? item.session_id) !== Number(sessionId)),
      ]);

      setLiveRows([]);
      setQr(null);

      setForm(getDefaultForm());

      void load();

      try {
        const qrData = await getTenantSessionQr(usableSession.id, activeCollegeId);
        setQr(qrData);
        setNotice("Attendance session created. Dynamic QR is ready.");
      } catch (qrError) {
        setError(`Session created, but its QR could not be loaded. Use Refresh QR to retry. ${getErrorMessage(qrError, "")}`.trim());
        setNotice("Attendance session is active.");
      }
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to create attendance session."
        )
      );
    } finally {
      setSaving(false);
    }
  };

  /* =======================================================
     OPEN EXISTING SESSION
     ======================================================= */

  const openSession = async (session) => {
    try {
      setError("");
      setNotice("");

      setSelectedSession(session);
      setLiveRows([]);
      setQr(null);

      const data =
        await getTenantSessionQr(
          session.id,
          activeCollegeId,
        );

      setQr(data);
    } catch (err) {
      setQr(null);

      setError(
        getErrorMessage(
          err,
          "Unable to generate session QR."
        )
      );
    }
  };

  /* =======================================================
     REFRESH DYNAMIC QR
     ======================================================= */

  const refreshQr = async () => {
    if (!selectedSession?.id) {
      return;
    }

    try {
      setRefreshingQr(true);
      setError("");
      setNotice("");

      const data =
        await refreshTenantSessionQr(
          selectedSession.id,
          activeCollegeId,
        );

      setQr(data);

      setNotice(
        "QR token refreshed. The previous token is no longer valid."
      );
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to refresh QR."
        )
      );
    } finally {
      setRefreshingQr(false);
    }
  };

  /* =======================================================
     CLOSE SESSION
     ======================================================= */

  const closeSession = async () => {
    if (!selectedSession?.id) {
      return;
    }

    const confirmed =
      window.confirm(
        "Close this attendance session? Students will no longer be able to submit attendance to this session."
      );

    if (!confirmed) {
      return;
    }

    try {
      setClosing(true);
      setError("");
      setNotice("");

      await closeTenantAttendanceSession(
        selectedSession.id,
        activeCollegeId,
      );

      setNotice(
        "Attendance session closed successfully."
      );

      setQr(null);

      await load();

      const updatedSessions =
        await getTenantAttendanceSessions(activeCollegeId);

      const updated =
        Array.isArray(updatedSessions)
          ? updatedSessions.find(
              (item) =>
                item.id ===
                selectedSession.id
            )
          : null;

      setSelectedSession(
        updated || {
          ...selectedSession,
          status: "closed",
        }
      );
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to close attendance session."
        )
      );
    } finally {
      setClosing(false);
    }
  };

  /* =======================================================
     RENDER
     ======================================================= */

  if (!activeCollegeId || dataScope !== `${authenticatedUserId ?? ""}:${activeCollegeId ?? ""}`) {
    return (
      <main className="teacher-attendance-page">
        <div className="ta-alert" role={membershipsLoading || (activeCollegeId && selectedMembershipIsTeacher) ? "status" : "alert"}>
          {membershipsLoading
            ? "Checking your College memberships…"
            : !activeCollegeId
            ? "Select an active College membership to use attendance sessions."
            : !selectedMembershipIsTeacher
              ? "The selected College membership is not a Teacher membership. Ask the College Admin to verify your account's Teacher membership."
              : "Loading the selected College attendance workspace…"}
        </div>
      </main>
    );
  }

  return (
    <div className="teacher-attendance-page">
      {/* =================================================
          HEADER
          ================================================= */}

      <header className="ta-header">
        <div>
          <div className="ta-eyebrow">
            TEACHER OPERATIONS
          </div>

          <h1>
            Attendance Sessions
          </h1>

          <p>
            Create a verified class session,
            publish a short-lived QR and
            monitor attendance live.
          </p>
        </div>

        <div className="ta-live-chip">
          <span />
          LIVE OPERATIONS
        </div>
      </header>

      {/* =================================================
          ALERTS
          ================================================= */}

      {error && (
        <div
          className="ta-alert error"
          role="alert"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          className="ta-alert success"
          role="status"
        >
          {notice}
        </div>
      )}

      {!loading && !error && classes.length === 0 && (
        <div className="ta-alert" role="status">
          No active Class and Subject assignments are available. Ask your College Admin to assign an active Class and Subject before starting attendance.
        </div>
      )}

      {/* =================================================
          CREATE + SESSION LIST
          ================================================= */}

      <div className="ta-grid">
        {/* ===============================================
            CREATE SESSION
            =============================================== */}

        <section className="ta-card create-card">
          <div className="ta-card-heading">
            <div>
              <span>01</span>

              <h2>
                Create Session
              </h2>
            </div>
          </div>

          <form
            onSubmit={handleCreate}
            className="ta-form"
          >
            {/* CLASS */}

            <label>
              <span>
                Class
              </span>

              <select
                value={form.class_id}
                onChange={(event) => {
                  setTeacherLocationDiagnostic(null);
                  setForm((current) => {
                    const selectedClass = classes.find((item) => String(item.id) === event.target.value);
                    return {
                      ...current,
                      class_id: event.target.value,
                      subject_id: "",
                      latitude: selectedClass?.latitude == null ? "" : String(selectedClass.latitude),
                      longitude: selectedClass?.longitude == null ? "" : String(selectedClass.longitude),
                      radius_m: selectedClass?.radius_m == null ? 100 : Number(selectedClass.radius_m),
                    };
                  });
                }}
                required
              >
                <option value="">
                  Select class
                </option>

                {classes.map(
                  (classItem) => (
                    <option
                      key={
                        classItem.id
                      }
                      value={
                        classItem.id
                      }
                    >
                      {classItem.name}{classItem.section ? ` · ${classItem.section}` : ""}

                    </option>
                  )
                )}
              </select>
            </label>

            {form.class_id && !loading && subjects.length === 0 && (
              <div className="ta-alert full" role="status">
                No active Subject is assigned to this Class. Ask your College Admin to review the Teacher assignment.
              </div>
            )}

            {/* SUBJECT */}

            <label>
              <span>
                Subject
              </span>

              <select
                value={form.subject_id}
                onChange={(event) =>
                  setForm((current) => ({ ...current, subject_id: event.target.value }))
                }
                required
                disabled={!form.class_id || subjects.length === 0}
              >
                <option value="">
                  Select subject
                </option>

                {subjects.map(
                  (subject) => (
                    <option
                      key={
                        subject.id
                      }
                      value={
                        subject.id
                      }
                    >
                      {subject.name}
                      {subject.code ? ` (${subject.code})` : ""}
                      {subject.semester != null ? ` · Semester ${subject.semester}` : ""}
                      {subject.academicYear ? ` · ${subject.academicYear}` : ""}

                      {selectedClass?.section
                        ? ` · ${selectedClass.section}`
                        : ""}
                    </option>
                  )
                )}
              </select>
            </label>

            {/* SESSION TITLE */}

            <label className="full">
              <span>
                Session title
              </span>

              <input
                type="text"
                value={
                  form.title
                }
                onChange={(event) =>
                  updateForm(
                    "title",
                    event.target.value
                  )
                }
                placeholder="e.g. Data Structures — Lecture 12"
                minLength={2}
                maxLength={180}
                required
              />
            </label>

            {/* START */}

            <label>
              <span>
                Starts
              </span>

              <input
                type="datetime-local"
                value={
                  form.starts_at
                }
                onChange={(event) =>
                  updateForm(
                    "starts_at",
                    event.target.value
                  )
                }
                required
              />
            </label>

            {/* END */}

            <label>
              <span>
                Ends
              </span>

              <input
                type="datetime-local"
                value={
                  form.ends_at
                }
                onChange={(event) =>
                  updateForm(
                    "ends_at",
                    event.target.value
                  )
                }
                required
              />
            </label>

            <fieldset className="ta-location-verification full" disabled={saving}>
              <legend>GPS Verification: {locationVerificationMode === "gps_on" ? "ON" : "OFF"}</legend>
              <label>
                <input
                  type="radio"
                  name="location-verification-mode"
                  value="gps_on"
                  checked={locationVerificationMode === "gps_on"}
                  onChange={() => setLocationVerificationMode("gps_on")}
                />
                GPS Verification: ON (verify classroom presence)
              </label>
              <label>
                <input
                  type="radio"
                  name="location-verification-mode"
                  value="gps_off"
                  checked={locationVerificationMode === "gps_off"}
                  onChange={() => setLocationVerificationMode("gps_off")}
                />
                GPS Verification: OFF (start without location check)
              </label>
              {locationVerificationMode === "gps_off" && (
                <p role="status">Location verification is OFF. Classroom presence has not been verified. Student face matching and all session, membership, assignment, and duplicate-attendance checks remain required. QR attendance still requires GPS.</p>
              )}
            </fieldset>

            {/* GEO-FENCE */}

            <div className="location-row full">
              <div>
                <strong>
                  Geo-fence
                </strong>

                <span>
                  {form.latitude &&
                  form.longitude
                    ? `${form.latitude}, ${form.longitude}`
                    : "Not configured"}
                </span>
              </div>

              <span role="status">
                {locationVerificationMode === "gps_off"
                  ? "GPS verification will not run for this session"
                  : classLocationConfigured ? "Configured by College Admin" : "College Admin setup required"}
              </span>
            </div>
            {teacherLocationDiagnostic && <div className="ta-location-diagnostic full" role="status">
              <strong>Location check details (distance estimate is informational; server validation is authoritative)</strong>
              <span>Selected Class: {teacherLocationDiagnostic.className}{teacherLocationDiagnostic.locationName ? ` · ${teacherLocationDiagnostic.locationName}` : ""}</span>
              <span>Saved classroom point: {teacherLocationDiagnostic.classLatitude.toFixed(6)}, {teacherLocationDiagnostic.classLongitude.toFixed(6)} · Radius {teacherLocationDiagnostic.radiusM} m</span>
              <span>Fresh Teacher device fix: {teacherLocationDiagnostic.teacherLatitude.toFixed(6)}, {teacherLocationDiagnostic.teacherLongitude.toFixed(6)} · Reported accuracy ±{teacherLocationDiagnostic.accuracyM.toFixed(1)} m</span>
              <span>Estimated distance to saved classroom point: {teacherLocationDiagnostic.distanceM == null ? "unavailable" : `${teacherLocationDiagnostic.distanceM.toFixed(1)} m`}</span>
            </div>}

            {/* RADIUS */}

            <label>
              <span>
                Radius (metres)
              </span>

              <input
                type="number"
                min="10"
                max="5000"
                step="1"
                value={
                  form.radius_m
                }
                disabled
                onChange={(event) =>
                  updateForm(
                    "radius_m",
                    event.target.value
                  )
                }
              />
              <small>{locationVerificationMode === "gps_off"
                ? "The saved College Admin radius remains authoritative for QR attendance. GPS-off sessions do not verify the Teacher's classroom presence."
                : classLocationConfigured
                ? "The College Admin configured this classroom location and radius; they will be used for this session."
                : "Ask the College Admin to configure valid classroom coordinates and a geofence radius before starting a lecture."}</small>
            </label>

            <div className="full ta-session-location-map">
              <LocationMap
                latitude={form.latitude === "" ? null : Number(form.latitude)}
                longitude={form.longitude === "" ? null : Number(form.longitude)}
                radiusM={Number(form.radius_m) || 100}
                locationName={classes.find((item) => String(item.id) === String(form.class_id))?.location_name || "Classroom"}
              />
              <small>Configured classroom GIS location and attendance boundary. This map does not verify the Teacher when GPS is off; QR attendance still checks GPS on the server.</small>
            </div>

            {/* CREATE */}

            <div className="ta-form-actions full">
              <button
                className="primary"
                disabled={saving || !selectedAssignmentIsValid}
                type="submit"
              >
                {saving
                  ? "Creating…"
                  : "Create Attendance Session"}
              </button>
            </div>
          </form>
        </section>

        {/* ===============================================
            SESSION LIST
            =============================================== */}

        <section className="ta-card session-card">
          <div className="ta-card-heading">
            <div>
              <span>02</span>

              <h2>
                Sessions
              </h2>
            </div>

            <small>
              {sessions.length}{" "}
              recorded
            </small>
          </div>

          {loading ? (
            <div className="ta-empty">
              Loading sessions…
            </div>
          ) : sessions.length ===
            0 ? (
            <div className="ta-empty">
              No attendance sessions
              yet.
            </div>
          ) : (
            <div className="session-list">
              {sessions.map(
                (session) => (
                  <button
                    key={
                      session.id
                    }
                    type="button"
                    className={`session-item ${
                      selectedSession?.id ===
                      session.id
                        ? "selected"
                        : ""
                    }`}
                    onClick={() =>
                      openSession(
                        session
                      )
                    }
                  >
                    <div>
                      <strong>
                        {session.title ||
                          `Session #${session.id}`}
                      </strong>

                      <span>
                        {session.subject_name ||
                          `Subject #${session.subject_id}`}

                        {" · "}

                        {session.class_name ||
                          `Class #${session.class_id}`}
                      </span>

                      {session.starts_at && (
                        <small>
                          {formatDateTime(
                            session.starts_at
                          )}
                        </small>
                      )}
                      <small className={`location-verification-status ${session.location_verification_status || "unknown"}`}>
                        {session.location_verification_status === "verified"
                          ? "Location verified"
                          : session.location_verification_status === "not_verified"
                            ? "Location not verified"
                            : "Location status unavailable"}
                      </small>
                    </div>

                    <em
                      className={
                        session.status ||
                        "unknown"
                      }
                    >
                      {session.status ||
                        "unknown"}
                    </em>
                  </button>
                )
              )}
            </div>
          )}
        </section>
      </div>

      {/* =================================================
          LIVE ATTENDANCE
          ================================================= */}

      {selectedSession && (
        <section className="ta-card live-card">
          <div className="ta-card-heading">
            <div>
              <span>03</span>

              <h2>
                Live Attendance
              </h2>
            </div>

            <div className="live-count">
              <strong>
                {presentCount}
              </strong>

              <span>
                verified
              </span>
            </div>
          </div>

          {/* LIVE SUMMARY */}

          <div className="ta-live-summary">
            <div>
              <span>
                Total events
              </span>

              <strong>
                {totalLiveCount}
              </strong>
            </div>

            <div>
              <span>
                Present / Late
              </span>

              <strong>
                {presentCount}
              </strong>
            </div>

            <div>
              <span>
                Absent
              </span>

              <strong>
                {absentCount}
              </strong>
            </div>

            <div>
              <span>
                Session
              </span>

              <strong>
                {selectedSession.status ||
                  "unknown"}
              </strong>
            </div>
          </div>

          <p className={`ta-location-verification-result ${selectedSession.location_verification_status || "unknown"}`} role="status">
            {selectedSession.location_verification_status === "verified"
              ? "Teacher classroom location was verified when this session started."
              : selectedSession.location_verification_status === "not_verified"
                ? "Teacher classroom location was not verified when this session started."
                : "Teacher location-verification status is unavailable for this session."}
          </p>

          <div className="ta-session-location-map">
            <LocationMap
              latitude={selectedSession.latitude}
              longitude={selectedSession.longitude}
              radiusM={Number(selectedSession.radius_m) || 100}
              locationName={selectedSession.location_name || selectedSession.class_name || "Classroom"}
            />
            <small>Map is informational. Attendance is decided by server-side GPS and geofence validation.</small>
          </div>

          <div className="live-layout">
            {/* =============================================
                QR PANEL
                ============================================= */}

            <div className="qr-panel">
              <div className="qr-placeholder">
                <div className="qr-code-surface">
                  {qr?.token ? (
                    <QRCodeSVG
                      value={qr.token}
                      size={160}
                      bgColor="#ffffff"
                      fgColor="#101828"
                      level="M"
                      title="Dynamic attendance QR code"
                    />
                  ) : (
                    <span>QR token unavailable</span>
                  )}
                </div>

                <strong>
                  Dynamic QR
                </strong>

                <span>
                  Expires every 60 seconds
                </span>
              </div>

              {qr ? (
                <>
                  <code className="qr-token">
                    {qr.token ||
                      "QR token unavailable"}
                  </code>

                  <div className="qr-meta">
                    {qr.ttl_seconds !=
                    null
                      ? `Valid for about ${qr.ttl_seconds}s`
                      : "Dynamic token generated"}
                  </div>
                </>
              ) : (
                <div className="qr-meta">
                  QR token is not loaded.
                </div>
              )}

              <div className="qr-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={refreshQr}
                  disabled={
                    refreshingQr ||
                    selectedSession.status ===
                      "closed"
                  }
                >
                  {refreshingQr
                    ? "Refreshing…"
                    : "Refresh QR"}
                </button>

                {selectedSession.status ===
                  "active" && (
                  <button
                    type="button"
                    className="danger"
                    onClick={
                      closeSession
                    }
                    disabled={closing}
                  >
                    {closing
                      ? "Closing…"
                      : "Close Session"}
                  </button>
                )}
              </div>
            </div>

            {/* =============================================
                LIVE TABLE
                ============================================= */}

            <div className="attendance-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      Student
                    </th>

                    <th>
                      Roll
                    </th>

                    <th>
                      Status
                    </th>

                    <th>
                      Method
                    </th>

                    <th>
                      Verified
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {liveRows.length ===
                  0 ? (
                    <tr>
                      <td
                        colSpan="5"
                        className="table-empty"
                      >
                        Waiting for
                        attendance
                        events…
                      </td>
                    </tr>
                  ) : (
                    liveRows.map(
                      (row, index) => (
                        <tr
                          key={`${row.student_id}-${row.verified_at || index}`}
                        >
                          <td>
                            <strong>
                              {row.name ||
                                "Unknown student"}
                            </strong>

                            <small>
                              {row.student_code ||
                                "—"}
                            </small>
                          </td>

                          <td>
                            {row.roll_number ||
                              "—"}
                          </td>

                          <td>
                            <span
                              className={`status ${
                                row.status ||
                                "unknown"
                              }`}
                            >
                              {row.status ||
                                "unknown"}
                            </span>
                          </td>

                          <td>
                            {row.method ||
                              "—"}
                          </td>

                          <td>
                            {formatTime(
                              row.verified_at
                            )}
                          </td>
                        </tr>
                      )
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
