import React, { 
  useCallback, 
  useEffect, 
  useMemo, 
  useRef, 
  useState, 
} from "react"; 
 
import { 
  activateStudent, 
  createStudent, 
  deactivateStudent, 
  getStudents, 
  getStudentGuardian, 
  registerStudentFace, 
  removeStudentFace, 
  saveStudentGuardian, 
  updateStudent, 
} from "../../../services/students"; 
 
import "./Students.css"; 
 
/* ========================================================= 
   EMPTY FORM 
========================================================= */ 
 
const emptyForm = { 
  name: "", 
  email: "", 
  password: "", 
  confirm_password: "", 
  mobile: "", 
  date_of_birth: "", 
  gender: "", 
  blood_group: "", 
  roll_number: "", 
  department: "", 
  course: "", 
  academic_year: "", 
  semester: "", 
  section: "", 
  admission_date: "", 
  address: "", 
  city: "", 
  state: "", 
  pincode: "", 
 
  guardian_name: "", 
  guardian_relationship: "Father", 
  guardian_mobile: "", 
  alternate_mobile: "", 
  notify_absence: true, 
  notify_low_attendance: true, 
  notification_channel: "sms_email", 
}; 
 
/* ========================================================= 
   SUCCESS CARD 
========================================================= */ 
 
const successCardStyle = { 
  width: "min(100%, 520px)", 
  padding: 30, 
  border: "1px solid #e4e7ec", 
  borderRadius: 20, 
  background: "#ffffff", 
  boxShadow: "0 28px 80px rgba(16, 24, 40, 0.20)", 
  textAlign: "center", 
}; 
 
/* ========================================================= 
   STUDENTS COMPONENT 
========================================================= */ 
 
