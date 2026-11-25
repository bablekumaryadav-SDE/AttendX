import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { completeAccountActivation } from "../../services/accountActivation.js";

function readActivationToken() {
  const fragment = window.location.hash.slice(1);
  const params = new URLSearchParams(fragment);
  const token = params.get("token") || "";
  // Remove the one-time token from the address bar and browser history entry.
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return token;
}

export default function AccountActivationPage() {
  const token = useMemo(readActivationToken, []);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const confirmation = String(form.get("confirmation") || "");
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    if (!token) {
      setError("This activation link is missing or invalid. Ask your College administrator to resend it.");
      return;
    }
    setBusy(true);
    try {
      await completeAccountActivation(token, password);
      setComplete(true);
      event.currentTarget.reset();
    } catch (failure) {
      setError(failure.response?.data?.detail || "Account activation could not be completed. Request a new invitation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page" aria-labelledby="activation-title">
      <section className="auth-card">
        <h1 id="activation-title">Set up your AttendX account</h1>
        {complete ? (
          <div role="status"><p>Your account is active. You can now sign in.</p><Link to="/login">Go to sign in</Link></div>
        ) : (
          <>
            <p>Choose a password to finish activating your account.</p>
            {!token && <div role="alert">This activation link is missing or invalid. Ask your College administrator to resend it.</div>}
            {error && <div role="alert">{error}</div>}
            <form onSubmit={submit}>
              <label>Password<input name="password" type="password" autoComplete="new-password" minLength="12" maxLength="72" required /></label>
              <label>Confirm password<input name="confirmation" type="password" autoComplete="new-password" minLength="12" maxLength="72" required /></label>
              <p>Use at least 12 characters with uppercase and lowercase letters, a number, and a symbol.</p>
              <button type="submit" disabled={busy || !token}>{busy ? "Activating…" : "Set password and activate"}</button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
