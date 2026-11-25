import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  activateTeacher,
  createAssignment,
  createTeacher,
  deactivateTeacher,
  deleteAssignment,
  getClasses,
  getSubjects,
  getTeacherAssignments,
  getTeachers,
  updateTeacher,
} from "../../../services/teachers";

import "./Teachers.css";

const emptyForm = {
  name: "",
  email: "",
  employee_id: "",
  department: "",
  password: "",
};

const emptyAssignmentForm = {
  subject_id: "",
  class_id: "",
  academic_year: String(new Date().getFullYear()),
  semester: "",
};

function getInitials(name = "") {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "T"
  );
}

function getErrorMessage(error, fallback) {
  return (
    error?.response?.data?.detail ||
    error?.message ||
    fallback
  );
}

function Teachers() {
  const [teachers, setTeachers] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [classes, setClasses] = useState([]);

  const [assignments, setAssignments] = useState([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assignmentSaving, setAssignmentSaving] =
    useState(false);
  const [assignmentLoading, setAssignmentLoading] =
    useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const [selectedTeacher, setSelectedTeacher] =
    useState(null);

  const [assignmentForm, setAssignmentForm] = useState(
    emptyAssignmentForm
  );

  const [showPassword, setShowPassword] = useState(false);

  /*
   * =========================================================
   * LOAD DATA
   * =========================================================
   */

  const loadTeachers = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      setError("");

      try {
        const [
          teacherData,
          subjectData,
          classData,
        ] = await Promise.all([
          getTeachers(),
          getSubjects(),
          getClasses(),
        ]);

        setTeachers(
          Array.isArray(teacherData)
            ? teacherData
            : []
        );

        setSubjects(
          Array.isArray(subjectData)
            ? subjectData
            : []
        );

        setClasses(
          Array.isArray(classData)
            ? classData
            : []
        );
      } catch (err) {
        setError(
          getErrorMessage(
            err,
            "Unable to load teacher management data."
          )
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    loadTeachers(true);
  }, [loadTeachers]);

  /*
   * =========================================================
   * ESCAPE MODAL
   * =========================================================
   */

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && modal && !saving) {
        closeModal();
      }
    };

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [modal, saving]);

  /*
   * =========================================================
   * DEPARTMENTS
   * =========================================================
   */

  const departments = useMemo(() => {
    return Array.from(
      new Set(
        teachers
          .map((teacher) =>
            String(
              teacher.department || ""
            ).trim()
          )
          .filter(Boolean)
      )
    ).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [teachers]);

  /*
   * =========================================================
   * FILTERING
   * =========================================================
   */

  const filteredTeachers = useMemo(() => {
    const query = search.trim().toLowerCase();

    return teachers.filter((teacher) => {
      const matchesSearch =
        !query ||
        [
          teacher.name,
          teacher.email,
          teacher.employee_id,
          teacher.department,
        ]
          .filter(Boolean)
          .some((value) =>
            String(value)
              .toLowerCase()
              .includes(query)
          );

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" &&
          teacher.is_active !== false) ||
        (statusFilter === "inactive" &&
          teacher.is_active === false);

      const matchesDepartment =
        departmentFilter === "all" ||
        String(
          teacher.department || ""
        ).toLowerCase() ===
          departmentFilter.toLowerCase();

      return (
        matchesSearch &&
        matchesStatus &&
        matchesDepartment
      );
    });
  }, [
    teachers,
    search,
    statusFilter,
    departmentFilter,
  ]);

  /*
   * =========================================================
   * STATS
   * =========================================================
   */

  const totalFaculty = teachers.length;

  const activeFaculty = teachers.filter(
    (teacher) =>
      teacher.is_active !== false
  ).length;

  const inactiveFaculty = teachers.filter(
    (teacher) =>
      teacher.is_active === false
  ).length;

  const departmentCount =
    departments.length;

  /*
   * =========================================================
   * MODALS
   * =========================================================
   */

  const openCreate = () => {
    setForm({ ...emptyForm });
    setSelectedTeacher(null);
    setAssignments([]);
    setAssignmentForm({
      ...emptyAssignmentForm,
    });
    setShowPassword(false);
    setError("");
    setNotice("");
    setModal("create");
  };

  const openEdit = (teacher) => {
    setForm({
      name: teacher.name || "",
      email: teacher.email || "",
      employee_id:
        teacher.employee_id || "",
      department:
        teacher.department || "",
      password: "",
    });

    setSelectedTeacher(teacher);
    setAssignments([]);
    setShowPassword(false);
    setError("");
    setNotice("");
    setModal("edit");
  };

  const loadAssignments = async (
    teacher,
    showLoader = true
  ) => {
    if (!teacher?.id) return;

    if (showLoader) {
      setAssignmentLoading(true);
    }

    setError("");

    try {
      const data =
        await getTeacherAssignments(
          teacher.id
        );

      setAssignments(
        Array.isArray(data) ? data : []
      );
    } catch (err) {
      setAssignments([]);

      setError(
        getErrorMessage(
          err,
          "Unable to load teacher assignments."
        )
      );
    } finally {
      setAssignmentLoading(false);
    }
  };

  const openView = async (teacher) => {
    setSelectedTeacher(teacher);
    setAssignments([]);
    setAssignmentForm({
      ...emptyAssignmentForm,
    });
    setError("");
    setNotice("");
    setModal("view");

    await loadAssignments(teacher);
  };

  function closeModal() {
    if (saving || assignmentSaving) {
      return;
    }

    setModal(null);
    setSelectedTeacher(null);
    setAssignments([]);
    setAssignmentForm({
      ...emptyAssignmentForm,
    });
    setShowPassword(false);
    setError("");
  }

  /*
   * =========================================================
   * FORM
   * =========================================================
   */

  const handleChange = (event) => {
    const {
      name,
      value,
    } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const passwordScore = useMemo(() => {
    const password = form.password;

    let score = 0;

    if (password.length >= 8) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[a-z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password))
      score += 1;

    return score;
  }, [form.password]);

  const passwordLabel = [
    "Very weak",
    "Weak",
    "Fair",
    "Good",
    "Strong",
  ][Math.max(0, passwordScore - 1)] ||
    "Enter password";

  /*
   * =========================================================
   * SAVE TEACHER
   * =========================================================
   */

  const handleSave = async (event) => {
    event.preventDefault();

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const name = form.name.trim();
      const email = form.email
        .trim()
        .toLowerCase();

      if (name.length < 2) {
        throw new Error(
          "Please enter a valid teacher name."
        );
      }

      if (!email) {
        throw new Error(
          "Email address is required."
        );
      }

      if (modal === "create") {
        if (!form.password) {
          throw new Error(
            "Login password is required."
          );
        }

        if (form.password.length < 8) {
          throw new Error(
            "Password must contain at least 8 characters."
          );
        }

        const created =
          await createTeacher({
            name,
            email,
            employee_id:
              form.employee_id.trim() ||
              null,
            department:
              form.department.trim() ||
              null,
            password: form.password,
          });

        setNotice(
          `Teacher ${created.name} created successfully. Teacher ID: ${created.employee_id}`
        );
      } else {
        const updated =
          await updateTeacher(
            selectedTeacher.id,
            {
              name,
              email,
              employee_id:
                form.employee_id.trim(),
              department:
                form.department.trim() ||
                null,
            }
          );

        setNotice(
          `${updated.name} profile updated successfully.`
        );
      }

      setModal(null);
      setSelectedTeacher(null);
      setForm({ ...emptyForm });

      await loadTeachers(false);
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to save teacher."
        )
      );
    } finally {
      setSaving(false);
    }
  };

  /*
   * =========================================================
   * ACTIVATE / DEACTIVATE
   * =========================================================
   */

  const handleDeactivate = async (
    teacher
  ) => {
    const confirmed = window.confirm(
      `Deactivate ${teacher.name}?\n\nThe teacher account will lose access, while existing attendance history remains preserved.`
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setNotice("");

    try {
      await deactivateTeacher(
        teacher.id
      );

      setNotice(
        `${teacher.name} has been deactivated.`
      );

      await loadTeachers(false);
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to deactivate teacher."
        )
      );
    }
  };

  const handleActivate = async (
    teacher
  ) => {
    setError("");
    setNotice("");

    try {
      await activateTeacher(
        teacher.id
      );

      setNotice(
        `${teacher.name} has been activated.`
      );

      await loadTeachers(false);
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to activate teacher."
        )
      );
    }
  };

  /*
   * =========================================================
   * ASSIGNMENT FORM
   * =========================================================
   */

  const handleAssignmentChange = (
    event
  ) => {
    const {
      name,
      value,
    } = event.target;

    setAssignmentForm(
      (previous) => ({
        ...previous,
        [name]: value,
      })
    );
  };

  const handleAssign = async (
    event
  ) => {
    event.preventDefault();

    if (!selectedTeacher) {
      return;
    }

    if (
      !assignmentForm.subject_id ||
      !assignmentForm.class_id
    ) {
      setError(
        "Please select both a subject and a class."
      );
      return;
    }

    const subjectId = Number(
      assignmentForm.subject_id
    );

    const classId = Number(
      assignmentForm.class_id
    );

    const duplicate =
      assignments.some(
        (assignment) =>
          Number(
            assignment.subject_id
          ) === subjectId &&
          Number(
            assignment.class_id
          ) === classId
      );

    if (duplicate) {
      setError(
        "This subject and class are already assigned to this teacher."
      );
      return;
    }

    setAssignmentSaving(true);
    setError("");
    setNotice("");

    try {
      await createAssignment({
        teacher_id:
          selectedTeacher.id,
        subject_id: subjectId,
        class_id: classId,
        academic_year:
          assignmentForm.academic_year.trim() ||
          null,
        semester:
          assignmentForm.semester
            ? Number(
                assignmentForm.semester
              )
            : null,
      });

      setNotice(
        "Subject and class assigned successfully."
      );

      setAssignmentForm({
        ...assignmentForm,
        subject_id: "",
        class_id: "",
        semester: "",
      });

      await loadAssignments(
        selectedTeacher,
        false
      );
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to create this assignment."
        )
      );
    } finally {
      setAssignmentSaving(false);
    }
  };

  const handleDeleteAssignment = async (
    assignment
  ) => {
    const confirmed = window.confirm(
      "Remove this subject/class assignment?"
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setNotice("");

    try {
      await deleteAssignment(
        assignment.assignment_id
      );

      setNotice(
        "Assignment removed successfully."
      );

      await loadAssignments(
        selectedTeacher,
        false
      );
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to remove assignment."
        )
      );
    }
  };

  /*
   * =========================================================
   * COPY TEACHER ID
   * =========================================================
   */

  const copyTeacherId = async () => {
    const teacherId =
      selectedTeacher?.employee_id;

    if (!teacherId) return;

    try {
      await navigator.clipboard.writeText(
        teacherId
      );

      setNotice(
        "Teacher ID copied to clipboard."
      );
    } catch {
      setNotice(
        "Teacher ID: " + teacherId
      );
    }
  };

  /*
   * =========================================================
   * FILTER RESET
   * =========================================================
   */

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setDepartmentFilter("all");
  };

  const hasFilters =
    search.trim() ||
    statusFilter !== "all" ||
    departmentFilter !== "all";

  /*
   * =========================================================
   * RENDER
   * =========================================================
   */

  return (
    <div className="teachers-page">
      {/* =====================================================
          HERO
         ===================================================== */}

      <section className="teachers-hero">
        <div className="teachers-hero-copy">
          <div className="eyebrow">
            FACULTY OPERATIONS
          </div>

          <h1>Teacher Management</h1>

          <p>
            Manage faculty identity, protected
            access, departments and teaching
            assignments from one controlled
            workspace.
          </p>
        </div>

        <div className="hero-actions">
          <button
            type="button"
            className="secondary-button refresh-button"
            onClick={() =>
              loadTeachers(false)
            }
            disabled={refreshing}
          >
            <span
              className={
                refreshing
                  ? "refresh-icon spinning"
                  : "refresh-icon"
              }
            >
              ↻
            </span>

            {refreshing
              ? "Refreshing..."
              : "Refresh"}
          </button>

          <button
            type="button"
            className="primary-button"
            onClick={openCreate}
          >
            <span className="button-plus">
              +
            </span>
            Add Teacher
          </button>
        </div>
      </section>

      {/* =====================================================
          ALERTS
         ===================================================== */}

      {notice && (
        <div className="page-alert success">
          <span className="alert-icon">
            ✓
          </span>

          <span>{notice}</span>

          <button
            type="button"
            onClick={() =>
              setNotice("")
            }
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}

      {error && !modal && (
        <div className="page-alert error">
          <span className="alert-icon">
            !
          </span>

          <span>{error}</span>

          <button
            type="button"
            onClick={() =>
              setError("")
            }
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* =====================================================
          STAT CARDS
         ===================================================== */}

      <section className="teacher-stat-grid">
        <article className="teacher-stat">
          <div className="stat-icon purple">
            ◎
          </div>

          <div className="stat-content">
            <span>Total Faculty</span>

            <strong>{totalFaculty}</strong>

            <small>
              Registered teachers
            </small>
          </div>

          <div className="stat-decoration" />
        </article>

        <article className="teacher-stat">
          <div className="stat-icon green">
            ✓
          </div>

          <div className="stat-content">
            <span>Active</span>

            <strong>{activeFaculty}</strong>

            <small>
              Available for teaching
            </small>
          </div>

          <div className="stat-decoration" />
        </article>

        <article className="teacher-stat">
          <div className="stat-icon orange">
            !
          </div>

          <div className="stat-content">
            <span>Inactive</span>

            <strong>{inactiveFaculty}</strong>

            <small>
              Access currently disabled
            </small>
          </div>

          <div className="stat-decoration" />
        </article>

        <article className="teacher-stat">
          <div className="stat-icon blue">
            #
          </div>

          <div className="stat-content">
            <span>Departments</span>

            <strong>
              {departmentCount}
            </strong>

            <small>
              Faculty departments
            </small>
          </div>

          <div className="stat-decoration" />
        </article>
      </section>

      {/* =====================================================
          DIRECTORY
         ===================================================== */}

      <section className="teacher-directory">
        <div className="directory-header">
          <div className="directory-title">
            <div className="eyebrow">
              FACULTY DIRECTORY
            </div>

            <h2>Teaching staff</h2>

            <p>
              Showing{" "}
              <strong>
                {filteredTeachers.length}
              </strong>{" "}
              of{" "}
              <strong>
                {teachers.length}
              </strong>{" "}
              teachers
            </p>
          </div>

          <div className="directory-filters">
            <div className="search-field">
              <span>⌕</span>

              <input
                type="search"
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value
                  )
                }
                placeholder="Search name, ID, email..."
                aria-label="Search teachers"
              />

              {search && (
                <button
                  type="button"
                  onClick={() =>
                    setSearch("")
                  }
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value
                )
              }
              aria-label="Filter by status"
            >
              <option value="all">
                All Status
              </option>
              <option value="active">
                Active
              </option>
              <option value="inactive">
                Inactive
              </option>
            </select>

            <select
              value={departmentFilter}
              onChange={(event) =>
                setDepartmentFilter(
                  event.target.value
                )
              }
              aria-label="Filter by department"
            >
              <option value="all">
                All Departments
              </option>

              {departments.map(
                (department) => (
                  <option
                    key={department}
                    value={department}
                  >
                    {department}
                  </option>
                )
              )}
            </select>

            {hasFilters && (
              <button
                type="button"
                className="clear-filter-button"
                onClick={clearFilters}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* =================================================
            TABLE
           ================================================= */}

        <div className="teacher-table-wrapper">
          {loading ? (
            <div className="teacher-loading">
              <div className="loading-spinner" />

              <strong>
                Loading faculty records
              </strong>

              <span>
                Connecting to the AttendX
                faculty service...
              </span>
            </div>
          ) : filteredTeachers.length ===
            0 ? (
            <div className="teacher-empty">
              <div className="empty-icon">
                ⌕
              </div>

              <strong>
                No teacher records found
              </strong>

              <span>
                Try another search or change
                the selected filters.
              </span>

              {hasFilters && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="table-scroll">
              <table className="teacher-table">
                <thead>
                  <tr>
                    <th>Teacher</th>
                    <th>Teacher ID</th>
                    <th>Department</th>
                    <th>Assignments</th>
                    <th>Access</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredTeachers.map(
                    (teacher) => {
                      const active =
                        teacher.is_active !==
                        false;

                      return (
                        <tr
                          key={teacher.id}
                        >
                          <td>
                            <div className="teacher-name">
                              <span className="teacher-avatar">
                                {getInitials(
                                  teacher.name
                                )}
                              </span>

                              <div>
                                <strong>
                                  {teacher.name}
                                </strong>

                                <small>
                                  {teacher.email}
                                </small>
                              </div>
                            </div>
                          </td>

                          <td>
                            <code className="teacher-id">
                              {teacher.employee_id}
                            </code>
                          </td>

                          <td>
                            <span className="department-text">
                              {teacher.department ||
                                "Not assigned"}
                            </span>
                          </td>

                          <td>
                            <button
                              type="button"
                              className="assignment-link"
                              onClick={() =>
                                openView(
                                  teacher
                                )
                              }
                            >
                              View assignments
                              <span>
                                →
                              </span>
                            </button>
                          </td>

                          <td>
                            <span
                              className={
                                active
                                  ? "access-pill enabled"
                                  : "access-pill disabled"
                              }
                            >
                              <span className="access-dot" />
                              {active
                                ? "Enabled"
                                : "Disabled"}
                            </span>
                          </td>

                          <td>
                            <span
                              className={
                                active
                                  ? "status-pill active"
                                  : "status-pill inactive"
                              }
                            >
                              {active
                                ? "Active"
                                : "Inactive"}
                            </span>
                          </td>

                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                onClick={() =>
                                  openView(
                                    teacher
                                  )
                                }
                              >
                                View
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  openEdit(
                                    teacher
                                  )
                                }
                              >
                                Edit
                              </button>

                              {active ? (
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() =>
                                    handleDeactivate(
                                      teacher
                                    )
                                  }
                                >
                                  Deactivate
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="positive"
                                  onClick={() =>
                                    handleActivate(
                                      teacher
                                    )
                                  }
                                >
                                  Activate
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* =====================================================
          MODAL
         ===================================================== */}

      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target ===
                event.currentTarget &&
              !saving &&
              !assignmentSaving
            ) {
              closeModal();
            }
          }}
        >
          <div
            className="teacher-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="teacher-modal-title"
          >
            {/* MODAL HEADER */}

            <div className="modal-header">
              <div className="modal-heading">
                <div className="modal-number">
                  {modal === "create"
                    ? "01"
                    : modal === "edit"
                    ? "01"
                    : "PROFILE"}
                </div>

                <div>
                  <div className="eyebrow">
                    {modal === "create"
                      ? "NEW FACULTY ACCOUNT"
                      : modal === "edit"
                      ? "FACULTY PROFILE"
                      : "FACULTY OVERVIEW"}
                  </div>

                  <h2 id="teacher-modal-title">
                    {modal === "create"
                      ? "Add New Teacher"
                      : modal === "edit"
                      ? "Edit Teacher"
                      : selectedTeacher?.name}
                  </h2>

                  <p>
                    {modal === "view"
                      ? "Profile, account access and teaching assignments."
                      : "Keep faculty identity and access information accurate."}
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="close-button"
                onClick={closeModal}
                disabled={
                  saving ||
                  assignmentSaving
                }
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {error && (
              <div className="modal-error">
                <span>!</span>
                <span>{error}</span>
              </div>
            )}

            {notice && modal && (
              <div className="modal-success">
                <span>✓</span>
                <span>{notice}</span>
              </div>
            )}

            {/* =================================================
                CREATE / EDIT
               ================================================= */}

            {modal !== "view" ? (
              <form
                onSubmit={handleSave}
                className="teacher-form"
              >
                <div className="form-section">
                  <div className="form-section-title">
                    <span>01</span>

                    <div>
                      <strong>
                        Faculty identity
                      </strong>

                      <small>
                        Basic teacher information
                      </small>
                    </div>
                  </div>

                  <div className="form-grid">
                    <label className="field">
                      <span>
                        Full Name
                        <b>*</b>
                      </span>

                      <input
                        name="name"
                        value={form.name}
                        onChange={
                          handleChange
                        }
                        required
                        minLength={2}
                        maxLength={100}
                        placeholder="e.g. Rahul Sharma"
                        autoComplete="name"
                      />
                    </label>

                    <label className="field">
                      <span>
                        Email Address
                        <b>*</b>
                      </span>

                      <input
                        type="email"
                        name="email"
                        value={form.email}
                        onChange={
                          handleChange
                        }
                        required
                        placeholder="teacher@example.com"
                        autoComplete="email"
                      />
                    </label>

                    <label className="field">
                      <span>
                        Teacher ID / Employee ID
                      </span>

                      <input
                        name="employee_id"
                        value={
                          form.employee_id
                        }
                        onChange={
                          handleChange
                        }
                        maxLength={50}
                        placeholder="Auto-generated if empty"
                      />

                      <small>
                        Leave empty to let
                        AttendX generate a
                        unique Teacher ID.
                      </small>
                    </label>

                    <label className="field">
                      <span>
                        Department
                      </span>

                      <input
                        name="department"
                        value={
                          form.department
                        }
                        onChange={
                          handleChange
                        }
                        maxLength={100}
                        placeholder="e.g. Computer Science"
                      />
                    </label>
                  </div>
                </div>

                {modal === "create" && (
                  <div className="form-section access-section">
                    <div className="form-section-title">
                      <span>02</span>

                      <div>
                        <strong>
                          Login access
                        </strong>

                        <small>
                          Protected teacher
                          account
                        </small>
                      </div>
                    </div>

                    <label className="field full-field">
                      <span>
                        Initial Login Password
                        <b>*</b>
                      </span>

                      <div className="password-field">
                        <input
                          type={
                            showPassword
                              ? "text"
                              : "password"
                          }
                          name="password"
                          value={
                            form.password
                          }
                          onChange={
                            handleChange
                          }
                          required
                          minLength={8}
                          maxLength={72}
                          placeholder="Minimum 8 characters"
                          autoComplete="new-password"
                        />

                        <button
                          type="button"
                          onClick={() =>
                            setShowPassword(
                              (value) =>
                                !value
                            )
                          }
                        >
                          {showPassword
                            ? "Hide"
                            : "Show"}
                        </button>
                      </div>

                      {form.password && (
                        <div className="password-strength">
                          <div className="strength-bars">
                            {[
                              1,
                              2,
                              3,
                              4,
                              5,
                            ].map((item) => (
                              <span
                                key={item}
                                className={
                                  item <=
                                  passwordScore
                                    ? "filled"
                                    : ""
                                }
                              />
                            ))}
                          </div>

                          <span>
                            {passwordLabel}
                          </span>
                        </div>
                      )}

                      <small>
                        This password creates
                        the teacher's protected
                        login account.
                      </small>
                    </label>

                    <div className="controlled-access">
                      <div className="controlled-check">
                        ✓
                      </div>

                      <div>
                        <strong>
                          Controlled access
                        </strong>

                        <span>
                          Teacher access can be
                          activated or deactivated
                          later without deleting
                          attendance history.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="modal-footer">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={closeModal}
                    disabled={saving}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="primary-button"
                    disabled={saving}
                  >
                    {saving ? (
                      <>
                        <span className="button-spinner" />
                        Saving...
                      </>
                    ) : (
                      <>
                        {modal === "create"
                          ? "Create Teacher"
                          : "Save Changes"}
                        <span>
                          →
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              /* =================================================
                 VIEW PROFILE
                 ================================================= */

              <div className="teacher-view">
                <div className="profile-identity">
                  <div className="profile-avatar">
                    {getInitials(
                      selectedTeacher?.name
                    )}
                  </div>

                  <div>
                    <h3>
                      {selectedTeacher?.name}
                    </h3>

                    <p>
                      {selectedTeacher?.email}
                    </p>

                    <div className="profile-badges">
                      <span
                        className={
                          selectedTeacher?.is_active ===
                          false
                            ? "status-pill inactive"
                            : "status-pill active"
                        }
                      >
                        {selectedTeacher?.is_active ===
                        false
                          ? "Inactive"
                          : "Active"}
                      </span>

                      <span className="profile-role">
                        Faculty
                      </span>
                    </div>
                  </div>
                </div>

                <div className="profile-grid">
                  <div className="profile-item">
                    <span>
                      Teacher ID
                    </span>

                    <div className="profile-value-row">
                      <strong>
                        {
                          selectedTeacher?.employee_id
                        }
                      </strong>

                      <button
                        type="button"
                        onClick={
                          copyTeacherId
                        }
                        title="Copy Teacher ID"
                      >
                        Copy
                      </button>
                    </div>
                  </div>

                  <div className="profile-item">
                    <span>
                      Email Address
                    </span>

                    <strong>
                      {
                        selectedTeacher?.email
                      }
                    </strong>
                  </div>

                  <div className="profile-item">
                    <span>
                      Department
                    </span>

                    <strong>
                      {selectedTeacher?.department ||
                        "Not assigned"}
                    </strong>
                  </div>

                  <div className="profile-item">
                    <span>
                      Account Access
                    </span>

                    <strong
                      className={
                        selectedTeacher?.is_active ===
                        false
                          ? "muted-value"
                          : "success-value"
                      }
                    >
                      {selectedTeacher?.is_active ===
                      false
                        ? "Disabled"
                        : "Enabled"}
                    </strong>
                  </div>
                </div>

                {/* =================================================
                    ASSIGNMENTS
                   ================================================= */}

                <section className="assignment-panel">
                  <div className="assignment-header">
                    <div>
                      <div className="eyebrow">
                        TEACHING LOAD
                      </div>

                      <h3>
                        Assigned subjects &
                        classes
                      </h3>

                      <p>
                        Connect this teacher
                        with the classes and
                        subjects they teach.
                      </p>
                    </div>

                    <div className="assignment-count">
                      <strong>
                        {assignments.length}
                      </strong>

                      <span>
                        active{" "}
                        {assignments.length ===
                        1
                          ? "assignment"
                          : "assignments"}
                      </span>
                    </div>
                  </div>

                  <form
                    className="assignment-form"
                    onSubmit={
                      handleAssign
                    }
                  >
                    <label>
                      <span>
                        Subject
                      </span>

                      <select
                        name="subject_id"
                        value={
                          assignmentForm.subject_id
                        }
                        onChange={
                          handleAssignmentChange
                        }
                        required
                      >
                        <option value="">
                          Select subject
                        </option>

                        {subjects
                          .filter(
                            (subject) =>
                              subject.is_active !==
                              false
                          )
                          .map(
                            (subject) => (
                              <option
                                key={
                                  subject.id
                                }
                                value={
                                  subject.id
                                }
                              >
                                {subject.code
                                  ? `${subject.code} — `
                                  : ""}
                                {
                                  subject.name
                                }
                              </option>
                            )
                          )}
                      </select>
                    </label>

                    <label>
                      <span>
                        Class
                      </span>

                      <select
                        name="class_id"
                        value={
                          assignmentForm.class_id
                        }
                        onChange={
                          handleAssignmentChange
                        }
                        required
                      >
                        <option value="">
                          Select class
                        </option>

                        {classes
                          .filter(
                            (item) =>
                              item.is_active !==
                              false
                          )
                          .map(
                            (item) => (
                              <option
                                key={item.id}
                                value={
                                  item.id
                                }
                              >
                                {
                                  item.name
                                }
                                {item.section
                                  ? ` — ${item.section}`
                                  : ""}
                              </option>
                            )
                          )}
                      </select>
                    </label>

                    <label>
                      <span>
                        Academic Year
                      </span>

                      <input
                        name="academic_year"
                        value={
                          assignmentForm.academic_year
                        }
                        onChange={
                          handleAssignmentChange
                        }
                        placeholder="2026"
                      />
                    </label>

                    <label>
                      <span>
                        Semester
                      </span>

                      <input
                        type="number"
                        name="semester"
                        value={
                          assignmentForm.semester
                        }
                        onChange={
                          handleAssignmentChange
                        }
                        min="1"
                        max="12"
                        placeholder="1"
                      />
                    </label>

                    <button
                      type="submit"
                      className="primary-button assign-button"
                      disabled={
                        assignmentSaving ||
                        assignmentLoading ||
                        selectedTeacher?.is_active ===
                          false
                      }
                    >
                      {assignmentSaving
                        ? "Assigning..."
                        : "Assign"}
                    </button>
                  </form>

                  {selectedTeacher?.is_active ===
                    false && (
                    <div className="assignment-disabled">
                      <span>!</span>
                      Activate this teacher
                      before adding new
                      teaching assignments.
                    </div>
                  )}

                  {assignmentLoading ? (
                    <div className="assignment-loading">
                      <div className="loading-spinner small" />
                      Loading teaching
                      assignments...
                    </div>
                  ) : assignments.length ===
                    0 ? (
                    <div className="assignment-empty">
                      <div>
                        <strong>
                          No teaching
                          assignments yet
                        </strong>

                        <span>
                          Select a subject and
                          class above to create
                          the first assignment.
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="assignment-list">
                      {assignments.map(
                        (assignment) => (
                          <div
                            className="assignment-row"
                            key={
                              assignment.assignment_id
                            }
                          >
                            <div className="assignment-main">
                              <div className="assignment-subject-icon">
                                #
                              </div>

                              <div>
                                <strong>
                                  {
                                    assignment.subject_code
                                  }
                                  {assignment.subject_code
                                    ? " — "
                                    : ""}
                                  {
                                    assignment.subject_name
                                  }
                                </strong>

                                <span>
                                  {
                                    assignment.class_name
                                  }

                                  {assignment.section
                                    ? ` / ${assignment.section}`
                                    : ""}

                                  {" · "}

                                  {assignment.academic_year ||
                                    "Current year"}

                                  {assignment.semester
                                    ? ` · Semester ${assignment.semester}`
                                    : ""}
                                </span>
                              </div>
                            </div>

                            <button
                              type="button"
                              className="remove-assignment"
                              onClick={() =>
                                handleDeleteAssignment(
                                  assignment
                                )
                              }
                            >
                              Remove
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </section>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={closeModal}
                  >
                    Close
                  </button>

                  <button
                    type="button"
                    className="primary-button"
                    onClick={() =>
                      openEdit(
                        selectedTeacher
                      )
                    }
                  >
                    Edit Teacher
                    <span>→</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Teachers;
