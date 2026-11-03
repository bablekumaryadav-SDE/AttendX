import React from "react";

import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import { AuthProvider } from "../context/AuthContext";

import ProtectedRoute from "./ProtectedRoute";
import DashboardLayout from "../layouts/DashboardLayout";
import AuthLayout from "../layouts/AuthLayout";

import LandingPage from "../pages/LandingPage";
import Login from "../pages/auth/Login";
import AdminDashboard from "../pages/auth/admin/AdminDashboard";

import Students from "../pages/auth/admin/Students";
import Teachers from "../pages/auth/admin/Teachers";
import Classes from "../pages/auth/admin/Classes";
import AcademicManagement from "../pages/auth/admin/AcademicManagement";
import Notifications from "../pages/auth/admin/Notifications";

import AttendancePage from "../pages/attendance/AttendancePage";
import AttendanceMonitor from "../pages/auth/admin/AttendanceMonitor";
import ReportsPage from "../pages/reports/ReportsPage";

import StudentDashboard from "../pages/student/StudentDashboard";
import StudentAttendance from "../pages/student/StudentAttendance";

import TeacherDashboard from "../pages/teacher/TeacherDashboard";
import TeacherAttendance from "../pages/teacher/TeacherAttendance";

class WorkspaceErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error) {
    console.error("AttendX workspace render failed:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main role="alert" className="app-error-fallback">
          <h1>This page could not be displayed.</h1>
          <p>Refresh the page to try again. If the problem continues, contact your administrator.</p>
          {import.meta.env.DEV && this.state.error && (
            <pre>{String(this.state.error.stack || this.state.error.message || this.state.error)}</pre>
          )}
          <button type="button" onClick={() => window.location.reload()}>
            Refresh page
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}

function HomeRoute() {
  return <LandingPage />;
}

function AppRouteContent() {
  return (
    <Routes>
      <Route
        path="/"
        element={<HomeRoute />}
      />

      <Route
        path="/login"
        element={
          <AuthLayout>
            <Login />
          </AuthLayout>
        }
      />

      {/* Admin workspace */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={["admin"]}>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<AdminDashboard />} />

        <Route
          path="students"
          element={<Students />}
        />

        <Route
          path="teachers"
          element={<Teachers />}
        />

        <Route
          path="classes"
          element={<Classes />}
        />

        <Route path="subjects" element={<AcademicManagement />} />

        <Route path="notifications" element={<Notifications />} />

        <Route
          path="attendance"
          element={<AttendanceMonitor />}
        />

        <Route path="attendance/legacy" element={<AttendancePage />} />

        <Route
          path="reports"
          element={<ReportsPage />}
        />

      </Route>

      {/* Teacher workspace */}
      <Route
        path="/teacher"
        element={
          <ProtectedRoute allowedRoles={["teacher"]}>
            <WorkspaceErrorBoundary>
              <DashboardLayout />
            </WorkspaceErrorBoundary>
          </ProtectedRoute>
        }
      >
        <Route index element={<TeacherDashboard />} />

        <Route
          path="attendance"
          element={<TeacherAttendance />}
        />

        <Route
          path="reports"
          element={<ReportsPage />}
        />

        <Route path="notifications" element={<Notifications />} />

      </Route>

      {/* Student workspace */}
      <Route
        path="/student"
        element={
          <ProtectedRoute allowedRoles={["student"]}>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<StudentDashboard />} />

        <Route
          path="attendance"
          element={<StudentAttendance />}
        />

        <Route path="notifications" element={<Notifications />} />

      </Route>

      <Route
        path="*"
        element={<Navigate to="/" replace />}
      />
    </Routes>
  );
}

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRouteContent />
      </AuthProvider>
    </BrowserRouter>
  );
}
