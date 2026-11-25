import React, { useEffect, useMemo, useState } from "react";
import { getSubjects, getClasses } from "../../services/teachers";
import "./AcademicManagement.css";

const errorText = (e) =>
  e?.response?.data?.detail ||
  "Unable to load academic data.";

export default function AcademicManagement() {
  const [tab, setTab] = useState("classes");
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");

    try {
      const [classData, subjectData] = await Promise.all([
        getClasses(),
        getSubjects(),
      ]);

      setClasses(
        Array.isArray(classData) ? classData : []
      );

      setSubjects(
        Array.isArray(subjectData) ? subjectData : []
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(() => {
    const source =
      tab === "classes" ? classes : subjects;

    const q = search.trim().toLowerCase();

    if (!q) return source;

    return source.filter((row) =>
      Object.values(row || {}).some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(q)
      )
    );
  }, [tab, classes, subjects, search]);

  return (
    <div className="academic-page">
      <header className="academic-header">
        <div>
          <span>ACADEMIC MANAGEMENT</span>

          <h1>Classes & Subjects</h1>

          <p>
            Use the records already connected to AttendX
            for attendance session assignment.
          </p>
        </div>

        <button
          onClick={load}
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </header>

      {error && (
        <div className="academic-alert">
          {error}
        </div>
      )}

      <div className="academic-tabs">
        <button
          className={
            tab === "classes" ? "active" : ""
          }
          onClick={() => setTab("classes")}
        >
          Classes <b>{classes.length}</b>
        </button>

        <button
          className={
            tab === "subjects" ? "active" : ""
          }
          onClick={() => setTab("subjects")}
        >
          Subjects <b>{subjects.length}</b>
        </button>
      </div>

      <section className="academic-card">
        <div className="academic-toolbar">
          <div>
            <strong>
              {tab === "classes"
                ? "Registered classes"
                : "Registered subjects"}
            </strong>

            <span>
              {rows.length} visible records
            </span>
          </div>

          <input
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            placeholder={`Search ${tab}…`}
          />
        </div>

        <div className="academic-table-wrap">
          <table className="academic-table">
            <thead>
              {tab === "classes" ? (
                <tr>
                  <th>Name</th>
                  <th>Section</th>
                  <th>Academic year</th>
                  <th>Semester</th>
                  <th>ID</th>
                </tr>
              ) : (
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Credits</th>
                  <th>ID</th>
                </tr>
              )}
            </thead>

            <tbody>
              {rows.map((row) =>
                tab === "classes" ? (
                  <tr key={row.id}>
                    <td>
                      <strong>
                        {row.name || "—"}
                      </strong>
                    </td>

                    <td>
                      {row.section || "—"}
                    </td>

                    <td>
                      {row.academic_year ||
                        row.year ||
                        "—"}
                    </td>

                    <td>
                      {row.semester ?? "—"}
                    </td>

                    <td>#{row.id}</td>
                  </tr>
                ) : (
                  <tr key={row.id}>
                    <td>
                      <strong>
                        {row.name || "—"}
                      </strong>
                    </td>

                    <td>
                      {row.code || "—"}
                    </td>

                    <td>
                      {row.credits ?? "—"}
                    </td>

                    <td>#{row.id}</td>
                  </tr>
                )
              )}

              {!loading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan="5"
                    className="academic-empty"
                  >
                    No records returned by the backend.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="academic-note">
        <strong>Attendance linkage</strong>

        <p>
          Teachers use these class and subject records
          when creating an attendance session.
          Assignment management remains available from
          the teacher management workflow.
        </p>
      </div>
    </div>
  );
}