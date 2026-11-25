import React from "react";

export default function FeatureUnavailable({ name }) {
  return (
    <main className="feature-unavailable" role="status">
      <span className="page-eyebrow">FEATURE STATUS</span>
      <h1>{name}</h1>
      <p>{name} is not available yet. This area will be enabled after its College-scoped API is reviewed.</p>
    </main>
  );
}
