import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getProtectedRouteDecision } from "./roleAccess";

export default function ProtectedRoute({
  children,
  allowedRoles = [],
}) {
  const { user, loading, isAuthenticated } = useAuth();
  const location = useLocation();
  const decision = getProtectedRouteDecision({
    user,
    loading,
    isAuthenticated,
    allowedRoles,
  });

  if (decision.type === "loading") {
    return (
      <div className="app-loading">
        <div className="loading-card">
          <strong>AttendX</strong>
          <p>Loading your workspace...</p>
        </div>
      </div>
    );
  }

  if (decision.to === "/login") {
    return (
      <Navigate
        to="/login"
        state={{ from: location }}
        replace
      />
    );
  }

  if (decision.type === "redirect") {
    return (
      <Navigate
        to={decision.to}
        replace
      />
    );
  }

  return children;
}
