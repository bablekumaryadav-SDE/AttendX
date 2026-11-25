import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { assignTeacher, createTeacher, createTeacherAccountLink, deactivateTeacher, deactivateTeacherAssignment, getClasses, getSubjects, getTeacher, getTeacherAccountLink, getTeacherAssignments, getTeacherInvitation, getTeacherManagementProfile, getTeacherProfileVerification, getTeacherProfileVerificationHistory, getTeachers, reconcileLegacyTeacher, resendTeacherInvitation, resetTeacherPassword, revokeTeacherAccountLink, reviewTeacherProfileVerification, searchTeacherAccountLinkCandidates, updateTeacherProfile } from "../../../services/teachers";
import {
  createLatestRequestGuard,
  teacherLoadMessage,
} from "../../../services/tenantSelection";
import { isPasswordPolicyValid } from "../../../services/passwordPolicy";
import { activeAssignableRecords, validateTeacherAssignmentRows } from "../../../utils/tenantAssignments";
import "./Teachers.css";

function localDateTimeInput(value = new Date()) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function assignmentStatus(assignment) {
  const now = Date.now();
  if (assignment.effective_from && new Date(assignment.effective_from).getTime() > now) return "Scheduled";
  if (assignment.effective_to && new Date(assignment.effective_to).getTime() <= now) return "Ended";
  return assignment.is_active ? "Active" : "Ended";
}
import "../../../components/tenantRegistration.css";

function getInitials(name = "") {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase()).join("") || "T";
}

function emptyTeacherAssignmentRows() {
  return Array.from({ length: 3 }, () => ({ class_id: "", subject_id: "", academic_year: "", semester: "" }));
}

