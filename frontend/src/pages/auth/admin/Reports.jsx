import React, {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getAttendanceSessions,
} from "../../services/attendance";
import {
  getAnalyticsOverview,
  getLowAttendance,
} from "../../services/dashboard";
import "./Reports.css";

function csvDownload(rows) {
  if (!rows.length) return;

  const headers = [
    "student_code",
    "name",
    "roll_number",
    "present_count",
    "total_count",
    "attendance_percentage",
  ];

  const lines = [headers.join(",")];

  rows.forEach((row) => {
    lines.push(
      headers
        .map(
          (header) =>
            `"${String(
              row[header] ?? ""
            ).replaceAll('"', '""')}"`
        )
        .join(",")
    );
  });

  const blob = new Blob(
    [lines.join("\n")],
    {
      type: "text/csv;charset=utf-8",
    }
  );

  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download =
    "attendx-low-attendance-report.csv";

  anchor.click();

  URL.revokeObjectURL(url);
}

export default function Reports() {
  const [overview, setOverview] = useState(null);
  const [low, setLow] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [threshold, setThreshold] = useState(75);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");

    try {
      const [
        overviewData,
        lowData,
        sessionData,
      ] = await Promise.all([
        getAnalyticsOverview(),
        getLowAttendance(threshold),
        getAttendanceSessions(),
      ]);

      setOverview(overviewData || null);

      setLow(
        Array.isArray(lowData)
          ? lowData
          : []
      );

      setSessions(
        Array.isArray(sessionData)
          ? sessionData
          : []
      );
    } catch (e) {
      setError(
        e?.response?.data?.detail ||
          "Unable to load report data."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [threshold]);

  const active = useMemo(
    () =>
      sessions.filter(
        (s) => s.status === "active"
      ).length,
    [sessions]
  );

  return (
    <div className="reports-page">
      <header className="reports-header">
        <div>
          <span>
            REPORTING & ANALYTICS
          </span>

          <h1>AttendX Reports</h1>

          <p>
            Live database-backed summaries for
            attendance, sessions and
            low-attendance students.
          </p>
        </div>

        <button onClick={load}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </header>

      {error && (
        <div className="reports-alert">
          {error}
        </div>
      )}

      <div className="reports-kpis">
        <div>
          <span>Attendance rate</span>
          <strong>
            {overview?.attendance_percentage ??
              0}
            %
          </strong>
        </div>

        <div>
          <span>Present events</span>
          <strong>
            {overview?.present_events ?? 0}
          </strong>
        </div>

        <div>
          <span>Absent events</span>
          <strong>
            {overview?.absent_events ?? 0}
          </strong>
        </div>

        <div>
          <span>Active sessions</span>
          <strong>{active}</strong>
        </div>
      </div>

      <section className="reports-card">
        <div className="reports-toolbar">
          <div>
            <span>LOW ATTENDANCE</span>
            <h2>
              Students below threshold
            </h2>
          </div>

          <div className="reports-controls">
            <label>
              Threshold

              <input
                type="number"
                min="1"
                max="100"
                value={threshold}
                onChange={(e) =>
                  setThreshold(
                    Number(e.target.value) || 75
                  )
                }
              />
            </label>

            <button
              onClick={() =>
                csvDownload(low)
              }
              disabled={!low.length}
            >
              Export CSV
            </button>
          </div>
        </div>

        <div className="reports-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Roll</th>
                <th>Present</th>
                <th>Total</th>
                <th>Attendance</th>
              </tr>
            </thead>

            <tbody>
              {low.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                    <small>
                      {row.student_code ||
                        "—"}
                    </small>
                  </td>

                  <td>
                    {row.roll_number || "—"}
                  </td>

                  <td>
                    {row.present_count ?? 0}
                  </td>

                  <td>
                    {row.total_count ?? 0}
                  </td>

                  <td>
                    <b className="report-low">
                      {row.attendance_percentage ??
                        0}
                      %
                    </b>
                  </td>
                </tr>
              ))}

              {!loading && low.length === 0 && (
                <tr>
                  <td
                    colSpan="5"
                    className="reports-empty"
                  >
                    No students are below the
                    selected threshold.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="reports-card">
        <div className="reports-toolbar">
          <div>
            <span>SESSION REPORT</span>
            <h2>Attendance sessions</h2>
          </div>
        </div>

        <div className="reports-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Session</th>
                <th>Subject</th>
                <th>Class</th>
                <th>Status</th>
                <th>Start</th>
                <th>End</th>
              </tr>
            </thead>

            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.title}</td>

                  <td>
                    {s.subject_name ||
                      `#${s.subject_id}`}
                  </td>

                  <td>
                    {s.class_name ||
                      `#${s.class_id}`}
                    {s.section
                      ? ` • ${s.section}`
                      : ""}
                  </td>

                  <td>{s.status}</td>

                  <td>
                    {s.starts_at
                      ? new Date(
                          s.starts_at
                        ).toLocaleString()
                      : "—"}
                  </td>

                  <td>
                    {s.ends_at
                      ? new Date(
                          s.ends_at
                        ).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}