import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { CalendarDays, Filter, RefreshCw, Search, X } from "lucide-react";
import {
  attendanceLoadMessage,
  getTenantAttendanceRecords,
  getTenantAttendanceRecordDetail,
  getTenantAttendanceEvents,
  getTenantAttendanceEventDetail,
} from "../../../services/tenantAttendance";
import { createLatestRequestGuard } from "../../../services/tenantSelection";
import "./TenantAttendance.css";

const text = (value) => String(value ?? "").toLowerCase();
const statusTone = (value) => ["present", "late", "absent", "excused"].includes(text(value)) ? text(value) : "unknown";

export default function TenantAttendance() {
  const { activeCollegeId } = useAuth();
  const [records, setRecords] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [partialError, setPartialError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [reload, setReload] = useState(0);
  const listGuard = useRef(null);
  const detailGuard = useRef(null);
  if (!listGuard.current) listGuard.current = createLatestRequestGuard();
  if (!detailGuard.current) detailGuard.current = createLatestRequestGuard();

  useEffect(() => {
    const version = listGuard.current.begin();
    detailGuard.current.invalidate();
    setRecords([]);
    setSelected(null);
    setError("");
    setPartialError("");
    setDetailError("");
    setDetailLoading(false);
    if (!activeCollegeId) {
      setLoading(false);
      return () => listGuard.current.invalidate();
    }
    setLoading(true);
    Promise.allSettled([
      getTenantAttendanceRecords(activeCollegeId),
      getTenantAttendanceEvents(activeCollegeId),
    ])
      .then(([recordResult, eventResult]) => {
        if (!listGuard.current.isCurrent(version)) return;
        const failures = [recordResult, eventResult].filter((result) => result.status === "rejected");
        const legacyRecords = recordResult.status === "fulfilled" && Array.isArray(recordResult.value)
          ? recordResult.value.map((row) => ({ ...row, source: "record" }))
          : [];
        const eventItems = eventResult.status === "fulfilled" && Array.isArray(eventResult.value?.items)
          ? eventResult.value.items
          : [];
        setRecords([...legacyRecords, ...eventItems.map((row) => ({ ...row, source: "verified_event" }))]);
        if (failures.length === 2) {
          const failure = recordResult.status === "rejected" ? recordResult.reason : eventResult.reason;
          setError(attendanceLoadMessage(failure?.response?.status));
        } else if (failures.length === 1) {
          setPartialError(`Some attendance history is unavailable. ${attendanceLoadMessage(failures[0].reason?.response?.status)}`);
        }
      })
      .finally(() => {
        if (listGuard.current.isCurrent(version)) setLoading(false);
      });
    return () => listGuard.current.invalidate();
  }, [activeCollegeId, reload]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((row) => {
      const date = String(row.attendance_date || "").slice(0, 10);
      return (statusFilter === "all" || text(row.status) === statusFilter)
        && (!dateFilter || date === dateFilter)
        && (!query || [row.id, row.student_id, row.student_name, row.roll_number, row.student_code, row.teacher_id, row.teacher_name, row.subject_id, row.subject_name, row.class_id, row.class_name, row.status, row.method]
          .some((value) => text(value).includes(query)));
    });
  }, [records, search, statusFilter, dateFilter]);

  async function openDetail(row) {
    const version = detailGuard.current.begin();
    setSelected(row);
    setDetailError("");
    setDetailLoading(true);
    try {
      const detail = row.source === "verified_event"
        ? await getTenantAttendanceEventDetail(row.id, activeCollegeId)
        : await getTenantAttendanceRecordDetail(row.id, activeCollegeId);
      if (detailGuard.current.isCurrent(version)) setSelected(detail);
    } catch (failure) {
      if (detailGuard.current.isCurrent(version)) setDetailError(attendanceLoadMessage(failure.response?.status, true));
    } finally {
      if (detailGuard.current.isCurrent(version)) setDetailLoading(false);
    }
  }

  function closeDetail() {
    detailGuard.current.invalidate();
    setSelected(null);
    setDetailError("");
    setDetailLoading(false);
  }

  return (
    <main className="dashboard-page tenant-attendance-page">
      <header className="tenant-attendance-hero">
        <div><span className="page-eyebrow">COLLEGE ATTENDANCE / RECORDS</span><h1>Attendance history</h1><p>Explore saved records and verified session events for the selected College.</p></div>
        <button className="tenant-attendance-refresh" type="button" disabled={loading || !activeCollegeId} onClick={() => setReload((value) => value + 1)}><RefreshCw size={15} className={loading ? "tenant-attendance-spin" : ""} />{loading ? "Loading…" : "Refresh records"}</button>
      </header>
      {!activeCollegeId && <div className="tenant-attendance-alert" role="status">Select an active College membership to view attendance.</div>}
      {error && <div className="tenant-attendance-alert error" role="alert">{error}</div>}
      {partialError && <div className="tenant-attendance-alert" role="status">{partialError}</div>}
      <section className="tenant-attendance-toolbar" aria-label="Attendance filters">
        <div className="tenant-attendance-search"><Search size={16} aria-hidden="true" /><input aria-label="Search attendance" type="search" placeholder="Search students, classes or records" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <label className="tenant-attendance-filter"><Filter size={14} aria-hidden="true" /><span>Status</span><select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option></select></label>
        <label className="tenant-attendance-filter"><CalendarDays size={14} aria-hidden="true" /><span>Date</span><input aria-label="Filter by date" type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label>
      </section>
      <div className="tenant-attendance-results"><strong>{loading ? "—" : filtered.length.toLocaleString()}</strong><span>{loading ? "loading records" : `record${filtered.length === 1 ? "" : "s"} shown`}</span></div>
      <section className="tenant-attendance-table-card" aria-label="College attendance records"><div className="tenant-attendance-table-wrap">
        <table className="tenant-attendance-table"><thead><tr><th>Record</th><th>Student</th><th>Teacher</th><th>Class</th><th>Subject</th><th>Date</th><th>Status</th><th>Source</th><th>Details</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan="9" role="status"><div className="tenant-attendance-state">Loading attendance records…</div></td></tr>
            : error || !activeCollegeId ? <tr><td colSpan="9"><div className="tenant-attendance-state empty"><span className="tenant-attendance-empty-icon"><CalendarDays size={20} /></span><strong>{error ? "Attendance history is unavailable" : "Select a College to view attendance"}</strong><span>{error ? "Refresh the page to retry when the service is available." : "Choose an active College membership in the workspace header."}</span></div></td></tr>
              : filtered.length === 0 ? <tr><td colSpan="9"><div className="tenant-attendance-state empty"><span className="tenant-attendance-empty-icon"><CalendarDays size={20} /></span><strong>No attendance records available for these filters</strong><span>Try changing the search or filters.</span></div></td></tr>
              : filtered.map((row) => <tr key={`${row.source}:${row.id}`}><td><span className="tenant-attendance-record-id">#{row.id}</span></td><td><strong>{row.student_name || row.roll_number || row.student_code || row.student_id}</strong></td><td>{row.teacher_name || row.teacher_id}</td><td>{row.class_name || row.class_id}</td><td>{row.subject_name || row.subject_id}</td><td>{row.attendance_date ? new Date(row.attendance_date).toLocaleDateString() : "Date unavailable"}</td><td><span className={`tenant-attendance-status ${statusTone(row.status)}`}>{row.status || "Unknown"}</span></td><td><span className={`tenant-attendance-source ${row.source === "verified_event" ? "verified" : "legacy"}`}>{row.source === "verified_event" ? "Verified event" : "Legacy record"}</span></td><td><button className="tenant-attendance-view" type="button" onClick={() => openDetail(row)}>View details <span aria-hidden="true">→</span></button></td></tr>)}</tbody>
        </table>
      </div></section>
      {selected && <section className="tenant-attendance-detail" aria-label="Attendance record detail" role="region">
        <div className="tenant-attendance-detail-heading"><div><span>RECORD DETAILS</span><h2>{selected.source === "verified_event" ? "Verified attendance event" : "Attendance record"} #{selected.id}</h2></div><button type="button" onClick={closeDetail} aria-label="Close attendance details"><X size={17} /></button></div>
        {detailLoading && <p role="status">Loading details…</p>}
        {detailError && <p className="tenant-attendance-alert error" role="alert">{detailError}</p>}
        {!detailLoading && !detailError && <p><span className={`tenant-attendance-status ${statusTone(selected.status)}`}>{selected.status || "Unknown"}</span><span className="tenant-attendance-detail-date">{selected.attendance_date ? new Date(selected.attendance_date).toLocaleString() : "Date unavailable"}</span></p>}
      </section>}
    </main>
  );
}






