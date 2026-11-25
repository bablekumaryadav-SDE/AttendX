import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getStudents } from "../../services/students";
import { getTeachers } from "../../services/teachers";
import { getAttendanceSessions } from "../../services/attendance";
import {
  getAnalyticsOverview,
  getLowAttendance,
} from "../../services/dashboard";
import "./AdminDashboard.css";

const number = (value) => Number(value || 0);

const errorText = (error, fallback) =>
  error?.response?.data?.detail || fallback;

export default function AdminDashboard() {
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [overview, setOverview] = useState(null);
  const [lowAttendance, setLowAttendance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const results = await Promise.allSettled([
      getStudents(),
      getTeachers(),
      getAttendanceSessions(),
      getAnalyticsOverview(),
      getLowAttendance(75),
    ]);

    const [
      studentResult,
      teacherResult,
      sessionResult,
      overviewResult,
      lowResult,
    ] = results;

    if (studentResult.status === "fulfilled") {
      setStudents(
        Array.isArray(studentResult.value) ? studentResult.value : []
      );
    }

    if (teacherResult.status === "fulfilled") {
      setTeachers(
        Array.isArray(teacherResult.value) ? teacherResult.value : []
      );
    }

    if (sessionResult.status === "fulfilled") {
      setSessions(
        Array.isArray(sessionResult.value) ? sessionResult.value : []
      );
    }

    if (overviewResult.status === "fulfilled") {
      setOverview(overviewResult.value || null);
    }

    if (lowResult.status === "fulfilled") {
      setLowAttendance(
        Array.isArray(lowResult.value) ? lowResult.value : []
      );
    }

    const failed = results.find((item) => item.status === "rejected");

    if (failed) {
      setError(
        errorText(
          failed.reason,
          "Some dashboard data could not be loaded."
        )
      );
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeStudents = useMemo(
    () =>
      students.filter((item) => item.is_active !== false).length,
    [students]
  );

  const activeTeachers = useMemo(
    () =>
      teachers.filter((item) => item.is_active !== false).length,
    [teachers]
  );

  const activeSessions = useMemo(
    () =>
      sessions.filter((item) => item.status === "active").length,
    [sessions]
  );

  return (
    <div className="admin-dashboard-page">
      <header className="ad-header">
        <div>
          <span className="ad-eyebrow">ADMIN CONTROL CENTER</span>

          <h1>AttendX Overview</h1>

          <p>
            Manage students, teachers, attendance operations, analytics
            and alerts from one workspace.
          </p>
        </div>

        <button
          className="ad-refresh"
          onClick={load}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh data"}
        </button>
      </header>

      {error && <div className="ad-alert">{error}</div>}

      <section className="ad-stat-grid">
        <article className="ad-stat">
          <span>Active students</span>

          <strong>
            {number(
              overview?.active_students || activeStudents
            )}
          </strong>

          <small>Registered in PostgreSQL</small>
        </article>

        <article className="ad-stat">
          <span>Active teachers</span>

          <strong>{activeTeachers}</strong>

          <small>Teacher accounts</small>
        </article>

        <article className="ad-stat">
          <span>Attendance sessions</span>

          <strong>
            {number(overview?.sessions || sessions.length)}
          </strong>

          <small>{activeSessions} currently active</small>
        </article>

        <article className="ad-stat">
          <span>Attendance rate</span>

          <strong>
            {number(overview?.attendance_percentage)}%
          </strong>

          <small>Present + late events</small>
        </article>
      </section>

      <section className="ad-grid">
        <article className="ad-card">
          <div className="ad-card-head">
            <div>
              <span className="ad-kicker">OPERATIONS</span>

              <h2>Quick actions</h2>
            </div>
          </div>

          <div className="ad-action-grid">
            <Link to="/admin/students">
              Register student <b>→</b>
            </Link>

            <Link to="/admin/teachers">
              Manage teachers <b>→</b>
            </Link>

            <Link to="/admin/classes">
              Classes & subjects <b>→</b>
            </Link>

            <Link to="/admin/attendance">
              Attendance monitor <b>→</b>
            </Link>

            <Link to="/admin/reports">
              Open reports <b>→</b>
            </Link>

            <Link to="/admin/notifications">
              Notification history <b>→</b>
            </Link>
          </div>
        </article>

        <article className="ad-card">
          <div className="ad-card-head">
            <div>
              <span className="ad-kicker">RISK WATCH</span>

              <h2>Low attendance</h2>
            </div>

            <Link to="/admin/reports">View all</Link>
          </div>

          {lowAttendance.length === 0 ? (
            <div className="ad-empty">
              No low-attendance records returned for the 75% threshold.
            </div>
          ) : (
            <div className="ad-risk-list">
              {lowAttendance.slice(0, 6).map((student) => (
                <div
                  className="ad-risk-row"
                  key={student.id}
                >
                  <div>
                    <strong>{student.name}</strong>

                    <span>
                      {student.student_code ||
                        student.roll_number ||
                        "Student"}
                    </span>
                  </div>

                  <b>
                    {number(student.attendance_percentage)}%
                  </b>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="ad-card">
        <div className="ad-card-head">
          <div>
            <span className="ad-kicker">RECENT ACTIVITY</span>

            <h2>Attendance sessions</h2>
          </div>

          <Link to="/admin/attendance">
            Open monitor
          </Link>
        </div>

        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Subject</th>
                <th>Class</th>
                <th>Status</th>
                <th>Starts</th>
              </tr>
            </thead>

            <tbody>
              {sessions.slice(0, 8).map((session) => (
                <tr key={session.id}>
                  <td>
                    <strong>{session.title}</strong>
                  </td>

                  <td>
                    {session.subject_name ||
                      `Subject #${session.subject_id}`}
                  </td>

                  <td>
                    {session.class_name ||
                      `Class #${session.class_id}`}

                    {session.section
                      ? ` • ${session.section}`
                      : ""}
                  </td>

                  <td>
                    <span
                      className={`ad-status ${session.status}`}
                    >
                      {session.status}
                    </span>
                  </td>

                  <td>
                    {session.starts_at
                      ? new Date(
                          session.starts_at
                        ).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}

              {!loading && sessions.length === 0 && (
                <tr>
                  <td
                    colSpan="5"
                    className="ad-empty-cell"
                  >
                    No sessions have been recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}