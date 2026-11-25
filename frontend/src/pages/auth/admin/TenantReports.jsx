import React, { useEffect, useRef, useState } from "react";
import { BarChart3, Download, RefreshCw } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import {
  getTenantAttendanceSummary,
  getTenantDashboardSummary,
  hasTenantAttendanceSummaryShape,
  hasTenantDashboardSummaryShape,
  tenantDashboardErrorMessage,
} from "../../../services/tenantDashboard";
import { createLatestRequestGuard } from "../../../services/tenantSelection";
import { buildTenantReportCsv } from "../../../utils/tenantReportCsv";
import "./TenantReports.css";

const count = (value) => Number.isSafeInteger(value) ? value.toLocaleString() : "Unavailable";
const rate = (value) => typeof value === "number" ? `${value}%` : "Unavailable";

function downloadCsv(summary, attendance) {
  const csv = buildTenantReportCsv(summary, attendance);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "attendx-college-report.csv";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function TenantReports() {
  const { activeCollegeId } = useAuth();
  const [summary, setSummary] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const [attendanceError, setAttendanceError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const requestGuard = useRef(null);
  if (!requestGuard.current) requestGuard.current = createLatestRequestGuard();

  useEffect(() => {
    const version = requestGuard.current.begin();
    setSummary(null);
    setAttendance(null);
    setSummaryError("");
    setAttendanceError("");
    if (!activeCollegeId) {
      setLoading(false);
      return () => requestGuard.current.invalidate();
    }

    setLoading(true);
    Promise.allSettled([
      getTenantDashboardSummary(activeCollegeId),
      getTenantAttendanceSummary(activeCollegeId),
    ]).then(([summaryResult, attendanceResult]) => {
      if (!requestGuard.current.isCurrent(version)) return;
      if (summaryResult.status === "fulfilled" && hasTenantDashboardSummaryShape(summaryResult.value)) {
        setSummary(summaryResult.value);
      } else if (summaryResult.status === "fulfilled") {
        setSummaryError("College report returned an unexpected response. Refresh and try again.");
      } else setSummaryError(tenantDashboardErrorMessage(summaryResult.reason?.response?.status));

      if (attendanceResult.status === "fulfilled" && hasTenantAttendanceSummaryShape(attendanceResult.value)) {
        setAttendance(attendanceResult.value);
      } else if (attendanceResult.status === "fulfilled") {
        setAttendanceError("Attendance report returned an unexpected response. Refresh and try again.");
      } else setAttendanceError(tenantDashboardErrorMessage(attendanceResult.reason?.response?.status));
    }).finally(() => {
      if (requestGuard.current.isCurrent(version)) setLoading(false);
    });

    return () => requestGuard.current.invalidate();
  }, [activeCollegeId, reloadVersion]);

  const hasExportData = Boolean(summary && attendance);
  const reportCards = attendance ? [
    ["Recorded presence rate", rate(attendance.recorded_presence_rate_percent), "Based on classified present, late and absent records"],
    ["Session event presence", rate(attendance.verified_presence_rate_percent), "Based on verified session events"],
    ["Present / late / absent", `${count(attendance.present_records)} / ${count(attendance.late_records)} / ${count(attendance.absent_records)}`, "Saved attendance records"],
    ["Verified session events", count(attendance.verified_attendance_event_rows), "College-scoped session history"],
  ] : [];

  return (
    <main className="tenant-reports-page">
      <header className="tenant-reports-header">
        <div>
          <span className="tenant-reports-eyebrow"><BarChart3 size={14} /> COLLEGE ANALYTICS</span>
          <h1>Reports &amp; Analytics</h1>
          <p>Verified College-scoped summaries from the existing tenant reporting APIs.</p>
        </div>
        <div className="tenant-reports-actions">
          <button type="button" className="tenant-reports-button secondary" onClick={() => setReloadVersion((value) => value + 1)} disabled={loading || !activeCollegeId}>
            <RefreshCw size={16} /> {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" className="tenant-reports-button" onClick={() => downloadCsv(summary, attendance)} disabled={!hasExportData}>
            <Download size={16} /> Export available summary
          </button>
        </div>
      </header>

      {!activeCollegeId && <section className="tenant-reports-state" role="status"><strong>Select a College</strong><p>Choose an active College membership to load its reports.</p></section>}
      {summaryError && <section className="tenant-reports-alert" role="alert"><strong>College summary unavailable</strong><p>{summaryError}</p></section>}
      {attendanceError && <section className="tenant-reports-alert" role="alert"><strong>Attendance report unavailable</strong><p>{attendanceError}</p></section>}
      {loading && <section className="tenant-reports-state" role="status">Loading College reports…</section>}

      {summary && <section className="tenant-reports-section">
        <div className="tenant-reports-section-heading"><div><span>COLLEGE OVERVIEW</span><h2>{summary.college_name}</h2></div></div>
        <div className="tenant-reports-entity-grid">
          {["students", "teachers", "classes", "subjects"].map((key) => (
            <article className="tenant-reports-card" key={key}>
              <span>{key}</span><strong>{count(summary[key].total)}</strong>
              <small>{count(summary[key].active)} active · {count(summary[key].inactive)} inactive</small>
            </article>
          ))}
          <article className="tenant-reports-card accent"><span>Face registered</span><strong>{count(summary.face_registered_count)}</strong><small>{count(summary.face_not_registered_count)} not registered</small></article>
        </div>
      </section>}

      {attendance && <section className="tenant-reports-section">
        <div className="tenant-reports-section-heading"><div><span>ATTENDANCE</span><h2>Recorded attendance summary</h2></div></div>
        <div className="tenant-reports-metric-grid">{reportCards.map(([label, value, note]) => <article className="tenant-reports-card" key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</div>
        <p className="tenant-reports-note">Unclassified records: {count(attendance.unclassified_status_records)}. They are excluded from the recorded presence-rate denominator.</p>
        {attendance.trend_available ? <section className="tenant-reports-trends" aria-label="Historical attendance trend">
          <div><span>HISTORICAL TREND</span><h3>From {attendance.trend_start_date || "the earliest verified date"}</h3></div>
          {attendance.trend_partial && <p role="status">Partial coverage: {count(attendance.trend_excluded_records)} records without verified relationship dates are excluded.</p>}
          <div className="tenant-reports-trend-list">{attendance.trends.map((point) => <article key={point.period}><strong>{point.period}</strong><span>{count(point.present)} present · {count(point.late)} late · {count(point.absent)} absent</span><b>{rate(point.presence_rate_percent)}</b></article>)}</div>
        </section> : <section className="tenant-reports-state" role="status"><strong>Historical trends unavailable</strong><p>{attendance.trend_unavailable_reason || "Verified relationship effective dates are not available."}</p></section>}
      </section>}

      <section className="tenant-reports-limits"><strong>Available reporting scope</strong><p>This view and its CSV export contain only the aggregate fields returned by the approved College-scoped APIs. Date-range, class, subject and student-level reports are unavailable until tenant-safe reporting APIs are implemented and reviewed.</p></section>
    </main>
  );
}
