import React from "react";
import { useLocation } from "react-router-dom";

class WorkspaceErrorBoundaryImpl extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error) {
    if (import.meta.env?.DEV) {
      console.error("AttendX workspace render failed:", error);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <main role="alert" className="app-error-fallback">
          <h1>This page could not be displayed.</h1>
          <p>The page failed while rendering. Refresh to retry, or use the workspace navigation to open another page.</p>
          {import.meta.env?.DEV && this.state.error && (
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

export default function WorkspaceErrorBoundary({ children }) {
  const location = useLocation();
  return (
    <WorkspaceErrorBoundaryImpl key={location.pathname}>
      {children}
    </WorkspaceErrorBoundaryImpl>
  );
}
