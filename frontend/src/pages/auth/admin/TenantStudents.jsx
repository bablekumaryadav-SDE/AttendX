import React, { useEffect, useMemo, useRef, useState } from "react";
import { Building2, RefreshCw, Search, UserCheck, UserPlus, UserRoundX, UsersRound } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import FaceCamera from "../../../components/FaceCamera";
import { activateTenantStudent, assignTenantStudentToClass, createTenantStudent, createStudentAccountLink, deactivateTenantStudent, deactivateTenantStudentClassAssignment, getTenantStudent, getTenantStudentAccountLink, getTenantStudentAcademicHistory, getTenantStudentClassAssignments, getTenantStudentFaceStatus, getTenantStudentInvitation, getTenantStudents, promoteTenantStudent, registerTenantStudentFace, resendTenantStudentInvitation, resetTenantStudentPassword, revokeStudentAccountLink, searchStudentAccountLinkCandidates, updateTenantStudent } from "../../../services/tenantStudents";
import { getClasses } from "../../../services/academic";
import { isPasswordPolicyValid } from "../../../services/passwordPolicy";
import { mapStudentRegistrationFailure, studentInvitationFailureMessage, studentStatusActionFailureMessage } from "../../../utils/studentRegistrationErrors";
import {
  createLatestRequestGuard,
  studentLoadMessage,
} from "../../../services/tenantSelection";
import "./Students.css";
import "./TenantStudents.css";
import "../../../components/tenantRegistration.css";

function localDateTimeInput(value = new Date()) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function assignmentStatus(assignment) {
  const now = Date.now();
  if (assignment.effective_from && new Date(assignment.effective_from).getTime() > now) return "Scheduled";
  if (assignment.effective_to && new Date(assignment.effective_to).getTime() <= now) return "Ended";
  return assignment.is_active ? "Active" : "Ended";
}

