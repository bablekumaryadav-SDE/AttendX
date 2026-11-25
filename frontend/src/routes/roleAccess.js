const ROLE_HOME = Object.freeze({
  super_admin: "/platform",
  admin: "/admin",
  college_admin: "/admin",
  teacher: "/teacher",
  student: "/student",
});

export function getProtectedRouteDecision({
  loading,
  isAuthenticated,
  user,
  allowedRoles = [],
}) {
  if (loading) return { type: "loading" };

  if (!isAuthenticated || !user) {
    return { type: "redirect", to: "/login" };
  }

  const role = String(user.role || "").trim().toLowerCase();
  const allowed = allowedRoles.map((item) => String(item).trim().toLowerCase());

  if (allowed.length > 0 && !allowed.includes(role)) {
    return { type: "redirect", to: ROLE_HOME[role] || "/login" };
  }

  return { type: "allow" };
}

export function getRoleHome(role) {
  return ROLE_HOME[String(role || "").trim().toLowerCase()] || "/login";
}
