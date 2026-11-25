import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();

    if (loading) return;

    setError("");
    setLoading(true);

    try {
      const currentUser = await login(email, password);
      const role = String(currentUser?.role || "")
        .trim()
        .toLowerCase();

      if (role === "admin") {
        navigate("/admin", { replace: true });
      } else if (role === "teacher") {
        navigate("/teacher", { replace: true });
      } else if (role === "student") {
        navigate("/student", { replace: true });
      } else {
        throw new Error(
          "Account role valid nahi hai. Administrator se sampark karein."
        );
      }
    } catch (err) {
      console.error("AttendX login failed:", err);

      const detail = err?.response?.data?.detail;

      if (typeof detail === "string") {
        setError(detail);
      } else if (Array.isArray(detail)) {
        setError(
          detail.map((item) => item.msg || "Invalid input").join(", ")
        );
      } else if (err?.message) {
        setError(err.message);
      } else {
        setError(
          "Login fail hua. Backend, API URL aur credentials check karein."
        );
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrapper">
      <div className="mobile-brand">
        <div className="brand-mark small">
          <span>AX</span>
        </div>
        <span>ATTENDX</span>
      </div>

      <div className="login-card">
        <div className="login-header">
          <div className="eyebrow">WELCOME BACK</div>
          <h2>Sign in to AttendX</h2>
          <p>
            Access your attendance dashboard and academic workspace.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <div className="password-label">
              <label htmlFor="password">Password</label>
              <button
                type="button"
                className="forgot-button"
                onClick={() =>
                  setError(
                    "Password recovery abhi configure nahi hai."
                  )
                }
                disabled={loading}
              >
                Forgot password?
              </button>
            </div>

            <div className="password-input">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={loading}
                required
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() =>
                  setShowPassword((previous) => !previous)
                }
                aria-label={
                  showPassword ? "Hide password" : "Show password"
                }
                disabled={loading}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div className="remember-row">
            <label className="remember-option">
              <input type="checkbox" disabled={loading} />
              <span>Remember me</span>
            </label>
          </div>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="login-button"
            disabled={loading}
          >
            {loading ? "Signing in..." : "Sign in"}
            {!loading && <span>→</span>}
          </button>
        </form>

        <div className="login-divider">
          <span>SECURE ACCESS</span>
        </div>

        <p className="login-security">
          Your account access is protected by AttendX
          authentication and role-based authorization.
        </p>
      </div>
    </div>
  );
}
