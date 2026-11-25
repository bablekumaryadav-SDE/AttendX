import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Link, useLocation } from "react-router-dom";

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
  getTenantAttendanceSessions,
  getTenantTeacherAssignments,
  getTenantTeacherAttendanceSummary,
} from "../../services/tenantAttendanceSessions";

import "./TeacherDashboard.css";
import { getApiErrorMessage, uniqueApiErrorMessages } from "../../utils/errors";

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
  if (!error?.response && (error?.code === "ERR_NETWORK" || error?.message === "Network Error")) {
    return "AttendX could not reach the backend. Check the connection and retry.";
  }
  return getApiErrorMessage(error, fallback);
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
  const { user, activeCollegeId } = useAuth();
  const authenticatedUserId = user?.user_id ?? user?.id;
  const location = useLocation();

  const [profile, setProfile] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [overview, setOverview] = useState(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [assignmentsAvailable, setAssignmentsAvailable] = useState(false);
  const [sessionsAvailable, setSessionsAvailable] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [dataScope, setDataScope] = useState(null);
  const requestVersion = useRef(0);
  const dataScopeRef = useRef(null);
  const lastAutoRefreshAtRef = useRef(0);

  const loadDashboard = useCallback(async (silent = false) => {
    const version = ++requestVersion.current;
    const requestScope = `${authenticatedUserId ?? ""}:${activeCollegeId ?? ""}`;
    if (!activeCollegeId) {
      setProfile(null);
      setSessions([]);
      setAssignments([]);
      setOverview(null);
      setAssignmentsAvailable(false);
      setSessionsAvailable(false);
      setDataScope(null);
      dataScopeRef.current = null;
      setError("Select an active College membership to view your Teacher workspace.");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (dataScopeRef.current !== requestScope) {
      setProfile(null);
      setSessions([]);
      setAssignments([]);
      setOverview(null);
      setAssignmentsAvailable(false);
      setSessionsAvailable(false);
      setLastUpdated(null);
      setDataScope(null);
    }
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");

    const [summaryResult, assignmentsResult, sessionsResult] = await Promise.allSettled([
      getTenantTeacherAttendanceSummary(activeCollegeId),
      getTenantTeacherAssignments(activeCollegeId),
      getTenantAttendanceSessions(activeCollegeId),
    ]);
    if (version !== requestVersion.current) return;

    const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
    setProfile(summary ? { ...summary, teacher_name: summary.teacher_name || user?.name } : null);
    setOverview(summary);
    setAssignments(assignmentsResult.status === "fulfilled" ? asArray(assignmentsResult.value) : []);
    setSessions(sessionsResult.status === "fulfilled" ? asArray(sessionsResult.value) : []);
    setAssignmentsAvailable(assignmentsResult.status === "fulfilled");
    setSessionsAvailable(sessionsResult.status === "fulfilled");
    dataScopeRef.current = requestScope;
    setDataScope(requestScope);

    const errors = [];

    if (summaryResult.status === "rejected") {
      errors.push(getErrorMessage(summaryResult.reason, "Teacher summary could not be loaded."));
    }
    if (assignmentsResult.status === "rejected") {
      errors.push(getErrorMessage(assignmentsResult.reason, "Teacher assignments could not be loaded."));
    }
    if (sessionsResult.status === "rejected") {
      errors.push(getErrorMessage(sessionsResult.reason, "Attendance sessions could not be loaded."));
    }

    if (errors.length) {
      setError(uniqueApiErrorMessages(errors));
    }

    setLastUpdated(new Date());
    setLoading(false);
    setRefreshing(false);
  }, [activeCollegeId, authenticatedUserId, user?.name]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => () => { requestVersion.current += 1; }, []);

  useEffect(() => {
    const refreshVisibleDashboard = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastAutoRefreshAtRef.current < 1000) return;
      lastAutoRefreshAtRef.current = now;
      loadDashboard(true);
    };
    window.addEventListener("focus", refreshVisibleDashboard);
    document.addEventListener("visibilitychange", refreshVisibleDashboard);
    return () => {
      window.removeEventListener("focus", refreshVisibleDashboard);
      document.removeEventListener("visibilitychange", refreshVisibleDashboard);
    };
  }, [loadDashboard]);

  useEffect(() => {
    if (!new Set(["#my-classes", "#subject-assignments", "#my-subjects"]).has(location.hash)) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash]);

  const currentDataScope = dataScope === `${authenticatedUserId ?? ""}:${activeCollegeId ?? ""}`;
  const visibleAssignments = currentDataScope ? assignments : [];
  const activeAssignments = visibleAssignments.filter((assignment) => assignment.is_active !== false);
  const mySubjects = [...new Map(activeAssignments.map((assignment) => [String(assignment.subject_id), assignment])).values()];
  const assignedClassCount = new Set(activeAssignments.filter((assignment) => assignment.class_id != null).map((assignment) => String(assignment.class_id))).size;
  const assignedSubjectCount = new Set(activeAssignments.filter((assignment) => assignment.subject_id != null).map((assignment) => String(assignment.subject_id))).size;
  const visibleSessions = currentDataScope ? sessions : [];
  const visibleAssignmentsAvailable = currentDataScope && assignmentsAvailable;
  const visibleSessionsAvailable = currentDataScope && sessionsAvailable;
  const visibleOverview = currentDataScope ? overview : null;

  const activeSessions = useMemo(
    () =>
      visibleSessions.filter(
        (session) =>
          String(session.status || "").toLowerCase() === "active"
      ),
    [visibleSessions]
  );

  const firstName =
    String(profile?.teacher_name || user?.name || "Teacher")
      .trim()
      .split(/\s+/)[0] || "Teacher";

  const attendanceRate = visibleOverview?.attendance_percentage;

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
        <aside className="td-workspace-snapshot" aria-label="Current teaching activity">
          <span className="td-snapshot-kicker"><Activity size={13} /> TODAY AT A GLANCE</span>
          <div className="td-snapshot-values">
            <div><strong>{loading ? "—" : visibleAssignmentsAvailable ? activeAssignments.length : "—"}</strong><span>active class-subject mappings</span></div>
            <i aria-hidden="true" />
            <div><strong>{loading ? "—" : visibleSessionsAvailable ? activeSessions.length : "—"}</strong><span>open sessions</span></div>
          </div>
          <small>Counts reflect the selected College workspace.</small>
        </aside>
      </section>

      {error && (
        <div className="td-alert" role="alert">
          <ShieldAlert size={18} />

          <span>{error}</span>
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
              {loading ? "..." : attendanceRate == null ? "N/A" : `${Math.round(attendanceRate)}%`}
            </strong>

            <small>Present + late among classified events</small>
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
                : visibleOverview?.sessions ?? "Unavailable"}
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
              {loading ? "..." : visibleSessionsAvailable ? activeSessions.length : "Unavailable"}
            </strong>

            <small>Open sessions</small>
          </div>
        </article>

        <article className="td-kpi-card">
          <span className="td-kpi-icon blue">
            <BookOpenCheck size={20} />
          </span>

          <div>
            <span>Assigned classes</span>

            <strong>
              {loading
                ? "—"
                : visibleAssignmentsAvailable ? assignedClassCount : "Unavailable"}
            </strong>

            <small>Active College class-subject mappings</small>
          </div>
        </article>
        <article className="td-kpi-card">
          <span className="td-kpi-icon purple"><BookOpenCheck size={20} /></span>
          <div>
            <span>Assigned subjects</span>
            <strong>{loading ? "—" : visibleAssignmentsAvailable ? assignedSubjectCount : "Unavailable"}</strong>
            <small>Distinct active subjects</small>
          </div>
        </article>
        <article className="td-kpi-card">
          <span className="td-kpi-icon green"><CheckCircle2 size={20} /></span>
          <div>
            <span>Present events</span>
            <strong>{loading ? "—" : visibleOverview ? (visibleOverview.present_events ?? 0) : "Unavailable"}</strong>
            <small>Verified events across your sessions</small>
          </div>
        </article>
        <article className="td-kpi-card">
          <span className="td-kpi-icon orange"><UsersRound size={20} /></span>
          <div>
            <span>Absent events</span>
            <strong>{loading ? "—" : visibleOverview ? (visibleOverview.absent_events ?? 0) : "Unavailable"}</strong>
            <small>Classified events across your sessions</small>
          </div>
        </article>
      </section>

      <section className="td-main-grid" id="my-classes">
        <article className="td-card">
          <div className="td-head">
            <div>
              <span>YOUR CLASSROOM</span>
              <h3 id="subject-assignments">Subject Assignments</h3>
            </div>

            <span className="td-count-pill">
              {loading ? "…" : visibleAssignments.length} assigned
            </span>
          </div>

          {loading ? (
            <div className="td-empty">
              <span className="td-loader" />
              Loading assignments…
            </div>
          ) : !visibleAssignmentsAvailable ? (
            <div className="td-empty" role="status">Teacher assignments are unavailable. Refresh to retry.</div>
          ) : activeAssignments.length === 0 ? (
            <div className="td-empty">
              <span className="td-empty-icon">
                <BookOpenCheck size={22} />
              </span>

              <strong>No assignments found</strong>

              <p>
                Ask your College Admin to assign an active Class and Subject to your account.
              </p>
            </div>
          ) : (
            <div className="td-assignment-list">
              {activeAssignments.map((assignment, index) => (
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
                    <span>
                      {assignment.department || "Department unavailable"}
                      {assignment.semester != null ? ` · Semester ${assignment.semester}` : ""}
                      {assignment.academic_year ? ` · ${assignment.academic_year}` : ""}
                    </span>
                    {assignment.effective_from && <span>Assigned {formatDateTime(assignment.effective_from)}</span>}
                  </div>

                  <span className="td-assignment-code">
                    {assignment.subject_code || "Code unavailable"}
                    <small>Active</small>
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
          ) : !visibleSessionsAvailable ? (
            <div className="td-empty" role="status">Active attendance sessions are unavailable. Refresh to retry.</div>
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

      <section className="td-card td-recent-card" id="my-subjects" aria-label="My Subjects">
        <div className="td-head">
          <div>
            <span>TEACHING CATALOG</span>
            <h3>My Subjects</h3>
            <p>Subjects from your active College assignments.</p>
          </div>
          <Link to="/teacher/attendance">Start attendance <ArrowRight size={14} /></Link>
        </div>
        {loading ? <div className="td-empty" role="status">Loading your Subjects…</div>
          : !visibleAssignmentsAvailable ? <div className="td-empty" role="status">Your Subject list is unavailable. Refresh to retry.</div>
            : mySubjects.length === 0 ? <div className="td-empty" role="status">No active Subjects are assigned yet. Ask your College Admin to assign a Class and Subject.</div>
              : <div className="td-assignment-list">{mySubjects.map((assignment) => <div className="td-assignment-row" key={assignment.subject_id}>
                <span className="td-assignment-icon"><BookOpenCheck size={17} /></span>
                <div>
                  <strong>{assignment.subject_name || "Subject name unavailable"}</strong>
                  <span>{assignment.subject_code || "Code unavailable"} · {assignment.department || "Department unavailable"}</span>
                </div>
                <span className="td-count-pill">{activeAssignments.filter((row) => String(row.subject_id) === String(assignment.subject_id)).length} Class(es)</span>
              </div>)}</div>}
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
        ) : !visibleSessionsAvailable ? (
          <div className="td-empty" role="status">Attendance sessions are unavailable. Refresh to retry.</div>
        ) : visibleSessions.length === 0 ? (
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
                {visibleSessions.slice(0, 8).map((session, index) => {
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
