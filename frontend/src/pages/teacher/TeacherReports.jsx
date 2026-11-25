import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { getTenantAttendanceSessions, getTenantLiveAttendance, getTenantTeacherAttendanceSummary } from "../../services/tenantAttendanceSessions";
import { getApiErrorMessage, uniqueApiErrorMessages } from "../../utils/errors";
import "./TeacherReports.css";

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportRoster(session, rows) {
  const lines = [["Session", "Class", "Subject", "Starts at", "Student ID", "Student", "Roll number", "Status", "Method", "Verified at"]];
  for (const row of rows) lines.push([session.title, session.class_name, session.subject_name, session.starts_at, row.student_id, row.name, row.roll_number, row.status, row.method, row.verified_at]);
  const blob = new Blob([lines.map((line) => line.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `attendx-session-${session.id}-attendance.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function TeacherReports() {
  const { activeCollegeId, user } = useAuth();
  const userId = user?.user_id ?? user?.id;
  const scope = `${userId ?? ""}:${activeCollegeId ?? ""}`;
  const [loadedScope, setLoadedScope] = useState("");
  const [summary, setSummary] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [listError, setListError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [classFilter, setClassFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [roster, setRoster] = useState([]);
  const [rosterState, setRosterState] = useState("idle");
  const [rosterError, setRosterError] = useState("");
  const requestId = useRef(0);
  const rosterRequestId = useRef(0);
  const explicitRetryRef = useRef(false);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setSummary(null);
    setSessions([]);
    setRoster([]);
    setSessionId("");
    setLoadedScope("");
    setListError("");
    if (!activeCollegeId) { setLoading(false); setListError("Select an active College membership to load reports."); return; }
    setLoading(true);
    const retryAuthorization = explicitRetryRef.current;
    explicitRetryRef.current = false;
    const [summaryResult, sessionsResult] = await Promise.allSettled([
      getTenantTeacherAttendanceSummary(activeCollegeId, userId, { retryAuthorization }),
      getTenantAttendanceSessions(activeCollegeId, userId, { retryAuthorization }),
    ]);
    if (requestId.current !== current) return;
    const failures = [];
    if (summaryResult.status === "fulfilled") setSummary(summaryResult.value);
    else failures.push(getApiErrorMessage(summaryResult.reason, "Teacher summary could not be loaded."));
    if (sessionsResult.status === "fulfilled" && Array.isArray(sessionsResult.value)) setSessions(sessionsResult.value);
    else if (sessionsResult.status === "fulfilled") failures.push("Attendance sessions returned an unexpected response.");
    else failures.push(getApiErrorMessage(sessionsResult.reason, "Attendance sessions could not be loaded."));
    if (failures.length) setListError(uniqueApiErrorMessages(failures));
    setLoadedScope(scope);
    setLoading(false);
  }, [activeCollegeId, scope, reload, userId]);

  const retryReports = () => {
    explicitRetryRef.current = true;
    setReload((value) => value + 1);
  };

  useEffect(() => { void load(); return () => { requestId.current += 1; }; }, [load]);

  const classOptions = useMemo(() => [...new Map(sessions.map((row) => [String(row.class_id), { id: row.class_id, name: row.class_name }])).values()], [sessions]);
  const subjectOptions = useMemo(() => [...new Map(sessions.map((row) => [String(row.subject_id), { id: row.subject_id, name: row.subject_name }])).values()], [sessions]);
  const filteredSessions = useMemo(() => sessions.filter((row) => {
    const day = String(row.starts_at || "").slice(0, 10);
    return (!classFilter || String(row.class_id) === classFilter)
      && (!subjectFilter || String(row.subject_id) === subjectFilter)
      && (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
  }), [sessions, classFilter, subjectFilter, dateFrom, dateTo]);
  const selectedSession = filteredSessions.find((row) => String(row.id) === sessionId) || null;

  useEffect(() => {
    if (!selectedSession && filteredSessions.length) setSessionId(String(filteredSessions[0].id));
    if (!filteredSessions.length) { setSessionId(""); setRoster([]); setRosterState("idle"); }
  }, [filteredSessions, selectedSession]);

  useEffect(() => {
    const version = ++rosterRequestId.current;
    setRoster([]);
    setRosterError("");
    if (!selectedSession || !activeCollegeId || loadedScope !== scope) { setRosterState("idle"); return; }
    setRosterState("loading");
    getTenantLiveAttendance(selectedSession.id, activeCollegeId).then((rows) => {
      if (rosterRequestId.current !== version) return;
      if (!Array.isArray(rows)) throw new Error("Attendance roster returned an unexpected response.");
      setRoster(rows);
      setRosterState("ready");
    }).catch((error) => {
      if (rosterRequestId.current !== version) return;
      setRosterError(getApiErrorMessage(error, "Session attendance details could not be loaded."));
      setRosterState("error");
    });
    return () => { rosterRequestId.current += 1; };
  }, [selectedSession?.id, activeCollegeId, loadedScope, scope]);

  const visible = loadedScope === scope;
  const currentSessions = visible ? filteredSessions : [];
  const currentSummary = visible ? summary : null;
  const currentRoster = visible && rosterState === "ready" ? roster : [];
  const counts = useMemo(() => ({
    present: currentRoster.filter((row) => ["present", "late"].includes(String(row.status).toLowerCase())).length,
    absent: currentRoster.filter((row) => String(row.status).toLowerCase() === "absent").length,
    pending: currentRoster.filter((row) => String(row.status).toLowerCase() === "pending").length,
  }), [currentRoster]);

  return <main className="teacher-reports-page">
    <header className="teacher-reports-header"><div><span>TEACHING WORKSPACE</span><h1>Attendance reports</h1><p>Review saved attendance sessions and the verified roster for each session.</p></div><button type="button" onClick={retryReports} disabled={loading || !activeCollegeId}><RefreshCw size={16} /> {loading ? "Refreshing…" : "Refresh"}</button></header>
    {!activeCollegeId && <p role="status">Select an active College membership to load reports.</p>}
    {loading && <p role="status">Loading your attendance reports…</p>}
    {listError && <div className="teacher-reports-alert" role="alert"><p>{listError}</p><button type="button" onClick={retryReports}>Retry</button></div>}
    {currentSummary && <section className="teacher-report-metrics" aria-label="Teacher attendance summary">{[["Attendance rate", currentSummary.attendance_percentage == null ? "N/A" : `${currentSummary.attendance_percentage}%`], ["Sessions", currentSummary.sessions], ["Active sessions", currentSummary.active_sessions], ["Assigned class-subject mappings", currentSummary.total_assignments], ["Present / late events", `${currentSummary.present_events} / ${currentSummary.late_events}`], ["Absent events", currentSummary.absent_events]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>}
    {visible && !loading && !listError && sessions.length === 0 && <section className="teacher-reports-empty" role="status"><strong>No attendance sessions yet</strong><p>Sessions created for your verified Teacher profile will appear here.</p></section>}
    {visible && sessions.length > 0 && <section className="teacher-reports-panel">
      <div className="teacher-reports-filter-grid"><label>Class<select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}><option value="">All classes</option>{classOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Subject<select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}><option value="">All subjects</option>{subjectOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>From<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label>To<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></div>
      <p className="teacher-reports-limit">Showing the latest {sessions.length} sessions returned by the attendance API (maximum 100).</p>
      {currentSessions.length === 0 ? <p role="status">No sessions match these filters.</p> : <label className="teacher-reports-session-select">Session<select value={selectedSession?.id || ""} onChange={(event) => setSessionId(event.target.value)}>{currentSessions.map((session) => <option key={session.id} value={session.id}>{session.title} · {session.class_name} · {session.subject_name} · {new Date(session.starts_at).toLocaleString()}</option>)}</select></label>}
      {selectedSession && <><div className="teacher-report-session-summary"><div><span>Present / late</span><strong>{rosterState === "ready" ? counts.present : rosterState === "error" ? "Unavailable" : "—"}</strong></div><div><span>Absent</span><strong>{rosterState === "ready" ? counts.absent : rosterState === "error" ? "Unavailable" : "—"}</strong></div><div><span>Pending</span><strong>{rosterState === "ready" ? counts.pending : rosterState === "error" ? "Unavailable" : "—"}</strong></div><button type="button" onClick={() => exportRoster(selectedSession, currentRoster)} disabled={rosterState !== "ready" || !currentRoster.length}><Download size={15} /> Export session CSV</button></div>
        {rosterState === "loading" && <p role="status">Loading saved session attendance…</p>}
        {rosterError && <p className="teacher-reports-alert" role="alert">{rosterError}</p>}
        {rosterState === "ready" && currentRoster.length === 0 && <p role="status">No enrolled roster records were returned for this session.</p>}
        {rosterState === "ready" && currentRoster.length > 0 && <div className="teacher-reports-table-wrap"><table><thead><tr><th>Student</th><th>Roll number</th><th>Status</th><th>Method</th><th>Verified at</th></tr></thead><tbody>{currentRoster.map((row) => <tr key={row.student_id}><td>{row.name}</td><td>{row.roll_number}</td><td>{row.status}</td><td>{row.method || "—"}</td><td>{row.verified_at ? new Date(row.verified_at).toLocaleString() : "—"}</td></tr>)}</tbody></table></div>}</>}
    </section>}
  </main>;
}
