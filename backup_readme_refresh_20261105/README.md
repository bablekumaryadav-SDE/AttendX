# AttendX Project
# AttendX — Implement Real Face Recognition Attendance in Student Dashboard

## Project Background

I am a B.Tech CSE final-year student developing **AttendX — AI-Powered Smart Attendance Management System**.

I have an existing AttendX project with a React + Vite frontend, Python FastAPI backend, SQLAlchemy ORM and PostgreSQL database. The project already contains student, teacher and admin dashboards, authentication, attendance functionality, QR attendance and admin-side face photo registration.

**Your task is to inspect my actual uploaded project ZIP, understand the existing code, and implement a fully functional Face Recognition Attendance feature in the Student Dashboard.**

Do not create a new project from scratch. Work on my existing codebase.

## 1. Current Problem

Currently, the Student Dashboard provides a QR scanner, but the student-facing Face Attendance feature is missing or incomplete.

The admin panel has a face photo registration feature, but the complete flow from face registration to real face verification and attendance recording is not working correctly.

I want students to mark attendance through their own camera using real face verification while keeping the existing QR attendance system functional.

## 2. Required Student Dashboard Features

Add a professional **Face Attendance** option to the existing Student Dashboard.

The interface should include:

- Face Attendance button or card.
- Live camera preview.
- Start Camera and Stop Camera controls.
- Capture Face or Verify Face button.
- Camera permission handling.
- Face verification loading indicator.
- Clear verification success and failure messages.
- Attendance session status.
- Attendance marking result.
- QR Attendance as an alternative method.

Preserve the existing design system, navigation, responsive layout and dashboard components.

## 3. Real Face Registration and Verification

Inspect the current face registration implementation before making changes.

Implement the following complete workflow:

1. An admin registers a student and uploads a valid face image, or uses the existing supported registration flow.
2. The backend validates the image format, size and image contents.
3. The backend detects a usable face.
4. The backend generates a genuine face embedding using a real face-recognition model.
5. The embedding is stored securely and associated with the correct student.
6. When the student starts Face Attendance, the browser requests camera permission.
7. The browser captures a live camera frame and sends it to the authenticated backend.
8. The backend processes the captured face using the same compatible recognition model.
9. The backend compares the captured embedding against the registered embedding using a configured similarity or distance threshold.
10. The backend identifies whether the face matches the authenticated student's registered face.
11. Attendance is considered only after identity verification succeeds.

Important requirements:

- Never use fake embeddings, hardcoded success responses, random matching or placeholder verification.
- Never accept a client-provided student ID as proof of identity.
- Derive the student identity from the authenticated user and verify that the student record belongs to that user.
- Reject missing, invalid, corrupted or unregistered face data.
- Do not set `face_registered = true` unless valid registration has actually completed.
- Prevent one student's face from being used to register or mark attendance for another student without authorization.
- Keep face images and embeddings protected from unauthorized access.

If the existing model is unsuitable or unavailable in the current environment, inspect compatibility and recommend a practical implementation that fits the existing Python environment. Do not silently replace real face recognition with a mock.

## 4. Attendance Session Validation

Before recording face attendance, verify:

- The student is authenticated.
- The student account is active and eligible.
- An appropriate attendance session exists.
- The session is currently active and within its permitted time window.
- The student belongs to the relevant class or course, where applicable.
- Face verification has succeeded.
- The student has not already marked attendance for that session.
- Existing GPS/geofencing requirements are enforced if they are already part of the applicable attendance workflow.

Only after all required checks succeed should the backend create the attendance record.

Use a database-level uniqueness constraint or equivalent transaction-safe protection where appropriate to prevent concurrent duplicate attendance submissions.

Do not mark attendance when face verification fails, the session is inactive, the student is ineligible or the attendance record already exists.

Preserve existing attendance statuses, session rules and database relationships.

## 5. Backend Implementation

Inspect the actual FastAPI project and implement the feature using its existing architecture.

Check and modify the relevant files as necessary, including:

- `backend/app/main.py`
- Existing authentication and user/student models.
- Existing student API routes.
- Existing face registration or face verification services.
- Existing attendance and attendance-session routes.
- Existing database models and schemas.
- Existing dependencies and configuration files.

Create or update appropriate modules only when needed.

Implement proper APIs for:

- Checking whether the authenticated student has registered face data.
- Starting or validating an attendance session.
- Submitting a camera frame for face verification.
- Verifying the registered face.
- Recording attendance after successful verification.
- Returning the attendance result and useful error messages.

Use the existing API conventions, authentication dependencies, SQLAlchemy sessions, response schemas and error-handling patterns.

