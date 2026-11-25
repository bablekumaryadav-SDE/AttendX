import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CalendarDays, ClipboardList, Filter, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { courseworkErrorMessage, getAdminCourseworkAssignment, isCourseworkFilterUnavailable, listAdminCoursework, listAdminCourseworkSubmissions } from "../services/coursework";
import "./CourseworkWorkspace.css";

const filtersEmpty = { teacher_id: "", class_id: "", subject_id: "", status: "", due_from: "", due_to: "" };
const toDateTimeInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const toUtcDateTime = (value) => value ? new Date(value).toISOString() : "";

export default function CourseworkMigrationRequired() {
  const { activeCollegeId } = useAuth();
  const requestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const [assignments, setAssignments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [facets, setFacets] = useState({ teachers: [], classes: [], subjects: [] });
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState(filtersEmpty);
  const [appliedFilters, setAppliedFilters] = useState(filtersEmpty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [routeUnavailable, setRouteUnavailable] = useState(false);
  const [selected, setSelected] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    setAssignments([]); setSubmissions([]); setSelected(null);
    setRouteUnavailable(false);
    if (!activeCollegeId) {
      setLoading(false); setSummary(null); setFacets({ teachers: [], classes: [], subjects: [] }); setTotal(0);
      setError("Select an active College membership to view monitoring data.");
      return;
    }
    setLoading(true); setError("");
    try {
      const response = await listAdminCoursework(activeCollegeId, appliedFilters, { limit: 25, offset });
      if (requestRef.current !== requestId) return;
      const summaryFields = ["total", "published", "draft", "archived", "submissions", "pending_submissions", "late_submissions"];
      if (!response || !Array.isArray(response.items) || !response.summary
        || summaryFields.some((field) => !Number.isSafeInteger(response.summary[field]) || response.summary[field] < 0)) {
        throw new Error("The coursework monitoring API returned an invalid response.");
      }
      setSummary(response.summary);
      setRouteUnavailable(false);
      setFacets({ teachers: response.teachers || [], classes: response.classes || [], subjects: response.subjects || [] });
      setTotal(Number.isSafeInteger(response.total) ? response.total : 0);
      setAssignments(response.items);
    } catch (requestError) {
      if (requestRef.current === requestId) {
        setSummary(null); setFacets({ teachers: [], classes: [], subjects: [] }); setTotal(0); setAssignments([]);
        setRouteUnavailable(requestError?.response?.status === 404 && !isCourseworkFilterUnavailable(requestError));
        setError(courseworkErrorMessage(requestError));
      }
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [activeCollegeId, appliedFilters, offset]);

  useEffect(() => {
    setFilters(filtersEmpty); setAppliedFilters(filtersEmpty); setSelected(null); setSubmissions([]); setOffset(0);
    setDetailLoading(false); setDetailError("");
    detailRequestRef.current += 1;
  }, [activeCollegeId]);

  useEffect(() => {
    void refresh();
    return () => { requestRef.current += 1; };
  }, [refresh]);

  const counts = useMemo(() => ({
    total: summary?.total ?? 0,
    published: summary?.published ?? 0,
    draft: summary?.draft ?? 0,
    archived: summary?.archived ?? 0,
    submissions: summary?.submissions ?? 0,
    pending: summary?.pending_submissions ?? 0,
    late: summary?.late_submissions ?? 0,
  }), [summary]);

  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  const viewDetails = async (assignment) => {
    const requestId = ++detailRequestRef.current;
    setSelected(assignment); setSubmissions([]); setDetailError(""); setDetailLoading(true);
    try {
      const [detail, rows] = await Promise.all([
        getAdminCourseworkAssignment(activeCollegeId, assignment.id),
        listAdminCourseworkSubmissions(activeCollegeId, assignment.id),
      ]);
      if (!detail || detail.id !== assignment.id || !Array.isArray(rows)) {
        throw new Error("The assignment detail API returned an invalid response.");
      }
      if (detailRequestRef.current === requestId) {
        setSelected(detail);
        setSubmissions(rows);
      }
    } catch (requestError) {
      if (detailRequestRef.current === requestId) {
        setSubmissions([]);
        setDetailError(courseworkErrorMessage(requestError, "load assignment details"));
      }
    } finally {
      if (detailRequestRef.current === requestId) setDetailLoading(false);
    }
  };

  return (
    <main className="coursework-page coursework-admin" aria-labelledby="coursework-admin-title">
      <header className="coursework-hero"><div><span className="coursework-eyebrow">COLLEGE WORKSPACE · MONITORING</span><h1 id="coursework-admin-title">Assignments</h1><p>Monitor teacher-created coursework and student submissions for your College.</p></div><div className="coursework-hero-badge"><ShieldCheck size={17} /> Monitoring only</div></header>

      {error && <section className="coursework-unavailable" role="alert"><span className="coursework-status-icon"><ClipboardList size={21} /></span><div><span className="coursework-eyebrow">{routeUnavailable ? "COURSEWORK ROUTE NOT REGISTERED" : "COURSEWORK SERVICE"}</span><h2>{routeUnavailable ? "Coursework monitoring is not enabled yet" : "Monitoring data could not be loaded"}</h2><p>{error}</p><button type="button" onClick={refresh}>Retry</button></div></section>}

      <section className="coursework-summary-grid" aria-label="Assignments overview">
        {[["Total assignments", counts.total], ["Published", counts.published], ["Draft", counts.draft], ["Archived", counts.archived], ["Submissions", counts.submissions], ["Pending submissions", counts.pending], ["Late submissions", counts.late]].map(([label, count]) => <article className="coursework-summary-card" key={label}><span>{label}</span><strong>{loading || error ? "\u2014" : count}</strong><small>{error ? "Unavailable until the API responds" : "College-scoped API results"}</small></article>)}
      </section>

      <section className="coursework-panel" aria-labelledby="coursework-monitor-title">
        <div className="coursework-panel-heading"><div><span className="coursework-eyebrow">COLLEGE OVERSIGHT</span><h2 id="coursework-monitor-title">Assignment monitoring</h2></div><button type="button" onClick={refresh} disabled={loading}><RefreshCw size={15} /> Refresh</button></div>
        <fieldset className="coursework-form-grid coursework-filter-grid" disabled={loading || Boolean(error)} aria-label="Filter monitoring data">
          <label>Teacher<select value={filters.teacher_id} onChange={(event) => updateFilter("teacher_id", event.target.value)}><option value="">All teachers</option>{facets.teachers.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
          <label>Class<select value={filters.class_id} onChange={(event) => updateFilter("class_id", event.target.value)}><option value="">All classes</option>{facets.classes.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
          <label>Subject<select value={filters.subject_id} onChange={(event) => updateFilter("subject_id", event.target.value)}><option value="">All subjects</option>{facets.subjects.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
          <label>Status<select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}><option value="">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
          <label>Due from<input type="datetime-local" value={toDateTimeInput(filters.due_from)} onChange={(event) => updateFilter("due_from", toUtcDateTime(event.target.value))} /></label>
          <label>Due to<input type="datetime-local" value={toDateTimeInput(filters.due_to)} onChange={(event) => updateFilter("due_to", toUtcDateTime(event.target.value))} /></label>
          <div className="coursework-actions coursework-form-wide"><button type="button" disabled={loading} onClick={() => { setOffset(0); setAppliedFilters({ ...filters }); }}><Filter size={15} /> Apply filters</button><button type="button" disabled={loading} onClick={() => { setFilters(filtersEmpty); setOffset(0); setAppliedFilters(filtersEmpty); }}>Clear filters</button></div>
        </fieldset>
        {loading && <p role="status">Loading College coursework…</p>}
        {!loading && !error && assignments.length === 0 && <div className="coursework-empty-state"><BookOpen size={23} /><h3>{total ? "No assignments on this page" : "No assignments found for this College."}</h3><p>{total ? "Return to an earlier page or adjust the filters." : "No coursework records were returned for the selected College."}</p></div>}
        {!error && assignments.length > 0 && <div className="coursework-table-wrap"><table className="coursework-table coursework-monitor-table"><thead><tr><th>Assignment</th><th>Teacher</th><th>Class</th><th>Subject</th><th>Status</th><th>Issue date</th><th>Due date</th><th>Submissions</th><th>Pending</th><th>Late</th><th>Actions</th></tr></thead><tbody>{assignments.map((item) => <tr key={item.id}><td><strong>{item.title}</strong><small>Assignment #{item.id}{item.maximum_marks != null ? ` · ${item.maximum_marks} marks` : ""}</small></td><td>{item.teacher_name}</td><td>{item.class_name}<small>{item.academic_year || "Academic year not set"}{item.semester ? ` · Semester ${item.semester}` : ""}</small></td><td>{item.subject_name}</td><td><span className={`coursework-status-chip status-${item.status}`}>{item.status}</span></td><td>{new Date(item.issued_at).toLocaleString()}</td><td>{new Date(item.due_at).toLocaleString()}</td><td>{item.submission_count}/{item.enrolled_count}<small>{item.completion_percentage}% complete</small></td><td>{item.pending_count}</td><td>{item.late_submission_count}</td><td><button type="button" onClick={() => void viewDetails(item)}>View details</button></td></tr>)}</tbody></table></div>}
      </section>

      {!error && total > 25 && <nav className="coursework-actions" aria-label="Assignment result pages"><button type="button" disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 25))}>Previous page</button><span>Showing {offset + 1}–{Math.min(offset + 25, total)} of {total}</span><button type="button" disabled={loading || offset + 25 >= total} onClick={() => setOffset((value) => value + 25)}>Next page</button></nav>}

      {selected && <section className="coursework-panel" aria-labelledby="coursework-admin-details"><div className="coursework-panel-heading"><div><span className="coursework-eyebrow">MONITORING ONLY</span><h2 id="coursework-admin-details">{selected.title} details</h2></div><button type="button" onClick={() => { detailRequestRef.current += 1; setSelected(null); setSubmissions([]); setDetailError(""); setDetailLoading(false); }}>Close</button></div>{detailError && <div className="coursework-unavailable" role="alert"><p>{detailError}</p><button type="button" onClick={() => void viewDetails(selected)}>Retry details</button></div>}{detailLoading && <p role="status">Loading assignment details…</p>}{!detailLoading && !detailError && <><dl className="coursework-detail-grid"><dt>Teacher</dt><dd>{selected.teacher_name}</dd><dt>Class</dt><dd>{selected.class_name}</dd><dt>Subject</dt><dd>{selected.subject_name}</dd><dt>Status</dt><dd>{selected.status}</dd><dt>Issue date</dt><dd>{new Date(selected.issued_at).toLocaleString()}</dd><dt>Due date</dt><dd>{new Date(selected.due_at).toLocaleString()}</dd><dt>Maximum marks</dt><dd>{selected.maximum_marks ?? "Not set"}</dd><dt>Instructions</dt><dd>{selected.instructions}</dd><dt>Submission progress</dt><dd>{selected.submission_count}/{selected.enrolled_count} submitted · {selected.pending_count} pending · {selected.late_submission_count} late</dd></dl><div className="coursework-table-wrap"><table className="coursework-table"><thead><tr><th>Student</th><th>Roll number</th><th>Status</th><th>Latest submitted</th></tr></thead><tbody>{submissions.map((item) => <tr key={item.student_id}><td>{item.student_name}</td><td>{item.roll_number}</td><td>{item.state}</td><td>{item.latest_revision ? new Date(item.latest_revision.submitted_at).toLocaleString() : "Not submitted"}</td></tr>)}{!submissions.length && <tr><td colSpan="4">No enrolled student submission rows were returned.</td></tr>}</tbody></table></div></>}</section>}
      <p className="coursework-role-note">College Admin can monitor but cannot create, edit, publish, extend, or archive teacher-owned coursework from this page.</p>
    </main>
  );
}
