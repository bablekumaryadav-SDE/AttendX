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
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  RefreshCw,
  ShieldAlert,
  UsersRound,
} from "lucide-react";

import { useAuth } from "../../context/AuthContext";

import {
  getAttendanceSessions,
} from "../../services/attendance";

import {
  getTeacherDashboard,
  getAnalyticsOverview,
} from "../../services/dashboard";

import "./TeacherDashboard.css";

function asArray(value, keys = []) {
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

function formatDateTime(value) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export default function TeacherDashboard() {
  const { user } = useAuth();

  const [profile, setProfile] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [overview, setOverview] = useState(null);

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

    const [
      profileResult,
      sessionsResult,
      overviewResult,
    ] = await Promise.allSettled([
      getTeacherDashboard(),
      getAttendanceSessions(),
      getAnalyticsOverview(),
    ]);

    if (profileResult.status === "fulfilled") {
      setProfile(profileResult.value || null);
    } else {
      setProfile(null);
    }

    if (sessionsResult.status === "fulfilled") {
      setSessions(
        asArray(sessionsResult.value, [
          "sessions",
          "items",
        ])
      );
    } else {
      setSessions([]);
    }

    if (overviewResult.status === "fulfilled") {
      setOverview(overviewResult.value || null);
    } else {
      setOverview(null);
    }

    const errors = [];

    if (profileResult.status === "rejected") {
      errors.push(
        getErrorMessage(
          profileResult.reason,
          "Teacher assignments could not be loaded."
        )
      );
    }

    if (sessionsResult.status === "rejected") {
      errors.push(
        getErrorMessage(
          sessionsResult.reason,
          "Attendance sessions could not be loaded."
        )
      );
    }

    if (overviewResult.status === "rejected") {
      errors.push(
        getErrorMessage(
          overviewResult.reason,
          "Attendance analytics could not be loaded."
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

  const assignments = useMemo(
    () => asArray(profile?.assignments, ["items"]),
    [profile]
  );

  const activeSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          String(session.status || "").toLowerCase() === "active"
      ),
    [sessions]
  );

  const firstName =
    String(profile?.teacher_name || user?.name || "Teacher")
      .trim()
      .split(/\s+/)[0] || "Teacher";

  const attendanceRate = Number(
    overview?.attendance_percentage ?? 0
  );

  return (
    <div className="teacher-dashboard-page">
      <section className="td-welcome">
        <div>
          <span className="td-eyebrow">
            TEACHER WORKSPACE
          </span>

          <h2>Welcome back, {firstName}.</h2>

          <p>
            Manage your attendance sessions, review assigned
            classes and keep track of classroom activity.
          </p>

          {lastUpdated && (
            <small className="td-updated">
              Last updated{" "}
              {lastUpdated.toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </small>
          )}
        </div>

        <div className="td-welcome-actions">
          <button
            type="button"
            className="td-quiet-button"
            onClick={() => loadDashboard(true)}
            disabled={loading || refreshing}
          >
            <RefreshCw
              size={15}
              className={refreshing ? "td-spin" : ""}
            />

            {refreshing ? "Refreshing" : "Refresh"}
          </button>

          <Link
            className="td-primary"
            to="/teacher/attendance"
          >
            <CalendarClock size={16} />
            Manage attendance
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {error && (
        <div className="td-alert" role="status">
          <ShieldAlert size={18} />

          <span>
            {error} Check that the backend is running
            and your teacher profile is active.
          </span>
        </div>
      )}

      <section className="td-kpis" aria-label="Teacher summary">
        <article className="td-kpi-card">
          <span className="td-kpi-icon purple">
            <Activity size={20} />
          </span>

          <div>
            <span>Attendance rate</span>

            <strong>
              {loading ? "—" : `${Math.round(attendanceRate)}%`}
            </strong>

            <small>From attendance analytics</small>
          </div>
        </article>

        <article className="td-kpi-card">
          <span className="td-kpi-icon green">
            <CalendarClock size={20} />
          </span>

          <div>
            <span>Total sessions</span>

            <strong>
              {loading
                ? "—"
                : (overview?.sessions ?? sessions.length)}
            </strong>

            <small>Attendance sessions</small>
          </div>
        </article>

        <article className="td-kpi-card">
          <span className="td-kpi-icon orange">
            <CheckCircle2 size={20} />
          </span>

          <div>
            <span>Active now</span>

            <strong>
              {loading ? "—" : activeSessions.length}
            </strong>

            <small>Open sessions</small>
          </div>
        </article>

        <article className="td-kpi-card">
          <span className="td-kpi-icon blue">
            <BookOpenCheck size={20} />
          </span>

          <div>
            <span>Assignments</span>

            <strong>
              {loading
                ? "—"
                : (profile?.total_assignments ?? assignments.length)}
            </strong>

            <small>Classes and subjects</small>
          </div>
        </article>
      </section>

      <section className="td-main-grid">
        <article className="td-card">
          <div className="td-head">
            <div>
              <span>YOUR CLASSROOM</span>
              <h3>Assigned classes & subjects</h3>
            </div>

            <span className="td-count-pill">
              {loading ? "…" : assignments.length} assigned
            </span>
          </div>

          {loading ? (
            <div className="td-empty">
              <span className="td-loader" />
              Loading assignments…
            </div>
          ) : assignments.length === 0 ? (
            <div className="td-empty">
              <span className="td-empty-icon">
                <BookOpenCheck size={22} />
              </span>

              <strong>No assignments found</strong>

              <p>
                Ask your administrator to assign a class
                and subject to your teacher account.
              </p>
            </div>
          ) : (
            <div className="td-assignment-list">
              {assignments.slice(0, 8).map((assignment, index) => (
                <div
                  className="td-assignment-row"
                  key={
                    assignment.assignment_id ??
                    `${assignment.subject_id}-${assignment.class_id}-${index}`
                  }
                >
                  <span className="td-assignment-icon">
                    <BookOpenCheck size={17} />
                  </span>

                  <div>
                    <strong>
                      {assignment.subject_name ||
                        `Subject #${assignment.subject_id ?? "—"}`}
                    </strong>

                    <span>
                      {assignment.class_name ||
                        `Class #${assignment.class_id ?? "—"}`}

                      {assignment.section
                        ? ` · ${assignment.section}`
                        : ""}
                    </span>
                  </div>

                  <span className="td-assignment-code">
                    {assignment.subject_code ||
                      `SUB-${assignment.subject_id ?? "—"}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="td-card">
          <div className="td-head">
            <div>
              <span>LIVE ACTIVITY</span>
              <h3>Active attendance sessions</h3>
            </div>

            <Link to="/teacher/attendance">
              Open workspace <ArrowRight size={13} />
            </Link>
          </div>

          {loading ? (
            <div className="td-empty">
              <span className="td-loader" />
              Checking live sessions…
            </div>
          ) : activeSessions.length === 0 ? (
            <div className="td-empty">
              <span className="td-empty-icon">
                <CalendarClock size={22} />
              </span>

              <strong>No active session right now</strong>

              <p>
                Start a session when you are ready
                to take attendance.
              </p>

              <Link
                className="td-inline-cta"
                to="/teacher/attendance"
              >
                Start a session <ArrowRight size={14} />
              </Link>
            </div>
          ) : (
            <div className="td-live-list">
              {activeSessions.slice(0, 5).map((session) => (
                <Link
                  className="td-live-session"
                  to="/teacher/attendance"
                  key={session.id}
                >
                  <span className="td-live-indicator">
                    <i />
                  </span>

                  <span className="td-live-copy">
                    <strong>
                      {session.title ||
                        session.subject_name ||
                        `Session #${session.id}`}
                    </strong>

                    <small>
                      {session.subject_name || "Subject"}
                      {" · "}
                      {session.class_name || "Class"}

                      {session.section
                        ? ` · ${session.section}`
                        : ""}
                    </small>
                  </span>

                  <ArrowRight size={16} />
                </Link>
              ))}
            </div>
          )}

          <div className="td-session-footer">
            <UsersRound size={16} />

            <span>
              Live attendance status is available in your
              attendance workspace.
            </span>
          </div>
        </article>
      </section>

      <section className="td-card td-recent-card">
        <div className="td-head">
          <div>
            <span>RECENT ACTIVITY</span>
            <h3>Recent attendance sessions</h3>

            <p>
              Latest sessions available to your teacher account.
            </p>
          </div>

          <Link to="/teacher/attendance">
            View all sessions <ArrowRight size={14} />
          </Link>
        </div>

        {loading ? (
          <div className="td-empty">
            Loading attendance sessions…
          </div>
        ) : sessions.length === 0 ? (
          <div className="td-empty">
            <span className="td-empty-icon">
              <ClipboardList size={22} />
            </span>

            <strong>No sessions to show yet</strong>

            <p>
              Attendance sessions you create will appear here.
            </p>
          </div>
        ) : (
          <div className="td-table-wrap">
            <table className="td-table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Subject</th>
                  <th>Class</th>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {sessions.slice(0, 8).map((session, index) => {
                  const status = String(
                    session.status || "unknown"
                  ).toLowerCase();

                  return (
                    <tr
                      key={
                        session.id ??
                        `${session.title}-${index}`
                      }
                    >
                      <td>
                        <strong>
                          {session.title || `Session #${session.id}`}
                        </strong>
                      </td>

                      <td>{session.subject_name || "—"}</td>

                      <td>
                        {session.class_name || "—"}

                        {session.section
                          ? ` · ${session.section}`
                          : ""}
                      </td>

                      <td>{formatDateTime(session.starts_at)}</td>

                      <td>
                        <span className={`td-status ${status}`}>
                          {status.charAt(0).toUpperCase() +
                            status.slice(1)}
                        </span>
                      </td>

                      <td>
                        <Link
                          className="td-row-link"
                          to="/teacher/attendance"
                        >
                          Open <ArrowRight size={13} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="td-footer-note">
        <CheckCircle2 size={15} />

        Dashboard numbers are loaded from your AttendX APIs.
        Session management opens the attendance workspace.
      </div>
    </div>
  );
}