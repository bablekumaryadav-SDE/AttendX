
import React, {
  useMemo,
  useState,
  useCallback,
} from "react";

import {
  NavLink,
  Outlet,
  useNavigate,
  useLocation,
} from "react-router-dom";

import { useAuth } from "../context/AuthContext";

function DashboardLayout() {
  const { user, logout, loading } = useAuth();

  const navigate = useNavigate();
  const location = useLocation();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const role = String(user?.role || "")
    .trim()
    .toLowerCase();

  // Role-based workspace name
  const roleLabel = useMemo(() => {
    const labels = {
      admin: "Administrator",
      teacher: "Teacher",
      student: "Student",
    };

    return labels[role] || "User";
  }, [role]);

  // Sidebar navigation: only use routes configured in AppRoutes.jsx
  const navigation = useMemo(() => {
    if (role === "admin") {
      return [
        {
          label: "Overview",
          path: "/admin",
          icon: "⌂",
        },
        {
          label: "Attendance",
          path: "/admin/attendance",
          icon: "✓",
        },
        {
          label: "Students",
          path: "/admin/students",
          icon: "◉",
        },
        {
          label: "Teachers",
          path: "/admin/teachers",
          icon: "♙",
        },
        {
          label: "Classes",
          path: "/admin/classes",
          icon: "▦",
        },
        {
          label: "Reports",
          path: "/admin/reports",
          icon: "▤",
        },
      ];
    }

    if (role === "teacher") {
      return [
        {
          label: "Overview",
          path: "/teacher",
          icon: "⌂",
        },
        {
          label: "Attendance",
          path: "/teacher/attendance",
          icon: "✓",
        },
        {
          label: "Reports",
          path: "/teacher/reports",
          icon: "▤",
        },
      ];
    }

    if (role === "student") {
      return [
        {
          label: "Overview",
          path: "/student",
          icon: "⌂",
        },
        {
          label: "Attendance & History",
          path: "/student/attendance",
          icon: "◷",
        },
      ];
    }

    return [];
  }, [role]);

  // Dynamic heading changes when the user navigates to another page
  const pageTitle = useMemo(() => {
    const currentPath = location.pathname.replace(/\/+$/, "") || "/";

    const currentItem = navigation.find(
      (item) => item.path === currentPath
    );

    if (currentItem) {
      return currentItem.label === "Overview"
        ? "Dashboard"
        : currentItem.label;
    }

    // Fallback titles for nested or additional routes
    if (currentPath.endsWith("/attendance")) {
      return "Attendance";
    }

    if (
      currentPath.endsWith("/reports") ||
      currentPath.endsWith("/analytics")
    ) {
      return currentPath.endsWith("/analytics")
        ? "Analytics"
        : "Reports";
    }

    if (currentPath.endsWith("/students")) {
      return "Students";
    }

    if (currentPath.endsWith("/teachers")) {
      return "Teachers";
    }

    if (currentPath.endsWith("/classes")) {
      return "Classes";
    }

    if (
      currentPath.endsWith("/subjects")
    ) {
      return "My Subjects";
    }

    if (currentPath.endsWith("/profile")) {
      return "My Profile";
    }

    if (currentPath.endsWith("/history")) {
      return "Attendance History";
    }

    return "Dashboard";
  }, [navigation, location.pathname]);

  // Logout
  const handleLogout = useCallback(async () => {
    if (loggingOut) return;

    setLoggingOut(true);

    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      setMobileMenuOpen(false);
      setLoggingOut(false);
    }
  }, [logout, navigate, loggingOut]);

  // Close the mobile sidebar
  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  // User avatar initial
  const firstLetter =
    user?.name?.trim()?.charAt(0)?.toUpperCase() ||
    user?.email?.charAt(0)?.toUpperCase() ||
    "U";

  if (loading) {
    return (
      <div className="app-loading">
        <div className="loading-card">
          <strong>AttendX</strong>
          <span>Loading your workspace...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="app-shell">
      {/* Mobile sidebar overlay */}
      {mobileMenuOpen && (
        <button
          className="sidebar-overlay"
          type="button"
          aria-label="Close menu"
          onClick={closeMobileMenu}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`app-sidebar ${
          mobileMenuOpen ? "sidebar-open" : ""
        }`}
      >
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">AX</div>

          <div className="sidebar-brand-text">
            <strong>AttendX</strong>
            <span>Smart Attendance</span>
          </div>
        </div>

        <div className="workspace-label">
          WORKSPACE
        </div>

        <nav
          className="sidebar-nav"
          aria-label="Main navigation"
        >
          {navigation.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={
                item.label === "Overview" ||
                item.path === `/${role}`
              }
              onClick={closeMobileMenu}
              className={({ isActive }) =>
                `sidebar-nav-item ${
                  isActive ? "active" : ""
                }`
              }
            >
              <span
                className="nav-icon"
                aria-hidden="true"
              >
                {item.icon}
              </span>

              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Sidebar bottom section */}
        <div className="sidebar-bottom">
          <div className="sidebar-help">
            <div
              className="help-icon"
              aria-hidden="true"
            >
              ?
            </div>

            <div>
              <strong>Need help?</strong>
              <span>Contact your administrator</span>
            </div>
          </div>

          <button
            type="button"
            className="logout-button"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <span aria-hidden="true">↪</span>

            {loggingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="app-main">
        <header className="app-header">
          <div className="header-left">
            <button
              type="button"
              className="mobile-menu-button"
              onClick={() =>
                setMobileMenuOpen((open) => !open)
              }
              aria-label={
                mobileMenuOpen
                  ? "Close menu"
                  : "Open menu"
              }
              aria-expanded={mobileMenuOpen}
            >
              ☰
            </button>

            <div>
              <span className="header-kicker">
                {roleLabel.toUpperCase()} WORKSPACE
              </span>

              {/* Dynamic page heading */}
              <h1>{pageTitle}</h1>
            </div>
          </div>

          <div className="header-right">
            <button
              type="button"
              className="notification-button"
              aria-label="Notifications"
              title="Notifications"
              onClick={() =>
                navigate(`/${role}/notifications`)
              }
            >
              ♢
              <span className="notification-dot" />
            </button>

            <div className="header-divider" />

            <div className="user-menu">
              <div className="user-avatar">
                {firstLetter}
              </div>

              <div className="user-info">
                <strong>
                  {user.name || roleLabel}
                </strong>

                <span>
                  {user.email || "Account"}
                </span>
              </div>
            </div>
          </div>
        </header>

        <section className="app-content">
          <Outlet />
        </section>
      </main>
    </div>
  );
}

export default DashboardLayout;
