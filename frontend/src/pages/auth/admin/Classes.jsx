import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  createClass,
  deleteClass,
  getClasses,
  updateClass,
} from "../../../services/academic";
import "./Classes.css";
import { getApiErrorMessage } from "../../../utils/errors";

const emptyForm = {
  name: "",
  section: "",
  department: "",
  semester: "",
  academic_year: "",
};

function errorMessage(error) {
  return getApiErrorMessage(error, "The class request could not be completed.");
}

export default function Classes() {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingClass, setEditingClass] = useState(null);

  const loadClasses = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getClasses();
      if (!Array.isArray(data)) throw new Error("The classes API returned an invalid response.");
      setClasses(data);
      return true;
    } catch (requestError) {
      setError(errorMessage(requestError));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClasses();
  }, [loadClasses]);

  const filteredClasses = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return classes;
    return classes.filter((item) => [
      item.name,
      item.section,
      item.department,
      item.academic_year,
      item.semester,
    ].some((value) => String(value ?? "").toLowerCase().includes(query)));
  }, [classes, search]);

  const activeCount = classes.filter((item) => item.is_active === true).length;
  const departmentCount = new Set(classes.map((item) => item.department).filter(Boolean)).size;
  const sectionCount = new Set(classes.map((item) => item.section).filter(Boolean)).size;

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingClass(null);
  }

  async function submitClass(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    const name = form.name.trim();
    if (!name) {
      setError("Class name is required.");
      return;
    }
    if (name.length > 100 || form.section.length > 50 || form.department.length > 100 || form.academic_year.length > 20) {
      setError("One or more fields exceed the maximum length allowed by the class model.");
      return;
    }

    const semester = form.semester.trim() === "" ? null : Number(form.semester);
    if (semester !== null && !Number.isInteger(semester)) {
      setError("Semester must be a whole number.");
      return;
    }

    const payload = {
      name,
      section: form.section.trim() || null,
      department: form.department.trim() || null,
      semester,
      academic_year: form.academic_year.trim() || null,
    };

    setSaving(true);
    try {
      if (editingClass) {
        await updateClass(editingClass.id, payload);
      } else {
        await createClass(payload);
      }
      resetForm();
      const refreshed = await loadClasses();
      setNotice(refreshed
        ? `Class ${editingClass ? "updated" : "created"} successfully.`
        : `Class ${editingClass ? "updated" : "created"}, but the list could not be refreshed. Use Refresh to retry.`);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  function beginEdit(item) {
    setEditingClass(item);
    setForm({
      name: item.name ?? "",
      section: item.section ?? "",
      department: item.department ?? "",
      semester: item.semester == null ? "" : String(item.semester),
      academic_year: item.academic_year ?? "",
    });
    setNotice("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleActive(item) {
    const nextActive = !item.is_active;
    if (!nextActive && !window.confirm(`Deactivate ${item.name}${item.section ? ` · ${item.section}` : ""}? Existing academic history will be preserved.`)) return;
    setError("");
    setNotice("");
    setSaving(true);
    try {
      if (nextActive) await updateClass(item.id, { is_active: true });
      else await deleteClass(item.id);
      const refreshed = await loadClasses();
      setNotice(refreshed
        ? `Class ${nextActive ? "activated" : "deactivated"} successfully.`
        : `Class ${nextActive ? "activated" : "deactivated"}, but the list could not be refreshed. Use Refresh to retry.`);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="classes-page">
      <div className="classes-container">
        <header className="classes-header">
          <div>
            <div className="classes-eyebrow">ACADEMIC STRUCTURE</div>
            <h1>Classes</h1>
            <p>Create and manage the active classes used for subject assignments and attendance.</p>
          </div>
          <button className="classes-refresh" type="button" onClick={loadClasses} disabled={loading || saving}>
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </header>

        {error && <div className="classes-error" role="alert">{error}</div>}
        {notice && <div className="classes-success" role="status">{notice}</div>}

        <section className="classes-stats" aria-label="Class statistics">
          <div><span>Total classes</span><strong>{classes.length}</strong></div>
          <div><span>Active classes</span><strong>{activeCount}</strong></div>
          <div><span>Departments / sections</span><strong>{departmentCount} / {sectionCount}</strong></div>
        </section>

        <section className="classes-card classes-form-card">
          <div className="classes-card-header">
            <div>
              <div className="classes-card-kicker">CLASS DETAILS</div>
              <h2>{editingClass ? "Edit class" : "Create class"}</h2>
              <p>New classes are created active and become available for subject assignment.</p>
            </div>
          </div>
          <form className="classes-form" onSubmit={submitClass}>
            <label>Class name *
              <input name="name" value={form.name} onChange={updateField} required maxLength={100} autoComplete="off" placeholder="e.g. Computer Science" />
            </label>
            <label>Section
              <input name="section" value={form.section} onChange={updateField} maxLength={50} placeholder="e.g. A" />
            </label>
            <label>Department
              <input name="department" value={form.department} onChange={updateField} maxLength={100} placeholder="e.g. Engineering" />
            </label>
            <label>Semester
              <input name="semester" type="number" step="1" value={form.semester} onChange={updateField} placeholder="e.g. 3" />
            </label>
            <label>Academic year
              <input name="academic_year" value={form.academic_year} onChange={updateField} maxLength={20} placeholder="e.g. 2026-2027" />
            </label>
            <div className="classes-form-actions">
              <button className="classes-primary" type="submit" disabled={saving || loading}>
                {saving ? "Saving…" : editingClass ? "Save changes" : "Create class"}
              </button>
              {editingClass && <button className="classes-secondary" type="button" onClick={resetForm} disabled={saving}>Cancel edit</button>}
            </div>
          </form>
        </section>

        <section className="classes-card">
          <div className="classes-card-header">
            <div>
              <div className="classes-card-kicker">DIRECTORY</div>
              <h2>Registered classes</h2>
              <p>{filteredClasses.length} records</p>
            </div>
            <input aria-label="Search classes" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search classes…" />
          </div>
          {loading ? <div className="classes-empty" role="status">Loading classes…</div> : (
            <div className="classes-table-wrap">
              <table className="classes-table">
                <thead><tr><th>Class</th><th>Section</th><th>Department</th><th>Semester</th><th>Academic year</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {filteredClasses.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.name || `Class #${item.id}`}</strong><small>ID #{item.id}</small></td>
                      <td>{item.section || "—"}</td>
                      <td>{item.department || "—"}</td>
                      <td>{item.semester ?? "—"}</td>
                      <td>{item.academic_year || "—"}</td>
                      <td><span className={`class-status ${item.is_active ? "active" : "inactive"}`}>{item.is_active ? "Active" : "Inactive"}</span></td>
                      <td className="classes-row-actions">
                        <button type="button" onClick={() => beginEdit(item)} disabled={saving}>Edit</button>
                        <button type="button" className={item.is_active ? "danger" : "activate"} onClick={() => toggleActive(item)} disabled={saving}>
                          {item.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!filteredClasses.length && <tr><td className="classes-empty" colSpan={7}>{classes.length ? "No classes match this search." : "No classes exist yet. Create a class above to make it available for subject assignments."}</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
