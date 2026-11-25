import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Clock3, FileText, History, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import {
  courseworkErrorMessage,
  getStudentCourseworkHistory,
  listStudentCoursework,
  submitStudentCoursework,
} from "../../services/coursework";
import "../CourseworkWorkspace.css";

const labelForState = (assignment) => {
  if (assignment.state === "archived" || assignment.status === "archived") return "Archived";
  if (assignment.state === "late" || assignment.latest_revision?.is_late) return "Late";
  if (assignment.state === "submitted" || assignment.submission_id) return "Submitted";
  if (assignment.state === "pending") return "Pending";
  return "Available";
};

export default function StudentAssignments() {
  const { activeCollegeId } = useAuth();
  const requestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [contentById, setContentById] = useState({});
  const [submittingId, setSubmittingId] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    setHistory(null); setHistoryFor(null); setAssignments([]);
    if (!activeCollegeId) {
      setAssignments([]); setLoading(false);
      setError("Select an active College membership to load assignments.");
      return;
    }
    setLoading(true); setError("");
    try {
      const rows = await listStudentCoursework(activeCollegeId);
      if (requestRef.current === requestId) setAssignments(Array.isArray(rows) ? rows : []);
    } catch (requestError) {
      if (requestRef.current === requestId) {
        setAssignments([]);
        setError(courseworkErrorMessage(requestError));
      }
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [activeCollegeId]);

  useEffect(() => {
    setContentById({}); setHistory(null); setHistoryFor(null);
    historyRequestRef.current += 1;
  }, [activeCollegeId]);

  useEffect(() => {
    void refresh();
    return () => { requestRef.current += 1; };
  }, [refresh]);

  const totals = useMemo(() => assignments.reduce((result, assignment) => {
    const state = labelForState(assignment);
    result[state] += 1;
    return result;
  }, { Available: 0, Pending: 0, Submitted: 0, Late: 0, Archived: 0 }), [assignments]);

  const submit = async (assignment) => {
    const content = (contentById[assignment.id] || "").trim();
    if (!activeCollegeId || !content || submittingId != null) return;
    if (!globalThis.crypto?.randomUUID) {
      setError("This browser cannot create a secure submission request key. Update the browser and retry.");
      return;
    }
    setSubmittingId(assignment.id); setError(""); setNotice("");
    try {
      await submitStudentCoursework(activeCollegeId, assignment.id, {
        idempotency_key: globalThis.crypto.randomUUID(),
        content,
      });
      setContentById((current) => ({ ...current, [assignment.id]: "" }));
      setNotice("Your submission was saved by the server.");
      await refresh();
    } catch (requestError) {
      setError(courseworkErrorMessage(requestError, "submit your work"));
    } finally {
      setSubmittingId(null);
    }
  };

  const showHistory = async (assignment) => {
    if (!activeCollegeId) return;
    const requestId = ++historyRequestRef.current;
    setHistory(null); setHistoryFor(assignment.id); setError("");
    try {
      const result = await getStudentCourseworkHistory(activeCollegeId, assignment.id);
      if (historyRequestRef.current === requestId) setHistory(result);
    } catch (requestError) {
      if (historyRequestRef.current === requestId) setError(courseworkErrorMessage(requestError, "load submission history"));
    }
  };

  return (
    <main className="coursework-page coursework-student" aria-labelledby="student-coursework-title">
      <header className="coursework-hero">
        <div><span className="coursework-eyebrow">STUDENT WORKSPACE</span><h1 id="student-coursework-title">My Assignments</h1><p>View coursework and submit text answers for your active enrollment.</p></div>
        <button className="coursework-primary-button" type="button" onClick={refresh} disabled={loading}><RefreshCw size={16} /> Refresh</button>
      </header>

      {error && <section className="coursework-unavailable" role="alert"><span className="coursework-status-icon"><ShieldAlert size={20} /></span><div><span className="coursework-eyebrow">COURSEWORK SERVICE</span><p>{error}</p><button type="button" onClick={refresh}>Retry</button></div></section>}
      {notice && <p className="coursework-notice" role="status">{notice}</p>}

      <section className="coursework-summary-grid" aria-label="Assignment status totals">
        {Object.entries(totals).map(([label, count]) => <article className="coursework-summary-card" key={label}><span>{label}</span><strong>{loading || error ? "\u2014" : count}</strong><small>{error ? "Unavailable until the API responds" : "Returned for your verified enrollment"}</small></article>)}
      </section>

      <section className="coursework-panel" aria-labelledby="student-assignment-list-title">
        <div className="coursework-panel-heading"><div><span className="coursework-eyebrow">YOUR COURSEWORK</span><h2 id="student-assignment-list-title">Assignments</h2></div><span className="coursework-muted-tag"><Clock3 size={15} /> Server-backed status</span></div>
        {loading && <p role="status">Loading your assignments…</p>}
        {!loading && !error && assignments.length === 0 && <div className="coursework-empty-state"><BookOpen size={23} /><h3>No published assignments</h3><p>Assignments for your verified account link and active enrollment will appear here.</p></div>}
        <div className="coursework-assignment-list">
          {assignments.map((assignment) => {
            const submitted = Boolean(assignment.submission_id);
            const state = labelForState(assignment);
            const archived = state === "Archived";
            return <article className="coursework-assignment-card" key={assignment.id}>
              <div className="coursework-panel-heading"><div><span className={`coursework-status-chip status-${state.toLowerCase()}`}>{state}</span><h3>{assignment.title}</h3></div><span className="coursework-deadline">Due {new Date(assignment.due_at).toLocaleString()}</span></div>
              <p className="coursework-assignment-instructions">{assignment.instructions}</p>
              {assignment.latest_revision && <p className="coursework-muted-line">Latest submission: {new Date(assignment.latest_revision.submitted_at).toLocaleString()}{assignment.latest_revision.is_late ? " · submitted late" : ""}</p>}
              {!archived && <div className="coursework-student-submit"><label htmlFor={`answer-${assignment.id}`}>{submitted ? "New revision" : "Text answer"}</label><textarea id={`answer-${assignment.id}`} rows="5" maxLength="50000" value={contentById[assignment.id] || ""} onChange={(event) => setContentById((current) => ({ ...current, [assignment.id]: event.target.value }))} placeholder={submitted ? "Write a new revision; the previous submission remains in history" : "Write your answer"} /><button className="coursework-primary-button" type="button" disabled={submittingId != null || !(contentById[assignment.id] || "").trim()} onClick={() => void submit(assignment)}><Send size={15} /> {submittingId === assignment.id ? "Submitting…" : submitted ? "Submit revision" : "Submit answer"}</button></div>}
              {submitted && <button type="button" className="coursework-secondary-button" onClick={() => void showHistory(assignment)}><History size={15} /> View submission history</button>}
              {historyFor === assignment.id && history && <div className="coursework-revision-list"><h4><FileText size={16} /> Submission history</h4>{history.revisions?.length ? history.revisions.map((revision) => <article key={revision.id}><strong>Revision {revision.revision_number} · {revision.is_late ? "Late" : "On time"}</strong><time>{new Date(revision.submitted_at).toLocaleString()}</time><p>{revision.content}</p></article>) : <p>No submission has been recorded.</p>}</div>}
              {historyFor === assignment.id && !history && <p role="status">Loading submission history…</p>}
            </article>;
          })}
        </div>
      </section>
      <p className="coursework-role-note">Submission is reported only after the server returns a saved revision. Server time and deadline status are authoritative.</p>
    </main>
  );
}
