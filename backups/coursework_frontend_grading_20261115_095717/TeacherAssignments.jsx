import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, BookOpen, CalendarClock, ClipboardList, FileText, Plus, RefreshCw, Search, Send, Eye } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import {
  archiveTeacherCoursework,
  courseworkErrorMessage,
  createTeacherCourseworkDraft,
  extendTeacherCourseworkDeadline,
  getTeacherCourseworkSubmission,
  listTeacherCoursework,
  listTeacherCourseworkMappings,
  listTeacherCourseworkSubmissions,
  publishTeacherCoursework,
  updateTeacherCourseworkDraft,
} from "../../services/coursework";
import "../CourseworkWorkspace.css";

const emptyForm = { teacher_assignment_id: "", title: "", instructions: "", issued_at: "", due_at: "", maximum_marks: "" };
const toApiDate = (value) => value ? new Date(value).toISOString() : null;
const toLocalDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export default function TeacherAssignments() {
  const { activeCollegeId } = useAuth();
  const requestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const [assignments, setAssignments] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [selected, setSelected] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [monitorRequested, setMonitorRequested] = useState(false);
  const [submissions, setSubmissions] = useState([]);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [reason, setReason] = useState("");
  const [extendedDueAt, setExtendedDueAt] = useState("");

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!activeCollegeId) {
      setAssignments([]); setMappings([]); setLoading(false);
      setError("Select an active College membership to load coursework.");
      return;
    }
    setLoading(true); setError(""); setAssignments([]); setMappings([]);
    try {
      const [rows, authorizedMappings] = await Promise.all([
        listTeacherCoursework(activeCollegeId),
        listTeacherCourseworkMappings(activeCollegeId),
      ]);
      if (requestRef.current !== requestId) return;
      setAssignments(Array.isArray(rows) ? rows : []);
      setMappings(Array.isArray(authorizedMappings) ? authorizedMappings : []);
    } catch (requestError) {
      if (requestRef.current === requestId) {
        setAssignments([]); setMappings([]);
        setError(courseworkErrorMessage(requestError));
      }
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [activeCollegeId]);

  useEffect(() => {
    setFormOpen(false); setEditingId(null); setSelected(null); setSubmissions([]); setSelectedSubmission(null); setDetailsLoading(false); setMonitorRequested(false);
    detailRequestRef.current += 1;
  }, [activeCollegeId]);

  useEffect(() => {
    void refresh();
    return () => { requestRef.current += 1; };
  }, [refresh]);

  const visibleAssignments = useMemo(() => assignments.filter((item) => {
    const mapping = mappings.find((candidate) => candidate.id === item.teacher_assignment_id);
    const matchesStatus = !statusFilter || item.status === statusFilter;
    const matchesClass = !classFilter || String(mapping?.class_id) === classFilter;
    const matchesSubject = !subjectFilter || String(mapping?.subject_id) === subjectFilter;
    const query = search.trim().toLowerCase();
    return matchesStatus && matchesClass && matchesSubject
      && (!query || `${item.title} ${item.instructions}`.toLowerCase().includes(query));
  }), [assignments, mappings, statusFilter, classFilter, subjectFilter, search]);

  const classOptions = useMemo(() => [...new Map(mappings.map((mapping) => [mapping.class_id, mapping.class_name])).entries()], [mappings]);
  const subjectOptions = useMemo(() => [...new Map(mappings.map((mapping) => [mapping.subject_id, mapping.subject_name])).entries()], [mappings]);

  const openCreate = () => {
    setEditingId(null); setForm({ ...emptyForm, teacher_assignment_id: mappings[0] ? String(mappings[0].id) : "" });
    setFormOpen(true); setError(""); setNotice("");
  };

  const openEdit = (item) => {
    setEditingId(item.id);
    setForm({
      teacher_assignment_id: String(item.teacher_assignment_id), title: item.title,
      instructions: item.instructions, issued_at: toLocalDate(item.issued_at),
      due_at: toLocalDate(item.due_at), maximum_marks: item.maximum_marks ?? "",
    });
    setFormOpen(true); setError(""); setNotice("");
  };

  const saveDraft = async (event) => {
    event.preventDefault();
    if (saving || !activeCollegeId) return;
    if (!form.teacher_assignment_id || !form.title.trim() || !form.instructions.trim() || !form.issued_at || !form.due_at) {
      setError("Choose an authorized class and subject, then complete the title, instructions, issue time, and deadline.");
      return;
    }
    const issuedAt = toApiDate(form.issued_at); const dueAt = toApiDate(form.due_at);
    if (!issuedAt || !dueAt || new Date(dueAt) <= new Date(issuedAt)) {
      setError("The deadline must be later than the issue time.");
      return;
    }
    setSaving(true); setError(""); setNotice("");
    const payload = {
      teacher_assignment_id: Number(form.teacher_assignment_id), title: form.title.trim(),
      instructions: form.instructions.trim(), issued_at: issuedAt, due_at: dueAt,
      maximum_marks: form.maximum_marks === "" ? null : Number(form.maximum_marks),
    };
    try {
      if (editingId == null) await createTeacherCourseworkDraft(activeCollegeId, payload);
      else await updateTeacherCourseworkDraft(activeCollegeId, editingId, {
        title: payload.title, instructions: payload.instructions, issued_at: payload.issued_at,
        due_at: payload.due_at, maximum_marks: payload.maximum_marks,
      });
      setFormOpen(false); await refresh(); setNotice("Draft saved by the coursework API.");
    } catch (requestError) { setError(courseworkErrorMessage(requestError, "save")); }
    finally { setSaving(false); }
  };

  const publish = async (assignmentId) => {
    if (saving || !activeCollegeId) return;
    setSaving(true); setError(""); setNotice("");
    try { await publishTeacherCoursework(activeCollegeId, assignmentId); await refresh(); setNotice("Assignment published."); }
    catch (requestError) { setError(courseworkErrorMessage(requestError, "publish")); }
    finally { setSaving(false); }
  };

  const archive = async (assignmentId) => {
    if (saving || !activeCollegeId) return;
    if (!reason.trim()) { setError("Enter an archive reason before archiving."); return; }
    setSaving(true); setError(""); setNotice("");
    try { await archiveTeacherCoursework(activeCollegeId, assignmentId, reason.trim()); setReason(""); await refresh(); setNotice("Assignment archived."); }
    catch (requestError) { setError(courseworkErrorMessage(requestError, "archive")); }
    finally { setSaving(false); }
  };

  const extendDeadline = async (assignmentId) => {
    if (saving || !activeCollegeId) return;
    if (!extendedDueAt || !reason.trim()) { setError("Choose a later deadline and provide an audit reason."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      await extendTeacherCourseworkDeadline(activeCollegeId, assignmentId, toApiDate(extendedDueAt), reason.trim());
      setReason(""); setExtendedDueAt(""); await refresh(); setNotice("Deadline extension recorded.");
    } catch (requestError) { setError(courseworkErrorMessage(requestError, "extend the deadline")); }
    finally { setSaving(false); }
  };

  const viewSubmissions = async (assignment) => {
    if (!activeCollegeId) return;
    const requestId = ++detailRequestRef.current;
    setSelected(assignment); setSubmissions([]); setSelectedSubmission(null); setError("");
    setMonitorRequested(true);
    setDetailsLoading(true);
    try {
      const rows = await listTeacherCourseworkSubmissions(activeCollegeId, assignment.id);
      if (detailRequestRef.current === requestId) setSubmissions(Array.isArray(rows) ? rows : []);
    } catch (requestError) {
      if (detailRequestRef.current === requestId) setError(courseworkErrorMessage(requestError));
    } finally {
      if (detailRequestRef.current === requestId) setDetailsLoading(false);
    }
  };

  const viewRevisionHistory = async (submission) => {
    if (!activeCollegeId || !selected) return;
    const requestId = ++detailRequestRef.current;
    setSelectedSubmission(null); setError("");
    try {
      const detail = await getTeacherCourseworkSubmission(activeCollegeId, selected.id, submission.student_id);
      if (detailRequestRef.current === requestId) setSelectedSubmission(detail);
    } catch (requestError) {
      if (detailRequestRef.current === requestId) setError(courseworkErrorMessage(requestError));
    }
  };

  const publishedCount = assignments.filter((item) => item.status === "published").length;
  const draftCount = assignments.filter((item) => item.status === "draft").length;
  const archivedCount = assignments.filter((item) => item.status === "archived").length;

  return (
    <main className="coursework-page coursework-teacher" aria-labelledby="teacher-coursework-title">
      <header className="coursework-hero"><div><span className="coursework-eyebrow">TEACHER WORKSPACE</span><h1 id="teacher-coursework-title">Assignments</h1><p>Create coursework for your active class and subject assignments.</p></div>
        <button className="coursework-primary-button" type="button" onClick={openCreate} disabled={loading || !mappings.length}><Plus size={17} /> Create Assignment</button>
      </header>

      {error && <div className="coursework-unavailable" role="alert"><span className="coursework-status-icon"><FileText size={20} /></span><div><span className="coursework-eyebrow">COURSEWORK API</span><p>{error}</p><button type="button" onClick={refresh}>Retry</button></div></div>}
      {notice && <p className="coursework-notice" role="status">{notice}</p>}
      <section className="coursework-summary-grid" aria-label="My assignment totals">
        {[["Total", assignments.length], ["Published", publishedCount], ["Draft", draftCount], ["Archived", archivedCount]].map(([label, count]) => <article className="coursework-summary-card" key={label}><span>{label}</span><strong>{loading || error ? "\u2014" : count}</strong><small>{error ? "Unavailable until the API responds" : "From the selected College API"}</small></article>)}
      </section>

      {formOpen && <section className="coursework-panel" aria-labelledby="teacher-assignment-form-title">
        <div className="coursework-panel-heading"><div><span className="coursework-eyebrow">AUTHORING</span><h2 id="teacher-assignment-form-title">{editingId == null ? "Create a draft" : "Edit draft"}</h2></div><button type="button" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button></div>
        <form className="coursework-form-grid" onSubmit={saveDraft}>
          <label className="coursework-form-wide">Authorized Class and Subject<select required value={form.teacher_assignment_id} onChange={(event) => setForm((current) => ({ ...current, teacher_assignment_id: event.target.value }))}><option value="">Select your assignment</option>{mappings.map((mapping) => <option key={mapping.id} value={mapping.id}>{mapping.class_name} · {mapping.subject_name}{mapping.academic_year ? ` · ${mapping.academic_year}` : ""}{mapping.semester ? ` · Semester ${mapping.semester}` : ""}</option>)}</select></label>
          <label>Title<input required maxLength={240} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></label>
          <label>Maximum marks (optional)<input type="number" min="0" step="0.01" value={form.maximum_marks} onChange={(event) => setForm((current) => ({ ...current, maximum_marks: event.target.value }))} /></label>
          <label>Issue time<input type="datetime-local" required value={form.issued_at} onChange={(event) => setForm((current) => ({ ...current, issued_at: event.target.value }))} /></label>
          <label>Deadline<input type="datetime-local" required value={form.due_at} onChange={(event) => setForm((current) => ({ ...current, due_at: event.target.value }))} /></label>
          <label className="coursework-form-wide">Instructions<textarea required maxLength={20000} rows="5" value={form.instructions} onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))} /></label>
          <div className="coursework-actions coursework-form-wide"><button type="submit" disabled={saving || !mappings.length}>{saving ? "Saving…" : "Save Draft"}</button></div>
        </form>
      </section>}

      <section className="coursework-panel" aria-labelledby="teacher-assignment-list-title">
        <div className="coursework-panel-heading"><div><span className="coursework-eyebrow">COURSEWORK</span><h2 id="teacher-assignment-list-title">My Assignments</h2></div><button type="button" onClick={refresh} disabled={loading}><RefreshCw size={15} /> Refresh</button></div>
        <fieldset className="coursework-form-grid coursework-filter-grid">
          <label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title or instructions" /></label>
          <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
          <label>Class<select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}><option value="">All authorized classes</option>{classOptions.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}</select></label>
          <label>Subject<select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}><option value="">All authorized subjects</option>{subjectOptions.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}</select></label>
        </fieldset>
        {loading && <p role="status">Loading coursework…</p>}
        {!loading && !error && visibleAssignments.length === 0 && <div className="coursework-empty-state"><BookOpen size={23} /><h3>{assignments.length ? "No assignments match these filters" : "No assignments yet"}</h3><p>Create a draft using one of your active Class and Subject mappings.</p></div>}
        {visibleAssignments.length > 0 && <div className="coursework-table-wrap"><table className="coursework-table"><thead><tr><th>Assignment</th><th>Status</th><th>Issue</th><th>Deadline</th><th>Actions</th></tr></thead><tbody>{visibleAssignments.map((item) => <tr key={item.id}><td><strong>{item.title}</strong><small>{mappings.find((mapping) => mapping.id === item.teacher_assignment_id)?.class_name || "Authorized Class"} · {mappings.find((mapping) => mapping.id === item.teacher_assignment_id)?.subject_name || "Subject"}</small></td><td><span className={`coursework-status-chip status-${item.status}`}>{item.status}</span></td><td>{new Date(item.issued_at).toLocaleString()}</td><td>{new Date(item.due_at).toLocaleString()}</td><td className="coursework-row-actions"><button type="button" onClick={() => viewSubmissions(item)}><Eye size={14} /> Details & submissions</button>{item.status === "draft" && <><button type="button" onClick={() => openEdit(item)}>Edit draft</button><button type="button" disabled={saving} onClick={() => publish(item.id)}><Send size={14} /> Publish</button></>}{item.status === "published" && <><button type="button" onClick={() => { setSelected(item); setSubmissions([]); setMonitorRequested(false); setReason(""); setExtendedDueAt(toLocalDate(item.due_at)); }}>Extend deadline</button><button type="button" onClick={() => { detailRequestRef.current += 1; setSelected((current) => current?.id === item.id ? null : item); setSubmissions([]); setMonitorRequested(false); setReason(""); }}>Archive</button></>}</td></tr>)}</tbody></table></div>}
      </section>

      {selected && <section className="coursework-panel" aria-labelledby="teacher-submission-monitor-title"><div className="coursework-panel-heading"><div><span className="coursework-eyebrow">{monitorRequested ? "ASSIGNMENT DETAILS & SUBMISSION MONITOR" : "ASSIGNMENT DETAILS"}</span><h2 id="teacher-submission-monitor-title">{selected.title}</h2></div><button type="button" onClick={() => { detailRequestRef.current += 1; setSelected(null); setSelectedSubmission(null); setSubmissions([]); setDetailsLoading(false); setMonitorRequested(false); }}>Close</button></div>
        <p>{selected.instructions}</p><p className="coursework-muted-line">Status: {selected.status} · Issued {new Date(selected.issued_at).toLocaleString()} · Due {new Date(selected.due_at).toLocaleString()}</p>
        {selected.status === "published" && <div className="coursework-form-grid"><label>New deadline<input type="datetime-local" value={extendedDueAt} onChange={(event) => setExtendedDueAt(event.target.value)} /></label><label>Audit reason<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} /></label><div className="coursework-actions coursework-form-wide"><button type="button" disabled={saving} onClick={() => extendDeadline(selected.id)}>Record deadline extension</button><button type="button" className="coursework-danger-button" disabled={saving} onClick={() => archive(selected.id)}><Archive size={14} /> Archive assignment</button></div></div>}
        {detailsLoading && <p role="status">Loading enrolled students and submission status…</p>}
        {monitorRequested && !detailsLoading && !error && <div className="coursework-table-wrap"><table className="coursework-table"><thead><tr><th>Student</th><th>Roll number</th><th>Status</th><th>Latest submission</th><th>History</th></tr></thead><tbody>{submissions.map((item) => <tr key={item.student_id}><td>{item.student_name}</td><td>{item.roll_number}</td><td>{item.state}</td><td>{item.latest_revision ? new Date(item.latest_revision.submitted_at).toLocaleString() : "Not submitted"}</td><td>{item.submission_id && <button type="button" onClick={() => viewRevisionHistory(item)}>View revisions</button>}</td></tr>)}{!submissions.length && <tr><td colSpan="5">No enrolled students or submissions were returned for this assignment.</td></tr>}</tbody></table></div>}
        {selectedSubmission && <div className="coursework-revision-list"><h3>{selectedSubmission.student_name} · submission history</h3>{selectedSubmission.revisions.map((revision) => <article key={revision.id}><strong>Revision {revision.revision_number} · {revision.is_late ? "Late" : "On time"}</strong><time>{new Date(revision.submitted_at).toLocaleString()}</time><p>{revision.content}</p></article>)}</div>}
      </section>}
      <p className="coursework-role-note">Only active verified Teacher account links and the authenticated Teacher’s active Class-Subject mappings are used by the server.</p>
    </main>
  );
}