function Students() { 
  /* ------------------------------------------------------- 
     STUDENT DATA 
  ------------------------------------------------------- */ 
 
  const [students, setStudents] = useState([]); 
  const [search, setSearch] = useState(""); 
 
  const [loading, setLoading] = useState(true); 
  const [saving, setSaving] = useState(false); 
 
  const [error, setError] = useState(""); 
  const [notice, setNotice] = useState(""); 
 
  /* ------------------------------------------------------- 
     MODAL 
  ------------------------------------------------------- */ 
 
  const [modalOpen, setModalOpen] = useState(false); 
  const [modalMode, setModalMode] = useState("create"); 
  const [editingStudent, setEditingStudent] = useState(null); 
 
  const [form, setForm] = useState(emptyForm); 
 
  /* ------------------------------------------------------- 
     CAMERA / FACE REGISTRATION 
  ------------------------------------------------------- */ 
 
  const [cameraActive, setCameraActive] = useState(false); 
  const [cameraError, setCameraError] = useState(""); 
 
  const [faceFile, setFaceFile] = useState(null); 
  const [facePreviewUrl, setFacePreviewUrl] = useState(""); 
 
  const [faceSaving, setFaceSaving] = useState(false); 
 
  const [cameraFacingMode, setCameraFacingMode] = useState("user"); 
 
  const videoRef = useRef(null); 
  const canvasRef = useRef(null); 
  const streamRef = useRef(null); 
 
  /* ------------------------------------------------------- 
     GUARDIAN 
  ------------------------------------------------------- */ 
 
  const [guardianLoading, setGuardianLoading] = useState(false); 
 
  /* ------------------------------------------------------- 
     REGISTRATION SUCCESS 
  ------------------------------------------------------- */ 
 
  const [registeredStudent, setRegisteredStudent] = useState(null); 
  const [registrationWarning, setRegistrationWarning] = useState(""); 
 
  /* ========================================================= 
     MODAL MODE HELPERS 
  ========================================================= */ 
 
  const isViewMode = modalMode === "view"; 
  const isCreateMode = modalMode === "create"; 
  const isEditMode = modalMode === "edit"; 
 
  /* ========================================================= 
     CAMERA STOP 
  ========================================================= */ 
 
  const stopCamera = useCallback(() => { 
    if (streamRef.current) { 
      streamRef.current.getTracks().forEach((track) => { 
        try { 
          track.stop(); 
        } catch (error) { 
          console.warn("Unable to stop camera track:", error); 
        } 
      }); 
 
      streamRef.current = null; 
    } 
 
    if (videoRef.current) { 
      videoRef.current.pause?.(); 
      videoRef.current.srcObject = null; 
    } 
 
    setCameraActive(false); 
  }, []); 
 
  /* ========================================================= 
     CLEAR CAPTURE 
  ========================================================= */ 
 
  const clearFaceCapture = useCallback(() => { 
    stopCamera(); 
 
    setFaceFile(null); 
    setCameraError(""); 
  }, [stopCamera]); 
 
  /* ========================================================= 
     ATTACH CAMERA STREAM AFTER VIDEO MOUNTS 
  ========================================================= */ 
 
  useEffect(() => { 
    if (!cameraActive) { 
      return; 
    } 
 
    if (!videoRef.current) { 
      return; 
    } 
 
    if (!streamRef.current) { 
      return; 
    } 
 
    const video = videoRef.current; 
    const stream = streamRef.current; 
 
    video.srcObject = stream; 
    video.muted = true; 
    video.playsInline = true; 
 
    const playVideo = async () => { 
      try { 
        await video.play(); 
      } catch (error) { 
        console.error("Unable to start camera preview:", error); 
      } 
    }; 
 
    if (video.readyState >= 1) { 
      void playVideo(); 
    } else { 
      video.onloadedmetadata = playVideo; 
    } 
 
    return () => { 
      video.onloadedmetadata = null; 
    }; 
  }, [cameraActive]); 
 
  /* ========================================================= 
     STOP CAMERA ON UNMOUNT 
  ========================================================= */ 
 
  useEffect(() => { 
    return () => { 
      stopCamera(); 
    }; 
  }, [stopCamera]); 
 
  /* ========================================================= 
     FACE PREVIEW URL 
  ========================================================= */ 
 
  useEffect(() => { 
    if (!faceFile) { 
      setFacePreviewUrl(""); 
      return undefined; 
    } 
 
    const previewUrl = URL.createObjectURL(faceFile); 
 
    setFacePreviewUrl(previewUrl); 
 
    return () => { 
      URL.revokeObjectURL(previewUrl); 
    }; 
  }, [faceFile]); 
 
  /* ========================================================= 
     LOAD STUDENTS 
  ========================================================= */ 
 
  const loadStudents = useCallback(async () => { 
    try { 
      setLoading(true); 
      setError(""); 
 
      const data = await getStudents(); 
 
      setStudents(Array.isArray(data) ? data : []); 
    } catch (err) { 
      console.error("Unable to load students:", err); 
 
      setError( 
        err?.response?.data?.detail || 
          "Unable to load students. Please try again." 
      ); 
    } finally { 
      setLoading(false); 
    } 
  }, []); 
 
  useEffect(() => { 
    loadStudents(); 
  }, [loadStudents]); 
 
  /* ========================================================= 
     SEARCH 
  ========================================================= */ 
 
  const filteredStudents = useMemo(() => { 
    const query = search.trim().toLowerCase(); 
 
    if (!query) { 
      return students; 
    } 
 
    return students.filter((student) => { 
      return ( 
        student.name?.toLowerCase().includes(query) || 
        student.email?.toLowerCase().includes(query) || 
        student.roll_number?.toLowerCase().includes(query) || 
        student.department?.toLowerCase().includes(query) || 
        student.student_code?.toLowerCase().includes(query) 
      ); 
    }); 
  }, [students, search]); 
 
  /* ========================================================= 
     STATISTICS 
  ========================================================= */ 
 
  const activeStudents = students.filter( 
    (student) => student.is_active !== false 
  ).length; 
 
  const inactiveStudents = students.length - activeStudents; 
 
  const departmentsCount = useMemo(() => { 
    return new Set( 
      students 
        .map((student) => student.department) 
        .filter(Boolean) 
    ).size; 
  }, [students]); 
 
  const faceRegisteredCount = useMemo(() => { 
    return students.filter( 
      (student) => student.face_registered 
    ).length; 
  }, [students]); 
 
  /* ========================================================= 
     RESET MODAL 
  ========================================================= */ 
 
  const resetModalState = () => { 
    stopCamera(); 
 
    setFaceFile(null); 
    setCameraError(""); 
    setFaceSaving(false); 
    setError(""); 
    setGuardianLoading(false); 
  }; 
 
  /* ========================================================= 
     OPEN ADD 
  ========================================================= */ 
 
  const openAddModal = () => { 
    resetModalState(); 
 
    setModalMode("create"); 
    setEditingStudent(null); 
    setForm({ 
      ...emptyForm, 
    }); 
 
    setRegistrationWarning(""); 
    setModalOpen(true); 
  }; 
 
  /* ========================================================= 
     BASE STUDENT FORM 
  ========================================================= */ 
 
  const baseStudentForm = (student) => ({ 
    name: student.name || "", 
    email: student.email || "", 
    mobile: 
      student.mobile || 
      student.phone || 
      student.phone_number || 
      "", 
    date_of_birth: 
      student.date_of_birth || 
      student.dob || 
      "", 
    gender: student.gender || "", 
    blood_group: student.blood_group || "", 
    roll_number: student.roll_number || "", 
    department: student.department || "", 
    course: 
      student.course || 
      student.program || 
      "", 
    academic_year: 
      student.academic_year || "", 
    semester: 
      student.semester ?? "", 
    section: 
      student.section || "", 
    admission_date: 
      student.admission_date || "", 
    address: 
      student.address || "", 
    city: 
      student.city || "", 
    state: 
      student.state || "", 
    pincode: 
      student.pincode || "", 
 
    guardian_name: "", 
    guardian_relationship: "Father", 
    guardian_mobile: "", 
    alternate_mobile: "", 
    notify_absence: true, 
    notify_low_attendance: true, 
    notification_channel: "sms_email", 
  }); 
 
  /* ========================================================= 
     LOAD GUARDIAN 
  ========================================================= */ 
 
  const loadGuardianIntoForm = async (studentId) => { 
    setGuardianLoading(true); 
 
    try { 
      const guardian = await getStudentGuardian(studentId); 
 
      setForm((previous) => ({ 
        ...previous, 
 
        guardian_name: 
          guardian?.guardian_name || "", 
 
        guardian_relationship: 
          guardian?.guardian_relationship || 
          "Father", 
 
        guardian_mobile: 
          guardian?.guardian_mobile || "", 
 
        alternate_mobile: 
          guardian?.alternate_mobile || "", 
 
        notify_absence: 
          guardian?.notify_absence !== false, 
 
        notify_low_attendance: 
          guardian?.notify_low_attendance !== false, 
 
        notification_channel: 
          guardian?.notification_channel || 
          "sms_email", 
      })); 
    } catch (err) { 
      if (err?.response?.status !== 404) { 
        console.error( 
          "Unable to load guardian details:", 
          err 
        ); 
      } 
    } finally { 
      setGuardianLoading(false); 
    } 
  }; 
 
  /* ========================================================= 
     OPEN EDIT 
  ========================================================= */ 
 
  const openEditModal = async (student) => { 
    resetModalState(); 
 
    setModalMode("edit"); 
    setEditingStudent(student); 
    setForm(baseStudentForm(student)); 
 
    setModalOpen(true); 
 
    await loadGuardianIntoForm(student.id); 
  }; 
 
  /* ========================================================= 
     OPEN VIEW 
  ========================================================= */ 
 
  const openViewModal = async (student) => { 
    resetModalState(); 
 
    setModalMode("view"); 
    setEditingStudent(student); 
    setForm(baseStudentForm(student)); 
 
    setModalOpen(true); 
 
    await loadGuardianIntoForm(student.id); 
  }; 
 
  /* ========================================================= 
     CLOSE MODAL 
  ========================================================= */ 
 
  const closeModal = (force = false) => { 
    if (!force && (saving || faceSaving)) { 
      return; 
    } 
 
    resetModalState(); 
 
    setModalOpen(false); 
    setEditingStudent(null); 
    setForm({ 
      ...emptyForm, 
    }); 
  }; 
 
  /* ========================================================= 
     FORM CHANGE 
  ========================================================= */ 
 
  const handleChange = (event) => { 
    const { 
      name, 
      value, 
      type, 
      checked, 
    } = event.target; 
 
    setForm((previous) => ({ 
      ...previous, 
      [name]: 
        type === "checkbox" 
          ? checked 
          : value, 
    })); 
  }; 
 
  /* ========================================================= 
     START CAMERA 
  ========================================================= */ 
 
  const startCamera = async ( 
    requestedMode = cameraFacingMode 
  ) => { 
    setCameraError(""); 
 
    if ( 
      !navigator.mediaDevices || 
      !navigator.mediaDevices.getUserMedia 
    ) { 
      setCameraError( 
        "Camera access is not available in this browser. Please use the upload option." 
      ); 
 
      return; 
    } 
 
    try { 
      stopCamera(); 
 
      const stream = 
        await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: { 
              ideal: requestedMode, 
            }, 
 
            width: { 
              ideal: 1280, 
              min: 640, 
            }, 
 
            height: { 
              ideal: 960, 
              min: 480, 
            }, 
 
            frameRate: { 
              ideal: 30, 
              min: 15, 
            }, 
          }, 
 
          audio: false, 
        }); 
 
      streamRef.current = stream; 
 
      setCameraActive(true); 
      setCameraError(""); 
    } catch (err) { 
      console.error( 
        "Camera initialization failed:", 
        err 
      ); 
 
      if ( 
        err?.name === 
        "NotAllowedError" 
      ) { 
        setCameraError( 
          "Camera permission was denied. Please allow camera access in your browser." 
        ); 
      } else if ( 
        err?.name === 
        "NotFoundError" 
      ) { 
        setCameraError( 
          "No camera was found on this device." 
        ); 
      } else if ( 
        err?.name === 
        "NotReadableError" 
      ) { 
        setCameraError( 
          "The camera is already being used by another application." 
        ); 
      } else { 
        setCameraError( 
          "Unable to start the camera. Please try again or upload a photo." 
        ); 
      } 
    } 
  }; 
 
  /* ========================================================= 
     SWITCH CAMERA 
  ========================================================= */ 
 
  const switchCamera = async () => { 
    const nextMode = 
      cameraFacingMode === "user" 
        ? "environment" 
        : "user"; 
 
    setCameraFacingMode(nextMode); 
 
    stopCamera(); 
 
    window.setTimeout(() => { 
      void startCamera(nextMode); 
    }, 150); 
  }; 
 
  /* ========================================================= 
     CAPTURE FACE 
  ========================================================= */ 
 
  const captureFace = async () => { 
    const video = videoRef.current; 
    const canvas = canvasRef.current; 
 
    if (!video || !canvas) { 
      setCameraError( 
        "Camera is not available." 
      ); 
 
      return; 
    } 
 
    if ( 
      !video.videoWidth || 
      !video.videoHeight 
    ) { 
      setCameraError( 
        "Camera is not ready yet. Please wait a moment." 
      ); 
 
      return; 
    } 
 
    if ( 
      video.readyState < 
      HTMLMediaElement.HAVE_CURRENT_DATA 
    ) { 
      setCameraError( 
        "Waiting for the camera frame. Please try again." 
      ); 
 
      return; 
    } 
 
    try { 
      setCameraError(""); 
 
      /* 
       * Wait for an actual camera frame. 
       * This prevents black/green/stale captures. 
       */ 
      if ( 
        typeof video.requestVideoFrameCallback === 
        "function" 
      ) { 
        await new Promise((resolve) => { 
          video.requestVideoFrameCallback(() => { 
            resolve(); 
          }); 
        }); 
      } else { 
        await new Promise((resolve) => { 
          window.requestAnimationFrame(resolve); 
        }); 
      } 
 
      const width = video.videoWidth; 
      const height = video.videoHeight; 
 
      canvas.width = width; 
      canvas.height = height; 
 
      const context = 
        canvas.getContext("2d", { 
          alpha: false, 
          colorSpace: "srgb", 
        }); 
 
      if (!context) { 
        throw new Error( 
          "Unable to create canvas context." 
        ); 
      } 
 
      context.save(); 
 
      context.globalAlpha = 1; 
      context.globalCompositeOperation = 
        "source-over"; 
      context.filter = "none"; 
 
      /* 
       * ImageCapture gives Chrome/Edge a direct 
       * camera frame. This is preferred over 
       * capturing the DOM/video overlay. 
       */ 
      let frameSource = video; 
      let imageBitmap = null; 
 
      const track = 
        streamRef.current 
          ?.getVideoTracks?.()[0]; 
 
      if ( 
        track && 
        typeof window.ImageCapture === 
          "function" 
      ) { 
        try { 
          const imageCapture = 
            new window.ImageCapture( 
              track 
            ); 
 
          imageBitmap = 
            await imageCapture.grabFrame(); 
 
          frameSource = imageBitmap; 
        } catch (captureError) { 
          console.warn( 
            "Direct camera capture unavailable. Falling back to video frame.", 
            captureError 
          ); 
        } 
      } 
 
      /* 
       * Mirror ONLY the saved image for front camera 
       * so it corresponds to the preview. 
       * 
       * Guide graphics are DOM elements and are NOT 
       * drawn into this canvas. 
       */ 
      if ( 
        cameraFacingMode === "user" 
      ) { 
        context.translate(width, 0); 
        context.scale(-1, 1); 
      } 
 
      context.drawImage( 
        frameSource, 
        0, 
        0, 
        width, 
        height 
      ); 
 
      context.restore(); 
 
      if ( 
        imageBitmap && 
        typeof imageBitmap.close === 
          "function" 
      ) { 
        imageBitmap.close(); 
      } 
 
      const blob = 
        await new Promise( 
          (resolve, reject) => { 
            canvas.toBlob( 
              (result) => { 
                if (result) { 
                  resolve(result); 
                } else { 
                  reject( 
                    new Error( 
                      "Unable to create image." 
                    ) 
                  ); 
                } 
              }, 
              "image/jpeg", 
              0.94 
            ); 
          } 
        ); 
 
      const capturedFile = 
        new File( 
          [blob], 
          `student-face-${Date.now()}.jpg`, 
          { 
            type: "image/jpeg", 
            lastModified: 
              Date.now(), 
          } 
        ); 
 
      stopCamera(); 
 
      setFaceFile(capturedFile); 
      setCameraError(""); 
    } catch (err) { 
      console.error( 
        "Face capture failed:", 
        err 
      ); 
 
      setCameraError( 
        "Unable to capture the face photo. Please keep the face centered and try again." 
      ); 
    } 
  }; 
 
  /* ========================================================= 
     UPLOAD FACE 
  ========================================================= */ 
 
  const handleFaceFile = (event) => { 
    const file = 
      event.target.files?.[0]; 
 
    /* 
     * Reset input so the same file can be selected again. 
     */ 
    event.target.value = ""; 
 
    if (!file) { 
      return; 
    } 
 
    if ( 
      !file.type.startsWith( 
        "image/" 
      ) 
    ) { 
      setCameraError( 
        "Please select a valid image file." 
      ); 
 
      return; 
    } 
 
    if ( 
      file.size > 
      5 * 1024 * 1024 
    ) { 
      setCameraError( 
        "Face image must be smaller than 5 MB." 
      ); 
 
      return; 
    } 
 
    stopCamera(); 
 
    setFaceFile(file); 
    setCameraError(""); 
  }; 
 
  /* ========================================================= 
     SUBMIT STUDENT 
  ========================================================= */ 
 
  const handleSubmit = async (event) => { 
    event.preventDefault(); 
 
    if (isViewMode) { 
      return; 
    } 
 
    setError(""); 
    setNotice(""); 
    setRegistrationWarning(""); 
 
    if (!form.name.trim()) { 
      setError( 
        "Student name is required." 
      ); 
 
      return; 
    } 
 
    if (!form.email.trim()) { 
      setError( 
        "Email address is required." 
      ); 
 
      return; 
    } 
 
    if (isCreateMode && !form.password) { 
      setError("Please set an initial password for the student."); 
      return; 
    } 
 
    if (isCreateMode && form.password.length < 8) { 
      setError("Password must be at least 8 characters long."); 
      return; 
    }

    if (isCreateMode && form.password !== form.confirm_password) {
      setError("Password and confirm password do not match.");
      return;
    } 
 
    if (!form.roll_number.trim()) { 
      setError( 
        "Roll number is required." 
      ); 
 
      return; 
    } 
 
    /* 
     * Face photo is required for NEW registrations. 
     * This makes sure every attendance-ready student 
     * has a biometric reference image. 
     */ 
    if (isCreateMode && !faceFile) { 
      setError( 
        "Please capture or upload the student's face photo before registration." 
      ); 
 
      return; 
    } 
 
    if (!form.guardian_name.trim()) { 
      setError( 
        "Parent / guardian name is required." 
      ); 
 
      return; 
    } 
 
    if (!form.guardian_mobile.trim()) { 
      setError( 
        "Parent / guardian mobile number is required." 
      ); 
 
      return; 
    } 
 
    try { 
      setSaving(true); 
 
      const payload = { 
        name: form.name.trim(), 
        email: form.email.trim().toLowerCase(), 
        ...(isCreateMode ? { password: form.password } : {}), 
 
        mobile: 
          form.mobile.trim() || null, 
 
        date_of_birth: 
          form.date_of_birth || null, 
 
        gender: 
          form.gender || null, 
 
        blood_group: 
          form.blood_group || null, 
 
        roll_number: 
          form.roll_number.trim(), 
 
        department: 
          form.department.trim() || null, 
 
        course: 
          form.course.trim() || null, 
 
        academic_year: 
          form.academic_year.trim() || null, 
 
        semester: 
          form.semester 
            ? Number(form.semester) 
            : null, 
 
        section: 
          form.section.trim() || null, 
 
        admission_date: 
          form.admission_date || null, 
 
        address: 
          form.address.trim() || null, 
 
        city: 
          form.city.trim() || null, 
 
        state: 
          form.state.trim() || null, 
 
        pincode: 
          form.pincode.trim() || null, 
      }; 
 
      const guardianPayload = { 
        guardian_name: 
          form.guardian_name.trim(), 
 
        guardian_relationship: 
          form.guardian_relationship, 
 
        guardian_mobile: 
          form.guardian_mobile.trim(), 
 
        alternate_mobile: 
          form.alternate_mobile.trim() || 
          null, 
 
        notify_absence: 
          Boolean(form.notify_absence), 
 
        notify_low_attendance: 
          Boolean( 
            form.notify_low_attendance 
          ), 
 
        notification_channel: 
          form.notification_channel, 
      }; 
 
      let savedStudent; 
 
      /* 
       * CREATE / UPDATE STUDENT 
       */ 
      if (isEditMode) { 
        savedStudent = 
          await updateStudent( 
            editingStudent.id, 
            payload 
          ); 
      } else { 
        savedStudent = 
          await createStudent( 
            payload 
          ); 
      } 
 
      /* 
       * SAVE GUARDIAN 
       */ 
      try { 
        await saveStudentGuardian( 
          savedStudent.id, 
          guardianPayload 
        ); 
      } catch (guardianError) { 
        console.error( 
          "Guardian save failed:", 
          guardianError 
        ); 
 
        setRegistrationWarning( 
          guardianError?.response 
            ?.data?.detail || 
            "Student was saved, but parent/guardian information could not be saved." 
        ); 
      } 
 
      /* 
       * REGISTER / REPLACE FACE 
       */ 
      if (faceFile) { 
        try { 
          setFaceSaving(true); 
 
          savedStudent = 
            await registerStudentFace( 
              savedStudent.id, 
              faceFile 
            ); 
        } catch (faceError) { 
          console.error( 
            "Face registration failed:", 
            faceError 
          ); 
 
          setRegistrationWarning( 
            faceError?.response 
              ?.data?.detail || 
              "Student was saved, but face registration could not be completed." 
          ); 
        } finally { 
          setFaceSaving(false); 
        } 
      } 
 
      const isNewRegistration = 
        isCreateMode; 
 
      closeModal(true); 
 
      await loadStudents(); 
 
      /* 
       * SHOW REGISTRATION SUCCESS CARD 
       */ 
      if (isNewRegistration) { 
        setRegisteredStudent( 
          savedStudent 
        ); 
      } else { 
        setNotice( 
          registrationWarning || 
            "Student details updated successfully." 
        ); 
      } 
    } catch (err) { 
      console.error( 
        "Student save failed:", 
        err 
      ); 
 
      setError( 
        err?.response?.data?.detail || 
          "Unable to save student. Please try again." 
      ); 
    } finally { 
      setSaving(false); 
      setFaceSaving(false); 
    } 
  }; 
 
  /* ========================================================= 
     DEACTIVATE 
  ========================================================= */ 
 
  const handleDeactivate = async ( 
    student 
  ) => { 
    const confirmed = 
      window.confirm( 
        `Deactivate ${student.name}? Attendance history will be preserved.` 
      ); 
 
    if (!confirmed) { 
      return; 
    } 
 
    try { 
      setError(""); 
      setNotice(""); 
 
      await deactivateStudent( 
        student.id 
      ); 
 
      setNotice( 
        `${student.name} has been deactivated.` 
      ); 
 
      await loadStudents(); 
    } catch (err) { 
      console.error(err); 
 
      setError( 
        err?.response?.data?.detail || 
          "Unable to deactivate student." 
      ); 
    } 
  }; 
 
  /* ========================================================= 
     ACTIVATE 
  ========================================================= */ 
 
  const handleActivate = async ( 
    student 
  ) => { 
    try { 
      setError(""); 
      setNotice(""); 
 
      await activateStudent( 
        student.id 
      ); 
 
      setNotice( 
        `${student.name} has been activated.` 
      ); 
 
      await loadStudents(); 
    } catch (err) { 
      console.error(err); 
 
      setError( 
        err?.response?.data?.detail || 
          "Unable to activate student." 
      ); 
    } 
  }; 
 
  /* ========================================================= 
     REMOVE FACE 
  ========================================================= */ 
 
  const handleRemoveFace = async () => { 
    if (!editingStudent) { 
      return; 
    } 
 
    const confirmed = 
      window.confirm( 
        "Remove this student's face registration?" 
      ); 
 
    if (!confirmed) { 
      return; 
    } 
 
    try { 
      setFaceSaving(true); 
      setError(""); 
 
      await removeStudentFace( 
        editingStudent.id 
      ); 
 
      const data = 
        await getStudents(); 
 
      const studentList = 
        Array.isArray(data) 
          ? data 
          : []; 
 
      setStudents(studentList); 
 
      const updated = 
        studentList.find( 
          (student) => 
            student.id === 
            editingStudent.id 
        ); 
 
      if (updated) { 
        setEditingStudent( 
          updated 
        ); 
      } 
 
      setNotice( 
        "Face registration removed successfully." 
      ); 
    } catch (err) { 
      console.error(err); 
 
      setError( 
        err?.response?.data?.detail || 
          "Unable to remove face registration." 
      ); 
    } finally { 
      setFaceSaving(false); 
    } 
  }; 
 
  /* ========================================================= 
     FACE REGISTRATION UI 
  ========================================================= */ 
 
  const renderFaceSection = () => { 
    /* 
     * VIEW MODE 
     */ 
    if (isViewMode) { 
      return ( 
        <section className="face-panel professional-face-panel"> 
          <div className="face-panel-header"> 
            <div> 
              <div className="face-panel-kicker"> 
                BIOMETRIC PROFILE 
              </div> 
 
              <h4 className="face-panel-title"> 
                Face recognition profile 
              </h4> 
 
              <p className="face-panel-hint"> 
                Reference image status used by 
                the attendance verification flow. 
              </p> 
            </div> 
 
            <span 
              className={`face-status-pill ${ 
                editingStudent?.face_registered 
                  ? "registered" 
                  : "pending" 
              }`} 
            > 
              <span className="face-status-dot" /> 
 
              {editingStudent?.face_registered 
                ? "Face registered" 
                : "Not registered"} 
            </span> 
          </div> 
 
          <div className="face-view-summary"> 
            <div className="face-view-icon"> 
              ◉ 
            </div> 
 
            <div> 
              <strong> 
                Attendance reference photo 
              </strong> 
 
              <span> 
                This student's registered face 
                reference is used by the 
                attendance verification workflow. 
              </span> 
            </div> 
          </div> 
        </section> 
      ); 
    } 
 
    /* 
     * CREATE / EDIT MODE 
     */ 
    return ( 
      <section className="face-panel professional-face-panel"> 
        <div className="face-panel-header"> 
          <div> 
            <div className="face-panel-kicker"> 
              BIOMETRIC REGISTRATION 
            </div> 
 
            <h4 className="face-panel-title"> 
              Student face photo 
 
              <span className="face-required-badge"> 
                {isCreateMode 
                  ? "Required" 
                  : "Optional"} 
              </span> 
            </h4> 
 
            <p className="face-panel-hint"> 
              Capture a clear, front-facing 
              reference photo. Keep the complete 
              face visible inside the guide. 
            </p> 
          </div> 
 
          {isEditMode && ( 
            <span 
              className={`face-status-pill ${ 
                editingStudent?.face_registered 
                  ? "registered" 
                  : "pending" 
              }`} 
            > 
              <span className="face-status-dot" /> 
 
              {editingStudent?.face_registered 
                ? "Registered" 
                : "Pending"} 
            </span> 
          )} 
        </div> 
 
        <div className="face-camera-layout"> 
          {/* ================================================= 
              CAMERA 
          ================================================= */} 
 
          <div className="face-camera-main"> 
            <div className="camera-frame"> 
              {faceFile && 
              facePreviewUrl ? ( 
                /* 
                 * CAPTURED IMAGE 
                 */ 
                <img 
                  src={facePreviewUrl} 
                  alt="Student face preview" 
                  className={`camera-media captured-face-image ${ 
                    cameraFacingMode === 
                    "user" 
                      ? "mirror-camera" 
                      : "" 
                  }`} 
                /> 
              ) : cameraActive ? ( 
                /* 
                 * LIVE CAMERA 
                 */ 
                <video 
                  ref={videoRef} 
                  muted 
                  playsInline 
                  autoPlay 
                  className={`camera-media ${ 
                    cameraFacingMode === 
                    "user" 
                      ? "mirror-camera" 
                      : "" 
                  }`} 
                /> 
              ) : ( 
                /* 
                 * CAMERA EMPTY STATE 
                 */ 
                <div className="camera-placeholder"> 
                  <div className="camera-placeholder-icon"> 
                    ◎ 
                  </div> 
 
                  <strong> 
                    Face camera ready 
                  </strong> 
 
                  <span> 
                    Start the camera and place 
                    the student's complete face 
                    inside the positioning guide. 
                  </span> 
                </div> 
              )} 
 
              {/* --------------------------------------------- 
                  TOP STATUS 
              --------------------------------------------- */} 
 
              <div className="camera-top-status"> 
                <span className="status-led" /> 
 
                {cameraActive 
                  ? "CAMERA LIVE" 
                  : faceFile 
                  ? "PHOTO READY" 
                  : "BIOMETRIC CAMERA"} 
              </div> 
 
              {/* --------------------------------------------- 
                  FACE GUIDE 
                  IMPORTANT: 
                  These are HTML overlays only. 
                  They are NOT drawn into canvas. 
              --------------------------------------------- */} 
 
              {!faceFile && 
                cameraActive && ( 
                  <> 
                    <div 
                      className="face-position-guide" 
                      aria-hidden="true" 
                    > 
                      <span className="guide-corner guide-tl" /> 
                      <span className="guide-corner guide-tr" /> 
                      <span className="guide-corner guide-bl" /> 
                      <span className="guide-corner guide-br" /> 
 
                      <span className="guide-face-oval" /> 
 
                      <span className="guide-eye-line" /> 
 
                      <span className="guide-node node-1" /> 
                      <span className="guide-node node-2" /> 
                      <span className="guide-node node-3" /> 
                      <span className="guide-node node-4" /> 
                    </div> 
 
                    <div 
                      className="camera-scan-line" 
                      aria-hidden="true" 
                    /> 
 
                    <div className="camera-guide-label"> 
                      <span> 
                        POSITION FACE HERE 
                      </span> 
 
                      <small> 
                        Look straight · Eyes visible 
                      </small> 
                    </div> 
                  </> 
                )} 
 
              {/* --------------------------------------------- 
                  PHOTO READY 
              --------------------------------------------- */} 
 
              {faceFile && ( 
                <div className="camera-captured-badge"> 
                  <span>✓</span> 
 
                  Photo captured · ready for 
                  registration 
                </div> 
              )} 
            </div> 
 
            <div className="camera-info-bar"> 
              <span> 
                <b>Photo quality:</b>{" "} 
                face visible · sharp · even 
                lighting 
              </span> 
 
              <span> 
                JPG / PNG / WEBP · Max 5 MB 
              </span> 
            </div> 
          </div> 
 
          {/* ================================================= 
              CAMERA CONTROLS 
          ================================================= */} 
 
          <div className="camera-controls-card"> 
            <div className="camera-controls-title"> 
              <span> 
                Face capture 
              </span> 
 
              <small> 
                ATTENDANCE BIOMETRIC 
              </small> 
            </div> 
 
            {/* START CAMERA */} 
 
            {!cameraActive && 
              !faceFile && ( 
                <button 
                  type="button" 
                  className="primary-button camera-control-button camera-start-button" 
                  onClick={() => 
                    void startCamera() 
                  } 
                  disabled={ 
                    saving || 
                    faceSaving 
                  } 
                > 
                  <span className="button-orb"> 
                    ◉ 
                  </span> 
 
                  Start Camera 
                </button> 
              )} 
 
            {/* CAMERA LIVE */} 
 
            {cameraActive && ( 
              <> 
                <button 
                  type="button" 
                  className="primary-button camera-control-button camera-capture-button" 
                  onClick={ 
                    captureFace 
                  } 
                  disabled={ 
                    saving || 
                    faceSaving 
                  } 
                > 
                  <span className="button-orb"> 
                    ◎ 
                  </span> 
 
                  Capture Photo 
                </button> 
 
                <button 
                  type="button" 
                  className="secondary-button camera-control-button" 
                  onClick={() => 
                    void switchCamera() 
                  } 
                  disabled={ 
                    saving || 
                    faceSaving 
                  } 
                > 
                  ↻ Switch Camera 
                </button> 
 
                <button 
                  type="button" 
                  className="secondary-button camera-control-button" 
                  onClick={ 
                    stopCamera 
                  } 
                  disabled={ 
                    saving || 
                    faceSaving 
                  } 
                > 
                  ■ Stop Camera 
                </button> 
              </> 
            )} 
 
            {/* RETAKE */} 
 
            {faceFile && ( 
              <button 
                type="button" 
                className="secondary-button camera-control-button" 
                onClick={() => { 
                  clearFaceCapture(); 
                }} 
                disabled={ 
                  saving || 
                  faceSaving 
                } 
              > 
                ↻ Retake Photo 
              </button> 
            )} 
 
            {/* UPLOAD */} 
 
            <label className="upload-photo-button camera-control-button"> 
              <span> 
                ⇧ Upload Photo 
              </span> 
 
              <input 
                type="file" 
                accept="image/jpeg,image/png,image/webp" 
                onChange={ 
                  handleFaceFile 
                } 
                disabled={ 
                  saving || 
                  faceSaving 
                } 
                style={{ 
                  display: "none", 
                }} 
              /> 
            </label> 
 
            {/* REMOVE EXISTING FACE */} 
 
            {isEditMode && 
              editingStudent?.face_registered && 
              !faceFile && ( 
                <button 
                  type="button" 
                  className="action-button delete camera-control-button" 
                  onClick={ 
                    handleRemoveFace 
                  } 
                  disabled={ 
                    saving || 
                    faceSaving 
                  } 
                > 
                  Remove Face Registration 
                </button> 
              )} 
 
            {/* PHOTO REQUIREMENT */} 
 
            {isCreateMode && 
              !faceFile && ( 
                <div className="face-required-note"> 
                  <span>!</span> 
 
                  <div> 
                    <strong> 
                      Face photo required 
                    </strong> 
 
                    <small> 
                      Capture a photo before 
                      registering this student 
                      for attendance. 
                    </small> 
                  </div> 
                </div> 
              )} 
 
            {faceFile && ( 
              <div className="face-photo-ready-note"> 
                <span>✓</span> 
 
                <div> 
                  <strong> 
                    Photo ready 
                  </strong> 
 
                  <small> 
                    This image will be registered 
                    as the student's attendance 
                    face reference. 
                  </small> 
                </div> 
              </div> 
            )} 
          </div> 
        </div> 
 
        <canvas 
          ref={canvasRef} 
          style={{ 
            display: "none", 
          }} 
        /> 
 
        {/* CAMERA ERROR */} 
 
        {cameraError && ( 
          <div className="modal-alert face-camera-error"> 
            <span>!</span> 
 
            {cameraError} 
          </div> 
        )} 
 
        {/* ================================================= 
            GUIDELINES 
        ================================================= */} 
 
        <div className="face-guidelines"> 
          <div> 
            <strong> 
              FACE POSITIONING 
            </strong> 
 
            <span> 
              ✓ Complete face visible 
            </span> 
 
            <span> 
              ✓ Look directly at camera 
            </span> 
 
            <span> 
              ✓ Keep eyes visible 
            </span> 
          </div> 
 
          <div> 
            <strong> 
              PHOTO QUALITY 
            </strong> 
 
            <span> 
              ✓ Use even front lighting 
            </span> 
 
            <span> 
              ✓ Avoid sunglasses 
            </span> 
 
            <span> 
              ✓ Avoid heavy shadows 
            </span> 
          </div> 
        </div> 
 
        <p className="face-panel-footer-hint"> 
          {faceFile 
            ? "Photo captured successfully. Save the student profile to register this face for attendance verification." 
            : isCreateMode 
            ? "A face photo is required for a new student so the student can participate in face-based attendance." 
            : "You can capture a new face photo to replace the existing attendance reference."} 
        </p> 
      </section> 
    ); 
  }; 
 
  /* ========================================================= 
     RENDER 
  ========================================================= */ 
 
  return ( 
    <div className="students-page"> 
 
      {/* ===================================================== 
          HEADER 
      ===================================================== */} 
 
      <div className="students-header"> 
        <div> 
          <div className="eyebrow"> 
            ADMINISTRATION 
          </div> 
 
          <h1> 
            Students 
          </h1> 
 
          <p> 
            Manage student profiles, 
            biometric identity and 
            enrollment information. 
          </p> 
        </div> 
 
        <button 
          className="primary-button" 
          onClick={ 
            openAddModal 
          } 
          type="button" 
        > 
          <span className="button-icon"> 
            + 
          </span> 
 
          Add Student 
        </button> 
      </div> 
 
      {/* ===================================================== 
          STATISTICS 
      ===================================================== */} 
 
      <div className="student-stat-grid"> 
 
        <div className="student-stat-card"> 
          <div className="stat-icon"> 
            ◎ 
          </div> 
 
          <div> 
            <span> 
              Total Students 
            </span> 
 
            <strong> 
              {students.length} 
            </strong> 
          </div> 
        </div> 
 
        <div className="student-stat-card"> 
          <div className="stat-icon success"> 
            ✓ 
          </div> 
 
          <div> 
            <span> 
              Active Students 
            </span> 
 
            <strong> 
              {activeStudents} 
            </strong> 
          </div> 
        </div> 
 
        <div className="student-stat-card"> 
          <div className="stat-icon warning"> 
            ! 
          </div> 
 
          <div> 
            <span> 
              Inactive Students 
            </span> 
 
            <strong> 
              {inactiveStudents} 
            </strong> 
          </div> 
        </div> 
 
        <div className="student-stat-card"> 
          <div className="stat-icon purple"> 
            ◉ 
          </div> 
 
          <div> 
            <span> 
              Face Registered 
            </span> 
 
            <strong> 
              {faceRegisteredCount} 
            </strong> 
          </div> 
        </div> 
 
      </div> 
 
      {/* ===================================================== 
          NOTICE 
      ===================================================== */} 
 
      {notice && ( 
        <div 
          className="students-alert" 
          style={{ 
            background: "#ecfdf3", 
            color: "#067647", 
          }} 
        > 
          <span>✓</span> 
 
          {notice} 
        </div> 
      )} 
 
      {/* ===================================================== 
          ERROR 
      ===================================================== */} 
 
      {error && !modalOpen && ( 
        <div className="students-alert"> 
          <span>!</span> 
 
          {error} 
        </div> 
      )} 
 
      {/* ===================================================== 
          DIRECTORY 
      ===================================================== */} 
 
      <section className="student-directory"> 
 
        <div className="directory-header"> 
 
          <div> 
            <div className="eyebrow"> 
              STUDENT DIRECTORY 
            </div> 
 
            <h2> 
              All Students 
            </h2> 
 
            <span className="result-count"> 
              {filteredStudents.length}{" "} 
              record 
              {filteredStudents.length !== 1 
                ? "s" 
                : ""} 
            </span> 
          </div> 
 
          <div className="directory-tools"> 
 
            <div className="search-box"> 
 
              <span> 
                ⌕ 
              </span> 
 
              <input 
                type="text" 
                placeholder="Search students..." 
                value={search} 
                onChange={(event) => 
                  setSearch( 
                    event.target.value 
                  ) 
                } 
              /> 
 
              {search && ( 
                <button 
                  className="clear-search" 
                  onClick={() => 
                    setSearch("") 
                  } 
                  type="button" 
                > 
                  × 
                </button> 
              )} 
 
            </div> 
 
            <button 
              className="secondary-button" 
              onClick={ 
                loadStudents 
              } 
              disabled={loading} 
              type="button" 
            > 
              ↻ Refresh 
            </button> 
 
          </div> 
        </div> 
 
        {/* =================================================== 
            TABLE 
        =================================================== */} 
 
        <div className="student-table-wrapper"> 
 
          <table className="student-table"> 
 
            <thead> 
              <tr> 
                <th> 
                  STUDENT 
                </th> 
 
                <th> 
                  ROLL NUMBER 
                </th> 
 
                <th> 
                  DEPARTMENT 
                </th> 
 
                <th> 
                  EMAIL 
                </th> 
 
                <th> 
                  FACE 
                </th> 
 
                <th> 
                  STATUS 
                </th> 
 
                <th className="actions-column"> 
                  ACTIONS 
                </th> 
              </tr> 
            </thead> 
 
            <tbody> 
 
              {loading ? ( 
                <tr> 
                  <td colSpan="7"> 
                    <div className="table-state"> 
                      <div className="loading-spinner" /> 
 
                      <span> 
                        Loading students... 
                      </span> 
                    </div> 
                  </td> 
                </tr> 
              ) : filteredStudents.length === 
                0 ? ( 
                <tr> 
                  <td colSpan="7"> 
                    <div className="table-state empty-state"> 
 
                      <div className="empty-icon"> 
                        ◎ 
                      </div> 
 
                      <strong> 
                        {search 
                          ? "No students found" 
                          : "No students available"} 
                      </strong> 
 
                      <span> 
                        {search 
                          ? "Try a different search term." 
                          : "Add your first student to get started."} 
                      </span> 
 
                      {!search && ( 
                        <button 
                          className="primary-button small" 
                          onClick={ 
                            openAddModal 
                          } 
                          type="button" 
                        > 
                          + Add Student 
                        </button> 
                      )} 
                    </div> 
                  </td> 
                </tr> 
              ) : ( 
                filteredStudents.map( 
                  (student) => ( 
                    <tr 
                      key={ 
                        student.id 
                      } 
                    > 
 
                      {/* STUDENT */} 
 
                      <td> 
                        <div className="student-identity"> 
 
                          <div className="student-avatar"> 
                            {student.name 
                              ?.charAt(0) 
                              ?.toUpperCase() || 
                              "S"} 
                          </div> 
 
                          <div> 
                            <strong> 
                              {student.name} 
                            </strong> 
 
                            <span> 
                              {student.student_code || 
                                `Student #${student.id}`} 
                            </span> 
                          </div> 
 
                        </div> 
                      </td> 
 
                      {/* ROLL */} 
 
                      <td> 
                        <span className="roll-number"> 
                          {student.roll_number || 
                            "—"} 
                        </span> 
                      </td> 
 
                      {/* DEPARTMENT */} 
 
                      <td> 
                        <span className="department-badge"> 
                          {student.department || 
                            "Not assigned"} 
                        </span> 
                      </td> 
 
                      {/* EMAIL */} 
 
                      <td> 
                        <span className="email-text"> 
                          {student.email || 
                            "—"} 
                        </span> 
                      </td> 
 
                      {/* FACE */} 
 
                      <td> 
                        <span 
                          className={`status-badge ${ 
                            student.face_registered 
                              ? "active" 
                              : "inactive" 
                          }`} 
                        > 
                          <span className="status-dot" /> 
 
                          {student.face_registered 
                            ? "Registered" 
                            : "Pending"} 
                        </span> 
                      </td> 
 
                      {/* STATUS */} 
 
                      <td> 
                        <span 
                          className={`status-badge ${ 
                            student.is_active === 
                            false 
                              ? "inactive" 
                              : "active" 
                          }`} 
                        > 
                          <span className="status-dot" /> 
 
                          {student.is_active === 
                          false 
                            ? "Inactive" 
                            : "Active"} 
                        </span> 
                      </td> 
 
                      {/* ACTIONS */} 
 
                      <td> 
                        <div className="row-actions"> 
 
                          <button 
                            className="action-button edit" 
                            onClick={() => 
                              openViewModal( 
                                student 
                              ) 
                            } 
                            type="button" 
                          > 
                            View 
                          </button> 
 
                          <button 
                            className="action-button edit" 
                            onClick={() => 
                              openEditModal( 
                                student 
                              ) 
                            } 
                            type="button" 
                          > 
                            Edit 
                          </button> 
 
                          {student.is_active !== 
                          false ? ( 
                            <button 
                              className="action-button delete" 
                              onClick={() => 
                                handleDeactivate( 
                                  student 
                                ) 
                              } 
                              type="button" 
                            > 
                              Deactivate 
                            </button> 
                          ) : ( 
                            <button 
                              className="action-button edit" 
                              onClick={() => 
                                handleActivate( 
                                  student 
                                ) 
                              } 
                              type="button" 
                            > 
                              Activate 
                            </button> 
                          )} 
 
                        </div> 
                      </td> 
 
                    </tr> 
                  ) 
                ) 
              )} 
 
            </tbody> 
          </table> 
        </div> 
      </section> 
 
      {/* ===================================================== 
          STUDENT MODAL 
      ===================================================== */} 
 
      {modalOpen && ( 
        <div 
          className="modal-backdrop" 
          onMouseDown={(event) => { 
            if ( 
              event.target === 
              event.currentTarget 
            ) { 
              closeModal(); 
            } 
          }} 
        > 
 
          <div 
            className="student-modal" 
            onMouseDown={(event) => 
              event.stopPropagation() 
            } 
          > 
 
            {/* MODAL HEADER */} 
 
            <div className="modal-header"> 
 
              <div> 
 
                <div className="eyebrow"> 
                  {isViewMode 
                    ? "STUDENT PROFILE" 
                    : isEditMode 
                    ? "UPDATE RECORD" 
                    : "NEW STUDENT REGISTRATION"} 
                </div> 
 
                <h2> 
                  {isViewMode 
                    ? "Student Profile" 
                    : isEditMode 
                    ? "Edit Student" 
                    : "Register New Student"} 
                </h2> 
 
                <p> 
                  {isViewMode 
                    ? "Review the student's academic, guardian and biometric details." 
                    : isEditMode 
                    ? "Update student information and biometric attendance reference." 
                    : "Create a complete student profile with a face reference for attendance."} 
                </p> 
 
              </div> 
 
              <button 
                className="modal-close" 
                onClick={ 
                  closeModal 
                } 
                disabled={ 
                  saving || 
                  faceSaving 
                } 
                type="button" 
                aria-label="Close" 
              > 
                × 
              </button> 
 
            </div> 
 
            {/* MODAL ERROR */} 
 
            {error && ( 
              <div className="modal-alert"> 
                <span>!</span> 
 
                {error} 
              </div> 
            )} 
 
            {/* ================================================= 
                VIEW MODE 
            ================================================= */} 
 
            {isViewMode ? ( 
              <> 
                {/* IDENTITY */} 
 
                <section className="student-detail-section"> 
 
                  <div className="student-detail-heading"> 
 
                    <div className="student-detail-number"> 
                      01 
                    </div> 
 
                    <div> 
                      <div className="student-detail-kicker"> 
                        STUDENT IDENTITY 
                      </div> 
 
                      <h3> 
                        Personal information 
                      </h3> 
 
                      <p> 
                        Core identity and contact 
                        details registered for 
                        this student. 
                      </p> 
                    </div> 
 
                  </div> 
 
                  <div className="form-grid"> 
 
                    <div className="form-field"> 
                      <label> 
                        Student ID 
                      </label> 
 
                      <input 
                        value={ 
                          editingStudent?.student_code || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label> 
                        Full Name 
                      </label> 
 
                      <input 
                        value={ 
                          editingStudent?.name || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label> 
                        Email Address 
                      </label> 
 
                      <input 
                        value={ 
                          editingStudent?.email || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label> 
                        Mobile Number 
                      </label> 
 
                      <input 
                        value={ 
                          form.mobile || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label> 
                        Date of Birth 
                      </label> 
 
                      <input 
                        value={ 
                          form.date_of_birth || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label> 
                        Gender 
                      </label> 
 
                      <input 
                        value={ 
                          form.gender || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label> 
                        Blood Group 
                      </label> 
 
                      <input 
                        value={ 
                          form.blood_group || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                  </div> 
                </section> 
 
                {/* ACADEMIC */} 
 
                <section className="student-detail-section"> 
 
                  <div className="student-detail-heading"> 
 
                    <div className="student-detail-number"> 
                      02 
                    </div> 
 
                    <div> 
                      <div className="student-detail-kicker"> 
                        ACADEMIC PROFILE 
                      </div> 
 
                      <h3> 
                        Enrollment details 
                      </h3> 
 
                      <p> 
                        Academic placement used 
                        by classes, subjects and 
                        attendance workflows. 
                      </p> 
                    </div> 
 
                  </div> 
 
                  <div className="form-grid"> 
 
                    <div className="form-field"> 
                      <label> 
                        Roll Number 
                      </label> 
 
                      <input 
                        value={ 
                          editingStudent?.roll_number || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label> 
                        Department 
                      </label> 
 
                      <input 
                        value={ 
                          editingStudent?.department || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label> 
                        Course / Program 
                      </label> 
 
                      <input 
                        value={ 
                          form.course || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label> 
                        Academic Year 
                      </label> 
 
                      <input 
                        value={ 
                          form.academic_year || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label> 
                        Semester 
                      </label> 
 
                      <input 
                        value={ 
                          form.semester || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label> 
                        Section 
                      </label> 
 
                      <input 
                        value={ 
                          form.section || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label> 
                        Admission Date 
                      </label> 
 
                      <input 
                        value={ 
                          form.admission_date || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                  </div> 
                </section> 
 
                {/* ADDRESS */} 
 
                <section className="student-detail-section"> 
 
                  <div className="student-detail-heading"> 
 
                    <div className="student-detail-number"> 
                      03 
                    </div> 
 
                    <div> 
                      <div className="student-detail-kicker"> 
                        CONTACT ADDRESS 
                      </div> 
 
                      <h3> 
                        Residential information 
                      </h3> 
 
                      <p> 
                        Current address 
                        information for 
                        institutional records. 
                      </p> 
                    </div> 
 
                  </div> 
 
                  <div className="form-grid"> 
 
                    <div className="form-field full"> 
                      <label> 
                        Address 
                      </label> 
 
                      <input 
                        value={ 
                          form.address || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label> 
                        City 
                      </label> 
 
                      <input 
                        value={ 
                          form.city || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label> 
                        State 
                      </label> 
 
                      <input 
                        value={ 
                          form.state || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label> 
                        PIN Code 
                      </label> 
 
                      <input 
                        value={ 
                          form.pincode || 
                          "—" 
                        } 
                        readOnly 
                      /> 
                    </div> 
 
                  </div> 
                </section> 
 
                {/* GUARDIAN */} 
 
                <section className="guardian-panel guardian-panel-view"> 
 
                  <div className="guardian-panel-header"> 
 
                    <div> 
                      <div className="guardian-eyebrow"> 
                        PARENT / GUARDIAN 
                      </div> 
 
                      <h3> 
                        Emergency & attendance contact 
                      </h3> 
 
                      <p> 
                        Used for configured absence 
                        and low-attendance alerts. 
                      </p> 
                    </div> 
 
                    <span className="guardian-status-badge"> 
                      🔔 Alerts ready 
                    </span> 
 
                  </div> 
 
                  {guardianLoading ? ( 
                    <div className="guardian-loading"> 
                      Loading guardian details… 
                    </div> 
                  ) : ( 
                    <div className="guardian-detail-grid"> 
 
                      <div> 
                        <span> 
                          Guardian name 
                        </span> 
 
                        <strong> 
                          {form.guardian_name || 
                            "Not provided"} 
                        </strong> 
                      </div> 
 
                      <div> 
                        <span> 
                          Relationship 
                        </span> 
 
                        <strong> 
                          {form.guardian_relationship || 
                            "Not provided"} 
                        </strong> 
                      </div> 
 
                      <div> 
                        <span> 
                          Mobile number 
                        </span> 
 
                        <strong> 
                          {form.guardian_mobile || 
                            "Not provided"} 
                        </strong> 
                      </div> 
 
                      <div> 
                        <span> 
                          Alternate number 
                        </span> 
 
                        <strong> 
                          {form.alternate_mobile || 
                            "Not provided"} 
                        </strong> 
                      </div> 
 
                      <div> 
                        <span> 
                          Absence alert 
                        </span> 
 
                        <strong> 
                          {form.notify_absence 
                            ? "Enabled" 
                            : "Disabled"} 
                        </strong> 
                      </div> 
 
                      <div> 
                        <span> 
                          Low attendance alert 
                        </span> 
 
                        <strong> 
                          {form.notify_low_attendance 
                            ? "Enabled" 
                            : "Disabled"} 
                        </strong> 
                      </div> 
 
                    </div> 
                  )} 
                </section> 
 
                {/* FACE */} 
 
                {renderFaceSection()} 
 
                {/* FOOTER */} 
 
                <div className="modal-footer"> 
 
                  <button 
                    className="secondary-button" 
                    onClick={ 
                      closeModal 
                    } 
                    type="button" 
                  > 
                    Close 
                  </button> 
 
                  <button 
                    className="primary-button" 
                    onClick={() => 
                      openEditModal( 
                        editingStudent 
                      ) 
                    } 
                    type="button" 
                  > 
                    Edit Student 
                  </button> 
 
                </div> 
              </> 
            ) : ( 
              /* ================================================= 
                 CREATE / EDIT 
              ================================================= */ 
 
              <form 
                onSubmit={ 
                  handleSubmit 
                } 
              > 
 
                {/* ================================================= 
                   SECTION 01 
                ================================================= */} 
 
                <section className="student-detail-section"> 
 
                  <div className="student-detail-heading"> 
 
                    <div className="student-detail-number"> 
                      01 
                    </div> 
 
                    <div> 
                      <div className="student-detail-kicker"> 
                        STUDENT IDENTITY 
                      </div> 
 
                      <h3> 
                        Personal information 
                      </h3> 
 
                      <p> 
                        Enter the student's 
                        identity and primary 
                        contact details. 
                      </p> 
                    </div> 
 
                  </div> 
 
                  <div className="form-grid"> 
 
                    <div className="form-field full"> 
                      <label htmlFor="student-name"> 
                        Full Name{" "} 
                        <span className="required-mark"> 
                          * 
                        </span> 
                      </label> 
 
                      <input 
                        id="student-name" 
                        name="name" 
                        value={ 
                          form.name 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                        placeholder="e.g. Pintu Kumar" 
                        autoFocus 
                        required 
                        minLength={2} 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label htmlFor="student-email"> 
                        Email Address{" "} 
                        <span className="required-mark"> 
                          * 
                        </span> 
                      </label> 
 
                      <input 
                        id="student-email" 
                        name="email" 
                        type="email" 
                        value={ 
                          form.email 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                        placeholder="student@example.com" 
                        required 
                      /> 
                    </div> 
 
                    {isCreateMode && ( 
                      <div className="form-field password-field"> 
                        <label htmlFor="student-password"> 
                          Initial Password{" "} 
                          <span className="required-mark">*</span> 
                        </label> 
                        <input 
                          id="student-password" 
                          name="password" 
                          type="password" 
                          autoComplete="new-password" 
                          value={form.password || ""} 
                          onChange={handleChange} 
                          placeholder="At least 8 characters" 
                          minLength={8} 
                          required={isCreateMode} 
                        /> 
                        <small className="password-help"> 
                          Set a temporary password; the student should change it after first login. 
                        </small> 
                      </div> 
                    )} 
 
                    <div className="form-field"> 
                      {isCreateMode && (
                      <div className="form-field password-field">
                        <label htmlFor="student-confirm-password">
                          Confirm Password <span className="required-mark">*</span>
                        </label>
                        <input
                          id="student-confirm-password"
                          name="confirm_password"
                          type="password"
                          autoComplete="new-password"
                          value={form.confirm_password || ""}
                          onChange={handleChange}
                          placeholder="Re-enter the password"
                          minLength={8}
                          required={isCreateMode}
                        />
                        <small className="password-help">
                          Both password fields must match exactly.
                        </small>
                      </div>
                    )}

                    <label htmlFor="student-mobile"> 
                        Mobile Number 
                      </label> 
 
                      <input 
                        id="student-mobile" 
                        name="mobile" 
                        type="tel" 
                        inputMode="tel" 
                        value={ 
                          form.mobile 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                        placeholder="+91 9876543210" 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label htmlFor="student-dob"> 
                        Date of Birth 
                      </label> 
 
                      <input 
                        id="student-dob" 
                        name="date_of_birth" 
                        type="date" 
                        value={ 
                          form.date_of_birth 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label htmlFor="student-gender"> 
                        Gender 
                      </label> 
 
                      <select 
                        id="student-gender" 
                        name="gender" 
                        value={ 
                          form.gender 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                      > 
                        <option value=""> 
                          Select gender 
                        </option> 
 
                        <option value="Male"> 
                          Male 
                        </option> 
 
                        <option value="Female"> 
                          Female 
                        </option> 
 
                        <option value="Other"> 
                          Other 
                        </option> 
 
                        <option value="Prefer not to say"> 
                          Prefer not to say 
                        </option> 
                      </select> 
                    </div> 
 
                    <div className="form-field"> 
                      <label htmlFor="student-blood-group"> 
                        Blood Group 
                      </label> 
 
                      <select 
                        id="student-blood-group" 
                        name="blood_group" 
                        value={ 
                          form.blood_group 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                      > 
                        <option value=""> 
                          Select blood group 
                        </option> 
 
                        <option value="A+"> 
                          A+ 
                        </option> 
 
                        <option value="A-"> 
                          A- 
                        </option> 
 
                        <option value="B+"> 
                          B+ 
                        </option> 
 
                        <option value="B-"> 
                          B- 
                        </option> 
 
                        <option value="AB+"> 
                          AB+ 
                        </option> 
 
                        <option value="AB-"> 
                          AB- 
                        </option> 
 
                        <option value="O+"> 
                          O+ 
                        </option> 
 
                        <option value="O-"> 
                          O- 
                        </option> 
                      </select> 
                    </div> 
 
                  </div> 
                </section> 
 
                {/* ================================================= 
                   SECTION 02 
                ================================================= */} 
 
                <section className="student-detail-section"> 
 
                  <div className="student-detail-heading"> 
 
                    <div className="student-detail-number"> 
                      02 
                    </div> 
 
                    <div> 
                      <div className="student-detail-kicker"> 
                        ACADEMIC PROFILE 
                      </div> 
 
                      <h3> 
                        Enrollment details 
                      </h3> 
 
                      <p> 
                        Define the student's 
                        academic placement for 
                        classes and attendance. 
                      </p> 
                    </div> 
 
                  </div> 
 
                  <div className="form-grid"> 
 
                    <div className="form-field"> 
                      <label htmlFor="student-roll"> 
                        Roll Number{" "} 
                        <span className="required-mark"> 
                          * 
                        </span> 
                      </label> 
 
                      <input 
                        id="student-roll" 
                        name="roll_number" 
                        value={ 
                          form.roll_number 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                        placeholder="e.g. 101" 
                        required 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label htmlFor="student-department"> 
                        Department 
                      </label> 
 
                      <input 
                        id="student-department" 
                        name="department" 
                        value={ 
                          form.department 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                        placeholder="Computer Science" 
                      /> 
                    </div> 
 
                    <div className="form-field full"> 
                      <label htmlFor="student-course"> 
                        Course / Program 
                      </label> 
 
                      <input 
                        id="student-course" 
                        name="course" 
                        value={ 
                          form.course 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                        placeholder="B.Tech Computer Science & Engineering" 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label htmlFor="student-academic-year"> 
                        Academic Year 
                      </label> 
 
                      <input 
                        id="student-academic-year" 
                        name="academic_year" 
                        value={ 
                          form.academic_year 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                        placeholder="2026-27" 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label htmlFor="student-semester"> 
                        Semester 
                      </label> 
 
                      <select 
                        id="student-semester" 
                        name="semester" 
                        value={ 
                          form.semester 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                      > 
                        <option value=""> 
                          Select semester 
                        </option> 
 
                        {[1, 2, 3, 4, 5, 6, 7, 8].map( 
                          (value) => ( 
                            <option 
                              key={value} 
                              value={value} 
                            > 
                              {value} Semester 
                            </option> 
                          ) 
                        )} 
                      </select> 
                    </div> 
 
                    <div className="form-field"> 
                      <label htmlFor="student-section"> 
                        Section 
                      </label> 
 
                      <input 
                        id="student-section" 
                        name="section" 
                        value={ 
                          form.section 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                        placeholder="A" 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label htmlFor="student-admission-date"> 
                        Admission Date 
                      </label> 
 
                      <input 
                        id="student-admission-date" 
                        name="admission_date" 
                        type="date" 
                        value={ 
                          form.admission_date 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                      /> 
                    </div> 
 
                  </div> 
                </section> 
 
                {/* ================================================= 
                   SECTION 03 
                ================================================= */} 
 
                <section className="student-detail-section"> 
 
                  <div className="student-detail-heading"> 
 
                    <div className="student-detail-number"> 
                      03 
                    </div> 
 
                    <div> 
                      <div className="student-detail-kicker"> 
                        CONTACT ADDRESS 
                      </div> 
 
                      <h3> 
                        Residential information 
                      </h3> 
 
                      <p> 
                        Add the student's 
                        current residential 
                        address. 
                      </p> 
                    </div> 
 
                  </div> 
 
                  <div className="form-grid"> 
 
                    <div className="form-field full"> 
                      <label htmlFor="student-address"> 
                        Address 
                      </label> 
 
                      <textarea 
                        id="student-address" 
                        name="address" 
                        value={ 
                          form.address 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                        placeholder="House / street / locality" 
                        rows="3" 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label htmlFor="student-city"> 
                        City 
                      </label> 
 
                      <input 
                        id="student-city" 
                        name="city" 
                        value={ 
                          form.city 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                        placeholder="e.g. Lucknow" 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label htmlFor="student-state"> 
                        State 
                      </label> 
 
                      <input 
                        id="student-state" 
                        name="state" 
                        value={ 
                          form.state 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                        placeholder="e.g. Uttar Pradesh" 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label htmlFor="student-pincode"> 
                        PIN Code 
                      </label> 
 
                      <input 
                        id="student-pincode" 
                        name="pincode" 
                        inputMode="numeric" 
                        maxLength="6" 
                        value={ 
                          form.pincode 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                        placeholder="e.g. 226001" 
                      /> 
                    </div> 
 
                  </div> 
                </section> 
 
                {/* ================================================= 
                   SECTION 04 - GUARDIAN 
                ================================================= */} 
 
                <section className="guardian-panel"> 
 
                  <div className="guardian-panel-header"> 
 
                    <div> 
                      <div className="guardian-eyebrow"> 
                        PARENT / GUARDIAN 
                      </div> 
 
                      <h3> 
                        Attendance alert contact 
                      </h3> 
 
                      <p> 
                        Configure the parent or 
                        guardian who should receive 
                        attendance notifications. 
                      </p> 
                    </div> 
 
                    <span className="guardian-status-badge"> 
                      🔔 Alerts 
                    </span> 
 
                  </div> 
 
                  <div className="form-grid"> 
 
                    <div className="form-field"> 
                      <label htmlFor="guardian-name"> 
                        Guardian Name{" "} 
                        <span className="required-mark"> 
                          * 
                        </span> 
                      </label> 
 
                      <input 
                        id="guardian-name" 
                        name="guardian_name" 
                        value={ 
                          form.guardian_name 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                        placeholder="e.g. Rajesh Kumar" 
                        required 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label htmlFor="guardian-relationship"> 
                        Relationship 
                      </label> 
 
                      <select 
                        id="guardian-relationship" 
                        name="guardian_relationship" 
                        value={ 
                          form.guardian_relationship 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                      > 
                        <option value="Father"> 
                          Father 
                        </option> 
 
                        <option value="Mother"> 
                          Mother 
                        </option> 
 
                        <option value="Guardian"> 
                          Guardian 
                        </option> 
 
                        <option value="Brother"> 
                          Brother 
                        </option> 
 
                        <option value="Sister"> 
                          Sister 
                        </option> 
 
                        <option value="Other"> 
                          Other 
                        </option> 
                      </select> 
                    </div> 
 
                    <div className="form-field"> 
                      <label htmlFor="guardian-mobile"> 
                        Guardian Mobile{" "} 
                        <span className="required-mark"> 
                          * 
                        </span> 
                      </label> 
 
                      <input 
                        id="guardian-mobile" 
                        name="guardian_mobile" 
                        type="tel" 
                        inputMode="tel" 
                        value={ 
                          form.guardian_mobile 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                        placeholder="+91 9876543210" 
                        required 
                      /> 
                    </div> 
 
                    <div className="form-field"> 
                      <label htmlFor="guardian-alternate"> 
                        Alternate Mobile 
                      </label> 
 
                      <input 
                        id="guardian-alternate" 
                        name="alternate_mobile" 
                        type="tel" 
                        inputMode="tel" 
                        value={ 
                          form.alternate_mobile 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                        placeholder="Optional" 
                      /> 
                    </div> 
 
                  </div> 
 
                  <div className="guardian-preferences"> 
 
                    <label className="guardian-check"> 
                      <input 
                        type="checkbox" 
                        name="notify_absence" 
                        checked={ 
                          form.notify_absence 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                      /> 
 
                      <span> 
                        <strong> 
                          Absence alerts 
                        </strong> 
 
                        <small> 
                          Notify guardian when 
                          attendance is marked 
                          absent. 
                        </small> 
                      </span> 
                    </label> 
 
                    <label className="guardian-check"> 
                      <input 
                        type="checkbox" 
                        name="notify_low_attendance" 
                        checked={ 
                          form.notify_low_attendance 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                      /> 
 
                      <span> 
                        <strong> 
                          Low attendance alerts 
                        </strong> 
 
                        <small> 
                          Notify guardian when 
                          attendance falls below 
                          the configured threshold. 
                        </small> 
                      </span> 
                    </label> 
 
                    <div className="form-field"> 
                      <label htmlFor="notification-channel"> 
                        Notification Channel 
                      </label> 
 
                      <select 
                        id="notification-channel" 
                        name="notification_channel" 
                        value={ 
                          form.notification_channel 
                        } 
                        onChange={ 
                          handleChange 
                        } 
                      > 
                        <option value="sms_email"> 
                          SMS + Email 
                        </option> 
 
                        <option value="sms"> 
                          SMS 
                        </option> 
 
                        <option value="email"> 
                          Email 
                        </option> 
                      </select> 
                    </div> 
 
                  </div> 
                </section> 
 
                {/* ================================================= 
                   STUDENT ID 
                ================================================= */} 
 
                <section className="student-id-preview"> 
 
                  <div> 
                    <span className="student-id-preview-kicker"> 
                      ATTENDX STUDENT IDENTIFIER 
                    </span> 
 
                    <strong> 
                      {isEditMode 
                        ? editingStudent?.student_code || 
                          "—" 
                        : "Generated automatically"} 
                    </strong> 
                  </div> 
 
                  <span> 
                    The unique Student ID is 
                    generated by the server during 
                    registration. 
                  </span> 
 
                </section> 
 
                {/* ================================================= 
                   FACE REGISTRATION 
                ================================================= */} 
 
                {renderFaceSection()} 
 
                {/* ================================================= 
                   FOOTER 
                ================================================= */} 
 
                <div className="modal-footer"> 
 
                  <button 
                    type="button" 
                    className="secondary-button" 
                    onClick={ 
                      closeModal 
                    } 
                    disabled={ 
                      saving || 
                      faceSaving 
                    } 
                  > 
                    Cancel 
                  </button> 
 
                  <button 
                    type="submit" 
                    className="primary-button" 
                    disabled={ 
                      saving || 
                      faceSaving 
                    } 
                  > 
                    {saving || 
                    faceSaving 
                      ? faceSaving 
                        ? "Registering face..." 
                        : "Saving..." 
                      : isEditMode 
                      ? "Save Changes" 
                      : "Register Student"} 
                  </button> 
 
                </div> 
 
              </form> 
            )} 
          </div> 
        </div> 
      )} 
 
      {/* ===================================================== 
          REGISTRATION SUCCESS 
      ===================================================== */} 
 
      {registeredStudent && ( 
        <div className="modal-backdrop"> 
 
          <div style={successCardStyle}> 
 
            <div 
              style={{ 
                width: 58, 
                height: 58, 
                margin: "0 auto 14px", 
                display: "grid", 
                placeItems: "center", 
                borderRadius: "50%", 
                background: "#ecfdf3", 
                color: "#039855", 
                fontSize: 26, 
                fontWeight: 900, 
              }} 
            > 
              ✓ 
            </div> 
 
            <div className="eyebrow"> 
              REGISTRATION COMPLETE 
            </div> 
 
            <h2 
              style={{ 
                margin: 
                  "7px 0 8px", 
                color: "#101828", 
              }} 
            > 
              Student registered successfully 
            </h2> 
 
            <p 
              style={{ 
                margin: 0, 
                color: "#667085", 
                fontSize: 13, 
                lineHeight: 1.6, 
              }} 
            > 
              The student profile has been 
              registered successfully. 
            </p> 
 
            {/* STUDENT ID */} 
 
            <div 
              style={{ 
                margin: 
                  "20px 0", 
                padding: 
                  "16px 18px", 
                border: 
                  "1px solid #dfe2ff", 
                borderRadius: 14, 
                background: 
                  "#f7f7ff", 
              }} 
            > 
              <span 
                style={{ 
                  display: 
                    "block", 
                  color: 
                    "#667085", 
                  fontSize: 10, 
                  fontWeight: 800, 
                  letterSpacing: 
                    "0.12em", 
                }} 
              > 
                GENERATED STUDENT ID 
              </span> 
 
              <strong 
                style={{ 
                  display: 
                    "block", 
                  marginTop: 5, 
                  color: 
                    "#4f46c6", 
                  fontSize: 23, 
                  letterSpacing: 
                    "0.03em", 
                }} 
              > 
                { 
                  registeredStudent.student_code 
                } 
              </strong> 
            </div> 
 
            {/* FACE STATUS */} 
 
            <div 
              style={{ 
                padding: 
                  "11px 13px", 
                borderRadius: 10, 
                background: 
                  registeredStudent.face_registered 
                    ? "#ecfdf3" 
                    : "#fff7ed", 
                color: 
                  registeredStudent.face_registered 
                    ? "#067647" 
                    : "#b54708", 
                fontSize: 11, 
                fontWeight: 700, 
                lineHeight: 1.5, 
              }} 
            > 
              {registeredStudent.face_registered 
                ? "✓ Face reference registered — student is ready for face-based attendance." 
                : registrationWarning || 
                  "Student registered, but the face reference was not registered."} 
            </div> 
 
            {/* ATTENDANCE STATUS */} 
 
            <div 
              style={{ 
                marginTop: 10, 
                padding: 
                  "11px 13px", 
                borderRadius: 10, 
                background: 
                  "#f8fafc", 
                color: 
                  "#475467", 
                fontSize: 11, 
                lineHeight: 1.5, 
              }} 
            > 
              Face verification will use this 
              registered reference image during 
              the attendance workflow. 
            </div> 
 
            <button 
              className="primary-button" 
              style={{ 
                marginTop: 20, 
                minWidth: 150, 
              }} 
              onClick={() => { 
                setRegisteredStudent( 
                  null 
                ); 
 
                setRegistrationWarning( 
                  "" 
                ); 
              }} 
              type="button" 
            > 
              Done 
            </button> 
 
          </div> 
        </div> 
      )} 
 
    </div> 
  ); 
} 
 
export default Students;
