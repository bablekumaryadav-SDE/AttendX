import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Link } from "react-router-dom";

import {
  Activity,
  ArrowRight,
  BookOpen,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";

import { useAuth } from "../../context/AuthContext";

import {
  getActiveStudentSessions,
  getMyAttendance,
} from "../../services/attendance";

import "./StudentDashboard.css";

function toList(value, keys = []) {
  if (Array.isArray(value)) return value;

  for (const key of keys) {
    if (Array.isArray(value?.[key])) {
      return value[key];
    }
  }

  return [];
}

function getErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail;

  return typeof detail === "string"
    ? detail
    : error?.message || fallback;
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function formatTime(value) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
}

function statusName(value) {
  const status = String(value || "unknown").toLowerCase();

  if (status === "present") return "Present";
  if (status === "late") return "Late";
  if (status === "absent") return "Absent";
  if (status === "excused") return "Excused";

  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function StudentDashboard() {
  const { user } = useAuth();

  const [records, setRecords] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadDashboard = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");

    const [historyResult, sessionsResult] =
      await Promise.allSettled([
        getMyAttendance(),
        getActiveStudentSessions(),
      ]);

    if (historyResult.status === "fulfilled") {
      setRecords(
        toList(historyResult.value, [
          "records",
          "items",
          "attendance",
        ])
      );
    } else {
      setRecords([]);
    }

    if (sessionsResult.status === "fulfilled") {
      setSessions(
        toList(sessionsResult.value, [
          "sessions",
          "items",
          "active_sessions",
        ])
      );
    } else {
      setSessions([]);
    }

    const errors = [];

    if (historyResult.status === "rejected") {
      errors.push(
        getErrorMessage(
          historyResult.reason,
          "Attendance history could not be loaded."
        )
      );
    }

    if (sessionsResult.status === "rejected") {
      errors.push(
        getErrorMessage(
          sessionsResult.reason,
          "Active sessions could not be loaded."
        )
      );
    }

    if (errors.length) {
      setError(errors.join(" "));
    }

    setLastUpdated(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const summary = useMemo(() => {
    const present = records.filter(
      (record) =>
        String(record.status || "").toLowerCase() === "present"
    ).length;

    const late = records.filter(
      (record) =>
        String(record.status || "").toLowerCase() === "late"
    ).length;

    const absent = records.filter(
      (record) =>
        String(record.status || "").toLowerCase() === "absent"
    ).length;

    const attended = present + late;
    const total = records.length;

    const percentage = total
      ? Math.round((attended / total) * 100)
      : 0;

    return {
      present,
      late,
      absent,
      attended,
      total,
      percentage,
    };
  }, [records]);

  const subjectSummary = useMemo(() => {
    const subjects = new Map();

    records.forEach((record) => {
      const name =
        record.subject_name ||
        record.subject ||
        "Other classes";

      const item = subjects.get(name) || {
        name,
        total: 0,
        attended: 0,
      };

      item.total += 1;

      const status = String(record.status || "").toLowerCase();

      if (status === "present" || status === "late") {
        item.attended += 1;
      }

      subjects.set(name, item);
    });

    return [...subjects.values()]
      .map((item) => ({
        ...item,
        percentage: item.total
          ? Math.round((item.attended / item.total) * 100)
          : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [records]);

  const firstName =
    String(user?.name || "Student")
      .trim()
      .split(/\s+/)[0] || "Student";

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="student-dashboard-page">
      <section className="sd-welcome">
        <div>
          <span className="sd-eyebrow">
            STUDENT WORKSPACE
          </span>

          <h2>Welcome back, {firstName}.</h2>

          <p>
            Track your attendance, check current sessions
            and stay on top of your classes.
          </p>

          <div className="sd-today">
            <CalendarCheck2 size={15} />
            {today}
          </div>
        </div>

        <div className="sd-welcome-actions">
          <button
            className="sd-quiet-button"
            type="button"
            onClick={() => loadDashboard(true)}
            disabled={loading || refreshing}
          >
            <RefreshCw
              size={15}
              className={refreshing ? "sd-spin" : ""}
            />

            {refreshing ? "Refreshing" : "Refresh"}
          </button>

          <Link
            className="sd-primary-button"
            to="/student/attendance"
          >
            Open attendance <ArrowRight size={17} />
          </Link>
        </div>
      </section>

      {error && (
        <div className="sd-alert" role="status">
          <ShieldAlert size={18} />

          <span>
            {error} Check that the backend is running
            and your student profile is active.
          </span>
        </div>
      )}

      <section
        className="sd-stat-grid"
        aria-label="Attendance summary"
      >
        <article className="sd-stat-card">
          <span className="sd-stat-icon purple">
            <TrendingUp size={20} />
          </span>

          <div>
            <span className="sd-stat-label">
              Attendance rate
            </span>

            <strong>
              {loading ? "—" : `${summary.percentage}%`}
            </strong>

            <small>Present + late classes</small>
          </div>

          <div
            className="sd-stat-ring"
            style={{
              "--sd-ring": `${summary.percentage}%`,
            }}
          >
            <span>
              {loading ? "…" : `${summary.percentage}%`}
            </span>
          </div>
        </article>

        <article className="sd-stat-card">
          <span className="sd-stat-icon green">
            <CheckCircle2 size={20} />
          </span>

          <div>
            <span className="sd-stat-label">
              Classes attended
            </span>

            <strong>
              {loading ? "—" : summary.attended}
            </strong>

            <small>
              {summary.present} present · {summary.late} late
            </small>
          </div>
        </article>

        <article className="sd-stat-card">
          <span className="sd-stat-icon orange">
            <Clock3 size={20} />
          </span>

          <div>
            <span className="sd-stat-label">
              Absent classes
            </span>

            <strong>
              {loading ? "—" : summary.absent}
            </strong>

            <small>Based on loaded records</small>
          </div>
        </article>

        <article className="sd-stat-card">
          <span className="sd-stat-icon blue">
            <Activity size={20} />
          </span>

          <div>
            <span className="sd-stat-label">
              Live sessions
            </span>

            <strong>
              {loading ? "—" : sessions.length}
            </strong>

            <small>Available to join now</small>
          </div>
        </article>
      </section>

      {summary.total > 0 &&
        summary.percentage < 75 &&
        !loading && (
          <div className="sd-attendance-tip">
            <ShieldAlert size={17} />

            <span>
              <strong>Your attendance is below 75%.</strong>
              {" "}Try to attend upcoming classes regularly
              and check your subject-wise records.
            </span>
          </div>
        )}

      <section className="sd-main-grid">
        <article className="sd-panel sd-sessions-panel">
          <div className="sd-panel-heading">
            <div>
              <span className="sd-panel-kicker">
                RIGHT NOW
              </span>
              <h3>Available attendance sessions</h3>
            </div>

            <Link to="/student/attendance">
              Attendance page <ArrowRight size={14} />
            </Link>
          </div>

          {loading ? (
            <div className="sd-empty">
              <span className="sd-loader" />
              Loading active sessions…
            </div>
          ) : sessions.length === 0 ? (
            <div className="sd-empty">
              <span className="sd-empty-icon">
                <CalendarCheck2 size={22} />
              </span>

              <strong>No active sessions right now</strong>

              <p>
                When a teacher opens a session,
                it will appear here.
              </p>
            </div>
          ) : (
            <div className="sd-session-list">
              {sessions.slice(0, 5).map((session) => {
                const alreadyAttended =
                  Boolean(session.already_attended);

                const title =
                  session.title ||
                  session.subject_name ||
                  `Session #${session.id}`;

                return (
                  <div
                    className="sd-session-row"
                    key={
                      session.id ??
                      `${title}-${session.starts_at}`
                    }
                  >
                    <div className="sd-session-icon">
                      <BookOpen size={18} />
                    </div>

                    <div className="sd-session-info">
                      <strong>{title}</strong>

                      <span>
                        {session.subject_name || "Subject"}
                        {" · "}
                        {session.class_name || "Class"}
                        {session.section
                          ? ` · ${session.section}`
                          : ""}
                      </span>

                      <small>
                        {session.teacher_name
                          ? `Teacher: ${session.teacher_name}`
                          : "Attendance session"}

                        {session.ends_at
                          ? ` · Ends ${formatTime(session.ends_at)}`
                          : ""}
                      </small>
                    </div>

                    <span
                      className={`sd-session-status ${
                        alreadyAttended ? "done" : "open"
                      }`}
                    >
                      {alreadyAttended ? "Marked" : "Open"}
                    </span>

                    <Link
                      className="sd-session-action"
                      to="/student/attendance"
                      aria-label={`Open attendance for ${title}`}
                    >
                      <ArrowRight size={17} />
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="sd-panel sd-subject-panel">
          <div className="sd-panel-heading">
            <div>
              <span className="sd-panel-kicker">
                YOUR CLASSES
              </span>
              <h3>Subject attendance</h3>
            </div>
          </div>

          {loading ? (
            <div className="sd-empty">
              Calculating your attendance…
            </div>
          ) : subjectSummary.length === 0 ? (
            <div className="sd-empty">
              <span className="sd-empty-icon">
                <BookOpen size={22} />
              </span>

              <strong>No subject records yet</strong>

              <p>
                Your subject summary appears after
                attendance records are available.
              </p>
            </div>
          ) : (
            <div className="sd-subject-list">
              {subjectSummary.map((subject) => (
                <div
                  className="sd-subject-item"
                  key={subject.name}
                >
                  <div className="sd-subject-copy">
                    <strong>{subject.name}</strong>
                    <span>
                      {subject.attended} of {subject.total} classes
                    </span>
                  </div>

                  <div className="sd-progress-track">
                    <span
                      style={{
                        width: `${subject.percentage}%`,
                      }}
                    />
                  </div>

                  <strong className="sd-subject-percent">
                    {subject.percentage}%
                  </strong>
                </div>
              ))}
            </div>
          )}

          <div className="sd-subject-footer">
            <span>Recommended target</span>
            <strong>75% attendance</strong>
          </div>
        </article>
      </section>

      <section className="sd-panel sd-history-panel">
        <div className="sd-panel-heading">
          <div>
            <span className="sd-panel-kicker">
              RECENT ACTIVITY
            </span>

            <h3>Attendance history</h3>

            <p>
              Latest records available for your account.
            </p>
          </div>

          <Link to="/student/attendance">
            View full history <ArrowRight size={14} />
          </Link>
        </div>

        {loading ? (
          <div className="sd-empty">
            Loading attendance history…
          </div>
        ) : records.length === 0 ? (
          <div className="sd-empty">
            <span className="sd-empty-icon">
              <CalendarCheck2 size={22} />
            </span>

            <strong>No attendance records yet</strong>

            <p>
              Your records will appear here after
              a session has been marked.
            </p>
          </div>
        ) : (
          <div className="sd-table-wrap">
            <table className="sd-table">
              <thead>
                <tr>
                  <th>Class / session</th>
                  <th>Subject</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Method</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {records.slice(0, 7).map((record, index) => {
                  const status = String(
                    record.status || "unknown"
                  ).toLowerCase();

                  return (
                    <tr
                      key={
                        record.id ??
                        `${record.title}-${record.verified_at}-${index}`
                      }
                    >
                      <td>
                        <strong>
                          {record.title ||
                            record.class_name ||
                            "Class session"}
                        </strong>

                        {record.section && (
                          <small>{record.section}</small>
                        )}
                      </td>

                      <td>{record.subject_name || "—"}</td>

                      <td>
                        {formatDate(
                          record.verified_at || record.starts_at
                        )}
                      </td>

                      <td>
                        {formatTime(
                          record.verified_at || record.starts_at
                        )}
                      </td>

                      <td>
                        <span className="sd-method">
                          {String(record.method || "—").replaceAll(
                            "_",
                            " "
                          )}
                        </span>
                      </td>

                      <td>
                        <span
                          className={`sd-status-badge ${status}`}
                        >
                          {statusName(status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="sd-footer-note">
        <CheckCircle2 size={15} />

        Attendance data reflects records returned by
        your AttendX account.

        {lastUpdated
          ? ` Updated at ${lastUpdated.toLocaleTimeString(
              undefined,
              {
                hour: "2-digit",
                minute: "2-digit",
              }
            )}.`
          : ""}
      </div>
    </div>
  );
}