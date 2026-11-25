import React, { useEffect, useRef, useState } from "react";
import { Building2, CheckCircle2, LoaderCircle, MapPinCheck, Save, ShieldCheck, UserRoundCog } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import {
  getTenantCollegeProfile,
  tenantCollegeProfileErrorMessage,
  updateTenantCollegeProfile,
} from "../../../services/tenant";
import "./CollegeSettings.css";

const validAccuracyLimit = (value) => Number.isInteger(Number(value))
  && Number(value) >= 1
  && Number(value) <= 150;

export default function CollegeSettings() {
  const { activeCollegeId, collegeMemberships } = useAuth();
  const canManage = collegeMemberships?.some((membership) =>
    String(membership.college_id) === String(activeCollegeId)
      && membership.membership_role === "college_admin"
  );
  const [profile, setProfile] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [accuracyLimit, setAccuracyLimit] = useState("");
  const [savedAccuracyLimit, setSavedAccuracyLimit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestVersion = useRef(0);

  useEffect(() => {
    const version = ++requestVersion.current;
    let cancelled = false;
    setProfile(null);
    setDisplayName("");
    setAccuracyLimit("");
    setSavedAccuracyLimit(null);
    setError("");
    setNotice("");
    setSaving(false);
    if (!activeCollegeId) {
      setLoading(false);
      setError("Select an active College membership to load its settings.");
      return () => { cancelled = true; requestVersion.current += 1; };
    }
    setLoading(true);
    getTenantCollegeProfile(activeCollegeId).then((result) => {
      const limit = Number(result?.gps_accuracy_limit_m);
      if (!result?.id || !validAccuracyLimit(limit)) {
        throw new Error("The College settings response was incomplete.");
      }
      if (cancelled || version !== requestVersion.current) return;
      setProfile(result);
      setDisplayName(result.display_name || "");
      setAccuracyLimit(String(limit));
      setSavedAccuracyLimit(limit);
    }).catch((loadError) => {
      if (!cancelled && version === requestVersion.current) setError(tenantCollegeProfileErrorMessage(loadError, "load"));
    }).finally(() => {
      if (!cancelled && version === requestVersion.current) setLoading(false);
    });
    return () => { cancelled = true; requestVersion.current += 1; };
  }, [activeCollegeId]);

  async function saveSettings(event) {
    event.preventDefault();
    if (!canManage || !profile || saving) return;
    const version = requestVersion.current;
    const collegeId = activeCollegeId;
    const limit = Number(accuracyLimit);
    if (!validAccuracyLimit(limit)) {
      setError("Enter a whole-number GPS accuracy limit from 1 to 150 metres.");
      return;
    }
    const nextDisplayName = displayName.trim();
    if (nextDisplayName.length > 120) {
      setError("College display name cannot exceed 120 characters.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await updateTenantCollegeProfile(collegeId, {
        display_name: nextDisplayName || null,
        gps_accuracy_limit_m: limit,
      });
      if (version !== requestVersion.current || String(collegeId) !== String(activeCollegeId)) return;
      if (saved?.id !== profile.id || saved.display_name !== (nextDisplayName || null)
          || Number(saved.gps_accuracy_limit_m) !== limit) {
        throw new Error("The server did not confirm the saved College settings.");
      }
      setProfile(saved);
      setDisplayName(saved.display_name || "");
      setAccuracyLimit(String(saved.gps_accuracy_limit_m));
      setSavedAccuracyLimit(Number(saved.gps_accuracy_limit_m));
      setNotice("College settings saved successfully.");
    } catch (saveError) {
      if (version === requestVersion.current && String(collegeId) === String(activeCollegeId)) {
        setError(tenantCollegeProfileErrorMessage(saveError, "save"));
      }
    } finally {
      if (version === requestVersion.current && String(collegeId) === String(activeCollegeId)) setSaving(false);
    }
  }

  return (
    <main className="college-settings-page">
      <header className="settings-hero">
        <div className="settings-hero-copy">
          <span className="settings-eyebrow"><Building2 size={14} /> COLLEGE WORKSPACE</span>
          <h1>Settings</h1>
          <p>Manage your College profile and attendance location policy.</p>
        </div>
        <div className="settings-scope-panel" aria-label="Selected College scope">
          <span className="settings-scope-icon"><ShieldCheck size={17} /></span>
          <div>
            <small>SELECTED COLLEGE</small>
            <strong>{profile?.display_name || profile?.official_name || (loading ? "Loading College…" : "College unavailable")}</strong>
            <span>{activeCollegeId ? `College ID ${activeCollegeId} · ${canManage ? "College Admin" : "Read-only membership"}` : "No active College selected"}</span>
          </div>
        </div>
      </header>

      {!activeCollegeId && <div className="settings-alert" role="status">Select an active College membership to continue.</div>}
      {error && <div className="settings-alert error" role="alert">{error}</div>}
      {notice && <div className="settings-alert success" role="status" aria-live="polite"><CheckCircle2 size={18} />{notice}</div>}
      <p className="settings-save-scope">Both Save actions submit the current College display name and GPS accuracy policy together through the existing profile API.</p>

      <section className="settings-card-grid" aria-label="College settings">
        <article className="settings-card profile-card">
          <div className="settings-card-heading">
            <span className="settings-card-icon"><Building2 size={19} /></span>
            <div><span className="settings-card-kicker">COLLEGE INFORMATION</span><h2>College Profile</h2><p>Review the verified identity and set the name shown in your workspace.</p></div>
          </div>
          {loading ? <div className="settings-loading" role="status"><LoaderCircle size={17} />Loading College profile…</div> : profile ? (
            <form className="settings-form" onSubmit={saveSettings}>
              <div className="settings-form-grid">
                <label className="settings-field" htmlFor="college-official-name"><span>Official College Name</span><input id="college-official-name" value={profile.official_name || ""} readOnly aria-describedby="official-name-help" /><small id="official-name-help">Verified registration name · read only</small></label>
                <label className="settings-field" htmlFor="college-slug"><span>College Identifier</span><input id="college-slug" value={profile.slug || ""} readOnly /><small>Unique workspace identifier · read only</small></label>
                <label className="settings-field" htmlFor="college-display-name"><span>Display Name <em>Optional</em></span><input id="college-display-name" maxLength="120" value={displayName} onChange={(event) => { setDisplayName(event.target.value); setError(""); setNotice(""); }} disabled={!canManage || saving} aria-describedby="display-name-help" /><small id="display-name-help">Up to 120 characters. Leave blank to use the official name.</small></label>
                <label className="settings-field" htmlFor="college-status"><span>College Status</span><input id="college-status" value={profile.status || "Unknown"} readOnly /><small>Current status returned by the server</small></label>
              </div>
              {!canManage && <p className="settings-permission-note" role="status"><ShieldCheck size={16} />Only an active College Admin membership can update these settings.</p>}
              <div className="settings-card-footer"><span>Uses the existing College profile service.</span><button className="settings-button" type="submit" disabled={!canManage || saving || loading}>{saving ? <><LoaderCircle size={16} className="settings-spinner" />Saving…</> : <><Save size={16} />Save College Settings</>}</button></div>
            </form>
          ) : !error ? <p className="settings-empty" role="status">College profile is unavailable.</p> : null}
        </article>

        <article className="settings-card policy-card">
          <div className="settings-card-heading">
            <span className="settings-card-icon policy-icon"><MapPinCheck size={19} /></span>
            <div><span className="settings-card-kicker">ATTENDANCE LOCATION POLICY</span><h2>GPS Accuracy Limit</h2><p>Choose the maximum device-reported accuracy accepted during attendance verification.</p></div>
          </div>
          <div className="settings-saved-value" aria-live="polite"><span>Currently saved</span><strong>{savedAccuracyLimit == null ? "—" : `${savedAccuracyLimit} m`}</strong></div>
          <div className="settings-policy-callout"><MapPinCheck size={17} /><p>This policy controls accepted GPS accuracy. It does <strong>not</strong> change the classroom geofence radius.</p></div>
          {loading ? <div className="settings-loading" role="status"><LoaderCircle size={17} />Loading GPS policy…</div> : profile ? (
            <form className="settings-form policy-form" onSubmit={saveSettings}>
              <label className="settings-field" htmlFor="college-gps-accuracy"><span>Maximum reported accuracy <em>Metres</em></span><input id="college-gps-accuracy" type="number" min="1" max="150" step="1" value={accuracyLimit} onChange={(event) => { setAccuracyLimit(event.target.value); setError(""); setNotice(""); }} disabled={!canManage || saving} aria-describedby="gps-limit-help" /><small id="gps-limit-help">Enter a whole number from 1 to 150 metres.</small></label>
              {!canManage && <p className="settings-permission-note" role="status"><ShieldCheck size={16} />Only an active College Admin membership can update this policy.</p>}
              <div className="settings-card-footer"><span>Saved value changes only after server confirmation.</span><button className="settings-button" type="submit" disabled={!canManage || saving || loading}>{saving ? <><LoaderCircle size={16} className="settings-spinner" />Saving…</> : <><Save size={16} />Save GPS Policy</>}</button></div>
            </form>
          ) : !error ? <p className="settings-empty" role="status">GPS policy is unavailable.</p> : null}
        </article>
      </section>

      <section className="settings-account-card">
        <span className="settings-account-icon"><UserRoundCog size={20} /></span>
        <div><span className="settings-card-kicker">ACCOUNT CONTROLS</span><h2>Profile, Password and Preferences</h2><p>Account profile editing, password changes and notification preferences are not exposed by the current tenant settings API. These controls are not available here.</p></div>
        <span className="settings-unavailable-badge">Not available</span>
      </section>
    </main>
  );
}
