import React, { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, UserRound } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { getMyStudentProfile } from "../services/attendance";
import { getMyTeacherProfile } from "../services/teachers";
import { getApiErrorMessage } from "../utils/errors";
import "./ProfilePage.css";

const PROFILE_CONFIG = {
  teacher: {
    title: "My profile",
    load: getMyTeacherProfile,
    fields: [
      ["Teacher name", "name"], ["Email", "email"], ["Employee ID", "employee_id"],
      ["Department", "department"], ["Designation", "designation"], ["Qualification", "qualification"],
      ["Mobile", "mobile"], ["Address", "address"], ["Joining date", "joining_date"],
    ],
  },
  student: {
    title: "My profile",
    load: getMyStudentProfile,
    fields: [
      ["Student name", "name"], ["Email", "email"], ["Student ID", "student_code"],
      ["Roll number", "roll_number"], ["Course", "course"], ["Department", "department"],
      ["Academic year", "current_academic_year"], ["Semester", "current_semester"],
      ["Admission session", "admission_session"], ["Section", "section"], ["Mobile", "mobile"],
      ["Address", "address"], ["City", "city"], ["State", "state"], ["Postal code", "postal_code"],
    ],
  },
};

export default function ProfilePage({ profileKind }) {
  const { activeCollegeId, user } = useAuth();
  const config = PROFILE_CONFIG[profileKind];
  const userId = user?.user_id ?? user?.id;
  const [profile, setProfile] = useState(null);
  const [loadedScope, setLoadedScope] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setProfile(null);
    setLoadedScope("");
    setError("");
    if (!activeCollegeId || !config) {
      setLoading(false);
      setError(!activeCollegeId ? "Select an active College membership to view your profile." : "This profile view is unavailable.");
      setLoadedScope(`${userId ?? ""}:${activeCollegeId ?? ""}`);
      return;
    }
    setLoading(true);
    try {
      const result = await config.load(activeCollegeId);
      if (requestId.current === current) {
        setProfile(result);
        setLoadedScope(`${userId ?? ""}:${activeCollegeId ?? ""}`);
      }
    } catch (requestError) {
      if (requestId.current === current) {
        const detail = getApiErrorMessage(requestError, "Your profile could not be loaded.");
        setError(requestError?.response?.status === 403 && /verified (Teacher|Student) profile link/i.test(detail)
          ? `${detail} Ask your College Admin to verify the correct existing profile and login account using official institutional records.`
          : detail);
        setLoadedScope(`${userId ?? ""}:${activeCollegeId ?? ""}`);
      }
    } finally {
      if (requestId.current === current) setLoading(false);
    }
  }, [activeCollegeId, config, reload, userId]);

  useEffect(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load, userId]);

  if (!config) return <main className="self-profile-page"><h1>Profile</h1><p role="alert">This profile view is unavailable.</p></main>;

  return (
    <main className="self-profile-page">
      <header className="self-profile-header">
        <div className="self-profile-icon"><UserRound size={22} aria-hidden="true" /></div>
        <div><span>PERSONAL WORKSPACE</span><h1>{config.title}</h1><p>Your profile from the active College record.</p></div>
        <button type="button" onClick={() => setReload((value) => value + 1)} disabled={loading || !activeCollegeId}>
          <RefreshCw size={16} aria-hidden="true" /> {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>
      {loading && <section className="self-profile-state" role="status">Loading your verified profile…</section>}
      {!loading && loadedScope === `${userId ?? ""}:${activeCollegeId ?? ""}` && error && <section className="self-profile-alert" role="alert"><strong>Profile unavailable</strong><p>{error}</p><button type="button" onClick={() => setReload((value) => value + 1)}>Retry</button></section>}
      {!loading && loadedScope === `${userId ?? ""}:${activeCollegeId ?? ""}` && profile && <>
        <section className="self-profile-college"><span>College</span><strong>{profile.college_name}</strong><small>College ID {profile.college_id} · Profile ID {profile.id}</small></section>
        <section className="self-profile-grid" aria-label="Profile details">
          {config.fields.map(([label, key]) => <div className="self-profile-field" key={key}><span>{label}</span><strong>{profile[key] == null || profile[key] === "" ? "Not recorded" : String(profile[key])}</strong></div>)}
          <div className="self-profile-field"><span>Profile status</span><strong>{profile.is_active ? "Active" : "Inactive"}</strong></div>
        </section>
        <p className="self-profile-note">Profile details are read-only here. Contact your College Admin for permitted updates.</p>
      </>}
    </main>
  );
}