export default function Teachers() {
  const { user, activeCollegeId, collegeMemberships } = useAuth();
  const canManage = user?.role !== "super_admin" && collegeMemberships.some((membership) => String(membership.college_id) === String(activeCollegeId) && membership.membership_role === "college_admin");
  const [teachers, setTeachers] = useState([]);
  const [selectedTeacher, setSelectedTeacher] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [registrationError, setRegistrationError] = useState("");
  const [registrationRowErrors, setRegistrationRowErrors] = useState({});
  const [registrationNotice, setRegistrationNotice] = useState("");
  const [registrationAssignmentRows, setRegistrationAssignmentRows] = useState(emptyTeacherAssignmentRows);
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [teacherInvitation, setTeacherInvitation] = useState(null);
  const [teacherAssignments, setTeacherAssignments] = useState([]);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({});
  const [profileSaving, setProfileSaving] = useState(false);
  const [assignmentForm, setAssignmentForm] = useState({ class_id: "", subject_id: "", academic_year: "", semester: "", effective_from: localDateTimeInput(), effective_to: "" });
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [teacherAccountLink, setTeacherAccountLink] = useState(null);
  const [accountLinkStatus, setAccountLinkStatus] = useState("loading");
  const [accountLinkUserId, setAccountLinkUserId] = useState("");
  const [accountLinkSearch, setAccountLinkSearch] = useState("");
  const [accountLinkCandidates, setAccountLinkCandidates] = useState([]);
  const [accountLinkSearchBusy, setAccountLinkSearchBusy] = useState(false);
  const [accountLinkAttested, setAccountLinkAttested] = useState(false);
  const [accountLinkBusy, setAccountLinkBusy] = useState(false);
  const [accountLinkError, setAccountLinkError] = useState("");
  const [accountLinkNotice, setAccountLinkNotice] = useState("");
  const [accountLinkRevokeReason, setAccountLinkRevokeReason] = useState("");
  const [teacherVerification, setTeacherVerification] = useState(null);
  const [teacherVerificationHistory, setTeacherVerificationHistory] = useState([]);
  const [verificationLoadStatus, setVerificationLoadStatus] = useState("loading");
  const [verificationReason, setVerificationReason] = useState("");
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  const [verificationNotice, setVerificationNotice] = useState("");
  const [passwordResetOpen, setPasswordResetOpen] = useState(false);
  const [passwordResetBusy, setPasswordResetBusy] = useState(false);
  const [passwordResetError, setPasswordResetError] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [legacyReconcileForm, setLegacyReconcileForm] = useState({ teacher_id: "", user_id: "", ownership_evidence_reference: "", identity_evidence_reference: "", reason: "", ownership_verified: false, identity_verified: false });
  const [legacyReconcileBusy, setLegacyReconcileBusy] = useState(false);
  const [legacyReconcileError, setLegacyReconcileError] = useState("");
  const activeCollegeIdRef = useRef(activeCollegeId);
  activeCollegeIdRef.current = activeCollegeId;
  const registrationRequestRef = useRef(false);
  const listGuard = useRef(null);
  const detailGuard = useRef(null);
  const accountCandidateRequestRef = useRef(0);
  if (!listGuard.current) listGuard.current = createLatestRequestGuard();
  if (!detailGuard.current) detailGuard.current = createLatestRequestGuard();

  useEffect(() => {
    const version = listGuard.current.begin();
    detailGuard.current.invalidate();
    setTeachers([]);
    setSelectedTeacher(null);
    setTeacherInvitation(null);
    setTeacherAssignments([]);
    setEditingProfile(false);
    setProfileForm({});
    setAssignmentError("");
    setTeacherAccountLink(null);
    setAccountLinkStatus("loading");
    setAccountLinkUserId("");
    setAccountLinkSearch("");
    setAccountLinkCandidates([]);
    setAccountLinkSearchBusy(false);
    setAccountLinkAttested(false);
    setAccountLinkBusy(false);
    setAccountLinkError("");
    setAccountLinkNotice("");
    setAccountLinkRevokeReason("");
    setTeacherVerification(null);
    setTeacherVerificationHistory([]);
    setVerificationLoadStatus("loading");
    setVerificationReason("");
    setVerificationError("");
    setVerificationNotice("");
    setPasswordResetOpen(false);
    setPasswordResetError("");
    setNewPassword("");
    setNewPasswordConfirmation("");
    setLegacyReconcileForm({ teacher_id: "", user_id: "", ownership_evidence_reference: "", identity_evidence_reference: "", reason: "", ownership_verified: false, identity_verified: false });
    setLegacyReconcileBusy(false);
    setLegacyReconcileError("");
    setRegistrationOpen(false);
    setClasses([]);
    setSubjects([]);
    setError("");
    setDetailError("");
    setDetailLoading(false);
    if (!activeCollegeId) {
      setLoading(false);
      return () => listGuard.current.invalidate();
    }

    setLoading(true);
    getTeachers(activeCollegeId)
      .then((items) => {
        if (listGuard.current.isCurrent(version)) setTeachers(Array.isArray(items) ? items : []);
      })
      .catch((failure) => {
        if (listGuard.current.isCurrent(version)) setError(teacherLoadMessage(failure.response?.status));
      })
      .finally(() => {
        if (listGuard.current.isCurrent(version)) setLoading(false);
      });
    return () => listGuard.current.invalidate();
  }, [activeCollegeId, reloadVersion]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeDetails();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const departments = useMemo(() => [...new Set(teachers
    .map((teacher) => String(teacher.department || "").trim())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b)), [teachers]);

  const filteredTeachers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return teachers.filter((teacher) => {
      const matchesSearch = !query || [teacher.name, teacher.department, String(teacher.id)]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
      const matchesStatus = statusFilter === "all"
        || (statusFilter === "active" && teacher.is_active !== false)
        || (statusFilter === "inactive" && teacher.is_active === false);
      const matchesDepartment = departmentFilter === "all"
        || String(teacher.department || "").toLowerCase() === departmentFilter.toLowerCase();
      return matchesSearch && matchesStatus && matchesDepartment;
    });
  }, [teachers, search, statusFilter, departmentFilter]);

  const activeFaculty = teachers.filter((teacher) => teacher.is_active !== false).length;
  const inactiveFaculty = teachers.length - activeFaculty;
  const hasFilters = Boolean(search.trim()) || statusFilter !== "all" || departmentFilter !== "all";

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setDepartmentFilter("all");
  }

  async function openRegistration() {
    if (!activeCollegeId) return;
    const requestedCollegeId = activeCollegeId;
    setRegistrationError("");
    setRegistrationRowErrors({});
    setRegistrationAssignmentRows(emptyTeacherAssignmentRows());
    setRegistrationNotice("");
    setRegistrationOpen(true);
    try {
      const [classRows, subjectRows] = await Promise.all([getClasses(requestedCollegeId), getSubjects(requestedCollegeId)]);
      if (String(activeCollegeIdRef.current) !== String(requestedCollegeId)) return;
      setClasses(Array.isArray(classRows) ? classRows : []);
      setSubjects(Array.isArray(subjectRows) ? subjectRows : []);
    } catch (failure) {
      setRegistrationError(teacherLoadMessage(failure.response?.status));
    }
  }

  function updateRegistrationAssignmentRow(index, field, value) {
    setRegistrationAssignmentRows((rows) => rows.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [field]: value } : row
    )));
    setRegistrationRowErrors((previous) => {
      if (!(index in previous)) return previous;
      const next = { ...previous };
      delete next[index];
      return next;
    });
  }

  async function submitRegistration(event) {
    event.preventDefault();
    if (!activeCollegeId || registrationRequestRef.current) return;
    registrationRequestRef.current = true;
    const submittedCollegeId = activeCollegeId;
    setRegistrationBusy(true);
    setRegistrationError("");
    try {
      const form = new FormData(event.currentTarget);
      const password = form.get("password");
      const passwordConfirmation = form.get("password_confirmation");
      if (!password || !passwordConfirmation) {
        setRegistrationError("Enter and confirm a permanent Teacher password.");
        return;
      }
      if (password !== passwordConfirmation) {
        setRegistrationError("Password confirmation does not match.");
        return;
      }
      if (!isPasswordPolicyValid(password)) {
        setRegistrationError("Use at least 12 characters with uppercase, lowercase, a number, and a symbol; maximum 72 UTF-8 bytes.");
        return;
      }
      const assignmentResult = validateTeacherAssignmentRows(registrationAssignmentRows);
      setRegistrationRowErrors(assignmentResult.errors);
      if (Object.keys(assignmentResult.errors).length) {
        return;
      }
      const payload = {
        name: form.get("name"), email: form.get("email"),
        department: form.get("department") || null, gender: form.get("gender") || null,
        designation: form.get("designation") || null, qualification: form.get("qualification") || null,
        mobile: form.get("mobile") || null, address: form.get("address") || null,
        joining_date: form.get("joining_date") || null, assignments: assignmentResult.assignments,
        password,
        password_confirmation: passwordConfirmation,
      };
      const created = await createTeacher(payload, submittedCollegeId);
      if (String(activeCollegeIdRef.current) !== String(submittedCollegeId)) return;
      if (!created?.id || !created?.employee_id) {
        setRegistrationError("Teacher creation returned no generated Teacher ID. Refresh the directory before retrying.");
        setReloadVersion((value) => value + 1);
        return;
      }
      setRegistrationNotice(`Teacher account created with the password set by College Admin. Profile verification is pending before Teacher workspace access. Generated Teacher ID: ${created.employee_id}.`);
      setRegistrationOpen(false);
      setReloadVersion((value) => value + 1);
    } catch (failure) {
      setRegistrationError(failure.response?.data?.detail || "Teacher registration could not be completed.");
    } finally {
      registrationRequestRef.current = false;
      setRegistrationBusy(false);
    }
  }

  async function submitPasswordReset(event) {
    event.preventDefault();
    if (!canManage || !activeCollegeId || !selectedTeacher || passwordResetBusy) return;
    if (newPassword !== newPasswordConfirmation) {
      setPasswordResetError("Password confirmation does not match.");
      return;
    }
    if (!isPasswordPolicyValid(newPassword)) {
      setPasswordResetError("Use at least 12 characters with uppercase, lowercase, a number, and a symbol; maximum 72 UTF-8 bytes.");
      return;
    }
    const submittedCollegeId = activeCollegeId;
    setPasswordResetBusy(true);
    setPasswordResetError("");
    try {
      await resetTeacherPassword(selectedTeacher.id, { password: newPassword, password_confirmation: newPasswordConfirmation }, submittedCollegeId);
      if (String(activeCollegeIdRef.current) !== String(submittedCollegeId)) return;
      setNewPassword("");
      setNewPasswordConfirmation("");
      setPasswordResetOpen(false);
      setRegistrationNotice("Teacher password reset successfully. The new password was not retained or displayed.");
    } catch (failure) {
      if (String(activeCollegeIdRef.current) === String(submittedCollegeId)) setPasswordResetError(failure.response?.data?.detail || "Teacher password could not be reset.");
    } finally {
      setPasswordResetBusy(false);
    }
  }

  async function openView(teacher) {
    accountCandidateRequestRef.current += 1;
    const version = detailGuard.current.begin();
    setSelectedTeacher(teacher);
    setDetailError("");
    setDetailLoading(true);
    setTeacherAssignments([]);
    setEditingProfile(false);
    setAssignmentError("");
    setTeacherAccountLink(null);
    setAccountLinkStatus("loading");
    setAccountLinkUserId("");
    setAccountLinkSearch("");
    setAccountLinkCandidates([]);
    setAccountLinkSearchBusy(false);
    setAccountLinkAttested(false);
    setAccountLinkError("");
    setAccountLinkNotice("");
    setAccountLinkRevokeReason("");
    if (!activeCollegeId) {
      setDetailLoading(false);
      return;
    }
    try {
      const current = canManage
        ? await getTeacherManagementProfile(teacher.id, activeCollegeId)
        : await getTeacher(teacher.id, activeCollegeId);
      if (detailGuard.current.isCurrent(version)) {
        setSelectedTeacher(current);
        if (canManage) {
          // Account invitation metadata is independent of assignment setup.
          // Keep one unavailable auxiliary endpoint from hiding the active
          // class/subject choices needed to create a tenant assignment.
          const [invitationResult, assignmentsResult, classResult, subjectResult, accountLinkResult, verificationResult, verificationHistoryResult] = await Promise.allSettled([
            getTeacherInvitation(teacher.id, activeCollegeId),
            getTeacherAssignments(teacher.id, activeCollegeId),
            getClasses(activeCollegeId),
            getSubjects(activeCollegeId),
            getTeacherAccountLink(teacher.id, activeCollegeId),
            getTeacherProfileVerification(teacher.id, activeCollegeId),
            getTeacherProfileVerificationHistory(teacher.id, activeCollegeId),
          ]);
          if (!detailGuard.current.isCurrent(version)) return;

          setTeacherInvitation(invitationResult.status === "fulfilled"
            ? invitationResult.value
            : { status: "Unavailable" });
          setTeacherAssignments(assignmentsResult.status === "fulfilled" && Array.isArray(assignmentsResult.value)
            ? assignmentsResult.value
            : []);
          setClasses(classResult.status === "fulfilled" && Array.isArray(classResult.value)
            ? classResult.value
            : []);
          setSubjects(subjectResult.status === "fulfilled" && Array.isArray(subjectResult.value)
            ? subjectResult.value
            : []);
          if (accountLinkResult.status === "fulfilled") {
            setTeacherAccountLink(accountLinkResult.value);
            setAccountLinkStatus("loaded");
          } else if (accountLinkResult.reason?.response?.status === 404) {
            setTeacherAccountLink(null);
            setAccountLinkStatus("missing");
          } else {
            setTeacherAccountLink(null);
            setAccountLinkStatus("unavailable");
          }
          if (verificationResult.status === "fulfilled") {
            setTeacherVerification(verificationResult.value);
            setVerificationLoadStatus("loaded");
          } else {
            setTeacherVerification(null);
            setVerificationLoadStatus("unavailable");
          }
          setTeacherVerificationHistory(verificationHistoryResult.status === "fulfilled" && Array.isArray(verificationHistoryResult.value)
            ? verificationHistoryResult.value
            : []);

          const assignmentLoadErrors = [];
          if (assignmentsResult.status === "rejected") assignmentLoadErrors.push("Assignment history could not be loaded.");
          if (classResult.status === "rejected") assignmentLoadErrors.push("Classes could not be loaded.");
          if (subjectResult.status === "rejected") assignmentLoadErrors.push("Subjects could not be loaded.");
          setAssignmentError(assignmentLoadErrors.join(" "));
        }
      }
    } catch (failure) {
      if (detailGuard.current.isCurrent(version)) setDetailError(teacherLoadMessage(failure.response?.status, true));
    } finally {
      if (detailGuard.current.isCurrent(version)) setDetailLoading(false);
    }
  }

  function closeDetails() {
    accountCandidateRequestRef.current += 1;
    detailGuard.current.invalidate();
    setSelectedTeacher(null);
    setTeacherInvitation(null);
    setTeacherAssignments([]);
    setEditingProfile(false);
    setProfileForm({});
    setAssignmentError("");
    setTeacherAccountLink(null);
    setAccountLinkStatus("loading");
    setAccountLinkUserId("");
    setAccountLinkSearch("");
    setAccountLinkCandidates([]);
    setAccountLinkSearchBusy(false);
    setAccountLinkAttested(false);
    setAccountLinkError("");
    setAccountLinkNotice("");
    setAccountLinkRevokeReason("");
    setTeacherVerification(null);
    setTeacherVerificationHistory([]);
    setVerificationLoadStatus("loading");
    setVerificationReason("");
    setVerificationError("");
    setVerificationNotice("");
    setPasswordResetOpen(false);
    setPasswordResetError("");
    setNewPassword("");
    setNewPasswordConfirmation("");
    setDetailError("");
    setDetailLoading(false);
  }

  function updateProfileField(event) {
    const { name, value } = event.target;
    setProfileForm((current) => ({ ...current, [name]: value }));
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!canManage || !activeCollegeId || !selectedTeacher || profileSaving) return;
    const collegeAtSubmit = activeCollegeId;
    setProfileSaving(true);
    setDetailError("");
    try {
      const result = await updateTeacherProfile(selectedTeacher.id, {
        name: profileForm.name,
        department: profileForm.department || null,
        gender: profileForm.gender || null,
        designation: profileForm.designation || null,
        qualification: profileForm.qualification || null,
        mobile: profileForm.mobile || null,
        address: profileForm.address || null,
        joining_date: profileForm.joining_date || null,
      }, collegeAtSubmit);
      if (String(activeCollegeIdRef.current) !== String(collegeAtSubmit)) return;
      setSelectedTeacher((current) => ({ ...current, ...result, ...profileForm }));
      setTeachers((current) => current.map((teacher) => teacher.id === result.id ? { ...teacher, ...result } : teacher));
      setEditingProfile(false);
      setRegistrationNotice("Teacher profile updated successfully.");
    } catch (failure) {
      if (String(activeCollegeIdRef.current) === String(collegeAtSubmit)) setDetailError(failure.response?.data?.detail || "Teacher profile could not be updated.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function deactivateSelectedTeacher() {
    if (!canManage || !activeCollegeId || !selectedTeacher || !selectedTeacher.is_active) return;
    const collegeAtSubmit = activeCollegeId;
    setProfileSaving(true);
    setDetailError("");
    try {
      const result = await deactivateTeacher(selectedTeacher.id, collegeAtSubmit);
      if (String(activeCollegeIdRef.current) !== String(collegeAtSubmit)) return;
      setTeachers((current) => current.map((teacher) => teacher.id === result.id ? { ...teacher, is_active: false } : teacher));
      setSelectedTeacher((current) => ({ ...current, is_active: false }));
      setTeacherAssignments((current) => current.map((assignment) => ({ ...assignment, is_active: false })));
      setRegistrationNotice("Teacher deactivated. Attendance history was retained.");
    } catch (failure) {
      if (String(activeCollegeIdRef.current) === String(collegeAtSubmit)) setDetailError(failure.response?.data?.detail || "Teacher could not be deactivated.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function addTeacherAssignment(event) {
    event.preventDefault();
    if (!canManage || !activeCollegeId || !selectedTeacher || assignmentSaving) return;
    const collegeAtSubmit = activeCollegeId;
    const payload = {
      class_id: Number(assignmentForm.class_id),
      subject_id: Number(assignmentForm.subject_id),
      academic_year: assignmentForm.academic_year.trim(),
      semester: Number(assignmentForm.semester),
      effective_from: new Date(assignmentForm.effective_from).toISOString(),
      effective_to: assignmentForm.effective_to ? new Date(assignmentForm.effective_to).toISOString() : null,
    };
    setAssignmentSaving(true);
    setAssignmentError("");
    try {
      const created = await assignTeacher(selectedTeacher.id, payload, collegeAtSubmit);
      if (String(activeCollegeIdRef.current) !== String(collegeAtSubmit)) return;
      setTeacherAssignments((current) => [...current, created]);
      setAssignmentForm({ class_id: "", subject_id: "", academic_year: "", semester: "", effective_from: localDateTimeInput(), effective_to: "" });
    } catch (failure) {
      if (String(activeCollegeIdRef.current) === String(collegeAtSubmit)) setAssignmentError(failure.response?.data?.detail || "Teacher assignment could not be saved.");
    } finally {
      setAssignmentSaving(false);
    }
  }

  async function endTeacherAssignment(assignmentId) {
    if (!canManage || !activeCollegeId || !selectedTeacher) return;
    const collegeAtSubmit = activeCollegeId;
    try {
      const result = await deactivateTeacherAssignment(selectedTeacher.id, assignmentId, collegeAtSubmit);
      if (String(activeCollegeIdRef.current) === String(collegeAtSubmit)) {
        setTeacherAssignments((current) => current.map((item) => item.id === result.id ? result : item));
      }
    } catch (failure) {
      if (String(activeCollegeIdRef.current) === String(collegeAtSubmit)) setAssignmentError(failure.response?.data?.detail || "Teacher assignment could not be ended.");
    }
  }

  async function searchTeacherLinkUsers() {
    if (!canManage || !activeCollegeId || !selectedTeacher || !selectedTeacher.is_active || accountLinkSearchBusy) return;
    if (accountLinkSearch.trim().length < 2) {
      setAccountLinkError("Enter at least two characters to search active Teacher login accounts in this College.");
      return;
    }
    const requestId = ++accountCandidateRequestRef.current;
    const collegeAtSubmit = activeCollegeId;
    const teacherId = selectedTeacher.id;
    setAccountLinkSearchBusy(true);
    setAccountLinkError("");
    setAccountLinkCandidates([]);
    setAccountLinkUserId("");
    setAccountLinkAttested(false);
    try {
      const candidates = await searchTeacherAccountLinkCandidates(accountLinkSearch, collegeAtSubmit);
      if (requestId !== accountCandidateRequestRef.current
          || String(activeCollegeIdRef.current) !== String(collegeAtSubmit)
          || selectedTeacher?.id !== teacherId) return;
      setAccountLinkCandidates(Array.isArray(candidates) ? candidates : []);
    } catch (failure) {
      if (requestId === accountCandidateRequestRef.current) {
        setAccountLinkError(failure.response?.data?.detail || failure.message || "Eligible login accounts could not be searched.");
      }
    } finally {
      if (requestId === accountCandidateRequestRef.current) setAccountLinkSearchBusy(false);
    }
  }

  async function saveTeacherAccountLink(event) {
    event.preventDefault();
    if (!canManage || !activeCollegeId || !selectedTeacher || !selectedTeacher.is_active || accountLinkBusy) return;
    const teacherId = selectedTeacher.id;
    const collegeAtSubmit = activeCollegeId;
    const userId = Number(accountLinkUserId.trim());
    if (!Number.isSafeInteger(userId) || userId < 1) {
      setAccountLinkError("Search for and select the existing Teacher login account before linking.");
      return;
    }
    if (!accountLinkAttested) {
      setAccountLinkError("Confirm the identity check against official College records before linking.");
      return;
    }
    const version = detailGuard.current.begin();
    setAccountLinkBusy(true);
    setAccountLinkError("");
    setAccountLinkNotice("");
    try {
      const result = await createTeacherAccountLink(teacherId, userId, collegeAtSubmit);
      if (!detailGuard.current.isCurrent(version) || String(activeCollegeIdRef.current) !== String(collegeAtSubmit)) return;
      setTeacherAccountLink(result);
      setAccountLinkStatus("loaded");
      setAccountLinkUserId("");
      setAccountLinkCandidates([]);
      setAccountLinkSearch("");
      setAccountLinkAttested(false);
      setAccountLinkNotice("The verified Teacher account link is active. The verifier and timestamp are recorded.");
    } catch (failure) {
      if (detailGuard.current.isCurrent(version)) {
        setAccountLinkError(failure.response?.data?.detail || failure.message || "Teacher account link could not be created.");
      }
    } finally {
      if (detailGuard.current.isCurrent(version)) setAccountLinkBusy(false);
    }
  }

  async function revokeSelectedTeacherAccountLink() {
    if (!canManage || !activeCollegeId || !selectedTeacher || !teacherAccountLink || accountLinkBusy) return;
    if (accountLinkRevokeReason.trim().length < 3) {
      setAccountLinkError("Provide a reason of at least three characters to revoke this link.");
      return;
    }
    const teacherId = selectedTeacher.id;
    const collegeAtSubmit = activeCollegeId;
    const version = detailGuard.current.begin();
    setAccountLinkBusy(true);
    setAccountLinkError("");
    setAccountLinkNotice("");
    try {
      const result = await revokeTeacherAccountLink(
        teacherAccountLink.id, accountLinkRevokeReason.trim(), collegeAtSubmit,
      );
      if (!detailGuard.current.isCurrent(version) || String(activeCollegeIdRef.current) !== String(collegeAtSubmit)
          || selectedTeacher.id !== teacherId) return;
      setTeacherAccountLink(result);
      setAccountLinkRevokeReason("");
      setAccountLinkNotice("The account link was revoked and the action was recorded.");
    } catch (failure) {
      if (detailGuard.current.isCurrent(version)) {
        setAccountLinkError(failure.response?.data?.detail || failure.message || "Teacher account link could not be revoked.");
      }
    } finally {
      if (detailGuard.current.isCurrent(version)) setAccountLinkBusy(false);
    }
  }

  async function updateTeacherVerification(verificationStatus) {
    if (!canManage || !activeCollegeId || !selectedTeacher || verificationBusy) return;
    const reason = verificationReason.trim();
    if (reason.length < 5) {
      setVerificationError("Record a reason of at least five characters before changing profile verification.");
      return;
    }
    const label = verificationStatus === "verified" ? "verify" : "reject";
    if (!window.confirm(`Confirm that you reviewed the Teacher's official College records and ${label} this profile?`)) return;
    const collegeAtSubmit = activeCollegeId;
    const teacherId = selectedTeacher.id;
    setVerificationBusy(true);
    setVerificationError("");
    setVerificationNotice("");
    try {
      const saved = await reviewTeacherProfileVerification(teacherId, verificationStatus, reason, collegeAtSubmit);
      if (String(activeCollegeIdRef.current) !== String(collegeAtSubmit) || selectedTeacher?.id !== teacherId) return;
      setTeacherVerification(saved);
      setVerificationReason("");
      setVerificationNotice(`Teacher profile marked ${saved.verification_status}. Account-link status remains separate.`);
      const history = await getTeacherProfileVerificationHistory(teacherId, collegeAtSubmit);
      if (String(activeCollegeIdRef.current) === String(collegeAtSubmit) && selectedTeacher?.id === teacherId) {
        setTeacherVerificationHistory(Array.isArray(history) ? history : []);
      }
    } catch (failure) {
      setVerificationError(failure.response?.data?.detail || failure.message || "Teacher profile verification could not be saved.");
    } finally {
      setVerificationBusy(false);
    }
  }

  async function resendInvitation(teacher) {
    if (!activeCollegeId) return;
    setRegistrationError("");
    setRegistrationNotice("");
    try {
      const result = await resendTeacherInvitation(teacher.id, activeCollegeId);
      setRegistrationNotice(result.status === "sent" ? "A new setup invitation was sent to the Teacher." : "Invitation delivery failed. Check the mail configuration and retry.");
      if (selectedTeacher?.id === teacher.id) setTeacherInvitation(await getTeacherInvitation(teacher.id, activeCollegeId));
    } catch (failure) {
      setRegistrationError(failure.response?.data?.detail || "Invitation could not be resent.");
    }
  }

  async function submitLegacyTeacherReconciliation(event) {
    event.preventDefault();
    if (!canManage || !activeCollegeId || legacyReconcileBusy) return;
    const collegeAtSubmit = activeCollegeId;
    setLegacyReconcileBusy(true);
    setLegacyReconcileError("");
    try {
      const result = await reconcileLegacyTeacher(legacyReconcileForm.teacher_id, legacyReconcileForm, collegeAtSubmit);
      if (String(activeCollegeIdRef.current) !== String(collegeAtSubmit)) return;
      setLegacyReconcileForm({ teacher_id: "", user_id: "", ownership_evidence_reference: "", identity_evidence_reference: "", reason: "", ownership_verified: false, identity_verified: false });
      setRegistrationNotice(`Legacy Teacher profile #${result.profile_id} was reconciled to User #${result.user_id}. Profile review remains ${result.profile_verification_status}; complete that separate review before Teacher access.`);
      setReloadVersion((value) => value + 1);
    } catch (failure) {
      if (String(activeCollegeIdRef.current) === String(collegeAtSubmit)) setLegacyReconcileError(failure.response?.data?.detail || failure.message || "Legacy Teacher reconciliation could not be completed.");
    } finally {
      setLegacyReconcileBusy(false);
    }
  }

  return (
    <main className="teachers-page">
      <section className="teachers-hero">
        <div className="teachers-hero-copy">
          <div className="eyebrow">FACULTY DIRECTORY</div>
          <h1>Teachers</h1>
          <p>Manage this College's teacher profiles and verified class assignments.</p>
        </div>
        <div className="hero-actions">
          {canManage && <button type="button" className="secondary-button" onClick={openRegistration} disabled={!activeCollegeId}>Register teacher</button>}
          <button type="button" className="secondary-button refresh-button"
            onClick={() => setReloadVersion((value) => value + 1)} disabled={loading || !activeCollegeId}>
            <span className={loading ? "refresh-icon spinning" : "refresh-icon"}>↻</span>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </section>

      {!activeCollegeId && <div className="teacher-empty" role="status"><strong>Select a College</strong><span>Select an active College membership to view its Teacher directory.</span></div>}
      {registrationNotice && <div className="page-alert" role="status">{registrationNotice}</div>}
      {registrationError && <div className="page-alert error" role="alert">{registrationError}</div>}
      {registrationOpen && canManage && <form className="tenant-registration-form" onSubmit={submitRegistration}>
        <h2>Register a teacher</h2>
        <p>Teacher ID is assigned by AttendX. Set a permanent password for the Teacher; it will not be shown again after creation.</p>
        <div className="tenant-registration-grid">
          {[["name", "Full name", "text", true], ["email", "Official email", "email", true], ["gender", "Gender", "text"], ["department", "Department", "text"], ["designation", "Designation", "text"], ["qualification", "Qualification", "text"], ["mobile", "Mobile", "tel"], ["address", "Address", "text"], ["joining_date", "Joining date", "date"]].map(([name, label, type, required]) => <label key={name}>{label}<input name={name} type={type} required={Boolean(required)} /></label>)}
        </div>
        <h3>Class and subject assignments (optional)</h3>
        {registrationAssignmentRows.map((row, index) => <div className="tenant-registration-assignment-row" key={index}>
          <div className="tenant-registration-grid">
            <label>Class<select name={`class_${index}`} value={row.class_id} aria-invalid={Boolean(registrationRowErrors[index])} aria-describedby={registrationRowErrors[index] ? `teacher-assignment-error-${index}` : undefined} onChange={(event) => updateRegistrationAssignmentRow(index, "class_id", event.target.value)}><option value="">No class</option>{activeAssignableRecords(classes).map((item) => <option key={item.id} value={item.id}>{item.name} {item.section || ""}</option>)}</select></label>
            <label>Subject<select name={`subject_${index}`} value={row.subject_id} aria-invalid={Boolean(registrationRowErrors[index])} aria-describedby={registrationRowErrors[index] ? `teacher-assignment-error-${index}` : undefined} onChange={(event) => updateRegistrationAssignmentRow(index, "subject_id", event.target.value)}><option value="">No subject</option>{activeAssignableRecords(subjects).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Academic year<input name={`year_${index}`} value={row.academic_year} maxLength="20" aria-invalid={Boolean(registrationRowErrors[index])} aria-describedby={registrationRowErrors[index] ? `teacher-assignment-error-${index}` : undefined} onChange={(event) => updateRegistrationAssignmentRow(index, "academic_year", event.target.value)} /></label>
            <label>Semester<input name={`semester_${index}`} type="number" value={row.semester} min="1" max="24" aria-invalid={Boolean(registrationRowErrors[index])} aria-describedby={registrationRowErrors[index] ? `teacher-assignment-error-${index}` : undefined} onChange={(event) => updateRegistrationAssignmentRow(index, "semester", event.target.value)} /></label>
          </div>
          {registrationRowErrors[index] && <p className="tenant-field-error" id={`teacher-assignment-error-${index}`} role="alert">{registrationRowErrors[index]}</p>}
        </div>)}
        <label>Password<input name="password" type="password" autoComplete="new-password" minLength="12" maxLength="72" required /></label>
        <label>Confirm password<input name="password_confirmation" type="password" autoComplete="new-password" minLength="12" maxLength="72" required /></label>
        <div className="tenant-form-note">Use at least 12 characters with uppercase, lowercase, a number, and a symbol. Passwords are never displayed again after saving.</div>
        <div className="tenant-form-actions"><button className="secondary-button" type="button" onClick={() => setRegistrationOpen(false)}>Cancel</button><button className="secondary-button" type="submit" disabled={registrationBusy}>{registrationBusy ? "Saving..." : "Create Teacher account"}</button></div>
      </form>}
      {error && <div className="page-alert error" role="alert"><span className="alert-icon">!</span><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError("")}>×</button></div>}

      <section className="teacher-stat-grid" aria-label="Teacher summary">
        <article className="teacher-stat"><div className="stat-icon purple">◎</div><div className="stat-content"><span>Total Faculty</span><strong>{teachers.length}</strong><small>Profiles in this College</small></div><div className="stat-decoration" /></article>
        <article className="teacher-stat"><div className="stat-icon green">✓</div><div className="stat-content"><span>Active</span><strong>{activeFaculty}</strong><small>Active profiles</small></div><div className="stat-decoration" /></article>
        <article className="teacher-stat"><div className="stat-icon orange">!</div><div className="stat-content"><span>Inactive</span><strong>{inactiveFaculty}</strong><small>Inactive profiles</small></div><div className="stat-decoration" /></article>
        <article className="teacher-stat"><div className="stat-icon blue">#</div><div className="stat-content"><span>Departments</span><strong>{departments.length}</strong><small>Departments represented</small></div><div className="stat-decoration" /></article>
      </section>

      {canManage && activeCollegeId && <section className="teacher-directory" aria-labelledby="legacy-teacher-reconciliation-title">
        <div className="directory-header">
          <div className="directory-title">
            <div className="eyebrow">LEGACY ACCOUNT REPAIR</div>
            <h2 id="legacy-teacher-reconciliation-title">Reconcile an existing Teacher</h2>
            <p>Use exact profile and User IDs confirmed from official College records. This form does not search or match people by personal details.</p>
          </div>
        </div>
        <form className="tenant-registration-form" onSubmit={submitLegacyTeacherReconciliation}>
          <div className="tenant-registration-grid">
            <label>Existing Teacher profile ID<input type="number" min="1" required value={legacyReconcileForm.teacher_id} onChange={(event) => setLegacyReconcileForm((current) => ({ ...current, teacher_id: event.target.value }))} /></label>
            <label>Original login User ID<input type="number" min="1" required value={legacyReconcileForm.user_id} onChange={(event) => setLegacyReconcileForm((current) => ({ ...current, user_id: event.target.value }))} /></label>
            <label>College ownership evidence reference<input required minLength="3" maxLength="200" value={legacyReconcileForm.ownership_evidence_reference} onChange={(event) => setLegacyReconcileForm((current) => ({ ...current, ownership_evidence_reference: event.target.value }))} /></label>
            <label>Identity verification evidence reference<input required minLength="3" maxLength="200" value={legacyReconcileForm.identity_evidence_reference} onChange={(event) => setLegacyReconcileForm((current) => ({ ...current, identity_evidence_reference: event.target.value }))} /></label>
            <label>Reconciliation reason<textarea required minLength="5" maxLength="500" value={legacyReconcileForm.reason} onChange={(event) => setLegacyReconcileForm((current) => ({ ...current, reason: event.target.value }))} /></label>
          </div>
          <label><input type="checkbox" required checked={legacyReconcileForm.ownership_verified} onChange={(event) => setLegacyReconcileForm((current) => ({ ...current, ownership_verified: event.target.checked }))} /> I verified this Teacher profile belongs to the selected College using the cited authoritative record.</label>
          <label><input type="checkbox" required checked={legacyReconcileForm.identity_verified} onChange={(event) => setLegacyReconcileForm((current) => ({ ...current, identity_verified: event.target.checked }))} /> I verified the existing User account belongs to this Teacher through the cited institutional identity check.</label>
          <p className="tenant-form-note">The operation preserves existing profile and assignment records. Any profile without a verified College membership may receive one through this explicit attested action. Separate profile verification remains pending and must be reviewed after reconciliation.</p>
          {legacyReconcileError && <div className="modal-error" role="alert">{legacyReconcileError}</div>}
          <div className="tenant-form-actions"><button type="submit" className="primary-button" disabled={legacyReconcileBusy || !legacyReconcileForm.ownership_verified || !legacyReconcileForm.identity_verified}>{legacyReconcileBusy ? "Reconciling…" : "Reconcile existing Teacher"}</button></div>
        </form>
      </section>}

      <section className="teacher-directory">
        <div className="directory-header">
          <div className="directory-title">
            <div className="eyebrow">COLLEGE DIRECTORY</div>
            <h2>Teaching staff</h2>
            <p>Showing <strong>{filteredTeachers.length}</strong> of <strong>{teachers.length}</strong> teachers</p>
          </div>
          <div className="directory-filters">
            <div className="search-field"><span>⌕</span><input type="search" value={search}
              onChange={(event) => setSearch(event.target.value)} placeholder="Search name or department..."
              aria-label="Search teachers" />{search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search">×</button>}</div>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
              <option value="all">All Status</option><option value="active">Active</option><option value="inactive">Inactive</option>
            </select>
            <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} aria-label="Filter by department">
              <option value="all">All Departments</option>{departments.map((department) => <option key={department} value={department}>{department}</option>)}
            </select>
            {hasFilters && <button type="button" className="clear-filter-button" onClick={clearFilters}>Clear</button>}
          </div>
        </div>
        <div className="teacher-table-wrapper">
          {loading ? <div className="teacher-loading"><div className="loading-spinner" /><strong>Loading faculty records</strong><span>Loading this College's directory...</span></div>
            : !error && activeCollegeId && filteredTeachers.length === 0 ? <div className="teacher-empty"><div className="empty-icon">⌕</div><strong>{teachers.length ? "No matching teachers" : "No teacher profiles found"}</strong><span>{teachers.length ? "Try another search or change the selected filters." : "No College-owned Teacher profiles are currently available."}</span>{hasFilters && <button type="button" className="secondary-button" onClick={clearFilters}>Clear filters</button>}</div>
              : filteredTeachers.length > 0 && <div className="table-scroll"><table className="teacher-table">
                <thead><tr><th>Teacher</th><th>Department</th><th>Record</th><th>Status</th><th>Details</th></tr></thead>
                <tbody>{filteredTeachers.map((teacher) => {
                  const active = teacher.is_active !== false;
                  return <tr key={teacher.id}>
                    <td><div className="teacher-name"><span className="teacher-avatar">{getInitials(teacher.name)}</span><div><strong>{teacher.name}</strong><small>College profile</small></div></div></td>
                    <td><span className="department-text">{teacher.department || "Not assigned"}</span></td>
                    <td><code className="teacher-id">#{teacher.id}</code></td>
                    <td><span className={active ? "status-pill active" : "status-pill inactive"}>{active ? "Active" : "Inactive"}</span></td>
                    <td><div className="row-actions"><button type="button" onClick={() => openView(teacher)}>View profile</button></div></td>
                  </tr>;
                })}</tbody>
              </table></div>}
        </div>
      </section>

      {selectedTeacher && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetails(); }}>
        <div className="teacher-modal teacher-view" role="dialog" aria-modal="true" aria-labelledby="teacher-modal-title">
          <div className="modal-header"><div className="modal-heading"><div className="modal-number">PROFILE</div><div><div className="eyebrow">COLLEGE TEACHER PROFILE</div><h2 id="teacher-modal-title">{selectedTeacher.name}</h2><p>{canManage ? "Manage this Teacher profile and College assignments." : "Profile details for this College."}</p></div></div>
            <button type="button" className="close-button" onClick={closeDetails} aria-label="Close profile">×</button></div>
          {detailError && <div className="modal-error" role="alert"><span>!</span><span>{detailError}</span></div>}
          {detailLoading ? <div className="teacher-loading"><div className="loading-spinner" /><strong>Loading teacher profile</strong></div> : !detailError && <>
            <div className="profile-identity"><span className="profile-avatar">{getInitials(selectedTeacher.name)}</span><div><h3>{selectedTeacher.name}</h3><p>{selectedTeacher.department || "Department not assigned"}</p><div className="profile-badges"><span className={selectedTeacher.is_active ? "status-pill active" : "status-pill inactive"}>{selectedTeacher.is_active ? "Active" : "Inactive"}</span></div></div></div>
            <div className="profile-grid">
              {canManage && <div className="profile-item"><span>Email</span><strong>{selectedTeacher.email}</strong></div>}
              {canManage && <div className="profile-item"><span>Employee ID</span><strong>{selectedTeacher.employee_id}</strong></div>}
              <div className="profile-item"><span>Department</span><strong>{selectedTeacher.department || "Not assigned"}</strong></div>
              {canManage && <div className="profile-item"><span>Designation</span><strong>{selectedTeacher.designation || "Not assigned"}</strong></div>}
              {canManage && <div className="profile-item"><span>Qualification</span><strong>{selectedTeacher.qualification || "Not provided"}</strong></div>}
              {canManage && <div className="profile-item"><span>Mobile</span><strong>{selectedTeacher.mobile || "Not provided"}</strong></div>}
              <div className="profile-item"><span>Profile status</span><strong>{selectedTeacher.is_active ? "Active" : "Inactive"}</strong></div>
              {canManage && <div className="profile-item"><span>Account setup</span><strong>{teacherInvitation?.status || "Loading status"}{teacherInvitation?.expires_at ? ` · expires ${new Date(teacherInvitation.expires_at).toLocaleString()}` : ""}</strong></div>}
              <div className="profile-item"><span>Record number</span><strong>#{selectedTeacher.id}</strong></div>
              <div className="profile-item"><span>Added</span><strong>{selectedTeacher.created_at ? new Date(selectedTeacher.created_at).toLocaleString() : "Not available"}</strong></div>
            </div>
            {canManage && <section className="teacher-assignment-panel" aria-labelledby="teacher-profile-verification-title">
              <h3 id="teacher-profile-verification-title">Teacher profile verification</h3>
              <p>Profile verification is an independent College Admin review. It does not create or confirm the login account link.</p>
              {verificationLoadStatus === "loading" && <p role="status">Loading profile verification…</p>}
              {verificationLoadStatus === "unavailable" && <div className="modal-error" role="alert">Profile verification is unavailable. The reviewed migration may be unapplied or the schema may be incomplete. Existing account-link details remain separate.</div>}
              {verificationLoadStatus === "loaded" && teacherVerification && <>
                <div className="profile-grid" aria-label="Teacher profile verification status">
                  <div className="profile-item"><span>Profile verification</span><strong>{teacherVerification.verification_status}</strong></div>
                  {teacherVerification.verified_by_admin_id && <div className="profile-item"><span>Verified by Admin User ID</span><strong>{teacherVerification.verified_by_admin_id}</strong></div>}
                  {teacherVerification.verified_at && <div className="profile-item"><span>Verified at</span><strong>{new Date(teacherVerification.verified_at).toLocaleString()}</strong></div>}
                  {teacherVerification.rejected_by_admin_id && <div className="profile-item"><span>Rejected by Admin User ID</span><strong>{teacherVerification.rejected_by_admin_id}</strong></div>}
                  {teacherVerification.rejected_at && <div className="profile-item"><span>Rejected at</span><strong>{new Date(teacherVerification.rejected_at).toLocaleString()}</strong></div>}
                  {teacherVerification.verification_reason && <div className="profile-item"><span>Review reason</span><strong>{teacherVerification.verification_reason}</strong></div>}
                </div>
                {verificationNotice && <p role="status">{verificationNotice}</p>}
                {verificationError && <div className="modal-error" role="alert">{verificationError}</div>}
                {selectedTeacher.is_active && <div className="tenant-promotion-form">
                  <label>Review reason<textarea value={verificationReason} maxLength={500} minLength={5} onChange={(event) => setVerificationReason(event.target.value)} placeholder="Record the reason for this review" /></label>
                  <div className="tenant-form-actions">
                    {teacherVerification.verification_status !== "verified" && <button type="button" className="primary-button" disabled={verificationBusy || verificationReason.trim().length < 5} onClick={() => void updateTeacherVerification("verified")}>{verificationBusy ? "Saving…" : "Verify profile"}</button>}
                    {teacherVerification.verification_status !== "rejected" && <button type="button" className="secondary-button" disabled={verificationBusy || verificationReason.trim().length < 5} onClick={() => void updateTeacherVerification("rejected")}>{verificationBusy ? "Saving…" : "Reject profile"}</button>}
                  </div>
                </div>}
                <h4>Verification history</h4>
                {teacherVerificationHistory.length === 0 ? <p>No profile review events are recorded.</p> : <ul>{teacherVerificationHistory.map((event) => <li key={event.id}>{event.action.replaceAll("_", " ")} · Admin User #{event.actor_user_id} · {new Date(event.created_at).toLocaleString()} · {event.reason}</li>)}</ul>}
              </>}
            </section>}
            {canManage && <section className="teacher-assignment-panel" aria-labelledby="teacher-account-link-title">
              <h3 id="teacher-account-link-title">Verified login account</h3>
              <p>Link an existing login only after verifying the account holder against official College records. Never infer identity from email, name, phone, employee ID, or ID ordering.</p>
              {accountLinkStatus === "loading" && <p role="status">Checking the verified account link...</p>}
              {accountLinkStatus === "unavailable" && <p className="modal-error" role="alert">Account-link status could not be loaded. Retry after checking that College account-link services are available.</p>}
              {accountLinkStatus === "loaded" && teacherAccountLink && <div className="profile-grid" aria-label="Account-link audit details">
                <div className="profile-item"><span>Profile ID</span><strong>{teacherAccountLink.profile_id}</strong></div>
                <div className="profile-item"><span>Linked User ID</span><strong>{teacherAccountLink.user_id}</strong></div>
                <div className="profile-item"><span>College ID</span><strong>{teacherAccountLink.college_id}</strong></div>
                <div className="profile-item"><span>Link status</span><strong>{teacherAccountLink.link_status}</strong></div>
                <div className="profile-item"><span>Teacher profile active</span><strong>{teacherAccountLink.profile_is_active == null ? "Unknown" : teacherAccountLink.profile_is_active ? "Yes" : "No"}</strong></div>
                <div className="profile-item"><span>Login account active</span><strong>{teacherAccountLink.user_is_active == null ? "Unknown" : teacherAccountLink.user_is_active ? "Yes" : "No"}</strong></div>
                <div className="profile-item"><span>College membership</span><strong>{teacherAccountLink.membership_status || "Not found"}</strong></div>
                <div className="profile-item"><span>Verified by User ID</span><strong>{teacherAccountLink.verified_by_user_id}</strong></div>
                <div className="profile-item"><span>Verified at</span><strong>{new Date(teacherAccountLink.verified_at).toLocaleString()}</strong></div>
                {teacherAccountLink.revoked_at && <div className="profile-item"><span>Revoked at</span><strong>{new Date(teacherAccountLink.revoked_at).toLocaleString()}</strong></div>}
                {teacherAccountLink.revocation_reason && <div className="profile-item"><span>Revocation reason</span><strong>{teacherAccountLink.revocation_reason}</strong></div>}
              </div>}
              {teacherAccountLink?.link_status === "active"
                && (teacherAccountLink.profile_is_active !== true || teacherAccountLink.user_is_active !== true || teacherAccountLink.membership_status !== "active")
                && <p className="modal-error" role="alert">An active link alone is not sufficient for Teacher access. The profile, login account, and active Teacher College membership must all be valid; this workflow will not grant membership or bypass authorization.</p>}
              {accountLinkNotice && <p role="status">{accountLinkNotice}</p>}
              {accountLinkError && <div className="modal-error" role="alert">{accountLinkError}</div>}
              {teacherAccountLink?.link_status === "active" && <div className="tenant-form-actions">
                <label>Revocation reason<input value={accountLinkRevokeReason} maxLength={500} onChange={(event) => setAccountLinkRevokeReason(event.target.value)} /></label>
                <button type="button" className="secondary-button" disabled={accountLinkBusy} onClick={() => void revokeSelectedTeacherAccountLink()}>
                  {accountLinkBusy ? "Saving..." : "Revoke account link"}
                </button>
              </div>}
              {selectedTeacher.is_active && (!teacherAccountLink || teacherAccountLink.link_status === "revoked") && accountLinkStatus !== "loading" && accountLinkStatus !== "unavailable" && <form className="tenant-promotion-form" onSubmit={saveTeacherAccountLink}>
                <p>{accountLinkStatus === "missing" ? "No account link is recorded for this Teacher profile." : "The prior link is revoked. Verify the replacement account before continuing."} Search the College's active Teacher login accounts and select the existing account only after checking official institutional records. Search results do not verify identity.</p>
                <label>Search existing accounts<input type="search" minLength="2" maxLength="120" value={accountLinkSearch} onChange={(event) => { setAccountLinkSearch(event.target.value); setAccountLinkCandidates([]); setAccountLinkUserId(""); setAccountLinkAttested(false); }} placeholder="Account name, email, or User ID" /></label>
                <div className="tenant-form-actions"><button type="button" className="secondary-button" disabled={accountLinkSearchBusy || accountLinkSearch.trim().length < 2} onClick={() => void searchTeacherLinkUsers()}>{accountLinkSearchBusy ? "Searching..." : "Search active accounts"}</button></div>
                {accountLinkCandidates.length > 0 && <div className="profile-grid" role="group" aria-label="Eligible existing Teacher login accounts">{accountLinkCandidates.map((candidate) => <button key={candidate.user_id} type="button" className="secondary-button" aria-pressed={String(candidate.user_id) === accountLinkUserId} onClick={() => { setAccountLinkUserId(String(candidate.user_id)); setAccountLinkAttested(false); setAccountLinkError(""); }}><strong>User #{candidate.user_id}</strong> · {candidate.name} · {candidate.email}</button>)}</div>}
                {accountLinkSearch.trim().length >= 2 && !accountLinkSearchBusy && accountLinkCandidates.length === 0 && <p role="status">No unlinked active Teacher login accounts matched this search in the selected College.</p>}
                {accountLinkUserId && <p role="status">Selected existing login User ID: {accountLinkUserId}. Confirm this account holder against institutional records before linking.</p>}
                <label><input type="checkbox" checked={accountLinkAttested} onChange={(event) => setAccountLinkAttested(event.target.checked)} /> I independently verified this account holder and Teacher profile using official College records and confirmed the selected College.</label>
                <div className="tenant-form-actions"><button type="submit" className="primary-button" disabled={accountLinkBusy || !accountLinkAttested || !accountLinkUserId}>{accountLinkBusy ? "Verifying..." : "Verify and link existing account"}</button></div>
              </form>}
            </section>}
            {canManage && !selectedTeacher.is_active && teacherInvitation?.membership_status === "pending" && <button type="button" className="secondary-button" onClick={() => resendInvitation(selectedTeacher)}>Resend setup invitation</button>}
            {canManage && selectedTeacher.is_active && <div className="tenant-form-actions">
              <button type="button" className="secondary-button" onClick={() => {
                setProfileForm({
                  name: selectedTeacher.name || "",
                  department: selectedTeacher.department || "", gender: selectedTeacher.gender || "",
                  designation: selectedTeacher.designation || "", qualification: selectedTeacher.qualification || "",
                  mobile: selectedTeacher.mobile || "", address: selectedTeacher.address || "",
                  joining_date: selectedTeacher.joining_date || "",
                });
                setEditingProfile((value) => !value);
              }}>Edit profile</button>
              <button type="button" className="secondary-button" disabled={profileSaving} onClick={deactivateSelectedTeacher}>Deactivate Teacher</button>
            </div>}
            {editingProfile && canManage && selectedTeacher.is_active && <form className="tenant-promotion-form" onSubmit={saveProfile}>
              <h3>Edit Teacher profile</h3>
              <div className="tenant-registration-grid">
                {[["name", "Full name", "text"], ["department", "Department", "text"], ["gender", "Gender", "text"], ["designation", "Designation", "text"], ["qualification", "Qualification", "text"], ["mobile", "Mobile", "tel"], ["address", "Address", "text"], ["joining_date", "Joining date", "date"]].map(([name, label, type]) => <label key={name}><span>{label}</span><input name={name} type={type} value={profileForm[name] || ""} required={name === "name"} onChange={updateProfileField} /></label>)}
              </div>
              <div className="tenant-form-actions"><button type="button" className="secondary-button" onClick={() => setEditingProfile(false)}>Cancel</button><button type="submit" className="primary-button" disabled={profileSaving}>{profileSaving ? "Saving..." : "Save profile"}</button></div>
            </form>}
            {canManage && <section className="teacher-assignment-panel">
              <h3>Class and subject assignments</h3>
              {assignmentError && <div className="modal-error" role="alert">{assignmentError}</div>}
              {teacherAssignments.length === 0 ? <p>No assignment history is available.</p> : <ul>{teacherAssignments.map((assignment) => <li key={assignment.id}>
                <span>{classes.find((item) => item.id === assignment.class_id)?.name || `Class ${assignment.class_id}`} · {subjects.find((item) => item.id === assignment.subject_id)?.name || `Subject ${assignment.subject_id}`} · {assignment.academic_year}, semester {assignment.semester} · {assignmentStatus(assignment)}</span>
                {assignmentStatus(assignment) !== "Ended" && selectedTeacher.is_active && <button type="button" className="secondary-button" onClick={() => endTeacherAssignment(assignment.id)}>End assignment</button>}
              </li>)}</ul>}
              {selectedTeacher.is_active && <form className="tenant-promotion-form" onSubmit={addTeacherAssignment}>
                <h4>Assign class and subject</h4>
                <div className="tenant-registration-grid">
                  <label>Class<select required value={assignmentForm.class_id} onChange={(event) => setAssignmentForm((current) => ({ ...current, class_id: event.target.value }))}><option value="">Select class</option>{activeAssignableRecords(classes).map((item) => <option key={item.id} value={item.id}>{item.name} {item.section || ""}</option>)}</select></label>
                  <label>Subject<select required value={assignmentForm.subject_id} onChange={(event) => setAssignmentForm((current) => ({ ...current, subject_id: event.target.value }))}><option value="">Select subject</option>{activeAssignableRecords(subjects).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  <label>Academic year<input required maxLength="20" value={assignmentForm.academic_year} onChange={(event) => setAssignmentForm((current) => ({ ...current, academic_year: event.target.value }))} /></label>
                  <label>Semester<input required type="number" min="1" max="24" value={assignmentForm.semester} onChange={(event) => setAssignmentForm((current) => ({ ...current, semester: event.target.value }))} /></label>
                  <label>Effective from<input required type="datetime-local" value={assignmentForm.effective_from} onChange={(event) => setAssignmentForm((current) => ({ ...current, effective_from: event.target.value }))} /></label>
                  <label>Effective until (optional)<input type="datetime-local" min={assignmentForm.effective_from} value={assignmentForm.effective_to} onChange={(event) => setAssignmentForm((current) => ({ ...current, effective_to: event.target.value }))} /></label>
                </div>
                <button type="submit" className="primary-button" disabled={assignmentSaving}>{assignmentSaving ? "Saving..." : "Add assignment"}</button>
              </form>}
            </section>}
            {canManage && selectedTeacher.is_active && <>
              <button type="button" className="secondary-button" onClick={() => { setPasswordResetOpen((value) => !value); setPasswordResetError(""); }}>Reset Teacher password</button>
              {passwordResetOpen && <form className="tenant-promotion-form" onSubmit={submitPasswordReset}>
                <h3>Set a new permanent password</h3>
                {passwordResetError && <div className="modal-error" role="alert">{passwordResetError}</div>}
                <label>New password<input type="password" autoComplete="new-password" minLength="12" maxLength="72" required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
                <label>Confirm new password<input type="password" autoComplete="new-password" minLength="12" maxLength="72" required value={newPasswordConfirmation} onChange={(event) => setNewPasswordConfirmation(event.target.value)} /></label>
                <button className="primary-button" type="submit" disabled={passwordResetBusy}>{passwordResetBusy ? "Resetting..." : "Set new password"}</button>
              </form>}
            </>}
          </>}
        </div>
      </div>}
    </main>
  );
}
