import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { getMyAttendance } from "../../services/attendance";
import { getApiErrorMessage } from "../../utils/errors";
import "./StudentReports.css";

function listFrom(value) {
  if (Array.isArray(value)) return value;
  for (const key of ["items", "records", "attendance"]) if (Array.isArray(value?.[key])) return value[key];
  return null;
}

function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

function downloadRows(rows) {
  const data = [["Date", "Class", "Subject", "Session", "Status", "Method"], ...rows.map((row) => [row.date, row.class_name, row.subject_name, row.session_title, row.status, row.method])];
  const blob = new Blob([data.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "attendx-my-attendance-report.csv";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function StudentReports() {
  const { activeCollegeId, user } = useAuth();
  const userId = user?.user_id ?? user?.id;
  const scope = `${userId ?? ""}:${activeCollegeId ?? ""}`;
  const [loadedScope, setLoadedScope] = useState("");
  const [records, setRecords] = useState([]);
  const [dataStatus, setDataStatus] = useState("loading");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setLoadedScope("");
    setRecords([]);
    setError("");
    if (!activeCollegeId) { setDataStatus("idle"); setError("Select an active College membership to load your attendance report."); return; }
    setDataStatus("loading");
    try {
      const result = listFrom(await getMyAttendance(activeCollegeId));
      if (requestId.current !== current) return;
      if (!result) throw new Error("Attendance history returned an unexpected response.");
      setRecords(result);
      setDataStatus("ready");
      setLoadedScope(scope);
    } catch (requestError) {
      if (requestId.current !== current) return;
      setDataStatus("error");
      setError(getApiErrorMessage(requestError, "Your attendance report could not be loaded."));
      setLoadedScope(scope);
    }
  }, [activeCollegeId, scope, reload]);

  useEffect(() => { void load(); return () => { requestId.current += 1; }; }, [load]);

  const visibleRecords = loadedScope === scope && dataStatus === "ready" ? records : [];
  const filtered = useMemo(() => visibleRecords.filter((row) => {
    const day = String(row.date || "").slice(0, 10);
    return (statusFilter === "all" || String(row.status).toLowerCase() === statusFilter)
      && (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
  }), [visibleRecords, statusFilter, dateFrom, dateTo]);
  const stats = useMemo(() => {
    const present = filtered.filter((row) => String(row.status).toLowerCase() === "present").length;
    const late = filtered.filter((row) => String(row.status).toLowerCase() === "late").length;
    const absent = filtered.filter((row) => String(row.status).toLowerCase() === "absent").length;
    const classified = present + late + absent;
    return { present, late, absent, classified, rate: classified ? Math.round(((present + late) / classified) * 10000) / 100 : null };
  }, [filtered]);

  return <main className="student-reports-page">
    <header className="student-reports-header"><div><span>PERSONAL ATTENDANCE</span><h1>My attendance report</h1><p>Review and export attendance records returned for your verified Student profile.</p></div><div><button type="button" onClick={() => setReload((value) => value + 1)} disabled={dataStatus === "loading" || !activeCollegeId}><RefreshCw size={16} /> {dataStatus === "loading" ? "Refreshing…" : "Refresh"}</button><button type="button" onClick={() => downloadRows(filtered)} disabled={dataStatus !== "ready" || filtered.length === 0}><Download size={16} /> Export CSV</button></div></header>
    {!activeCollegeId && <p role="status">Select an active College membership to load your report.</p>}
    {dataStatus === "loading" && <p role="status">Loading your attendance history…</p>}
    {dataStatus === "error" && <div className="student-reports-alert" role="alert"><p>{error || "Your attendance report is unavailable."}</p><button type="button" onClick={() => setReload((value) => value + 1)}>Retry</button></div>}
    {dataStatus === "ready" && loadedScope === scope && <>
      <section className="student-report-metrics" aria-label="Filtered attendance totals">{[["Present", stats.present], ["Late", stats.late], ["Absent", stats.absent], ["Attendance rate", stats.rate == null ? "N/A" : `${stats.rate}%`]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
      <section className="student-reports-panel"><div className="student-reports-filter-grid"><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="present">Present</option><option value="late">Late</option><option value="absent">Absent</option></select></label><label>From<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label>To<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></div>
        {records.length === 0 ? <div className="student-reports-empty" role="status"><strong>No attendance data yet</strong><p>No attendance records have been returned for your verified Student profile.</p></div> : filtered.length === 0 ? <p role="status">No attendance records match these filters.</p> : <div className="student-reports-table-wrap"><table><thead><tr><th>Date</th><th>Session</th><th>Class</th><th>Subject</th><th>Status</th><th>Method</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td>{row.date ? new Date(row.date).toLocaleString() : "—"}</td><td>{row.session_title || "—"}</td><td>{row.class_name || "—"}</td><td>{row.subject_name || "—"}</td><td>{row.status}</td><td>{row.method || "—"}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </main>;
}
