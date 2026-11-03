import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  activateAssignment, createAssignment, createSubject, deactivateAssignment,
  deleteSubject, getAssignments, getClasses, getSubjects,
  updateAssignment, updateSubject,
} from "../../../services/academic";
import { getTeachers } from "../../../services/teachers";
import "./AcademicManagement.css";
import { getApiErrorMessage } from "../../../utils/errors";

const emptySubject = { name: "", code: "", department: "" };
const emptyAssignment = { teacher_id: "", class_id: "", subject_id: "", academic_year: "", semester: "" };
const errorText = (error) => getApiErrorMessage(error);

export default function AcademicManagement() {
  const [tab, setTab] = useState("subjects");
  const [subjects, setSubjects] = useState([]);
  const [classes, setClasses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [search, setSearch] = useState("");
  const [subjectForm, setSubjectForm] = useState(emptySubject);
  const [assignmentForm, setAssignmentForm] = useState(emptyAssignment);
  const [editingSubject, setEditingSubject] = useState(null);
  const [editingAssignment, setEditingAssignment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const results = await Promise.allSettled([getSubjects(), getClasses(), getTeachers(), getAssignments()]);
    const [s, c, t, a] = results;
    if (s.status === "fulfilled") setSubjects(Array.isArray(s.value) ? s.value : []);
    if (c.status === "fulfilled") setClasses(Array.isArray(c.value) ? c.value : []);
    if (t.status === "fulfilled") setTeachers(Array.isArray(t.value) ? t.value : []);
    if (a.status === "fulfilled") setAssignments(Array.isArray(a.value) ? a.value : []);
    const failed = results.find((result) => result.status === "rejected");
    if (failed) setError(errorText(failed.reason));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const visibleSubjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subjects.filter((row) => !q || [row.name, row.code, row.department].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [subjects, search]);
  const visibleAssignments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assignments.filter((row) => !q || [teachers.find((x) => x.id === row.teacher_id)?.name, classes.find((x) => x.id === row.class_id)?.name, subjects.find((x) => x.id === row.subject_id)?.name, row.academic_year].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [assignments, teachers, classes, subjects, search]);

  const submitSubject = async (event) => {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      if (editingSubject) await updateSubject(editingSubject.id, subjectForm);
      else await createSubject(subjectForm);
      setSubjectForm(emptySubject); setEditingSubject(null); setMessage("Subject saved."); await load();
    } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  };
  const submitAssignment = async (event) => {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    const payload = { ...assignmentForm, teacher_id: Number(assignmentForm.teacher_id), class_id: Number(assignmentForm.class_id), subject_id: Number(assignmentForm.subject_id), semester: assignmentForm.semester ? Number(assignmentForm.semester) : null, academic_year: assignmentForm.academic_year || null };
    try {
      if (editingAssignment) await updateAssignment(editingAssignment.id, payload);
      else await createAssignment(payload);
      setAssignmentForm(emptyAssignment); setEditingAssignment(null); setMessage("Subject assignment saved."); await load();
    } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  };
  const deactivateSubject = async (row) => {
    if (!window.confirm(`Deactivate ${row.name}? Existing history will be preserved.`)) return;
    try { await deleteSubject(row.id); setMessage("Subject deactivated."); await load(); } catch (e) { setError(errorText(e)); }
  };
  const activateSubject = async (row) => {
    try { await updateSubject(row.id, { is_active: true }); setMessage("Subject activated."); await load(); } catch (e) { setError(errorText(e)); }
  };
  const deactivateAssignmentRow = async (row) => {
    if (!window.confirm("Deactivate this assignment?")) return;
    try { await deactivateAssignment(row.id); setMessage("Assignment deactivated."); await load(); } catch (e) { setError(errorText(e)); }
  };
  const startSubjectEdit = (row) => { setEditingSubject(row); setSubjectForm({ name: row.name, code: row.code, department: row.department || "" }); };
  const startAssignmentEdit = (row) => {
    setEditingAssignment(row);
    setAssignmentForm({ teacher_id: String(row.teacher_id), class_id: String(row.class_id), subject_id: String(row.subject_id), academic_year: row.academic_year || "", semester: row.semester == null ? "" : String(row.semester) });
  };

  return <div className="academic-page">
    <header className="academic-header"><div><span>ACADEMIC MANAGEMENT</span><h1>Subjects & Assignments</h1><p>Create subjects and assign active teachers to classes.</p></div><button onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button></header>
    {error && <div className="academic-alert" role="alert">{error}</div>}{message && <div className="academic-success" role="status">{message}</div>}
    <div className="academic-tabs">
      <button className={tab === "subjects" ? "active" : ""} onClick={() => { setTab("subjects"); setSearch(""); }}>Subjects <b>{subjects.length}</b></button>
      <button className={tab === "assignments" ? "active" : ""} onClick={() => { setTab("assignments"); setSearch(""); }}>Subject assignments <b>{assignments.filter((x) => x.is_active).length}</b></button>
    </div>
    {tab === "subjects" ? <>
      <form className="academic-form" onSubmit={submitSubject}>
        <strong>{editingSubject ? "Edit subject" : "Add subject"}</strong>
        <input required maxLength={150} placeholder="Subject name" value={subjectForm.name} onChange={(e) => setSubjectForm({ ...subjectForm, name: e.target.value })} />
        <input required maxLength={50} placeholder="Subject code" value={subjectForm.code} onChange={(e) => setSubjectForm({ ...subjectForm, code: e.target.value })} />
        <input maxLength={100} placeholder="Department" value={subjectForm.department} onChange={(e) => setSubjectForm({ ...subjectForm, department: e.target.value })} />
        <button disabled={saving}>{saving ? "Saving…" : editingSubject ? "Save changes" : "Create subject"}</button>
        {editingSubject && <button type="button" className="academic-cancel" onClick={() => { setEditingSubject(null); setSubjectForm(emptySubject); }}>Cancel</button>}
      </form>
      <section className="academic-card"><div className="academic-toolbar"><div><strong>Registered subjects</strong><span>{visibleSubjects.length} records</span></div><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search subjects…" /></div>
        <div className="academic-table-wrap"><table className="academic-table"><thead><tr><th>Name</th><th>Code</th><th>Department</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {visibleSubjects.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.code}</td><td>{row.department || "—"}</td><td>{row.is_active ? "Active" : "Inactive"}</td><td><button type="button" onClick={() => startSubjectEdit(row)}>Edit</button>{row.is_active ? <button type="button" onClick={() => deactivateSubject(row)}>Deactivate</button> : <button type="button" onClick={() => activateSubject(row)}>Activate</button>}</td></tr>)}
          {!loading && visibleSubjects.length === 0 && <tr><td colSpan="5" className="academic-empty">No subjects found.</td></tr>}
        </tbody></table></div>
      </section>
    </> : <>
      <form className="academic-form academic-assignment-form" onSubmit={submitAssignment}>
        <strong>{editingAssignment ? "Edit assignment" : "Assign subject"}</strong>
        <select required value={assignmentForm.teacher_id} onChange={(e) => setAssignmentForm({ ...assignmentForm, teacher_id: e.target.value })}><option value="">Select active teacher</option>{teachers.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.name} · {x.employee_id}</option>)}</select>
        <select required value={assignmentForm.class_id} onChange={(e) => setAssignmentForm({ ...assignmentForm, class_id: e.target.value })}><option value="">Select active class</option>{classes.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.name}{x.section ? ` · ${x.section}` : ""}</option>)}</select>
        <select required value={assignmentForm.subject_id} onChange={(e) => setAssignmentForm({ ...assignmentForm, subject_id: e.target.value })}><option value="">Select active subject</option>{subjects.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}</select>
        <input placeholder="Academic year" value={assignmentForm.academic_year} onChange={(e) => setAssignmentForm({ ...assignmentForm, academic_year: e.target.value })} />
        <input type="number" min="1" max="12" placeholder="Semester" value={assignmentForm.semester} onChange={(e) => setAssignmentForm({ ...assignmentForm, semester: e.target.value })} />
        <button disabled={saving}>{saving ? "Saving…" : editingAssignment ? "Save changes" : "Create assignment"}</button>
        {editingAssignment && <button type="button" className="academic-cancel" onClick={() => { setEditingAssignment(null); setAssignmentForm(emptyAssignment); }}>Cancel</button>}
      </form>
      <section className="academic-card"><div className="academic-toolbar"><div><strong>Subject assignments</strong><span>{visibleAssignments.length} records</span></div><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assignments…" /></div>
        <div className="academic-table-wrap"><table className="academic-table"><thead><tr><th>Teacher</th><th>Class</th><th>Subject</th><th>Year / semester</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {visibleAssignments.map((row) => <tr key={row.id}><td>{teachers.find((x) => x.id === row.teacher_id)?.name || `#${row.teacher_id}`}</td><td>{classes.find((x) => x.id === row.class_id)?.name || `#${row.class_id}`}</td><td>{subjects.find((x) => x.id === row.subject_id)?.name || `#${row.subject_id}`}</td><td>{row.academic_year || "—"}{row.semester ? ` · Sem ${row.semester}` : ""}</td><td>{row.is_active ? "Active" : "Inactive"}</td><td>{row.is_active ? <><button type="button" onClick={() => startAssignmentEdit(row)}>Edit</button><button type="button" onClick={() => deactivateAssignmentRow(row)}>Deactivate</button></> : <button type="button" onClick={() => activateAssignment(row.id).then(load).catch((e) => setError(errorText(e)))}>Activate</button>}</td></tr>)}
          {!loading && visibleAssignments.length === 0 && <tr><td colSpan="6" className="academic-empty">No assignments found.</td></tr>}
        </tbody></table></div>
      </section>
    </>}
  </div>;
}
