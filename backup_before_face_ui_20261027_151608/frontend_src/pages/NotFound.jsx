import React from "react";
import { Link } from "react-router-dom";

function NotFound() {
  return (
    <div className="not-found-page">
      <div className="not-found-card">
        <div className="not-found-code">404</div>

        <h1>Page not found</h1>

        <p>
          The page you're looking for doesn't exist or may have been moved.
        </p>

        <Link to="/login" className="back-home-button">
          Back to AttendX
          <span>→</span>
        </Link>
      </div>
    </div>
  );
}

export default NotFound;