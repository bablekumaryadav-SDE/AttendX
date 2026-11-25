import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  closeAttendanceSession,
  createAttendanceSession,
  getAttendanceSessions,
  getLiveAttendance,
  getSessionQr,
  refreshSessionQr,
} from "../../services/attendance";

import {
  getClasses,
  getSubjects,
} from "../../services/teachers";

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
  return (
    error?.response?.data?.detail ||
    error?.message ||
    fallback
  );
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
  const [sessions, setSessions] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [classes, setClasses] = useState([]);

  const [form, setForm] = useState(
    getDefaultForm
  );

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

  /* =======================================================
     LOAD PAGE DATA
     ======================================================= */

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const [
        sessionData,
        subjectData,
        classData,
      ] = await Promise.all([
        getAttendanceSessions(),
        getSubjects(),
        getClasses(),
      ]);

      setSessions(
        Array.isArray(sessionData)
          ? sessionData
          : []
      );

      setSubjects(
        Array.isArray(subjectData)
          ? subjectData
          : []
      );

      setClasses(
        Array.isArray(classData)
          ? classData
          : []
      );
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to load attendance workspace."
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  /* =======================================================
     INITIAL LOAD
     ======================================================= */

  useEffect(() => {
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
        const rows = await getLiveAttendance(
          selectedSession.id
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
  }, [selectedSession]);

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

    setError("");
    setNotice("");

    if (!form.subject_id) {
      setError("Please select a subject.");
      return;
    }

    if (!form.class_id) {
      setError("Please select a class.");
      return;
    }

    if (!form.title.trim()) {
      setError(
        "Please enter an attendance session title."
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

    const radius = Number(form.radius_m);

    if (
      !Number.isFinite(radius) ||
      radius < 10 ||
      radius > 5000
    ) {
      setError(
        "Geo-fence radius must be between 10 and 5000 metres."
      );
      return;
    }

    try {
      setSaving(true);

      const payload = {
        subject_id: Number(
          form.subject_id
        ),

        class_id: Number(
          form.class_id
        ),

        title: form.title.trim(),

        starts_at:
          startDate.toISOString(),

        ends_at:
          endDate.toISOString(),

        latitude:
          form.latitude === ""
            ? null
            : Number(form.latitude),

        longitude:
          form.longitude === ""
            ? null
            : Number(form.longitude),

        radius_m: radius,
      };

      const created =
        await createAttendanceSession(
          payload
        );

      setNotice(
        "Attendance session created. Dynamic QR is ready."
      );

      setSelectedSession(created);

      setLiveRows([]);

      setForm(getDefaultForm());

      await load();

      /*
       * Generate first dynamic QR.
       */
      const qrData =
        await getSessionQr(
          created.id
        );

      setQr(qrData);
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
        await getSessionQr(
          session.id
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
        await refreshSessionQr(
          selectedSession.id
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

      await closeAttendanceSession(
        selectedSession.id
      );

      setNotice(
        "Attendance session closed successfully."
      );

      setQr(null);

      await load();

      const updatedSessions =
        await getAttendanceSessions();

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
     USE CURRENT LOCATION
     ======================================================= */

  const useCurrentLocation = () => {
    setError("");
    setNotice("");

    if (!navigator.geolocation) {
      setError(
        "Geolocation is not available in this browser."
      );

      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude =
          position.coords.latitude.toFixed(
            7
          );

        const longitude =
          position.coords.longitude.toFixed(
            7
          );

        setForm((current) => ({
          ...current,
          latitude,
          longitude,
        }));

        setNotice(
          "Classroom location captured. Geo-fence will be checked during attendance."
        );
      },
      (geoError) => {
        let message =
          "Location permission was denied. You can still create a session without a geo-fence.";

        if (
          geoError?.code ===
          geoError.PERMISSION_DENIED
        ) {
          message =
            "Location permission was denied. You can still create a session without a geo-fence.";
        } else if (
          geoError?.code ===
          geoError.POSITION_UNAVAILABLE
        ) {
          message =
            "Your current location is unavailable. You can still create a session without a geo-fence.";
        } else if (
          geoError?.code ===
          geoError.TIMEOUT
        ) {
          message =
            "Location request timed out. You can still create a session without a geo-fence.";
        }

        setError(message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  /* =======================================================
     RENDER
     ======================================================= */

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
            {/* SUBJECT */}

            <label>
              <span>
                Subject
              </span>

              <select
                value={
                  form.subject_id
                }
                onChange={(event) =>
                  updateForm(
                    "subject_id",
                    event.target.value
                  )
                }
                required
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

                      {subject.code
                        ? ` (${subject.code})`
                        : ""}
                    </option>
                  )
                )}
              </select>
            </label>

            {/* CLASS */}

            <label>
              <span>
                Class
              </span>

              <select
                value={
                  form.class_id
                }
                onChange={(event) =>
                  updateForm(
                    "class_id",
                    event.target.value
                  )
                }
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
                      {classItem.name}

                      {classItem.section
                        ? ` • ${classItem.section}`
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
                maxLength={255}
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

              <button
                type="button"
                className="secondary"
                onClick={
                  useCurrentLocation
                }
              >
                Use my location
              </button>
            </div>

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
                onChange={(event) =>
                  updateForm(
                    "radius_m",
                    event.target.value
                  )
                }
              />
            </label>

            {/* CREATE */}

            <div className="ta-form-actions full">
              <button
                className="primary"
                disabled={saving}
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

          <div className="live-layout">
            {/* =============================================
                QR PANEL
                ============================================= */}

            <div className="qr-panel">
              <div className="qr-placeholder">
                <div className="qr-pattern">
                  ▦
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