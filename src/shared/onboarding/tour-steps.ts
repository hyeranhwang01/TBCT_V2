export interface TourStep {
  /** Matches a `data-tour-id="..."` attribute somewhere in the current
   * page's DOM. Steps whose target isn't present (e.g. responsive layouts
   * hide some header buttons below sm/lg, like ThemeToggle's own "hidden
   * ... sm:flex") are silently skipped rather than shown pointing at
   * nothing -- see OnboardingTour's resolvedSteps filter. */
  target: string;
  titleKey: string;
  bodyKey: string;
}

// Mounted once, on the patient's landing page (patient-list-page.tsx) --
// every target here is either on that page itself or in PatientShell,
// which wraps it. Kept in the same left-to-right, top-to-bottom order the
// buttons/cards actually appear in, so the tour reads like a natural walk
// across the page instead of jumping around.
export const PATIENT_TOUR_STEPS: TourStep[] = [
  { target: "patient-stats", titleKey: "onboarding.patient.stats.title", bodyKey: "onboarding.patient.stats.body" },
  { target: "mood-checkin", titleKey: "onboarding.patient.moodCheckin.title", bodyKey: "onboarding.patient.moodCheckin.body" },
  { target: "appointments", titleKey: "onboarding.patient.appointments.title", bodyKey: "onboarding.patient.appointments.body" },
  { target: "profile-link", titleKey: "onboarding.patient.profile.title", bodyKey: "onboarding.patient.profile.body" },
  { target: "memory-link", titleKey: "onboarding.patient.memory.title", bodyKey: "onboarding.patient.memory.body" },
  { target: "messages-link", titleKey: "onboarding.patient.messages.title", bodyKey: "onboarding.patient.messages.body" },
  { target: "new-session", titleKey: "onboarding.patient.newSession.title", bodyKey: "onboarding.patient.newSession.body" },
  { target: "theme-toggle", titleKey: "onboarding.patient.themeToggle.title", bodyKey: "onboarding.patient.themeToggle.body" },
  { target: "crisis-help", titleKey: "onboarding.patient.crisisHelp.title", bodyKey: "onboarding.patient.crisisHelp.body" },
];

// Mounted in app-shell.tsx, which wraps every clinician/admin page -- so
// unlike the patient tour, this one always has somewhere to run regardless
// of which page a clinician lands on first after login.
export const CLINICIAN_TOUR_STEPS: TourStep[] = [
  { target: "nav-protocol-editor", titleKey: "onboarding.clinician.protocolEditor.title", bodyKey: "onboarding.clinician.protocolEditor.body" },
  { target: "nav-manual-reflection", titleKey: "onboarding.clinician.manualReflection.title", bodyKey: "onboarding.clinician.manualReflection.body" },
  { target: "nav-patient-monitoring", titleKey: "onboarding.clinician.patientMonitoring.title", bodyKey: "onboarding.clinician.patientMonitoring.body" },
  { target: "command-search", titleKey: "onboarding.clinician.search.title", bodyKey: "onboarding.clinician.search.body" },
  { target: "theme-toggle", titleKey: "onboarding.clinician.themeToggle.title", bodyKey: "onboarding.clinician.themeToggle.body" },
  { target: "help-button", titleKey: "onboarding.clinician.help.title", bodyKey: "onboarding.clinician.help.body" },
];