Do not introduce duplicate endpoints or conflicting database models if equivalent implementations already exist.

## 6. Frontend Implementation

Inspect the actual React routing, authentication context, API service layer and Student Dashboard components.

Integrate Face Attendance into the existing student-facing interface.

Requirements:

- Use the correct authenticated API client.
- Send the correct access token.
- Use the browser camera through `navigator.mediaDevices.getUserMedia()` where supported.
- Handle camera permission denial, missing camera and camera errors.
- Release the camera tracks when the component unmounts or the camera is stopped.
- Prevent repeated submissions while verification is in progress.
- Display backend validation errors clearly.
- Refresh attendance history or dashboard statistics after successful attendance.
- Keep QR scanning, student profile, login and teacher/admin dashboards working.

Check imports, exports, route definitions, component paths and JSX syntax before finishing.

Do not assume the student dashboard is located in a particular directory until you inspect the ZIP.

## 7. Database and Migration Safety

Inspect the existing PostgreSQL schema and SQLAlchemy models first.

- Reuse existing face and attendance tables where possible.
- Preserve existing student records and attendance history.
- Do not drop or recreate the database.
- Do not delete existing migrations or project files.
- Add migrations or safe schema updates only if genuinely required.
- Ensure embeddings use a consistent format and compatible model version.
- Handle existing registrations whose embeddings are missing or invalid.

Create a backup before modifying existing source files or database schema.

## 8. Security and Liveness

Implement face matching as a genuine backend operation.

If the project includes a liveness component, inspect and integrate it correctly. If genuine liveness detection is not available, clearly identify that limitation and do not claim that photo or video replay attacks are fully prevented.

Face matching alone must not be described as proof of liveness.

Protect camera frames, stored images and embeddings. Avoid logging sensitive biometric data. Do not expose embeddings or private image data through ordinary student APIs.

## 9. Preserve Existing Features

Do not break or remove:

- Admin Dashboard.
- Student registration and management.
- Teacher Dashboard.
- Class and course management.
- Existing QR Attendance.
- Attendance sessions.
- GPS/geofencing validation, where implemented.
- Attendance reports and exports.
- Role-based authentication and protected routes.
- Existing frontend design and navigation.

The existing project must be enhanced, not rebuilt.

## 10. Testing Requirements

Run actual tests wherever the environment permits.

Test at least these cases:

1. Valid registered student face.
2. Unregistered student face.
3. Face mismatch using another registered student's image.
4. Invalid or unreadable image.
5. No usable face detected.
6. Camera permission denied.
7. Inactive or expired attendance session.
8. Student not eligible for the class.
9. Duplicate attendance attempt.
10. Unauthenticated API request.
11. Unauthorized role or student record access.
12. Successful attendance persistence in PostgreSQL.
13. Existing QR attendance still works.
14. Teacher and admin dashboards still open correctly.
15. Student Dashboard opens and displays Face Attendance.

Check backend startup, frontend compilation, API integration, database operations and relevant automated tests.

Do not claim a test passed unless it was actually executed and its result was checked.

Clearly distinguish:
- Passed tests.
- Failed tests.
- Not tested.
- Tests requiring my local camera, database, credentials or external services.

## 11. Required Deliverables

After completing the work, provide:

1. A diagnosis of the original problem.
2. The exact root cause found in the existing source code.
3. A list of modified and newly created files.
4. Complete corrected code for important modified files.
5. Any database migration or configuration instructions.
6. Updated dependency requirements, if needed.
7. Exact Windows PowerShell commands to start the backend and frontend.
8. Instructions to register a student's face and test attendance.
9. Actual test results with failures and limitations clearly identified.
10. A new ZIP containing the corrected existing project, if file editing and packaging are available.
11. A concise implementation summary suitable for my final-year project documentation.

## 12. Development Environment

My usual local project path is:

`C:\Users\Asus\OneDrive\Desktop\MainProject\AttendX`

Typical URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://127.0.0.1:8000`

The existing stack includes React, Vite, FastAPI, SQLAlchemy and PostgreSQL. Inspect the uploaded project to confirm the actual versions and configuration before changing dependencies.

## Final Instruction

Start by extracting and inspecting the uploaded ZIP. Trace the complete existing flow from student authentication to face registration, camera capture, backend verification, attendance-session validation and database insertion.

Identify the actual root cause before editing any files. Make the necessary changes directly in the existing project where supported, preserve all working features, and test the implementation.

**Do not merely provide suggestions or sample code. Implement the actual feature, verify what can be verified, and return a corrected project ZIP if possible. Explain the steps in simple Hinglish because I am a beginner.**