function TenantStudents() {
  const { user, activeCollegeId, collegeMemberships } = useAuth();
  const canManage = user?.role !== "super_admin" && collegeMemberships.some((membership) => String(membership.college_id) === String(activeCollegeId) && membership.membership_role === "college_admin");
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [inactiveCount, setInactiveCount] = useState(0);
  const [faceStatusFilter, setFaceStatusFilter] = useState("all");
  const [faceRegisteredCount, setFaceRegisteredCount] = useState(null);
  const [faceNotRegisteredCount, setFaceNotRegisteredCount] = useState(null);
  const [faceCountsAvailable, setFaceCountsAvailable] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentAccountLink, setStudentAccountLink] = useState(null);
  const [studentAccountLinkStatus, setStudentAccountLinkStatus] = useState("loading");
  const [studentAccountLinkSearch, setStudentAccountLinkSearch] = useState("");
  const [studentAccountLinkCandidates, setStudentAccountLinkCandidates] = useState([]);
  const [studentAccountLinkUserId, setStudentAccountLinkUserId] = useState("");
  const [studentAccountLinkAttested, setStudentAccountLinkAttested] = useState(false);
  const [studentAccountLinkBusy, setStudentAccountLinkBusy] = useState(false);
  const [studentAccountLinkSearchBusy, setStudentAccountLinkSearchBusy] = useState(false);
  const [studentAccountLinkError, setStudentAccountLinkError] = useState("");
  const [studentAccountLinkNotice, setStudentAccountLinkNotice] = useState("");
  const [studentAccountLinkRevokeReason, setStudentAccountLinkRevokeReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [passwordResetOpen, setPasswordResetOpen] = useState(false);
  const [passwordResetBusy, setPasswordResetBusy] = useState(false);
  const [passwordResetError, setPasswordResetError] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [editForm, setEditForm] = useState({});
  const [studentAssignments, setStudentAssignments] = useState([]);
  const [assignmentForm, setAssignmentForm] = useState({ class_id: "", academic_year: "", semester: "", effective_from: localDateTimeInput(), effective_to: "" });
  const [assignmentError, setAssignmentError] = useState("");
  const [classes, setClasses] = useState([]);
  const [classLoading, setClassLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formSuccess, setFormSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [showRegistration, setShowRegistration] = useState(false);
  const [newStudentFaceFile, setNewStudentFaceFile] = useState(null);
  const [newStudentFacePreview, setNewStudentFacePreview] = useState("");
  const [faceConsent, setFaceConsent] = useState(false);
  const [faceSaving, setFaceSaving] = useState(false);
  const [faceError, setFaceError] = useState("");
  const [faceRegistered, setFaceRegistered] = useState(false);
  const [faceStatus, setFaceStatus] = useState("unavailable");
  const [selectedFaceFile, setSelectedFaceFile] = useState(null);
  const [selectedFacePreview, setSelectedFacePreview] = useState("");
  const [academicHistory, setAcademicHistory] = useState([]);
  const [promotionReason, setPromotionReason] = useState("");
  const [promotionError, setPromotionError] = useState("");
  const [promotionSaving, setPromotionSaving] = useState(false);
  const [availableClasses, setAvailableClasses] = useState([]);
  const [studentInvitation, setStudentInvitation] = useState(null);
  const [invitationError, setInvitationError] = useState("");
  const [resendingInvitationId, setResendingInvitationId] = useState(null);
  const resendingInvitationRef = useRef(null);
  const studentAccountLinkSearchRef = useRef(0);
  const studentAccountLinkSearchBusyRef = useRef(false);
  const studentAccountLinkBusyRef = useRef(false);
  const activeCollegeIdRef = useRef(activeCollegeId);
  activeCollegeIdRef.current = activeCollegeId;
  const [reloadVersion, setReloadVersion] = useState(0);
  const listGuard = useRef(null);
  const detailGuard = useRef(null);
  if (!listGuard.current) listGuard.current = createLatestRequestGuard();
  if (!detailGuard.current) detailGuard.current = createLatestRequestGuard();

  useEffect(() => {
    const version = listGuard.current.begin();
    detailGuard.current.invalidate();
    setStudents([]);
    setTotal(0);
    setActiveCount(0);
    setInactiveCount(0);
    setFaceRegisteredCount(null);
    setFaceNotRegisteredCount(null);
    setFaceCountsAvailable(false);
    setSelectedStudent(null);
    setStudentAccountLink(null);
    setStudentAccountLinkStatus("loading");
    setStudentAccountLinkSearch("");
    setStudentAccountLinkCandidates([]);
    setStudentAccountLinkUserId("");
    setStudentAccountLinkAttested(false);
    setStudentAccountLinkBusy(false);
    setStudentAccountLinkSearchBusy(false);
    setStudentAccountLinkError("");
    setStudentAccountLinkNotice("");
    setStudentAccountLinkRevokeReason("");
    setStudentInvitation(null);
    setInvitationError("");
    setStudentAssignments([]);
    setClasses([]);
    setEditing(false);
    setPasswordResetOpen(false);
    setNewPassword("");
    setNewPasswordConfirmation("");
    setAssignmentError("");
    setShowRegistration(false);
    setNewStudentFaceFile(null);
    if (newStudentFacePreview) URL.revokeObjectURL(newStudentFacePreview);
    setNewStudentFacePreview("");
    setFaceConsent(false);
    setFaceError("");
    setFaceRegistered(false);
    setSelectedFaceFile(null);
    if (selectedFacePreview) URL.revokeObjectURL(selectedFacePreview);
    setSelectedFacePreview("");
    setAvailableClasses([]);
    setError("");
    setDetailError("");
    setFormError("");
    setFormSuccess("");
    setPromotionError("");
    setAcademicHistory([]);
    setDetailLoading(false);
    if (!activeCollegeId) {
      setLoading(false);
      return () => listGuard.current.invalidate();
    }

    setLoading(true);
    setFaceCountsAvailable(false);
    getTenantStudents(activeCollegeId, { search, course: courseFilter, department: departmentFilter, activeOnly, faceStatus: faceStatusFilter, page, pageSize })
      .then((result) => {
        if (listGuard.current.isCurrent(version)) {
          setStudents(Array.isArray(result?.items) ? result.items : []);
          setTotal(Number(result?.total || 0));
          setActiveCount(Number(result?.active_count || 0));
          setInactiveCount(Number(result?.inactive_count || 0));
          const registered = Number(result?.face_registered_count);
          const notRegistered = Number(result?.face_not_registered_count);
          const countsValid = Number.isInteger(registered) && registered >= 0 && Number.isInteger(notRegistered) && notRegistered >= 0;
          setFaceCountsAvailable(countsValid);
          setFaceRegisteredCount(countsValid ? registered : null);
          setFaceNotRegisteredCount(countsValid ? notRegistered : null);
        }
      })
      .catch((failure) => {
        if (listGuard.current.isCurrent(version)) {
          setStudents([]);
          setTotal(0);
          setActiveCount(0);
          setInactiveCount(0);
          setFaceRegisteredCount(null);
          setFaceNotRegisteredCount(null);
          setError(studentLoadMessage(failure.response?.status));
        }
      })
      .finally(() => {
        if (listGuard.current.isCurrent(version)) setLoading(false);
      });
    return () => listGuard.current.invalidate();
  }, [activeCollegeId, reloadVersion, search, courseFilter, departmentFilter, activeOnly, faceStatusFilter, page, pageSize]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") closeDetails();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const filteredStudents = useMemo(() => {
    return students;
  }, [students]);

  const activeStudents = activeCount;
  const inactiveStudents = inactiveCount;
  const departmentCount = new Set(students.map((student) => student.department).filter(Boolean)).size;

  async function openDetails(student) {
    const version = detailGuard.current.begin();
    setSelectedStudent(student);
    setStudentAccountLink(null);
    setStudentAccountLinkStatus(canManage ? "loading" : "unavailable");
    setStudentAccountLinkSearch("");
    setStudentAccountLinkCandidates([]);
    setStudentAccountLinkUserId("");
    setStudentAccountLinkAttested(false);
    setStudentAccountLinkError("");
    setStudentAccountLinkNotice("");
    setStudentAccountLinkRevokeReason("");
    setDetailError("");
    setFaceError("");
    setFaceRegistered(false);
    setFaceStatus("unavailable");
    setFaceConsent(false);
    setSelectedFaceFile(null);
    setStudentInvitation(null);
    setInvitationError("");
    if (selectedFacePreview) URL.revokeObjectURL(selectedFacePreview);
    setSelectedFacePreview("");
    setDetailLoading(true);
    if (!activeCollegeId) {
      setDetailLoading(false);
      return;
    }
    try {
      const detail = await getTenantStudent(student.id, activeCollegeId);
      if (detailGuard.current.isCurrent(version)) {
        setSelectedStudent(detail);
        const [historyResult, invitationResult, faceStatusResult, accountLinkResult] = await Promise.allSettled([
          getTenantStudentAcademicHistory(student.id, activeCollegeId),
          getTenantStudentInvitation(student.id, activeCollegeId),
          getTenantStudentFaceStatus(student.id, activeCollegeId),
          canManage ? getTenantStudentAccountLink(student.id, activeCollegeId) : Promise.resolve(null),
        ]);
        if (detailGuard.current.isCurrent(version)) {
          if (historyResult.status === "fulfilled") setAcademicHistory(Array.isArray(historyResult.value) ? historyResult.value : []);
          if (invitationResult.status === "fulfilled") setStudentInvitation(invitationResult.value);
          else setInvitationError(studentInvitationFailureMessage(invitationResult.reason));
          if (faceStatusResult.status === "fulfilled" && ["registered", "not_registered"].includes(faceStatusResult.value?.status)) {
            const registered = faceStatusResult.value.status === "registered" && faceStatusResult.value.face_registered === true;
            setFaceRegistered(registered);
            setFaceStatus(registered ? "registered" : "not_registered");
          } else {
            setFaceStatus("unavailable");
            setFaceError(faceStatusResult.reason?.response?.data?.detail || "Face registration status is unavailable.");
          }
          if (!canManage) {
            setStudentAccountLinkStatus("unavailable");
          } else if (accountLinkResult.status === "fulfilled") {
            setStudentAccountLink(accountLinkResult.value);
            setStudentAccountLinkStatus("loaded");
          } else if (accountLinkResult.reason?.response?.status === 404) {
            setStudentAccountLink(null);
            setStudentAccountLinkStatus("missing");
          } else {
            setStudentAccountLink(null);
            setStudentAccountLinkStatus("unavailable");
            setStudentAccountLinkError(accountLinkResult.reason?.response?.data?.detail || "Account-link status could not be loaded.");
          }
        }
        const [assignments, classRows] = await Promise.all([
          getTenantStudentClassAssignments(student.id, activeCollegeId),
          getClasses(activeCollegeId),
        ]);
        if (detailGuard.current.isCurrent(version)) {
          setStudentAssignments(Array.isArray(assignments) ? assignments : []);
          setClasses(Array.isArray(classRows) ? classRows : []);
        }
      }
    } catch (failure) {
      if (detailGuard.current.isCurrent(version)) setDetailError(studentLoadMessage(failure.response?.status, true));
    } finally {
      if (detailGuard.current.isCurrent(version)) setDetailLoading(false);
    }
  }

  async function searchStudentLinkUsers() {
    if (!canManage || !activeCollegeId || !selectedStudent?.is_active || studentAccountLinkSearchBusyRef.current) return;
    if (studentAccountLinkSearch.trim().length < 2) {
      setStudentAccountLinkError("Enter at least two characters to search active Student login accounts in this College.");
      return;
    }
    const requestId = ++studentAccountLinkSearchRef.current;
    const studentId = selectedStudent.id;
    const collegeAtSubmit = activeCollegeId;
    const queryAtSubmit = studentAccountLinkSearch.trim();
    studentAccountLinkSearchBusyRef.current = true;
    setStudentAccountLinkSearchBusy(true);
    setStudentAccountLinkError("");
    setStudentAccountLinkCandidates([]);
    setStudentAccountLinkUserId("");
    setStudentAccountLinkAttested(false);
    try {
      const candidates = await searchStudentAccountLinkCandidates(queryAtSubmit, collegeAtSubmit);
      if (requestId !== studentAccountLinkSearchRef.current
          || String(activeCollegeIdRef.current) !== String(collegeAtSubmit)
          || selectedStudent?.id !== studentId
          || studentAccountLinkSearch.trim() !== queryAtSubmit) return;
      setStudentAccountLinkCandidates(Array.isArray(candidates) ? candidates : []);
    } catch (failure) {
      if (requestId === studentAccountLinkSearchRef.current) {
        setStudentAccountLinkError(failure.response?.data?.detail || failure.message || "Eligible Student login accounts could not be searched.");
      }
    } finally {
      if (requestId === studentAccountLinkSearchRef.current) {
        studentAccountLinkSearchBusyRef.current = false;
        setStudentAccountLinkSearchBusy(false);
      }
    }
  }

  async function saveStudentAccountLink(event) {
    event.preventDefault();
    if (!canManage || !activeCollegeId || !selectedStudent?.is_active || studentAccountLinkBusyRef.current) return;
    const studentId = selectedStudent.id;
    const collegeAtSubmit = activeCollegeId;
    const userId = Number(studentAccountLinkUserId.trim());
    if (!Number.isSafeInteger(userId) || userId < 1) {
      setStudentAccountLinkError("Search for and select the existing Student login account before linking.");
      return;
    }
    if (!studentAccountLinkAttested) {
      setStudentAccountLinkError("Confirm the identity check against official College records before linking.");
      return;
    }
    studentAccountLinkBusyRef.current = true;
    setStudentAccountLinkBusy(true);
    setStudentAccountLinkError("");
    setStudentAccountLinkNotice("");
    try {
      const result = await createStudentAccountLink(studentId, userId, collegeAtSubmit);
      if (String(activeCollegeIdRef.current) !== String(collegeAtSubmit) || selectedStudent?.id !== studentId) return;
      setStudentAccountLink(result);
      setStudentAccountLinkStatus("loaded");
      setStudentAccountLinkUserId("");
      setStudentAccountLinkCandidates([]);
      setStudentAccountLinkSearch("");
      setStudentAccountLinkAttested(false);
      setStudentAccountLinkNotice("The verified Student account link is active. The verifier and timestamp are recorded.");
    } catch (failure) {
      setStudentAccountLinkError(failure.response?.data?.detail || failure.message || "Student account link could not be created.");
    } finally {
      studentAccountLinkBusyRef.current = false;
      setStudentAccountLinkBusy(false);
    }
  }

  async function revokeSelectedStudentAccountLink() {
    if (!canManage || !activeCollegeId || !selectedStudent || !studentAccountLink || studentAccountLinkBusyRef.current) return;
    if (studentAccountLinkRevokeReason.trim().length < 3) {
      setStudentAccountLinkError("Provide a reason of at least three characters to revoke this link.");
      return;
    }
    const studentId = selectedStudent.id;
    const collegeAtSubmit = activeCollegeId;
    studentAccountLinkBusyRef.current = true;
    setStudentAccountLinkBusy(true);
    setStudentAccountLinkError("");
    setStudentAccountLinkNotice("");
    try {
      const result = await revokeStudentAccountLink(studentAccountLink.id, studentAccountLinkRevokeReason.trim(), collegeAtSubmit);
      if (String(activeCollegeIdRef.current) !== String(collegeAtSubmit) || selectedStudent?.id !== studentId) return;
      setStudentAccountLink(result);
      setStudentAccountLinkRevokeReason("");
      setStudentAccountLinkNotice("The account link was revoked and the action was recorded.");
    } catch (failure) {
      setStudentAccountLinkError(failure.response?.data?.detail || failure.message || "Student account link could not be revoked.");
    } finally {
      studentAccountLinkBusyRef.current = false;
      setStudentAccountLinkBusy(false);
    }
  }

  function closeDetails() {
    detailGuard.current?.invalidate();
    setSelectedStudent(null);
    setStudentAccountLink(null);
    setStudentAccountLinkStatus("loading");
    setStudentAccountLinkCandidates([]);
    setStudentAccountLinkSearch("");
    setStudentAccountLinkUserId("");
    setStudentAccountLinkAttested(false);
    setStudentAccountLinkError("");
    setStudentAccountLinkNotice("");
    setStudentAccountLinkRevokeReason("");
    setStudentInvitation(null);
    setStudentAssignments([]);
    setEditing(false);
    setPasswordResetOpen(false);
    setPasswordResetError("");
    setNewPassword("");
    setNewPasswordConfirmation("");
    setDetailError("");
    setDetailLoading(false);
    setFaceConsent(false);
    setSelectedFaceFile(null);
    if (selectedFacePreview) URL.revokeObjectURL(selectedFacePreview);
    setSelectedFacePreview("");
    setFaceError("");
  }

  function clearNewStudentFace() {
    setNewStudentFaceFile(null);
    if (newStudentFacePreview) URL.revokeObjectURL(newStudentFacePreview);
    setNewStudentFacePreview("");
    setFaceConsent(false);
  }

  function clearRegistrationFieldError(field) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError("");
  }

  async function resendInvitation(student) {
    if (!activeCollegeId || resendingInvitationRef.current === student.id) return;
    const submittedCollegeId = activeCollegeId;
    resendingInvitationRef.current = student.id;
    setResendingInvitationId(student.id);
    setFormError("");
    setFormSuccess("");
    try {
      const result = await resendTenantStudentInvitation(student.id, submittedCollegeId);
      if (String(activeCollegeIdRef.current) !== String(submittedCollegeId)) return;
      setFormSuccess(result.status === "sent" ? "A new setup invitation was sent to the Student." : "Invitation delivery failed. Check the mail configuration and retry.");
      try {
        const invitation = await getTenantStudentInvitation(student.id, submittedCollegeId);
        if (String(activeCollegeIdRef.current) === String(submittedCollegeId) && selectedStudent?.id === student.id) {
          setStudentInvitation(invitation);
          setInvitationError("");
        }
      } catch (statusFailure) {
        if (String(activeCollegeIdRef.current) === String(submittedCollegeId) && selectedStudent?.id === student.id) {
          setInvitationError(studentInvitationFailureMessage(statusFailure));
        }
      }
    } catch (failure) {
      if (String(activeCollegeIdRef.current) === String(submittedCollegeId)) {
        setFormError(studentInvitationFailureMessage(failure));
      }
    } finally {
      resendingInvitationRef.current = null;
      setResendingInvitationId(null);
    }
  }

  async function submitRegistration(event) {
    event.preventDefault();
    if (!activeCollegeId || saving) return;
    const formElement = event.currentTarget;
    const submittedCollegeId = activeCollegeId;
    setSaving(true);
    setFormError("");
    setFormSuccess("");
    setFieldErrors({});
    const form = new FormData(formElement);
    const password = form.get("password");
    const passwordConfirmation = form.get("password_confirmation");
    if (!password || !passwordConfirmation) {
      setFieldErrors({
        ...(!password ? { password: "Enter a permanent Student password." } : {}),
        ...(!passwordConfirmation ? { password_confirmation: "Confirm the Student password." } : {}),
      });
      setSaving(false);
      return;
    }
    if (password !== passwordConfirmation) {
      setFieldErrors({ password_confirmation: "Password confirmation does not match." });
      setSaving(false);
      return;
    }
    if (!isPasswordPolicyValid(password)) {
      setFieldErrors({ password: "Use at least 12 characters with uppercase, lowercase, a number, and a symbol; maximum 72 UTF-8 bytes." });
      setSaving(false);
      return;
    }
    const payload = Object.fromEntries(form.entries());
    Object.keys(payload).forEach((key) => { if (payload[key] === "") payload[key] = null; });
    ["admission_year", "program_duration_years", "current_academic_year", "current_semester"].forEach((key) => {
      payload[key] = payload[key] ? Number(payload[key]) : null;
    });
    try {
      const created = await createTenantStudent(payload, submittedCollegeId);
      if (String(activeCollegeIdRef.current) !== String(submittedCollegeId)) return;
      if (!created?.id) {
        setFormError("Student creation returned no generated Student ID. Refresh the directory before retrying.");
        setReloadVersion((value) => value + 1);
        return;
      }
      const generatedStudentId = created.student_code || `Student #${created.id}`;
      if (newStudentFaceFile && created?.id) {
        try {
          await registerTenantStudentFace(created.id, newStudentFaceFile, submittedCollegeId, faceConsent);
          setFormSuccess(`Student account created successfully (Student ID: ${generatedStudentId}) and face registered. Student can log in using the password set by College Admin.`);
        } catch (faceFailure) {
          setFormSuccess(`Student account created successfully (Student ID: ${generatedStudentId}). Face registration did not complete: ${faceFailure.response?.data?.detail || "retry it from the Student profile"}`);
        }
      } else {
        setFormSuccess(`Student account created successfully (Student ID: ${generatedStudentId}). Student can log in using the password set by College Admin.`);
      }
      setShowRegistration(false);
      formElement.reset();
      setNewStudentFaceFile(null);
      if (newStudentFacePreview) URL.revokeObjectURL(newStudentFacePreview);
      setNewStudentFacePreview("");
      setFaceConsent(false);
      setReloadVersion((value) => value + 1);
    } catch (failure) {
      if (String(activeCollegeIdRef.current) === String(submittedCollegeId)) {
        const mapped = mapStudentRegistrationFailure(failure);
        setFieldErrors(mapped.fieldErrors);
        setFormError(mapped.formError);
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveSelectedStudentFace(file) {
    if (!canManage || !activeCollegeId || !selectedStudent || !faceConsent) return;
    const submittedCollegeId = activeCollegeId;
    setFaceSaving(true);
    setFaceError("");
    try {
      const result = await registerTenantStudentFace(selectedStudent.id, file, submittedCollegeId, true);
      if (String(activeCollegeIdRef.current) !== String(submittedCollegeId)) return;
      setFaceRegistered(Boolean(result.face_registered));
      setFaceStatus(result.status === "registered" && result.face_registered === true ? "registered" : "unavailable");
      setSelectedFaceFile(null);
      if (selectedFacePreview) URL.revokeObjectURL(selectedFacePreview);
      setSelectedFacePreview("");
      setReloadVersion((value) => value + 1);
    } catch (failure) {
      if (String(activeCollegeIdRef.current) === String(submittedCollegeId)) setFaceError(failure.response?.data?.detail || "Face registration could not be completed.");
      throw failure;
    } finally {
      setFaceSaving(false);
    }
  }

  function beginEdit() {
    if (!selectedStudent || !canManage) return;
    setEditForm({
      name: selectedStudent.name || "", roll_number: selectedStudent.roll_number || "",
      department: selectedStudent.department || "", course: selectedStudent.course || "",
      enrollment_number: selectedStudent.enrollment_number || "", mobile: selectedStudent.mobile || "",
      current_academic_year: selectedStudent.current_academic_year || "", current_semester: selectedStudent.current_semester || "",
      section: selectedStudent.section || "", father_name: selectedStudent.father_name || "",
      mother_name: selectedStudent.mother_name || "", guardian_name: selectedStudent.guardian_name || "",
      guardian_relationship: selectedStudent.guardian_relationship || "Guardian", parent_mobile: selectedStudent.guardian_mobile || "",
      parent_email: selectedStudent.parent_email || "",
    });
    setEditing(true);
    setFormError("");
  }

  async function saveStudentProfile(event) {
    event.preventDefault();
    if (!canManage || !activeCollegeId || !selectedStudent || saving) return;
    const submittedCollegeId = activeCollegeId;
    setSaving(true);
    setFormError("");
    const payload = { ...editForm };
    for (const key of Object.keys(payload)) payload[key] = typeof payload[key] === "string" ? payload[key].trim() || null : payload[key];
    for (const key of ["current_academic_year", "current_semester"]) payload[key] = payload[key] == null ? null : Number(payload[key]);
    try {
      const updated = await updateTenantStudent(selectedStudent.id, payload, submittedCollegeId);
      if (String(activeCollegeIdRef.current) !== String(submittedCollegeId)) return;
      setSelectedStudent(updated);
      setEditing(false);
      setReloadVersion((value) => value + 1);
    } catch (failure) {
      if (String(activeCollegeIdRef.current) === String(submittedCollegeId)) setFormError(failure.response?.data?.detail || "Student profile could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  async function resetStudentPassword(event) {
    event.preventDefault();
    if (!canManage || !activeCollegeId || !selectedStudent || passwordResetBusy) return;
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
      await resetTenantStudentPassword(selectedStudent.id, { password: newPassword, password_confirmation: newPasswordConfirmation }, submittedCollegeId);
      if (String(activeCollegeIdRef.current) !== String(submittedCollegeId)) return;
      setNewPassword("");
      setNewPasswordConfirmation("");
      setPasswordResetOpen(false);
      setFormSuccess("Student password reset successfully. The new password was not retained or displayed.");
    } catch (failure) {
      if (String(activeCollegeIdRef.current) === String(submittedCollegeId)) setPasswordResetError(failure.response?.data?.detail || "Student password could not be reset.");
    } finally {
      setPasswordResetBusy(false);
    }
  }

  async function deactivateStudent(student) {
    if (!canManage || !activeCollegeId || saving || !window.confirm(`Deactivate ${student.name}? The Student and College membership will be retained for history.`)) return;
    const submittedCollegeId = activeCollegeId;
    setSaving(true);
    setFormError("");
    setFormSuccess("");
    try {
      const result = await deactivateTenantStudent(student.id, submittedCollegeId);
      if (result?.is_active !== false) throw new Error("The backend did not confirm Student deactivation.");
      if (String(activeCollegeIdRef.current) === String(submittedCollegeId)) {
        setStudents((current) => current.map((item) => item.id === student.id ? { ...item, ...result } : item));
        if (selectedStudent?.id === student.id) closeDetails();
        setReloadVersion((value) => value + 1);
        setFormSuccess("Student deactivated. Historical records were retained.");
      }
    } catch (failure) {
      if (String(activeCollegeIdRef.current) === String(submittedCollegeId)) setFormError(studentStatusActionFailureMessage(failure, "deactivated"));
    } finally {
      setSaving(false);
    }
  }

  async function activateStudent(student) {
    if (!canManage || !activeCollegeId || saving || !window.confirm(`Activate ${student.name}? Previously ended class assignments will remain ended.`)) return;
    const submittedCollegeId = activeCollegeId;
    setSaving(true);
    setFormError("");
    setFormSuccess("");
    try {
      const result = await activateTenantStudent(student.id, submittedCollegeId);
      if (result?.is_active !== true) throw new Error("The backend did not confirm Student activation.");
      if (String(activeCollegeIdRef.current) === String(submittedCollegeId)) {
        setStudents((current) => current.map((item) => item.id === student.id ? { ...item, ...result } : item));
        if (selectedStudent?.id === student.id) setSelectedStudent((current) => current ? { ...current, ...result } : current);
        setReloadVersion((value) => value + 1);
        setFormSuccess("Student activated successfully. Existing face registration and historical records are retained.");
      }
    } catch (failure) {
      if (String(activeCollegeIdRef.current) === String(submittedCollegeId)) setFormError(studentStatusActionFailureMessage(failure, "activated"));
    } finally {
      setSaving(false);
    }
  }

  async function assignClass(event) {
    event.preventDefault();
    if (!canManage || !activeCollegeId || !selectedStudent || !assignmentForm.class_id) return;
    const submittedCollegeId = activeCollegeId;
    setAssignmentError("");
    try {
      await assignTenantStudentToClass(selectedStudent.id, {
        class_id: Number(assignmentForm.class_id),
        academic_year: assignmentForm.academic_year.trim(),
        semester: assignmentForm.semester ? Number(assignmentForm.semester) : null,
        effective_from: new Date(assignmentForm.effective_from).toISOString(),
        effective_to: assignmentForm.effective_to ? new Date(assignmentForm.effective_to).toISOString() : null,
      }, submittedCollegeId);
      if (String(activeCollegeIdRef.current) !== String(submittedCollegeId)) return;
      const rows = await getTenantStudentClassAssignments(selectedStudent.id, submittedCollegeId);
      if (String(activeCollegeIdRef.current) !== String(submittedCollegeId)) return;
      setStudentAssignments(rows);
      setAssignmentForm({ class_id: "", academic_year: "", semester: "", effective_from: localDateTimeInput(), effective_to: "" });
    } catch (failure) {
      if (String(activeCollegeIdRef.current) === String(submittedCollegeId)) setAssignmentError(failure.response?.data?.detail || "Class assignment could not be saved.");
    }
  }

  async function removeClassAssignment(assignmentId) {
    if (!canManage || !activeCollegeId || !selectedStudent) return;
    const submittedCollegeId = activeCollegeId;
    setAssignmentError("");
    try {
      await deactivateTenantStudentClassAssignment(selectedStudent.id, assignmentId, submittedCollegeId);
      if (String(activeCollegeIdRef.current) !== String(submittedCollegeId)) return;
      const rows = await getTenantStudentClassAssignments(selectedStudent.id, submittedCollegeId);
      if (String(activeCollegeIdRef.current) !== String(submittedCollegeId)) return;
      setStudentAssignments(rows);
    } catch (failure) {
      if (String(activeCollegeIdRef.current) === String(submittedCollegeId)) setAssignmentError(failure.response?.data?.detail || "Class assignment could not be removed.");
    }
  }

  async function toggleRegistration() {
    const next = !showRegistration;
    const requestedCollegeId = activeCollegeId;
    if (!next) clearNewStudentFace();
    setShowRegistration(next);
    setFormError("");
    setFieldErrors({});
    if (next && activeCollegeId) {
      try {
        const rows = await getClasses(requestedCollegeId);
        if (String(activeCollegeIdRef.current) !== String(requestedCollegeId)) return;
        setAvailableClasses(Array.isArray(rows) ? rows : []);
      } catch (failure) {
        if (String(activeCollegeIdRef.current) === String(requestedCollegeId)) setFormError(failure.response?.data?.detail || "College Classes could not be loaded.");
      }
    }
  }

  async function submitPromotion(event) {
    event.preventDefault();
    if (!activeCollegeId || !selectedStudent) return;
    const submittedCollegeId = activeCollegeId;
    setPromotionSaving(true);
    setPromotionError("");
    const form = new FormData(event.currentTarget);
    try {
      const updated = await promoteTenantStudent(selectedStudent.id, {
        current_academic_year: Number(form.get("current_academic_year")),
        current_semester: Number(form.get("current_semester")),
        section: form.get("section") || null,
        reason: promotionReason,
      }, submittedCollegeId);
      if (String(activeCollegeIdRef.current) !== String(submittedCollegeId)) return;
      setSelectedStudent(updated);
      setPromotionReason("");
      const history = await getTenantStudentAcademicHistory(updated.id, submittedCollegeId);
      if (String(activeCollegeIdRef.current) !== String(submittedCollegeId)) return;
      setAcademicHistory(history);
      setReloadVersion((value) => value + 1);
    } catch (failure) {
      if (String(activeCollegeIdRef.current) === String(submittedCollegeId)) setPromotionError(failure.response?.data?.detail || "Academic progression could not be saved.");
    } finally {
      setPromotionSaving(false);
    }
  }

  return (
    <main className="students-page">
      <header className="students-header">
        <div className="students-header-copy">
          <div className="eyebrow">COLLEGE DIRECTORY</div>
          <h1>Students</h1>
          <p>Student directory and academic records for the selected College.</p>
        </div>
        <div className="students-header-actions">
          {canManage && <button className="primary-button" onClick={toggleRegistration} disabled={!activeCollegeId} type="button"><UserPlus size={16} />Register student</button>}
          <button className="secondary-button" onClick={() => setReloadVersion((value) => value + 1)} disabled={loading || !activeCollegeId} type="button">
            <RefreshCw size={15} className={loading ? "students-refresh-spin" : ""} />{loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </header>

      {!activeCollegeId && <div className="students-alert" role="status"><span>!</span>Select an active College membership to view Students.</div>}
      {error && <div className="students-alert" role="alert"><span>!</span>{error}</div>}
      {formSuccess && <div className="students-alert" role="status">{formSuccess}</div>}
      {formError && <div className="students-alert" role="alert">{formError}</div>}

      {showRegistration && canManage && <form className="tenant-registration-form" onSubmit={submitRegistration}>
        <h2>Register a student</h2>
        <p>Student code is generated by AttendX. Set a permanent password for the Student; it will not be shown again after creation.</p>
        <div className="tenant-registration-grid">
          {[
            ["name", "Full name", "text", true], ["email", "Student email", "email", true], ["date_of_birth", "Date of birth", "date"], ["gender", "Gender", "text"],
            ["enrollment_number", "Enrollment number", "text"], ["roll_number", "Roll number", "text", true], ["course", "Course", "text"], ["department", "Branch / Department", "text"],
            ["admission_year", "Admission year", "number"], ["admission_session", "Admission session", "text"], ["program_duration_years", "Program duration (years)", "number"], ["current_academic_year", "Current academic year", "number"],
            ["current_semester", "Current semester", "number"], ["section", "Section", "text"], ["mobile", "Student mobile", "tel"], ["address", "Address", "text"], ["city", "City", "text"], ["state", "State", "text"], ["postal_code", "PIN code", "text"],
            ["father_name", "Father name", "text"], ["mother_name", "Mother name", "text"], ["parent_mobile", "Parent mobile", "tel"], ["parent_email", "Parent email", "email"], ["guardian_name", "Guardian name", "text"],
          ].map(([name, label, type, required]) => <label key={name}>{label}<input name={name} type={type} required={Boolean(required)} min={type === "number" ? "1" : undefined} aria-invalid={Boolean(fieldErrors[name])} aria-describedby={fieldErrors[name] ? `student-registration-${name}-error` : undefined} onChange={() => clearRegistrationFieldError(name)} />{fieldErrors[name] && <small id={`student-registration-${name}-error`} className="tenant-field-error" role="alert">{fieldErrors[name]}</small>}</label>)}
          <label>Initial class assignment<select name="initial_class_id" defaultValue=""><option value="">No class assignment</option>{availableClasses.map((item) => <option key={item.id} value={item.id}>{item.name}{item.section ? ` · ${item.section}` : ""}</option>)}</select></label>
          <label>Guardian relationship<select name="guardian_relationship" defaultValue="Guardian"><option>Father</option><option>Mother</option><option>Guardian</option><option>Brother</option><option>Sister</option><option>Other</option></select></label>
          <label>Password<input name="password" type="password" autoComplete="new-password" minLength="12" maxLength="72" required aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? "student-registration-password-error" : undefined} onChange={() => clearRegistrationFieldError("password")} />{fieldErrors.password && <small id="student-registration-password-error" className="tenant-field-error" role="alert">{fieldErrors.password}</small>}</label>
          <label>Confirm password<input name="password_confirmation" type="password" autoComplete="new-password" minLength="12" maxLength="72" required aria-invalid={Boolean(fieldErrors.password_confirmation)} aria-describedby={fieldErrors.password_confirmation ? "student-registration-password_confirmation-error" : undefined} onChange={() => clearRegistrationFieldError("password_confirmation")} />{fieldErrors.password_confirmation && <small id="student-registration-password_confirmation-error" className="tenant-field-error" role="alert">{fieldErrors.password_confirmation}</small>}</label>
        </div>
        <section className="tenant-promotion-form" aria-label="Student face registration">
          <h3>Optional face registration</h3>
          <p>Face data is biometric information. Obtain the Student's consent before capture.</p>
          <label><input type="checkbox" checked={faceConsent} onChange={(event) => setFaceConsent(event.target.checked)} /> I confirm the Student has consented to face registration.</label>
          {faceConsent && <FaceCamera disabled={saving} onCapture={async (file) => {
            if (newStudentFacePreview) URL.revokeObjectURL(newStudentFacePreview);
            setNewStudentFaceFile(file);
            setNewStudentFacePreview(URL.createObjectURL(file));
          }} title="Capture Student face" subtitle="The image is uploaded only after the Student account is created." />}
          {newStudentFacePreview && <div><img src={newStudentFacePreview} alt="Captured Student face preview" style={{ maxWidth: 240, borderRadius: 12 }} /><button type="button" className="secondary-button" onClick={() => { setNewStudentFaceFile(null); URL.revokeObjectURL(newStudentFacePreview); setNewStudentFacePreview(""); }}>Remove capture</button></div>}
        </section>
        <div className="tenant-form-note">Use at least 12 characters with uppercase, lowercase, a number, and a symbol. Passwords are never displayed again after saving.</div>
        <div className="tenant-form-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving..." : "Create Student account"}</button><button className="secondary-button" type="button" onClick={() => { setShowRegistration(false); clearNewStudentFace(); }}>Cancel</button></div>
      </form>}

      <section className="student-stat-grid" aria-label="Student summary">
        <article className="student-stat-card"><div className="stat-icon"><UsersRound size={19} /></div><div><span>Matching Students</span><strong>{total}</strong></div></article>
        <article className="student-stat-card"><div className="stat-icon success"><UserCheck size={19} /></div><div><span>Active matches</span><strong>{activeStudents}</strong></div></article>
        <article className="student-stat-card"><div className="stat-icon warning"><UserRoundX size={19} /></div><div><span>Inactive matches</span><strong>{inactiveStudents}</strong></div></article>
        <article className="student-stat-card"><div className="stat-icon purple"><Building2 size={19} /></div><div><span>Departments on page</span><strong>{departmentCount}</strong></div></article>
      </section>

      <section className="student-stat-grid face-summary-grid" aria-label="College-wide face registration counts">
        <article className="student-stat-card"><div><span>Face Registered (College-wide)</span><strong>{faceCountsAvailable ? faceRegisteredCount : "Unavailable"}</strong></div></article>
        <article className="student-stat-card"><div><span>Face Not Registered (College-wide)</span><strong>{faceCountsAvailable ? faceNotRegisteredCount : "Unavailable"}</strong></div></article>
        <p className="tenant-form-note">Pending and failed enrollment attempts are not persisted by the current workflow, so they are not reported as separate counts.</p>
      </section>

      <section className="student-directory">
        <div className="directory-header">
          <div>
            <div className="eyebrow">STUDENT DIRECTORY</div>
            <h2>College Students</h2>
            <span className="result-count">{total} matching records</span>
          </div>
          <div className="directory-tools">
            <div className="search-box">
              <Search size={16} aria-hidden="true" />
              <input type="search" placeholder="Search all College Students..." aria-label="Search students" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
              {search && <button className="clear-search" onClick={() => setSearch("")} type="button" aria-label="Clear search">×</button>}
            </div>
            <label>Course<input aria-label="Filter by course" value={courseFilter} onChange={(event) => { setCourseFilter(event.target.value); setPage(1); }} placeholder="All courses" /></label>
            <label>Department<input aria-label="Filter by department" value={departmentFilter} onChange={(event) => { setDepartmentFilter(event.target.value); setPage(1); }} placeholder="All departments" /></label>
            <label className="tenant-active-filter"><input type="checkbox" checked={activeOnly} onChange={(event) => { setActiveOnly(event.target.checked); setPage(1); }} />Active only</label>
            <label>Face registration<select aria-label="Filter by face registration" value={faceStatusFilter} onChange={(event) => { setFaceStatusFilter(event.target.value); setPage(1); }}><option value="all">All Students</option><option value="registered">Face Registered</option><option value="not_registered">Face Not Registered</option></select></label>
          </div>
        </div>

        <div className="student-table-wrapper">
          <table className="student-table">
            <thead><tr><th>STUDENT</th><th>ROLL NUMBER</th><th>DEPARTMENT</th><th>EMAIL</th><th>STATUS</th><th>FACE REGISTRATION</th><th className="actions-column">DETAILS</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan="7"><div className="table-state"><div className="loading-spinner" /><span>Loading Students...</span></div></td></tr>
                : !error && activeCollegeId && filteredStudents.length === 0 ? <tr><td colSpan="7"><div className="table-state empty-state"><div className="empty-icon">◎</div><strong>{students.length ? "No students found" : "No Student records available"}</strong><span>{students.length ? "Try a different search term." : "No College-owned Student records are currently available."}</span>{(search || faceStatusFilter !== "all") && <button className="secondary-button" onClick={() => { setSearch(""); setFaceStatusFilter("all"); setPage(1); }} type="button">Clear filters</button>}</div></td></tr>
                  : filteredStudents.map((student) => <tr key={student.id}>
                    <td><div className="student-identity"><div className="student-avatar">{student.name?.charAt(0)?.toUpperCase() || "S"}</div><div><strong>{student.name}</strong><span>{student.student_code || `Student #${student.id}`}</span></div></div></td>
                    <td><span className="roll-number">{student.roll_number || "—"}</span></td>
                    <td><span className="department-badge">{student.department || "Not assigned"}</span></td>
                    <td><span className="email-text">{student.email || "—"}</span></td>
                    <td><span className={`status-badge ${student.is_active === false ? "inactive" : "active"}`}><span className="status-dot" />{student.is_active === false ? "Inactive" : "Active"}</span></td>
                    <td><span className={`status-badge face-status-badge ${student.face_status === "registered" && student.face_registered === true ? "active" : student.face_status === "not_registered" ? "not-registered" : "unavailable"}`}>{student.face_status === "registered" && student.face_registered === true ? "Face Registered" : student.face_status === "not_registered" ? "Not Registered" : "Unavailable / Error"}</span></td>
                    <td><div className="row-actions"><button className="action-button edit" onClick={() => openDetails(student)} type="button">View</button>{canManage && student.is_active && <button className="action-button" onClick={() => void deactivateStudent(student)} type="button" disabled={saving}>{saving ? "Updating..." : "Deactivate"}</button>}{canManage && !student.is_active && <button className="action-button" onClick={() => void activateStudent(student)} type="button" disabled={saving}>{saving ? "Updating..." : "Activate"}</button>}</div></td>
                  </tr>)}
            </tbody>
          </table>
        </div>
        <div className="tenant-student-pagination" aria-label="Student directory pagination">
          <button type="button" className="secondary-button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>Previous</button>
          <span>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
          <button type="button" className="secondary-button" onClick={() => setPage((value) => value + 1)} disabled={page >= Math.ceil(total / pageSize) || loading}>Next</button>
        </div>
      </section>

      {selectedStudent && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetails(); }}>
        <section className="student-modal" role="dialog" aria-modal="true" aria-labelledby="tenant-student-title">
          <div className="modal-header"><div><div className="eyebrow">COLLEGE STUDENT PROFILE</div><h2 id="tenant-student-title">{selectedStudent.name}</h2><p>Private profile details for this College.</p></div><button className="secondary-button" type="button" onClick={closeDetails} aria-label="Close Student details">Close</button></div>
          {detailError && <div className="modal-alert" role="alert"><span>!</span>{detailError}</div>}
          {detailLoading ? <div className="table-state"><div className="loading-spinner" /><span>Loading Student profile...</span></div> : !detailError && <div className="student-detail-section">
            {canManage && <div className="tenant-form-actions"><button type="button" className="primary-button" onClick={beginEdit}>Edit profile</button>{selectedStudent.is_active ? <button type="button" className="secondary-button" onClick={() => void deactivateStudent(selectedStudent)} disabled={saving}>{saving ? "Updating..." : "Deactivate Student"}</button> : <button type="button" className="secondary-button" onClick={() => void activateStudent(selectedStudent)} disabled={saving}>{saving ? "Updating..." : "Activate Student"}</button>}</div>}
            {canManage && <section className="tenant-promotion-form" aria-label="Student account link">
              <h3>Login account link</h3>
              {studentAccountLinkStatus === "loading" && <p role="status">Checking the verified Student account link...</p>}
              {studentAccountLinkStatus === "unavailable" && <p role="alert">{studentAccountLinkError || "Account-link status could not be loaded. Retry after checking that College account-link services are available."}</p>}
              {studentAccountLinkStatus === "loaded" && studentAccountLink && <div className="tenant-student-profile" aria-label="Account-link audit details">
                <p>Profile #{studentAccountLink.profile_id} is linked to User #{studentAccountLink.user_id} in College #{studentAccountLink.college_id} ({studentAccountLink.link_status}).</p>
                <p>Profile active: {studentAccountLink.profile_is_active === true ? "Yes" : studentAccountLink.profile_is_active === false ? "No" : "Not returned"}; User active: {studentAccountLink.user_is_active === true ? "Yes" : studentAccountLink.user_is_active === false ? "No" : "Not returned"}; membership: {studentAccountLink.membership_status || "Not returned"}.</p>
                <p>Verified by User #{studentAccountLink.verified_by_user_id} on {studentAccountLink.verified_at ? new Date(studentAccountLink.verified_at).toLocaleString() : "time unavailable"}.</p>
              </div>}
              {studentAccountLinkNotice && <p role="status">{studentAccountLinkNotice}</p>}
              {studentAccountLinkError && studentAccountLinkStatus !== "unavailable" && <div className="students-alert" role="alert">{studentAccountLinkError}</div>}
              {studentAccountLink?.link_status === "active" && <form className="tenant-promotion-form" onSubmit={(event) => { event.preventDefault(); void revokeSelectedStudentAccountLink(); }}>
                <label>Reason to revoke this link<input value={studentAccountLinkRevokeReason} minLength="3" maxLength="500" onChange={(event) => setStudentAccountLinkRevokeReason(event.target.value)} /></label>
                <button type="submit" className="secondary-button" disabled={studentAccountLinkBusy}>{studentAccountLinkBusy ? "Saving..." : "Revoke account link"}</button>
              </form>}
              {selectedStudent.is_active && (!studentAccountLink || studentAccountLink.link_status === "revoked") && studentAccountLinkStatus !== "loading" && studentAccountLinkStatus !== "unavailable" && <form className="tenant-promotion-form" onSubmit={saveStudentAccountLink}>
                <p>{studentAccountLinkStatus === "missing" ? "No account link is recorded for this Student profile." : "The previous link is revoked."} Search the College's active Student login accounts. Search results are candidates only; select an account only after independently checking official institutional records. Linking grants that account access to this Student profile.</p>
                <label>Search existing Student login accounts<input type="search" minLength="2" maxLength="120" value={studentAccountLinkSearch} onChange={(event) => { setStudentAccountLinkSearch(event.target.value); setStudentAccountLinkCandidates([]); setStudentAccountLinkUserId(""); setStudentAccountLinkAttested(false); }} placeholder="Account name, email, or User ID" /></label>
                <div className="tenant-form-actions"><button type="button" className="secondary-button" disabled={studentAccountLinkSearchBusy || studentAccountLinkSearch.trim().length < 2} onClick={() => void searchStudentLinkUsers()}>{studentAccountLinkSearchBusy ? "Searching..." : "Search active accounts"}</button></div>
                {studentAccountLinkCandidates.length > 0 && <div className="profile-grid" role="group" aria-label="Eligible existing Student login accounts">{studentAccountLinkCandidates.map((candidate) => <button key={candidate.user_id} type="button" className="secondary-button" aria-pressed={String(candidate.user_id) === studentAccountLinkUserId} onClick={() => { setStudentAccountLinkUserId(String(candidate.user_id)); setStudentAccountLinkAttested(false); setStudentAccountLinkError(""); }}><strong>User #{candidate.user_id}</strong> · {candidate.name} · {candidate.email}</button>)}</div>}
                {studentAccountLinkSearch.trim().length >= 2 && !studentAccountLinkSearchBusy && studentAccountLinkCandidates.length === 0 && !studentAccountLinkError && <p role="status">No unlinked active Student login accounts matched this search in the selected College.</p>}
                {studentAccountLinkUserId && <p role="status">Selected existing login User ID: {studentAccountLinkUserId}. Confirm this account holder against official College records before linking.</p>}
                <label><input type="checkbox" checked={studentAccountLinkAttested} onChange={(event) => setStudentAccountLinkAttested(event.target.checked)} /> I independently verified this account holder and Student profile using official College records and confirmed the selected College.</label>
                <div className="tenant-form-actions"><button type="submit" className="primary-button" disabled={studentAccountLinkBusy || !studentAccountLinkAttested || !studentAccountLinkUserId}>{studentAccountLinkBusy ? "Verifying..." : "Verify and link existing account"}</button></div>
              </form>}
            </section>}
            {canManage && selectedStudent.is_active && <div className="tenant-form-actions"><button type="button" className="secondary-button" onClick={() => { setPasswordResetOpen((value) => !value); setPasswordResetError(""); }}>Reset Student password</button></div>}
            {passwordResetOpen && canManage && selectedStudent.is_active && <form className="tenant-promotion-form" onSubmit={resetStudentPassword}>
              <h3>Set a new permanent password</h3>
              {passwordResetError && <div className="students-alert" role="alert">{passwordResetError}</div>}
              <label>New password<input type="password" autoComplete="new-password" minLength="12" maxLength="72" required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
              <label>Confirm new password<input type="password" autoComplete="new-password" minLength="12" maxLength="72" required value={newPasswordConfirmation} onChange={(event) => setNewPasswordConfirmation(event.target.value)} /></label>
              <button className="primary-button" type="submit" disabled={passwordResetBusy}>{passwordResetBusy ? "Resetting..." : "Set new password"}</button>
            </form>}
            {formError && <div className="modal-alert" role="alert">{formError}</div>}
            <section className="tenant-promotion-form" aria-label="Student face registration status">
              <h3>Face registration</h3>
              <p>Status: <strong>{faceStatus === "registered" ? "Face Registered" : faceStatus === "not_registered" ? "Not Registered" : "Unavailable / Error"}</strong></p>
              <p>Face images and embeddings are never included in Student API responses.</p>
              {canManage && selectedStudent.is_active && <>
                <label><input type="checkbox" checked={faceConsent} onChange={(event) => setFaceConsent(event.target.checked)} /> Student consent has been obtained for capture or replacement.</label>
                {faceError && <div className="students-alert" role="alert">{faceError}</div>}
                {faceConsent && <FaceCamera disabled={faceSaving} onCapture={async (file) => {
                  if (selectedFacePreview) URL.revokeObjectURL(selectedFacePreview);
                  setSelectedFaceFile(file);
                  setSelectedFacePreview(URL.createObjectURL(file));
                }} title={faceRegistered ? "Replace registered face" : "Register Student face"} />}
                {selectedFacePreview && <div><img src={selectedFacePreview} alt="Captured Student face preview" style={{ maxWidth: 240, borderRadius: 12 }} /><button type="button" className="secondary-button" onClick={() => { setSelectedFaceFile(null); URL.revokeObjectURL(selectedFacePreview); setSelectedFacePreview(""); }}>Remove capture</button><button type="button" className="primary-button" disabled={faceSaving || !selectedFaceFile} onClick={() => void saveSelectedStudentFace(selectedFaceFile)}>{faceSaving ? "Saving face..." : "Save face registration"}</button></div>}
              </>}
            </section>
            {editing && canManage && <form className="tenant-promotion-form" onSubmit={saveStudentProfile}>
              <h3>Edit profile (login email cannot be changed here)</h3>
              {[['name', 'Full name'], ['roll_number', 'Roll number'], ['department', 'Department'], ['course', 'Course'], ['enrollment_number', 'Enrollment number'], ['mobile', 'Student mobile'], ['current_academic_year', 'Academic year'], ['current_semester', 'Semester'], ['section', 'Section'], ['father_name', 'Father name'], ['mother_name', 'Mother name'], ['guardian_name', 'Guardian name'], ['parent_mobile', 'Parent mobile'], ['parent_email', 'Parent email']].map(([name, label]) => <label key={name}>{label}<input name={name} type={name === 'parent_email' ? 'email' : ['current_academic_year', 'current_semester'].includes(name) ? 'number' : 'text'} min={name.startsWith('current_') ? '1' : undefined} max={name === 'current_academic_year' ? '12' : name === 'current_semester' ? '24' : undefined} value={editForm[name] || ''} onChange={(event) => setEditForm((current) => ({ ...current, [name]: event.target.value }))} /></label>)}
              <label>Guardian relationship<select value={editForm.guardian_relationship || 'Guardian'} onChange={(event) => setEditForm((current) => ({ ...current, guardian_relationship: event.target.value }))}>{['Father', 'Mother', 'Guardian', 'Brother', 'Sister', 'Other'].map((value) => <option key={value}>{value}</option>)}</select></label>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button><button className="secondary-button" type="button" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
            </form>}
            <h3>Student information</h3>
            <dl className="tenant-student-profile">
              <div><dt>Student code</dt><dd>{selectedStudent.student_code || "Not available"}</dd></div>
              <div><dt>Roll number</dt><dd>{selectedStudent.roll_number || "Not available"}</dd></div>
              <div><dt>Department</dt><dd>{selectedStudent.department || "Not assigned"}</dd></div>
              <div><dt>Email</dt><dd>{selectedStudent.email}</dd></div>
              <div><dt>Admission year</dt><dd>{selectedStudent.admission_year || "Not recorded"}</dd></div>
              <div><dt>Current academic year</dt><dd>{selectedStudent.current_academic_year || "Not recorded"}</dd></div>
              <div><dt>Current semester</dt><dd>{selectedStudent.current_semester || "Not recorded"}</dd></div>
              <div><dt>Section</dt><dd>{selectedStudent.section || "Not assigned"}</dd></div>
              <div><dt>Father</dt><dd>{selectedStudent.father_name || "Not recorded"}</dd></div>
              <div><dt>Mother</dt><dd>{selectedStudent.mother_name || "Not recorded"}</dd></div>
              <div><dt>Guardian contact</dt><dd>{selectedStudent.guardian_mobile || "Not recorded"}</dd></div>
              <div><dt>Parent email</dt><dd>{selectedStudent.parent_email || "Not recorded"}</dd></div>
              <div><dt>Status</dt><dd>{selectedStudent.is_active ? "Active" : "Inactive"}</dd></div>
              <div><dt>Account invitation</dt><dd>{studentInvitation?.status || (invitationError ? "Unavailable" : "Loading status")}{studentInvitation?.expires_at ? ` · expires ${new Date(studentInvitation.expires_at).toLocaleString()}` : ""}</dd></div>
              <div><dt>Created</dt><dd>{selectedStudent.created_at ? new Date(selectedStudent.created_at).toLocaleString() : "Not available"}</dd></div>
            </dl>
            {invitationError && <p role="alert">{invitationError}</p>}
            {canManage && studentInvitation?.resend_blocked_reason === "account_active" && <p>Student already has an active account; a setup invitation is not needed.</p>}
            {canManage && studentInvitation?.resend_blocked_reason === "account_deactivated" && <p>This Student account is deactivated and cannot receive a setup invitation.</p>}
            {canManage && studentInvitation?.can_resend && <button type="button" className="secondary-button" disabled={resendingInvitationId === selectedStudent.id} onClick={() => void resendInvitation(selectedStudent)}>{resendingInvitationId === selectedStudent.id ? "Sending invitation..." : "Resend setup invitation"}</button>}
            <h3>Academic progression</h3>
            {promotionError && <div className="students-alert" role="alert">{promotionError}</div>}
            {canManage && <form className="tenant-promotion-form" onSubmit={submitPromotion}>
              <label>Current academic year<input name="current_academic_year" type="number" min="1" max="12" defaultValue={selectedStudent.current_academic_year || 1} required /></label>
              <label>Current semester<input name="current_semester" type="number" min="1" max="24" defaultValue={selectedStudent.current_semester || 1} required /></label>
              <label>Section<input name="section" defaultValue={selectedStudent.section || ""} /></label>
              <label>Reason<input value={promotionReason} onChange={(event) => setPromotionReason(event.target.value)} minLength="3" maxLength="500" required /></label>
              <button className="primary-button" disabled={promotionSaving}>{promotionSaving ? "Saving..." : "Record progression"}</button>
            </form>}
            <ul className="academic-history-list">{academicHistory.map((item) => <li key={item.id}><strong>{item.action}</strong><span>Admission {item.admission_year || "unknown"}; Year {item.academic_year || "—"}; Semester {item.semester || "—"}; Section {item.section || "—"}</span><small>{item.reason || "No reason recorded"}</small></li>)}</ul>
            <h3>Class assignments</h3>
            {assignmentError && <div className="students-alert" role="alert">{assignmentError}</div>}
            {canManage && <form className="tenant-promotion-form" onSubmit={assignClass}>
              <label>Class<select required value={assignmentForm.class_id} onChange={(event) => setAssignmentForm((current) => ({ ...current, class_id: event.target.value }))}><option value="">Select active Class</option>{classes.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}{item.section ? ` · ${item.section}` : ""}</option>)}</select></label>
              <label>Academic year<input required maxLength={20} value={assignmentForm.academic_year} onChange={(event) => setAssignmentForm((current) => ({ ...current, academic_year: event.target.value }))} placeholder="2026-27" /></label>
              <label>Semester<input type="number" min="1" max="24" value={assignmentForm.semester} onChange={(event) => setAssignmentForm((current) => ({ ...current, semester: event.target.value }))} /></label>
              <label>Effective from<input required type="datetime-local" value={assignmentForm.effective_from} onChange={(event) => setAssignmentForm((current) => ({ ...current, effective_from: event.target.value }))} /></label>
              <label>Effective until (optional)<input type="datetime-local" min={assignmentForm.effective_from} value={assignmentForm.effective_to} onChange={(event) => setAssignmentForm((current) => ({ ...current, effective_to: event.target.value }))} /></label>
              <button className="primary-button" type="submit">Assign Class</button>
            </form>}
            <ul className="academic-history-list">{studentAssignments.map((assignment) => <li key={assignment.id}><strong>{classes.find((item) => item.id === assignment.class_id)?.name || `Class #${assignment.class_id}`} — {assignmentStatus(assignment)}</strong><span>Year {assignment.academic_year || "—"}; Semester {assignment.semester || "—"}</span>{canManage && assignmentStatus(assignment) !== "Ended" && <button type="button" className="secondary-button" onClick={() => void removeClassAssignment(assignment.id)}>End assignment</button>}</li>)}</ul>
          </div>}
        </section>
      </div>}
    </main>
  );
}

export default TenantStudents;
