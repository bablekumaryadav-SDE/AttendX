import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  approveCollegeApplication,
  getCollegeApplication,
  getCollegeApplicationHistory,
  listCollegeApplications,
  rejectCollegeApplication,
  startCollegeApplicationReview,
} from "../../services/collegeRegistration";
import { getApiErrorMessage } from "../../utils/errors";
import "./SuperAdminHome.css";

function reviewRequestErrorMessage(error, fallback) {
  if (error?.response?.status === 503) {
    return "College application review is temporarily unavailable. Retry later; if the problem continues, ask the platform administrator to check the service and database schema.";
  }
  return getApiErrorMessage(error, fallback);
}

export default function SuperAdminHome() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("pending");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [applications, setApplications] = useState([]);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const rows = await listCollegeApplications(filter, search);
      if (requestId.current === id) setApplications(Array.isArray(rows) ? rows : []);
    } catch (requestError) {
      if (requestId.current === id) setError(reviewRequestErrorMessage(requestError, "College applications could not be loaded."));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => {
    refresh();
    return () => { requestId.current += 1; };
  }, [refresh]);

  async function openApplication(applicationId) {
    const id = ++requestId.current;
    setSelected(null);
    setHistory([]);
    setError("");
    setBusy(true);
    try {
      const [details, events] = await Promise.all([
        getCollegeApplication(applicationId),
        getCollegeApplicationHistory(applicationId),
      ]);
      if (requestId.current === id) {
        setSelected(details);
        setHistory(Array.isArray(events) ? events : []);
      }
    } catch (requestError) {
      if (requestId.current === id) setError(reviewRequestErrorMessage(requestError, "Application details could not be loaded."));
    } finally {
      if (requestId.current === id) setBusy(false);
    }
  }

  async function decide(action) {
    if (!selected || busy) return;
    if (action === "reject" && !reason.trim()) {
      setError("Enter a reason before rejecting this application.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (action === "start") await startCollegeApplicationReview(selected.id, reason.trim());
      if (action === "approve") await approveCollegeApplication(selected.id, reason.trim());
      if (action === "reject") await rejectCollegeApplication(selected.id, reason.trim());
      await refresh();
      await openApplication(selected.id);
    } catch (requestError) {
      setError(reviewRequestErrorMessage(requestError, "The application decision was not confirmed."));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <main className="platform-review-shell">
      <header className="platform-review-header">
        <div><p>AttendX platform</p><h1>Super Admin</h1><span>{user?.name} · {user?.email}</span></div>
        <div className="platform-header-actions"><button type="button" onClick={() => navigate("/platform/colleges")}>College directory</button><button type="button" onClick={signOut}>Sign out</button></div>
      </header>
      <div className="platform-review-notice"><strong>Approval process:</strong> approving an application activates the College, College Admin account and membership. The College Admin can then sign in using the email and password provided during registration.</div>
      {error && <p className="platform-review-error" role="alert">{error}</p>}
      <section className="platform-review-grid" aria-label="College application review">
        <div className="platform-application-list">
          <div className="platform-section-heading"><h2>College applications</h2><label>Status<select value={filter} onChange={(event) => { setFilter(event.target.value); setSelected(null); }}><option value="pending">Pending</option><option value="under_review">Under review</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label></div>
          <form className="platform-search-form" onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()); setSelected(null); }}><label>Search applications<input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} maxLength={200} placeholder="Reference, College or email" /></label><button type="submit">Search</button></form>
          {loading ? <p role="status">Loading applications…</p> : applications.length === 0 ? <p>No applications in this status.</p> : (
            <ul>{applications.map((application) => <li key={application.id}>
              <button type="button" className={selected?.id === application.id ? "platform-application-selected" : ""} onClick={() => openApplication(application.id)}>
                <strong>{application.college_name}</strong><span>{application.application_reference}</span><small>{application.city}, {application.state} · {application.status.replaceAll("_", " ")}</small>
              </button>
            </li>)}</ul>
          )}
        </div>

        <div className="platform-application-detail">
          <h2>Application details</h2>
          {busy && !selected ? <p role="status">Loading details…</p> : !selected ? <p>Select an application to review its submitted details and history.</p> : (
            <>
              <dl>{[
                ["Reference", selected.application_reference], ["Status", selected.status.replaceAll("_", " ")],
                ["College", selected.college_name], ["Type", selected.college_type], ["Official email", selected.official_email],
                ["Phone", selected.contact_number], ["Address", `${selected.address}, ${selected.city}, ${selected.state} ${selected.postal_code}, ${selected.country}`],
                ["Website", selected.website || "Not provided"], ["Representative", selected.admin_name],
                ["Proposed Admin email", selected.admin_email], ["Admin phone", selected.admin_contact_number],
                ["Submitted", new Date(selected.submitted_at).toLocaleString()],
                ["Reviewed", selected.reviewed_at ? new Date(selected.reviewed_at).toLocaleString() : "Not reviewed"],
                ["Reviewed by user ID", selected.reviewed_by_user_id ?? "—"], ["Review reason", selected.review_reason || "—"],
              ].map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl>
              <label className="platform-review-reason">Review reason / note<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} rows={3} /></label>
              {(selected.status === "pending" || selected.status === "under_review") && <div className="platform-review-actions">
                {selected.status === "pending" && <button type="button" disabled={busy} onClick={() => decide("start")}>Begin review</button>}
                <button type="button" disabled={busy} onClick={() => decide("approve")}>Approve</button>
                <button type="button" className="platform-reject-button" disabled={busy} onClick={() => decide("reject")}>Reject</button>
              </div>}
              {selected.status === "approved" && <p className="platform-pending-activation">Approved · awaiting secure admin activation. No invitation email was sent.</p>}
              <h3>Review history</h3>
              {history.length ? <ol className="platform-review-history">{history.map((event) => <li key={event.id}><strong>{event.decision.replaceAll("_", " ")}</strong><span>{new Date(event.created_at).toLocaleString()}</span>{event.reason && <p>{event.reason}</p>}</li>)}</ol> : <p>No review events recorded.</p>}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
