export const featureGroups = [
  {
    title: "Attendance management",
    features: [
      ["Dynamic QR attendance", "PARTIALLY AVAILABLE", "QR session and attendance code exists in the legacy workflow. Tenant-safe attendance session and write APIs remain disabled."],
      ["Attendance sessions", "PARTIALLY AVAILABLE", "Session workflows are present in source; complete College-scoped session creation is not available."],
      ["Attendance history", "PARTIALLY AVAILABLE", "Selected tenant-scoped attendance and attendance-record read views are available. Legacy routes remain gated."],
      ["Reports and corrections", "PLANNED", "Broader legacy report routes and attendance correction writes are not enabled."],
    ],
  },
  {
    title: "Location verification",
    features: [
      ["GPS/GIS attendance verification", "PARTIALLY AVAILABLE", "Location checks exist in attendance source and tests. They do not establish perfect spoof prevention or a complete tenant workflow."],
      ["Classroom geofence configuration", "PARTIALLY AVAILABLE", "Class location and radius support exists, but tenant-safe configuration writes are not enabled."],
      ["Foreground location use", "NOT VERIFIED", "Location is used in some attendance attempts. Browser/device permission, retention and production behavior have not been verified."],
    ],
  },
  {
    title: "Face verification",
    features: [
      ["Optional face verification", "PARTIALLY AVAILABLE", "Face reference and matching workflows exist in source. Face is not compulsory; privacy and production controls remain incomplete."],
      ["Consent and enrollment", "PARTIALLY AVAILABLE", "Some registration paths include consent handling. A complete tenant enrollment and lifecycle policy is not established."],
      ["Liveness and anti-spoofing", "NOT CONFIGURED", "Liveness detection is not implemented or independently verified."],
    ],
  },
  {
    title: "Academic management",
    features: [
      ["Students, teachers, classes and subjects", "PARTIALLY AVAILABLE", "Selected tenant-scoped read-only views exist. Provisioning and business write routes remain behind default deny."],
      ["Academic structure and timetables", "PLANNED", "A complete academic-session, timetable, lecture and scheduling workflow is not established."],
    ],
  },
  {
    title: "College administration",
    features: [
      ["College-specific administration", "PARTIALLY AVAILABLE", "Membership selection and selected College-scoped reads exist. The tenant ownership migration is DRAFT / NOT APPLIED."],
      ["Role-based access", "PARTIALLY AVAILABLE", "Protected role workspaces and default-deny API rules exist. This does not mean every legacy route is tenant-isolated or enabled."],
      ["College registration, invitations and management", "PARTIALLY AVAILABLE", "Registration and Super Admin review code exists in source, but its migration is DRAFT / NOT APPLIED. Admin activation/invitations and full College management remain unavailable."],
    ],
  },
  {
    title: "Analytics and notifications",
    features: [
      ["Attendance summaries", "PARTIALLY AVAILABLE", "Selected tenant dashboard summary endpoints are enabled; broader analytics and reports remain gated."],
      ["Guardian notifications", "NOT VERIFIED", "Notification source exists, but tenant attribution, provider configuration and successful delivery are not verified."],
    ],
  },
];
