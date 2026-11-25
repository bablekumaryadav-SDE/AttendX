import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import { getTenantCollegeProfile, tenantCollegeProfileErrorMessage, updateTenantCollegeProfile } from "../../../services/tenant";
import {
  getTenantAttendanceSummary,
  getTenantDashboardSummary,
  hasTenantDashboardSummaryShape,
  tenantDashboardErrorMessage,
} from "../../../services/tenantDashboard";
import { createLatestRequestGuard } from "../../../services/tenantSelection";
import "./AdminDashboard.css";

const displayCount = (value) => Number.isSafeInteger(value) ? value.toLocaleString() : "Unavailable";
const SUMMARY_KEYS = ["students", "teachers", "classes", "subjects"];

function MetricCard({ title, counts, loading }) {
  return (
    <article className="ad-stat">
      <span>{title}</span>
      <strong>{counts ? displayCount(counts.active) : "—"}</strong>
      <small>{counts ? `${displayCount(counts.total)} total · ${displayCount(counts.inactive)} inactive` : loading ? "Loading College-owned count…" : "College-owned count unavailable"}</small>
    </article>
  );
}

export default function TenantAdminDashboard() {
  const { activeCollegeId, collegeMemberships } = useAuth();
  const [summary, setSummary] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const [attendanceError, setAttendanceError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [gpsAccuracyLimit, setGpsAccuracyLimit] = useState(null);
  const [gpsSettingsLoaded, setGpsSettingsLoaded] = useState(false);
  const [gpsSettingsError, setGpsSettingsError] = useState("");
  const [gpsSettingsNotice, setGpsSettingsNotice] = useState("");
  const [gpsSettingsSaving, setGpsSettingsSaving] = useState(false);
  const canEditGpsSettings = collegeMemberships?.some(
    (membership) => String(membership.college_id) === String(activeCollegeId)
      && membership.membership_role === "college_admin"
  );
  const requestGuard = useRef(null);
  if (!requestGuard.current) requestGuard.current = createLatestRequestGuard();

  useEffect(() => {
    let cancelled = false;
    setGpsSettingsError("");
    setGpsSettingsNotice("");
    setGpsAccuracyLimit(null);
    setGpsSettingsLoaded(false);
    if (!activeCollegeId) return () => { cancelled = true; };
    getTenantCollegeProfile(activeCollegeId).then((profile) => {
      const savedValue = Number(profile?.gps_accuracy_limit_m);
      if (!Number.isInteger(savedValue) || savedValue < 1 || savedValue > 150) {
        const error = new Error("Invalid College profile response");
        error.code = "INVALID_COLLEGE_PROFILE_RESPONSE";
        throw error;
      }
      if (!cancelled) {
        setGpsAccuracyLimit(savedValue);
        setGpsSettingsLoaded(true);
      }
    }).catch((error) => {
      if (!cancelled) setGpsSettingsError(tenantCollegeProfileErrorMessage(error, "load"));
    });
    return () => { cancelled = true; };
  }, [activeCollegeId]);

  const saveGpsAccuracyLimit = async (event) => {
    event.preventDefault();
    if (!canEditGpsSettings || !gpsSettingsLoaded || gpsSettingsSaving) return;
    const value = Number(gpsAccuracyLimit);
    if (!Number.isInteger(value) || value < 1 || value > 150) {
      setGpsSettingsError("Enter a whole number from 1 to 150 metres.");
      return;
    }
    setGpsSettingsSaving(true);
    setGpsSettingsError("");
    setGpsSettingsNotice("");
    try {
      const saved = await updateTenantCollegeProfile(activeCollegeId, { gps_accuracy_limit_m: value });
      const savedValue = Number(saved?.gps_accuracy_limit_m);
      if (!Number.isInteger(savedValue) || savedValue !== value) {
        const error = new Error("Save response did not confirm the requested value");
        error.code = "INVALID_COLLEGE_PROFILE_RESPONSE";
        throw error;
      }
      setGpsAccuracyLimit(savedValue);
      setGpsSettingsNotice("GPS accuracy limit saved for this College.");
    } catch (error) {
      setGpsSettingsError(tenantCollegeProfileErrorMessage(error, "save"));
    } finally {
      setGpsSettingsSaving(false);
    }
  };

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
        setSummaryError("College dashboard returned an unexpected response. Refresh the page or contact support.");
      } else setSummaryError(tenantDashboardErrorMessage(summaryResult.reason?.response?.status));
      if (attendanceResult.status === "fulfilled") setAttendance(attendanceResult.value);
      else setAttendanceError(tenantDashboardErrorMessage(attendanceResult.reason?.response?.status));
    }).finally(() => {
      if (requestGuard.current.isCurrent(version)) setLoading(false);
    });

    return () => requestGuard.current.invalidate();
  }, [activeCollegeId, reloadVersion]);

  const partial = Boolean(summaryError) !== Boolean(attendanceError);

  return (
    <main className="admin-dashboard-page">
      <header className="ad-header">
        <div className="ad-header-copy">
          <span className="ad-eyebrow">COLLEGE ADMIN DASHBOARD</span>
          <h1>College Overview</h1>
          {summary?.college_name && <p className="ad-college-name">{summary.college_name}</p>}
          <p>Read-only metrics from verified records owned by the selected College. Unknown ownership is excluded.</p>
        </div>
        <div className="ad-header-tools">
          <div className="ad-scope-card"><span>WORKSPACE SCOPE</span><strong>{summary?.college_name || (activeCollegeId ? "Selected College" : "No College selected")}</strong><small>Tenant-scoped records only</small></div>
          <button className="ad-refresh" type="button" disabled={loading || !activeCollegeId} onClick={() => setReloadVersion((current) => current + 1)}>
            {loading ? "Refreshing…" : "Refresh data"}
          </button>
        </div>
      </header>

      {!activeCollegeId && <div className="ad-alert" role="status">Select an active College membership to view its dashboard.</div>}
      {summaryError && <div className="ad-alert" role="alert">{summaryError}</div>}
      {attendanceError && <div className="ad-alert" role="alert">Attendance metrics: {attendanceError}</div>}
      {partial && <div className="ad-alert" role="status">Some College metrics are unavailable; available cards are shown without substituting global data.</div>}

      <section className="ad-stat-grid" aria-label="College directory counts">
        {loading && !summary ? <article className="ad-stat" role="status">Loading College metrics…</article> : null}
        {!loading && summary && SUMMARY_KEYS.every((key) => summary[key].total === 0)
          ? <article className="ad-stat ad-empty">No College-owned directory records are available yet.</article>
          : null}
        <MetricCard title="Active students" counts={summary?.students} loading={loading} />
        <article className="ad-stat"><span>Face Registered</span><strong>{summary ? displayCount(summary.face_registered_count) : "Unavailable"}</strong><small>Valid enrolled embeddings in this College</small></article>
        <article className="ad-stat"><span>Face Not Registered</span><strong>{summary ? displayCount(summary.face_not_registered_count) : "Unavailable"}</strong><small>College-owned Students without a valid face embedding</small></article>
        <MetricCard title="Active teachers" counts={summary?.teachers} loading={loading} />
        <MetricCard title="Active classes" counts={summary?.classes} loading={loading} />
        <MetricCard title="Active subjects" counts={summary?.subjects} loading={loading} />
      </section>
      <p className="ad-empty">Pending and failed face enrollment states are not stored by the current enrollment workflow and are not reported as separate metrics.</p>

      <section className="ad-grid">
        {canEditGpsSettings && <article className="ad-card">
          <div className="ad-card-head"><div><span className="ad-kicker">LOCATION POLICY</span><h2>GPS accuracy limit</h2></div></div>
          <p>Maximum reported GPS accuracy accepted for attendance. This setting does not change the classroom geofence radius.</p>
          <form onSubmit={saveGpsAccuracyLimit}>
            <label htmlFor="tenant-gps-accuracy-limit">Accuracy limit (metres)</label>
            <input id="tenant-gps-accuracy-limit" type="number" min="1" max="150" step="1" value={gpsAccuracyLimit ?? ""} onChange={(event) => setGpsAccuracyLimit(event.target.value)} disabled={!gpsSettingsLoaded || gpsSettingsSaving} />
            <button type="submit" disabled={!gpsSettingsLoaded || gpsSettingsSaving}>{gpsSettingsSaving ? "Saving…" : "Save GPS limit"}</button>
          </form>
          {gpsSettingsError && <p role="alert">{gpsSettingsError}</p>}
          {gpsSettingsNotice && <p role="status">{gpsSettingsNotice}</p>}
        </article>}
        <article className="ad-card">
          <div className="ad-card-head"><div><span className="ad-kicker">COLLEGE WORKSPACE</span><h2>Read-only directories</h2></div></div>
          <div className="ad-action-grid">
            <Link to="/admin/students">Students <b>→</b></Link>
            <Link to="/admin/teachers">Teachers <b>→</b></Link>
            <Link to="/admin/classes">Classes <b>→</b></Link>
            <Link to="/admin/subjects">Subjects <b>→</b></Link>
            <Link to="/admin/attendance">Attendance history <b>→</b></Link>
          </div>
        </article>

        <article className="ad-card">
          <div className="ad-card-head"><div><span className="ad-kicker">ATTENDANCE AGGREGATES</span><h2>Recorded attendance</h2></div></div>
          {attendance ? (
            <>
              <div className="ad-risk-list">
                <div className="ad-risk-row"><strong>Legacy attendance rows</strong><b>{displayCount(attendance.legacy_attendance_rows)}</b></div>
                <div className="ad-risk-row"><strong>Session attendance events</strong><b>{displayCount(attendance.verified_attendance_event_rows)}</b></div>
                <div className="ad-risk-row"><strong>Qualified attendance records</strong><b>{displayCount(attendance.attendance_record_rows)}</b></div>
                <div className="ad-risk-row"><strong>Session event present / late / absent</strong><b>{displayCount(attendance.verified_present_events)} / {displayCount(attendance.verified_late_events)} / {displayCount(attendance.verified_absent_events)}</b></div>
                <div className="ad-risk-row"><strong>Present / late / absent</strong><b>{displayCount(attendance.present_records)} / {displayCount(attendance.late_records)} / {displayCount(attendance.absent_records)}</b></div>
                <div className="ad-risk-row"><strong>Unclassified status</strong><b>{displayCount(attendance.unclassified_status_records)}</b></div>
              </div>
              <p className="ad-empty">Recorded presence rate: {attendance.recorded_presence_rate_percent == null ? "Unavailable (no classified records)" : `${attendance.recorded_presence_rate_percent}%`}. Numerator: present + late records. Denominator: classified present + late + absent records.</p>
              <p className="ad-empty">Session event presence rate: {attendance.verified_presence_rate_percent == null ? "Unavailable (no classified events)" : `${attendance.verified_presence_rate_percent}%`}. Denominator: classified present + late + absent session events, including absences finalized when a Teacher closes a session.</p>
              {attendance.unclassified_status_records > 0 && <p className="ad-alert">Incomplete status data: {displayCount(attendance.unclassified_status_records)} qualified records have unclassified statuses and are excluded from the rate denominator.</p>}
              {attendance.trend_available ? (
                <section className="ad-trends" aria-label="Historical attendance trends">
                  <h3>Historical attendance trends</h3>
                  <p className="ad-empty">Calculated from {attendance.trend_start_date}. Each record is included only when a date-tracked student enrollment and Teacher assignment were both valid on its attendance date.</p>
                  {attendance.trend_partial && <p className="ad-alert" role="status">Partial trend coverage: {displayCount(attendance.trend_excluded_records)} otherwise qualified records lack verified relationship intervals and are excluded.</p>}
                  <div className="ad-risk-list">
                    {attendance.trends.map((trend) => <div className="ad-risk-row" key={trend.period}>
                      <strong>{trend.period}</strong>
                      <span>{displayCount(trend.present)} present · {displayCount(trend.late)} late · {displayCount(trend.absent)} absent · {displayCount(trend.unclassified)} unclassified</span>
                      <b>{trend.presence_rate_percent == null ? "N/A" : `${trend.presence_rate_percent}%`}</b>
                    </div>)}
                  </div>
                  {attendance.trend_unavailable_reason && <p className="ad-alert" role="status">{attendance.trend_unavailable_reason}</p>}
                </section>
              ) : <p className="ad-alert" role="status">{attendance.trend_unavailable_reason || "Earliest reliable trend date: not established."}</p>}
            </>
          ) : loading ? <div className="ad-empty" role="status">Loading attendance aggregates…</div> : attendanceError ? <div className="ad-empty">Attendance aggregates are unavailable.</div> : <div className="ad-empty">No attendance aggregate data is available for this College.</div>}
        </article>
      </section>
    </main>
  );
}
