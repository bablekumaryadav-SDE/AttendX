import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  getPlatformCollege,
  getPlatformCollegeHistory,
  listPlatformColleges,
  setPlatformCollegeStatus,
  updatePlatformCollege,
} from "../../services/collegeRegistration";
import { getApiErrorMessage } from "../../utils/errors";
import { ArrowUpRight, Building2, Landmark, ShieldCheck } from "lucide-react";
import "./SuperAdminHome.css";

export default function SuperAdminColleges() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [edit, setEdit] = useState({
    official_name: "", display_name: "", college_type: "", address: "", city: "", state: "",
    postal_code: "", country: "", official_email: "", contact_number: "", website: "",
  });
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const result = await listPlatformColleges({ q: query });
      if (requestId.current === id) setRows(Array.isArray(result) ? result : []);
    } catch (requestError) {
      if (requestId.current === id) setError(getApiErrorMessage(requestError, "College directory could not be loaded."));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    refresh();
    return () => { requestId.current += 1; };
  }, [refresh]);

  async function openCollege(id) {
    const request = ++requestId.current;
    setSelected(null);
    setHistory([]);
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const [detail, events] = await Promise.all([getPlatformCollege(id), getPlatformCollegeHistory(id)]);
      if (request === requestId.current) {
        setSelected(detail);
        setHistory(Array.isArray(events) ? events : []);
        setEdit({
          official_name: detail.official_name || "", display_name: detail.display_name || "",
          college_type: detail.college_type || "", address: detail.address || "", city: detail.city || "",
          state: detail.state || "", postal_code: detail.postal_code || "", country: detail.country || "",
          official_email: detail.official_email || "", contact_number: detail.contact_number || "", website: detail.website || "",
        });
        setReason("");
      }
    } catch (requestError) {
      if (request === requestId.current) setError(getApiErrorMessage(requestError, "College details could not be loaded."));
    } finally {
      if (request === requestId.current) setBusy(false);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await updatePlatformCollege(selected.id, {
        official_name: edit.official_name,
        display_name: edit.display_name.trim() || null,
        college_type: edit.college_type || null,
        address: edit.address || null,
        city: edit.city || null,
        state: edit.state || null,
        postal_code: edit.postal_code || null,
        country: edit.country || null,
        official_email: edit.official_email || null,
        contact_number: edit.contact_number || null,
        website: edit.website || null,
      });
      setSelected(updated);
      setEdit({
        official_name: updated.official_name || "", display_name: updated.display_name || "",
        college_type: updated.college_type || "", address: updated.address || "", city: updated.city || "",
        state: updated.state || "", postal_code: updated.postal_code || "", country: updated.country || "",
        official_email: updated.official_email || "", contact_number: updated.contact_number || "", website: updated.website || "",
      });
      setNotice("College profile saved.");
      await refresh();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "College profile could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus() {
    if (!selected || busy || !reason.trim()) {
      if (!reason.trim()) setError("Enter a reason for this status change.");
      return;
    }
    const target = selected.status === "active" ? "suspended" : "active";
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await setPlatformCollegeStatus(selected.id, target, reason.trim());
      setNotice(target === "suspended" ? "College suspended. Its tenant access is now denied." : "College reactivated.");
      await refresh();
      await openCollege(selected.id);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "College status was not changed."));
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
        <div className="platform-header-identity"><span className="platform-brand-glyph"><ShieldCheck size={20} /></span><div><p>ATTENDX / PLATFORM</p><h1>College directory</h1><span>{user?.name} · {user?.email}</span></div></div>
        <div className="platform-header-actions"><button type="button" onClick={() => navigate("/platform")}>Applications</button><button type="button" onClick={signOut}>Sign out</button></div>
      </header>
      <section className="platform-hero" aria-label="College directory workspace">
        <div className="platform-hero-copy"><span className="platform-hero-kicker"><Landmark size={14} /> PLATFORM DIRECTORY</span><h2>Institution records, clearly in view.</h2><p>Review current College profiles, their provisioning state and recorded status history.</p></div>
        <div className="platform-hero-count"><span className="platform-hero-icon"><Building2 size={18} /></span><div><strong>{loading ? "—" : rows.length}</strong><span>in this result set</span></div><ArrowUpRight size={17} aria-hidden="true" /></div>
      </section>
      <div className="platform-review-notice">College profile editing is limited to registration/profile fields. Slugs, ownership, memberships, account roles, and account activation cannot be changed here. Approvals remain pending activation until a verified activation process is configured.</div>
      {error && <p className="platform-review-error" role="alert">{error}</p>}
      {notice && <p className="platform-review-success" role="status">{notice}</p>}
      <section className="platform-review-grid" aria-label="College management">
        <div className="platform-application-list">
          <div className="platform-section-heading"><h2>Colleges</h2></div>
          <form className="platform-search-form" onSubmit={(event) => { event.preventDefault(); setQuery(searchInput.trim()); setSelected(null); }}><label>Search Colleges<input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} maxLength={200} placeholder="Name or College identifier" /></label><button type="submit">Search</button></form>
          {loading ? <p role="status">Loading Colleges…</p> : rows.length === 0 ? <p>No Colleges found.</p> : <ul>{rows.map((college) => <li key={college.id}><button type="button" className={selected?.id === college.id ? "platform-application-selected" : ""} onClick={() => openCollege(college.id)}><strong>{college.display_name || college.official_name}</strong><span>{college.slug} · {college.application_reference || `College ${college.id}`}</span><small>{college.status.replaceAll("_", " ")}{college.provisioning_status ? ` · ${college.provisioning_status.replaceAll("_", " ")}` : ""}</small></button></li>)}</ul>}
        </div>
        <div className="platform-application-detail">
          <h2>College details</h2>
          {busy && !selected ? <p role="status">Loading College details…</p> : !selected ? <p>Select a College to view its profile, administrators and status history.</p> : <>
            <dl>{[["Identifier", selected.slug], ["Status", selected.status], ["Created", selected.created_at ? new Date(selected.created_at).toLocaleString() : "—"], ["Updated", selected.updated_at ? new Date(selected.updated_at).toLocaleString() : "—"], ["Application", selected.application_reference || "No registration application linked"], ["Application state", selected.application_status || "—"], ["Provisioning", selected.provisioning_status || "—"]].map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl>
            {selected.application_id && <><h3>Submitted registration</h3><dl>{[["Type", selected.college_type], ["Address", `${selected.address}, ${selected.city}, ${selected.state} ${selected.postal_code}, ${selected.country}`], ["Official email", selected.official_email], ["Phone", selected.contact_number], ["Website", selected.website || "Not provided"], ["Representative", selected.admin_name], ["Proposed Admin email", selected.admin_email], ["Representative phone", selected.admin_contact_number]].map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl></>}
            <h3>Associated College Admin memberships</h3>{selected.admins?.length ? <ul className="platform-admin-list">{selected.admins.map((admin) => <li key={admin.membership_id}><strong>{admin.name}</strong><span>{admin.email}</span><small>Account {admin.account_active ? "active" : "inactive"} · membership {admin.membership_status.replaceAll("_", " ")}</small></li>)}</ul> : <p>No College Admin memberships are associated.</p>}
            <h3>Permitted profile fields</h3><form className="platform-college-edit" onSubmit={saveProfile}>
              {[["official_name", "Official College name", 200], ["display_name", "Display name", 120], ["college_type", "College type", 80], ["address", "Address", 255], ["city", "City", 100], ["state", "State / region", 100], ["postal_code", "Postal code", 20], ["country", "Country", 80], ["official_email", "Official email", 254], ["contact_number", "Phone (international format)", 32], ["website", "Website", 2048]].map(([field, label, maxLength]) => <label key={field}>{label}<input type={field === "official_email" ? "email" : field === "contact_number" ? "tel" : field === "website" ? "url" : "text"} required={field === "official_name"} maxLength={maxLength} value={edit[field]} onChange={(event) => setEdit((current) => ({ ...current, [field]: event.target.value }))} /></label>)}
              <button type="submit" disabled={busy}>Save profile</button>
            </form>
            {(selected.status === "active" || selected.status === "suspended") && <section className="platform-status-editor"><h3>College access status</h3><label>Reason<textarea required minLength={3} maxLength={1000} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} /></label><button type="button" disabled={busy || !reason.trim()} onClick={changeStatus}>{selected.status === "active" ? "Suspend College" : "Reactivate College"}</button></section>}
            <h3>Status history</h3>{history.length ? <ol className="platform-review-history">{history.map((event) => <li key={event.id}><strong>{event.action.replaceAll("_", " ")}</strong><span>{new Date(event.created_at).toLocaleString()}</span><p>{event.previous_status || "new"} → {event.new_status} · actor {event.actor_user_id ?? "system"}</p>{event.reason && <p>{event.reason}</p>}</li>)}</ol> : <p>No status history recorded.</p>}
          </>}
        </div>
      </section>
    </main>
  );
}
