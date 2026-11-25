import React from "react";

import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import { AuthProvider, useAuth } from "../context/AuthContext";

import ProtectedRoute from "./ProtectedRoute";
import DashboardLayout from "../layouts/DashboardLayout";
import AuthLayout from "../layouts/AuthLayout";

import LandingPage from "../pages/LandingPage";
import Login from "../pages/auth/Login";
import Dashboard from "../pages/dashboard/Dashboard";

import Students from "../pages/auth/admin/Students";
import Teachers from "../pages/auth/admin/Teachers";
import Classes from "../pages/auth/admin/Classes";

import AttendancePage from "../pages/attendance/AttendancePage";
import ReportsPage from "../pages/reports/ReportsPage";

import StudentDashboard from "../pages/student/StudentDashboard";
import StudentAttendance from "../pages/student/StudentAttendance";

import TeacherDashboard from "../pages/teacher/TeacherDashboard";
import TeacherAttendance from "../pages/teacher/TeacherAttendance";

function AppLoading() {
  return (
    <div className="app-loading">
      <div className="loading-card">
        <strong>AttendX</strong>
        <span>Loading your workspace...</span>
      </div>
    </div>
  );
}

function HomeRoute() {
  const { user, loading, isAuthenticated } = useAuth();

  if (loading) {
    return <AppLoading />;
  }

  if (!isAuthenticated || !user) {
    return <LandingPage />;
  }

  const role = String(user.role || "")
    .trim()
    .toLowerCase();

  if (role === "admin") {
    return <Navigate to="/admin" replace />;
  }

  if (role === "teacher") {
    return <Navigate to="/teacher" replace />;
  }

  if (role === "student") {
    return <Navigate to="/student" replace />;
  }

  return <Navigate to="/login" replace />;
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
        <Route index element={<Dashboard />} />

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

        <Route
          path="attendance"
          element={<AttendancePage />}
        />

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
            <DashboardLayout />
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