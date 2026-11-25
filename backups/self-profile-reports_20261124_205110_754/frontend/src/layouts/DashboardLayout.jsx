
import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
} from "react";
import { Activity, Bell, BookOpen, CalendarCheck, ChevronLeft, ChevronRight, ClipboardList, FileText, GraduationCap, LayoutDashboard, MessagesSquare, Settings, UserRound, Users } from "lucide-react";

import {
  NavLink,
  Outlet,
  useNavigate,
  useLocation,
} from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { getTenantUnreadNotificationCount } from "../services/tenantNotifications";
import { tenantViewKey } from "../services/tenantSelection";
import "./DashboardLayout.css";

const NAV_ICONS = {
  Home: <LayoutDashboard size={18} />,
  Overview: <LayoutDashboard size={18} />,
  Students: <GraduationCap size={18} />,
  Teachers: <Users size={18} />,
  Attendance: <CalendarCheck size={18} />,
  "Attendance & History": <CalendarCheck size={18} />,
  Classes: <Activity size={18} />,
  Subjects: <BookOpen size={18} />,
  "My Subjects": <BookOpen size={18} />,
  "My Classes": <Users size={18} />,
  "Subject Assignments": <ClipboardList size={18} />,
  "Parents & Notifications": <MessagesSquare size={18} />,
  "Reports & Analytics": <FileText size={18} />,
  Settings: <Settings size={18} />,
  Profile: <UserRound size={18} />,
};

