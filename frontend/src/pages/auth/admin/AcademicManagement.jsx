import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSubject, deactivateSubject, getSubjects, updateSubject } from "../../../services/academic";
import { createLatestRequestGuard } from "../../../services/tenantSelection";
import { getApiErrorMessage } from "../../../utils/errors";
import { useAuth } from "../../../context/AuthContext";
import { subjectLoadMessage } from "../../../services/tenantSelection";
import "./AcademicManagement.css";

const emptyForm = { name: "", code: "", department: "" };

export default function AcademicManagement() {
  const { activeCollegeId, collegeMemberships } = useAuth();
  const canManage = collegeMemberships.some((membership) =>
    String(membership.college_id) === String(activeCollegeId) && membership.membership_role === "college_admin");
  const [subjects, setSubjects] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const requestGuard = useRef(null);
  if (!requestGuard.current) requestGuard.current = createLatestRequestGuard();

  const load = useCallback(async () => {
    const version = requestGuard.current.begin();
    setLoading(true);
    setError("");
    setSubjects([]);
    try {
      const rows = await getSubjects(activeCollegeId);
      if (requestGuard.current.isCurrent(version)) setSubjects(Array.isArray(rows) ? rows : []);
    } catch (requestError) {
      if (requestGuard.current.isCurrent(version)) {
        setSubjects([]);
        setError(getApiErrorMessage(requestError, subjectLoadMessage(requestError.response?.status)));
      }
    } finally {
      if (requestGuard.current.isCurrent(version)) setLoading(false);
    }
  }, [activeCollegeId]);

  useEffect(() => {
    void load();
    return () => requestGuard.current.invalidate();
  }, [load]);

  const visibleSubjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return subjects.filter((subject) => !query ||
      [subject.name, subject.code, subject.department]
        .some((value) => String(value || "").toLowerCase().includes(query)));
  }, [subjects, search]);

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError("");
    setFormOpen(true);
  };

  const startEdit = (subject) => {
    setEditingId(subject.id);
    setForm({ name: subject.name || "", code: subject.code || "", department: subject.department || "" });
    setFormError("");
    setFormOpen(true);
  };

  const save = async (event) => {
    event.preventDefault();
    if (!activeCollegeId || saving) return;
    setSaving(true);
    setFormError("");
    const payload = {
      name: form.name.trim(),
      code: form.code.trim(),
      department: form.department.trim() || null,
    };
    try {
      if (editingId == null) await createSubject(payload, activeCollegeId);
      else await updateSubject(editingId, payload, activeCollegeId);
      setFormOpen(false);
      await load();
    } catch (requestError) {
      setFormError(getApiErrorMessage(requestError, subjectLoadMessage(requestError.response?.status)));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (subjectId) => {
    if (!activeCollegeId || saving || !window.confirm("Deactivate this Subject? Existing academic and attendance history will be retained.")) return;
    setSaving(true);
    setError("");
    try {
      await deactivateSubject(subjectId, activeCollegeId);
      await load();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, subjectLoadMessage(requestError.response?.status)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="academic-page">
      <header className="academic-header">
        <div><span>COLLEGE CATALOG</span><h1>Subjects</h1><p>Subjects for the explicitly selected College.</p></div>
        <div className="academic-header-actions">
          {canManage && <button type="button" onClick={startCreate}>Add Subject</button>}
          <button type="button" onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </header>
      {error && <div className="academic-alert" role="alert">{error}</div>}
      {formOpen && canManage && (
        <form className="academic-form" onSubmit={save}>
          <strong>{editingId == null ? "Add Subject" : "Edit Subject"}</strong>
          {formError && <div className="academic-alert" role="alert">{formError}</div>}
          <label>Subject name<input required minLength={1} maxLength={100} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>Code<input required minLength={1} maxLength={50} value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} /></label>
          <label>Department<input maxLength={100} value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} /></label>
          <button type="submit" disabled={saving || !activeCollegeId}>{saving ? "Saving…" : "Save Subject"}</button>
          <button className="academic-cancel" type="button" disabled={saving} onClick={() => setFormOpen(false)}>Cancel</button>
        </form>
      )}
      <section className="academic-card">
        <div className="academic-toolbar">
          <div><strong>Subjects</strong><span>{visibleSubjects.length} records</span></div>
          <input aria-label="Search subjects" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search subjects…" />
        </div>
        {loading ? <div className="academic-empty" role="status">Loading Subjects…</div> : (
          <div className="academic-table-wrap">
            <table className="academic-table">
              <thead><tr><th>Name</th><th>Code</th><th>Department</th><th>Status</th>{canManage && <th>Actions</th>}</tr></thead>
              <tbody>
                {visibleSubjects.map((subject) => (
                  <tr key={subject.id}>
                    <td><strong>{subject.name}</strong></td><td>{subject.code}</td>
                    <td>{subject.department || "—"}</td><td>{subject.is_active ? "Active" : "Inactive"}</td>
                    {canManage && <td><button type="button" onClick={() => startEdit(subject)} disabled={saving}>Edit</button>{subject.is_active && <button type="button" onClick={() => void deactivate(subject.id)} disabled={saving}>Deactivate</button>}</td>}
                  </tr>
                ))}
                {!error && visibleSubjects.length === 0 && (
                  <tr><td colSpan={canManage ? 5 : 4} className="academic-empty">No Subjects found for this College.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {canManage && <aside className="academic-note"><strong>History is preserved</strong><p>Deactivating a Subject retains its existing academic and attendance records.</p></aside>}
    </div>
  );
}
