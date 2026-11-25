import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({
  children,
  allowedRoles = [],
}) {
  const { user, loading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="app-loading">
        <div className="loading-card">
          <strong>AttendX</strong>
          <p>Loading your workspace...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <Navigate
        to="/login"
        state={{ from: location }}
        replace
      />
    );
  }

  const role = String(user.role || "")
    .trim()
    .toLowerCase();

  const roles = allowedRoles.map((item) =>
    String(item).trim().toLowerCase()
  );

  if (roles.length > 0 && !roles.includes(role)) {
    const dashboardByRole = {
      admin: "/admin",
      teacher: "/teacher",
      student: "/student",
    };

    return (
      <Navigate
        to={dashboardByRole[role] || "/login"}
        replace
      />
    );
  }

  return children;
}