function DashboardLayout() {
  const {
    user, logout, loading, collegeMemberships, membershipsLoading,
    membershipsError, reloadMemberships, activeCollegeId, selectCollege,
  } = useAuth();

  const navigate = useNavigate();
  const location = useLocation();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(null);

  const role = String(user?.role || "")
    .trim()
    .toLowerCase();

  useEffect(() => {
    let active = true;
    const loadUnreadCount = async () => {
      if (!activeCollegeId) {
        setUnreadNotifications(null);
        return;
      }
      try {
        const response = await getTenantUnreadNotificationCount(activeCollegeId);
        if (active && Number.isSafeInteger(response?.unread_count)) {
          setUnreadNotifications(response.unread_count);
        }
      } catch {
        if (active) setUnreadNotifications(null);
      }
    };
    const refreshUnreadCount = () => { void loadUnreadCount(); };
    refreshUnreadCount();
    window.addEventListener("attendx:notifications-updated", refreshUnreadCount);
    return () => {
      active = false;
      window.removeEventListener("attendx:notifications-updated", refreshUnreadCount);
    };
  }, [activeCollegeId]);

  // Role-based workspace name
  const roleLabel = useMemo(() => {
    const labels = {
      admin: "Administrator",
      college_admin: "College Admin",
      teacher: "Teacher",
      student: "Student",
    };

    return labels[role] || "User";
  }, [role]);

  // College Admin navigation mirrors the reviewed tenant workspace.
  const navigation = useMemo(() => {
    if (role === "admin" || role === "college_admin") {
      return [
        { label: "Overview", path: "/admin" },
        { label: "Students", path: "/admin/students" },
        { label: "Teachers", path: "/admin/teachers" },
        { label: "Attendance", path: "/admin/attendance" },
        { label: "Classes", path: "/admin/classes" },
        { label: "Subjects", path: "/admin/subjects" },
        { label: "Parents & Notifications", path: "/admin/parents-notifications" },
        { label: "Notifications", path: "/admin/notifications" },
        { label: "Reports & Analytics", path: "/admin/reports" },
        { label: "Settings", path: "/admin/settings" },
      ];
    }
    if (role === "teacher") {
      return [
        { label: "Home", path: "/", icon: "⌂" },
        {
          label: "Overview",
          path: "/teacher",
          icon: "⌂",
        },
        {
          label: "My Classes",
          path: "/teacher#my-classes",
          icon: "C",
        },
        {
          label: "Subject Assignments",
          path: "/teacher#subject-assignments",
          icon: "S",
        },
        {
          label: "My Subjects",
          path: "/teacher#my-subjects",
          icon: "B",
        },
        {
          label: "Attendance",
          path: "/teacher/attendance",
          icon: "✓",
        },
        { label: "Reports", path: "/teacher/reports" },
        { label: "Notifications", path: "/teacher/notifications" },
        { label: "Profile", path: "/teacher/profile" },
      ];
    }

    if (role === "student") {
      return [
        { label: "Home", path: "/", icon: "⌂" },
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
        { label: "Notifications", path: "/student/notifications" },
        { label: "Profile", path: "/student/profile" },
      ];
    }

    return [];
  }, [role]);

  // Dynamic heading changes when the user navigates to another page
  const pageTitle = useMemo(() => {
    const currentPath = location.pathname.replace(/\/+$/, "") || "/";

    if (currentPath === "/teacher" && location.hash === "#subject-assignments") return "Subject Assignments";
    if (currentPath === "/teacher" && location.hash === "#my-subjects") return "My Subjects";

    const currentItem = navigation.find(
      (item) => item.path === currentPath
    );

    if (currentItem) {
      return currentItem.label === "Overview"
        ? (role === "college_admin" || role === "admin" ? "College Overview" : "Dashboard")
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
  }, [navigation, location.pathname, location.hash, role]);

  // Logout
  const handleLogout = useCallback(async () => {
    if (loggingOut) return;

    setLoggingOut(true);

    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      // Keep authentication headers and request metadata out of browser logs.
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
        className={`app-sidebar ${mobileMenuOpen ? "sidebar-open" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
      >
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">AX</div>

          <div className="sidebar-brand-text">
            <strong>AttendX</strong>
            <span>{role === "college_admin" || role === "admin" ? "College Administration" : "Smart Attendance"}</span>
          </div>
          {(role === "college_admin" || role === "admin") && (
            <button
              type="button"
              className="sidebar-collapse-button"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-pressed={sidebarCollapsed}
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
            </button>
          )}
        </div>

        <div className="workspace-label">
          WORKSPACE
        </div>

        {(role === "admin" || role === "college_admin") && (
          <div className="sidebar-admin-profile" aria-label="College administrator profile">
            <div className="sidebar-admin-avatar" aria-hidden="true">{firstLetter}</div>
            <div className="sidebar-admin-copy">
              <strong>{user.name || "Administrator"}</strong>
              <span>{role === "college_admin" ? "College Administrator" : "Administrator"}</span>
            </div>
          </div>
        )}

        <nav
          className="sidebar-nav"
          aria-label="Main navigation"
        >
          {navigation.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              title={sidebarCollapsed ? item.label : undefined}
              end={
                item.path === "/" ||
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
              <span className="nav-icon" aria-hidden="true">{NAV_ICONS[item.label] || <LayoutDashboard size={18} />}</span>
              <span className="sidebar-nav-label">{item.label}</span>
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
            {collegeMemberships.length > 0 && (
              <label className="college-selector">
                <span>College</span>
                <select
                  aria-label="Select College"
                  value={activeCollegeId || ""}
                  onChange={(event) => selectCollege(event.target.value)}
                >
                  {collegeMemberships.length > 1 && <option value="">Choose a College</option>}
                  {collegeMemberships.map((membership) => (
                    <option key={membership.college_id} value={String(membership.college_id)}>
                      {membership.college_name} ({membership.membership_role.replaceAll("_", " ")})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className="notification-button"
              aria-label={unreadNotifications == null ? "Open notifications inbox" : `Open notifications inbox, ${unreadNotifications} unread`}
              title="Open notifications inbox"
              onClick={() => navigate(role === "admin" || role === "college_admin" ? "/admin/notifications" : `/${role}/notifications`)}
            >
              <Bell size={17} />
              {unreadNotifications > 0 && <span className="notification-unread-badge" aria-hidden="true">{unreadNotifications > 99 ? "99+" : unreadNotifications}</span>}
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

        <section className="app-content" key={tenantViewKey(activeCollegeId)}>
          {membershipsLoading ? (
            <div className="loading-card" role="status">Checking your College memberships…</div>
          ) : membershipsError ? (
            <div className="academic-alert" role="alert">
              {membershipsError.message}
              {membershipsError.status === 401 && (
                <button type="button" onClick={handleLogout}>Sign in again</button>
              )}
              <button type="button" onClick={reloadMemberships} disabled={membershipsLoading}>
                {membershipsLoading ? "Checking memberships…" : "Retry membership check"}
              </button>
            </div>
          ) : collegeMemberships.length === 0 ? (
            <div className="academic-alert" role="status">
              No active College membership is linked to this account. Contact your College administrator or Super Admin if you expected workspace access.
              <button type="button" onClick={reloadMemberships} disabled={membershipsLoading}>Check again</button>
            </div>
          ) : !activeCollegeId ? (
            <div className="academic-alert" role="status">
              Select a College from the workspace header to continue.
            </div>
          ) : (
            <Outlet />
          )}
        </section>
      </main>
    </div>
  );
}

export default DashboardLayout;
