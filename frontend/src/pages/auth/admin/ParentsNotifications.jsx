import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, RefreshCw, Search, UsersRound } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { getTenantGuardians, getTenantNotificationEvents } from "../../../services/tenant";
import "./ParentsNotifications.css";

const PAGE_SIZE = 20;

function safeError(error) {
  const status = error?.response?.status;
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) return "An active College Admin membership is required for this workspace.";
  if (status === 409) return "Select one active College membership and retry.";
  if (status === 503) return "College workspace records are unavailable. The required database schema may not be available.";
  if (!error?.response) return "The AttendX service could not be reached. Check the backend and retry.";
  return "These records could not be loaded. Retry or contact your administrator.";
}

function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function ParentsNotifications() {
  const { activeCollegeId } = useAuth();
  const [tab, setTab] = useState("parents");
  const [search, setSearch] = useState("");
  const [studentStatus, setStudentStatus] = useState("");
  const [recordStatus, setRecordStatus] = useState("");
  const [guardianPage, setGuardianPage] = useState(1);
  const [eventPage, setEventPage] = useState(1);
  const [guardians, setGuardians] = useState({ items: [], total: 0 });
  const [events, setEvents] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [guardianError, setGuardianError] = useState("");
  const [eventError, setEventError] = useState("");
  const requestVersion = useRef(0);
  const previousCollegeId = useRef(activeCollegeId);

  const load = useCallback(async (signalVersion) => {
    if (!activeCollegeId) {
      setGuardians({ items: [], total: 0 });
      setEvents({ items: [], total: 0 });
      setLoading(false);
      setGuardianError("Select an active College membership to view its records.");
      setEventError("Select an active College membership to view its records.");
      return;
    }
    setLoading(true);
    setGuardianError("");
    setEventError("");
    try {
      const [guardianOutcome, eventOutcome] = await Promise.allSettled([
        getTenantGuardians(activeCollegeId, { search: search || undefined, student_status: studentStatus || undefined, page: guardianPage, page_size: PAGE_SIZE }),
        getTenantNotificationEvents(activeCollegeId, { search: search || undefined, record_status: recordStatus || undefined, page: eventPage, page_size: PAGE_SIZE }),
      ]);
      if (signalVersion !== requestVersion.current) return;
      if (guardianOutcome.status === "fulfilled") setGuardians(guardianOutcome.value);
      else {
        setGuardians({ items: [], total: 0 });
        setGuardianError(safeError(guardianOutcome.reason));
      }
      if (eventOutcome.status === "fulfilled") setEvents(eventOutcome.value);
      else {
        setEvents({ items: [], total: 0 });
        setEventError(safeError(eventOutcome.reason));
      }
    } finally {
      if (signalVersion === requestVersion.current) setLoading(false);
    }
  }, [activeCollegeId, eventPage, guardianPage, recordStatus, search, studentStatus]);

  useEffect(() => {
    if (String(previousCollegeId.current || "") !== String(activeCollegeId || "")) {
      previousCollegeId.current = activeCollegeId;
      setGuardians({ items: [], total: 0 });
      setEvents({ items: [], total: 0 });
      setGuardianError("");
      setEventError("");
    }
    const version = ++requestVersion.current;
    void load(version);
    return () => { requestVersion.current += 1; };
  }, [load]);

  function refresh() {
    const version = ++requestVersion.current;
    void load(version);
  }

  function setTabAndSearch(nextTab) {
    setTab(nextTab);
    setSearch("");
  }

  const current = tab === "parents" ? guardians : events;
  const activeError = tab === "parents" ? guardianError : eventError;
  const page = tab === "parents" ? guardianPage : eventPage;
  const setPage = tab === "parents" ? setGuardianPage : setEventPage;
  const totalPages = Math.max(1, Math.ceil((current.total || 0) / PAGE_SIZE));

  return (
    <main className="tenant-parent-workspace">
      <header className="tenant-parent-hero">
        <div>
          <span className="tenant-parent-eyebrow">COLLEGE WORKSPACE</span>
          <h1>Parents &amp; Notifications</h1>
          <p>Review verified student contact links and stored notification event records for this College.</p>
        </div>
        <button className="tenant-parent-refresh" type="button" onClick={refresh} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" /> {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <div className="tenant-parent-tabs" role="tablist" aria-label="Parents and notification records">
        <button type="button" role="tab" aria-selected={tab === "parents"} onClick={() => setTabAndSearch("parents")}>
          <UsersRound size={17} /> Parent directory
        </button>
        <button type="button" role="tab" aria-selected={tab === "events"} onClick={() => setTabAndSearch("events")}>
          <Bell size={17} /> Notification records
        </button>
      </div>

      <section className="tenant-parent-card">
        <div className="tenant-parent-card-head">
          <div>
            <h2>{tab === "parents" ? "Linked parent contacts" : "Stored notification events"}</h2>
            <p>{tab === "parents"
              ? "Only existing guardian records linked to a student in the selected College are shown."
              : "These are database event records. A record or status is not proof of provider-confirmed email or SMS delivery."}</p>
          </div>
          <label className="tenant-parent-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search {tab === "parents" ? "parent records" : "notification records"}</span>
            <input value={search} onChange={(event) => { setSearch(event.target.value); setGuardianPage(1); setEventPage(1); }} placeholder="Search records" />
          </label>
        </div>
        <div className="tenant-parent-filters">
          {tab === "parents" ? <label>Student status
            <select value={studentStatus} onChange={(event) => { setStudentStatus(event.target.value); setGuardianPage(1); }}>
              <option value="">All linked students</option><option value="active">Active</option><option value="inactive">Inactive</option>
            </select>
          </label> : <label>Stored record status
            <select value={recordStatus} onChange={(event) => { setRecordStatus(event.target.value); setEventPage(1); }}>
              <option value="">All statuses</option><option value="queued">Queued</option><option value="sent">Sent status</option><option value="failed">Failed</option>
            </select>
          </label>}
        </div>

        {activeError && <div className="tenant-parent-alert" role="alert">{activeError} <button type="button" onClick={refresh}>Retry</button></div>}
        {loading ? <div className="tenant-parent-state" role="status">Loading College records…</div> : activeError ? null : tab === "parents" ? (
          guardians.items.length ? (
            <div className="tenant-parent-table-wrap"><table>
              <thead><tr><th>Parent / guardian</th><th>Contact</th><th>Linked student</th><th>Relationship</th><th>Student status</th></tr></thead>
              <tbody>{guardians.items.map((item) => <tr key={item.student_id}>
                <td>{item.guardian_name || "Name not recorded"}</td>
                <td>{item.guardian_mobile || item.parent_email || "No contact recorded"}<small>{item.guardian_mobile && item.parent_email ? item.parent_email : ""}</small></td>
                <td>{item.student_name}<small>{item.student_roll_number}</small></td>
                <td>{item.guardian_relationship}</td>
                <td><span className={`tenant-parent-status ${item.student_active ? "is-active" : "is-inactive"}`}>{item.student_active ? "Active" : "Inactive"}</span></td>
              </tr>)}</tbody>
            </table></div>
          ) : <div className="tenant-parent-state">No linked parent records found.</div>
        ) : events.items.length ? (
          <div className="tenant-parent-table-wrap"><table>
            <thead><tr><th>Notification record</th><th>Channel</th><th>Stored status</th><th>Read status</th><th>Created</th></tr></thead>
            <tbody>{events.items.map((item) => <tr key={item.id}>
              <td><strong>{item.title}</strong><small>{item.message}</small></td>
              <td>{item.channel}</td>
              <td><span className="tenant-parent-status">{item.record_status}</span></td>
              <td>{item.read_at ? `Read ${dateLabel(item.read_at)}` : "No read timestamp"}</td>
              <td>{dateLabel(item.created_at)}</td>
            </tr>)}</tbody>
          </table></div>
        ) : <div className="tenant-parent-state">No notification event records found.</div>}

        {!loading && !activeError && current.total > PAGE_SIZE && <footer className="tenant-parent-pagination">
          <span>{current.total} records · Page {page} of {totalPages}</span>
          <div><button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>Previous</button>
            <button type="button" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>Next</button></div>
        </footer>}
      </section>
    </main>
  );
}
