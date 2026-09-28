"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoaderCircle } from "lucide-react";
import type { ComponentType } from "react";
import { useAuth } from "@/shared/auth/auth-context";
import { AccessPending } from "@/shared/components/auth/access-pending";

const AssetsPage = dynamic(() => import("@/clinician/pages/protocol-studio/assets-page").then((mod) => mod.AssetsPage), { ssr: false });
const ClinicalAssetRegistrationPage = dynamic(() => import("@/clinician/pages/protocol-studio/clinical-asset-registration-page").then((mod) => mod.ClinicalAssetRegistrationPage), { ssr: false });
const ExtractionPage = dynamic(() => import("@/clinician/pages/protocol-studio/extraction-page").then((mod) => mod.ExtractionPage), { ssr: false });
const ProtocolPage = dynamic(() => import("@/clinician/pages/protocol-studio/protocol-page").then((mod) => mod.ProtocolPage), { ssr: false });
const ProtocolManualReflectionPage = dynamic(() => import("@/clinician/pages/protocol-studio/protocol-manual-reflection-page").then((mod) => mod.ProtocolManualReflectionPage), { ssr: false });
const SafetyPage = dynamic(() => import("@/clinician/pages/protocol-studio/safety-page").then((mod) => mod.SafetyPage), { ssr: false });
const ValidationPage = dynamic(() => import("@/clinician/pages/protocol-studio/validation-page").then((mod) => mod.ValidationPage), { ssr: false });
const AuditPage = dynamic(() => import("@/clinician/pages/protocol-studio/audit-page").then((mod) => mod.AuditPage), { ssr: false });
const SettingsPage = dynamic(() => import("@/clinician/pages/protocol-studio/settings-page").then((mod) => mod.SettingsPage), { ssr: false });
const PatientListPage = dynamic(() => import("@/patient/pages/patient-list-page").then((mod) => mod.PatientListPage), { ssr: false });
const PatientSessionHistoryPage = dynamic(() => import("@/patient/pages/patient-session-history-page").then((mod) => mod.PatientSessionHistoryPage), { ssr: false });
const PatientMonitoringListPage = dynamic(() => import("@/clinician/pages/monitoring/patient-list-page").then((mod) => mod.PatientListPage), { ssr: false });
const DataDashboardPage = dynamic(() => import("@/clinician/pages/monitoring/data-dashboard-page").then((mod) => mod.DataDashboardPage), { ssr: false });
const PatientMonitoringDetailPage = dynamic(() => import("@/clinician/pages/monitoring/patient-detail-page").then((mod) => mod.PatientMonitoringDetailPage), { ssr: false });
const AdminUsersPage = dynamic(() => import("@/clinician/pages/admin/users-page").then((mod) => mod.AdminUsersPage), { ssr: false });
const AdminDeletionRequestsPage = dynamic(() => import("@/clinician/pages/admin/deletion-requests-page").then((mod) => mod.AdminDeletionRequestsPage), { ssr: false });
const PatientSessionReportPage = dynamic(() => import("@/clinician/pages/monitoring/patient-session-report-page").then((mod) => mod.PatientSessionReportPage), { ssr: false });
const ClinicianAccountPage = dynamic(() => import("@/clinician/pages/account/clinician-account-page").then((mod) => mod.ClinicianAccountPage), { ssr: false });
const PatientNewSessionPage = dynamic(() => import("@/patient/pages/patient-new-session-page").then((mod) => mod.PatientNewSessionPage), { ssr: false });
const PatientSessionPage = dynamic(() => import("@/patient/pages/patient-session-page").then((mod) => mod.PatientSessionPage), { ssr: false });
const PatientSessionCompletePage = dynamic(() => import("@/patient/pages/patient-session-complete-page").then((mod) => mod.PatientSessionCompletePage), { ssr: false });
const HomeworkPage = dynamic(() => import("@/patient/pages/homework-page").then((mod) => mod.HomeworkPage), { ssr: false });
const HomeworkListPage = dynamic(() => import("@/patient/pages/homework-list-page").then((mod) => mod.HomeworkListPage), { ssr: false });
const PatientProfilePage = dynamic(() => import("@/patient/pages/patient-profile-page").then((mod) => mod.PatientProfilePage), { ssr: false });
const PatientCheckinPage = dynamic(() => import("@/patient/pages/patient-checkin-page").then((mod) => mod.PatientCheckinPage), { ssr: false });
const PatientMessagesPage = dynamic(() => import("@/patient/pages/patient-messages-page").then((mod) => mod.PatientMessagesPage), { ssr: false });
const ClinicianAuthPage = dynamic(() => import("@/shared/components/auth/clinician-auth-page").then((mod) => mod.ClinicianAuthPage), { ssr: false });
const PatientAuthPage = dynamic(() => import("@/shared/components/auth/patient-auth-page").then((mod) => mod.PatientAuthPage), { ssr: false });
const SetPasswordPage = dynamic(() => import("@/shared/components/auth/set-password-page").then((mod) => mod.SetPasswordPage), { ssr: false });
const CrisisResourcesPage = dynamic(() => import("@/shared/components/crisis-resources-page").then((mod) => mod.CrisisResourcesPage), { ssr: false });
const RuntimeInspectorPage = dynamic(() => import("@/clinician/pages/monitoring/inspector-page").then((mod) => mod.RuntimeInspectorPage), { ssr: false });
const RuntimeEscalationsPage = dynamic(() => import("@/clinician/pages/safety/escalations-page").then((mod) => mod.RuntimeEscalationsPage), { ssr: false });
const RuntimeParticipantPage = dynamic(() => import("@/clinician/pages/monitoring/participant-page").then((mod) => mod.RuntimeParticipantPage), { ssr: false });
const MemoryChunksPage = dynamic(() => import("@/clinician/pages/monitoring/memory-chunks-page").then((mod) => mod.MemoryChunksPage), { ssr: false });
const RuntimeSessionSummaryPage = dynamic(() => import("@/clinician/pages/monitoring/session-summary-page").then((mod) => mod.RuntimeSessionSummaryPage), { ssr: false });
const RuntimeSafetyDashboardPage = dynamic(() => import("@/clinician/pages/safety/dashboard-page").then((mod) => mod.RuntimeSafetyDashboardPage), { ssr: false });
const RuntimeSafetyEventsPage = dynamic(() => import("@/clinician/pages/safety/events-page").then((mod) => mod.RuntimeSafetyEventsPage), { ssr: false });
const RuntimeSafetyEventDetailPage = dynamic(() => import("@/clinician/pages/safety/event-detail-page").then((mod) => mod.RuntimeSafetyEventDetailPage), { ssr: false });
const RuntimeSafetyMyQueuePage = dynamic(() => import("@/clinician/pages/safety/my-queue-page").then((mod) => mod.RuntimeSafetyMyQueuePage), { ssr: false });
const RuntimeSafetyFollowUpsPage = dynamic(() => import("@/clinician/pages/safety/followups-page").then((mod) => mod.RuntimeSafetyFollowUpsPage), { ssr: false });
const RuntimeSafetyNotificationsPage = dynamic(() => import("@/clinician/pages/safety/notifications-page").then((mod) => mod.RuntimeSafetyNotificationsPage), { ssr: false });
const RuntimeSafetyAnalyticsPage = dynamic(() => import("@/clinician/pages/safety/analytics-page").then((mod) => mod.RuntimeSafetyAnalyticsPage), { ssr: false });
const RuntimeSafetyReportDetailPage = dynamic(() => import("@/clinician/pages/safety/report-detail-page").then((mod) => mod.RuntimeSafetyReportDetailPage), { ssr: false });
const RuntimePilotDashboardPage = dynamic(() => import("@/clinician/pages/pilot/dashboard-page").then((mod) => mod.RuntimePilotDashboardPage), { ssr: false });
const RuntimePilotConfigurationPage = dynamic(() => import("@/clinician/pages/pilot/configuration-page").then((mod) => mod.RuntimePilotConfigurationPage), { ssr: false });
const RuntimePilotSitesPage = dynamic(() => import("@/clinician/pages/pilot/sites-page").then((mod) => mod.RuntimePilotSitesPage), { ssr: false });
const RuntimePilotParticipantsPage = dynamic(() => import("@/clinician/pages/pilot/participants-page").then((mod) => mod.RuntimePilotParticipantsPage), { ssr: false });
const RuntimePilotParticipantDetailPage = dynamic(() => import("@/clinician/pages/pilot/participant-detail-page").then((mod) => mod.RuntimePilotParticipantDetailPage), { ssr: false });
const RuntimePilotScreeningPage = dynamic(() => import("@/clinician/pages/pilot/screening-page").then((mod) => mod.RuntimePilotScreeningPage), { ssr: false });
const RuntimePilotEnrollmentPage = dynamic(() => import("@/clinician/pages/pilot/enrollment-page").then((mod) => mod.RuntimePilotEnrollmentPage), { ssr: false });
const RuntimePilotAllocationPage = dynamic(() => import("@/clinician/pages/pilot/allocation-page").then((mod) => mod.RuntimePilotAllocationPage), { ssr: false });
const RuntimePilotSessionsPage = dynamic(() => import("@/clinician/pages/pilot/sessions-page").then((mod) => mod.RuntimePilotSessionsPage), { ssr: false });
const RuntimePilotDeviationsPage = dynamic(() => import("@/clinician/pages/pilot/deviations-page").then((mod) => mod.RuntimePilotDeviationsPage), { ssr: false });
const RuntimePilotOutcomesPage = dynamic(() => import("@/clinician/pages/pilot/outcomes-page").then((mod) => mod.RuntimePilotOutcomesPage), { ssr: false });
const RuntimePilotDataQualityPage = dynamic(() => import("@/clinician/pages/pilot/data-quality-page").then((mod) => mod.RuntimePilotDataQualityPage), { ssr: false });
const RuntimePilotExportsPage = dynamic(() => import("@/clinician/pages/pilot/exports-page").then((mod) => mod.RuntimePilotExportsPage), { ssr: false });
const RuntimePilotReportsPage = dynamic(() => import("@/clinician/pages/pilot/reports-page").then((mod) => mod.RuntimePilotReportsPage), { ssr: false });
const TrialParticipantsPage = dynamic(() => import("@/clinician/pages/trial/participants-page").then((mod) => mod.TrialParticipantsPage), { ssr: false });
const TrialParticipantDetailPage = dynamic(() => import("@/clinician/pages/trial/participant-detail-page").then((mod) => mod.TrialParticipantDetailPage), { ssr: false });
const AssessorWorklistPage = dynamic(() => import("@/clinician/pages/trial/assessor-page").then((mod) => mod.AssessorWorklistPage), { ssr: false });
const TrialSafetyPage = dynamic(() => import("@/clinician/pages/trial/safety-page").then((mod) => mod.TrialSafetyPage), { ssr: false });
const TrialMonitoringPage = dynamic(() => import("@/clinician/pages/trial/monitoring-page").then((mod) => mod.TrialMonitoringPage), { ssr: false });
const PatientStudyPage = dynamic(() => import("@/patient/pages/patient-study-page").then((mod) => mod.PatientStudyPage), { ssr: false });
const RuntimePilotReportDetailPage = dynamic(() => import("@/clinician/pages/pilot/report-detail-page").then((mod) => mod.RuntimePilotReportDetailPage), { ssr: false });

// "trial": the study team (clinician, coordinator, admin); "assessor": the
// blinded outcome assessor (and admin). note2026_09_28_rct_backend.
type Audience = "clinician" | "patient" | "admin" | "public" | "trial" | "assessor";

type StudioRoute = {
  matches: (pathname: string) => boolean;
  Page: ComponentType;
  /** Who's allowed on this route. Omitted = "clinician" (the majority of
   * pages). "public" = no auth required at all (the login/signup pages
   * themselves -- gating those would create a redirect loop). */
  audience?: Audience;
};

const studioRoutes: StudioRoute[] = [
  // Auth pages -- must be checked before the "/patient" substring matchers
  // below, since "/patient/login" and "/patient/signup" both contain
  // "/patient" and would otherwise fall into the patient-portal catch-all.
  { matches: (pathname) => pathname === "/login" || pathname === "/login/", Page: ClinicianAuthPage, audience: "public" },
  { matches: (pathname) => pathname === "/signup" || pathname === "/signup/", Page: ClinicianAuthPage, audience: "public" },
  { matches: (pathname) => pathname.includes("/patient/login"), Page: PatientAuthPage, audience: "public" },
  { matches: (pathname) => pathname.includes("/patient/signup"), Page: PatientAuthPage, audience: "public" },
  // Lands here from an invite/password-reset/signup-confirmation email's
  // final redirect (see set-password-page.tsx) -- must stay public since
  // the visitor isn't authenticated yet when they arrive, only once the
  // page exchanges the email link's code for a session.
  { matches: (pathname) => pathname === "/set-password" || pathname === "/set-password/", Page: SetPasswordPage, audience: "public" },
  // Crisis resources must never sit behind a login wall -- reachable
  // without an account, from every patient-facing page and both auth
  // screens (see patient-shell.tsx / auth-form.tsx).
  { matches: (pathname) => pathname === "/crisis" || pathname === "/crisis/", Page: CrisisResourcesPage, audience: "public" },
  { matches: (pathname) => pathname.includes("/admin/users"), Page: AdminUsersPage, audience: "admin" },
  { matches: (pathname) => pathname.includes("/admin/deletion-requests"), Page: AdminDeletionRequestsPage, audience: "admin" },
  // Clinician-facing Patient Monitoring (caseload list + detail) — must be checked
  // before the generic "/patient" (singular, patient-portal) matchers below.
  // The report route is checked first since it's the more specific path.
  { matches: (pathname) => /^\/patients\/[^/]+\/report\/[^/]+\/?$/.test(pathname), Page: PatientSessionReportPage },
  { matches: (pathname) => pathname === "/account" || pathname === "/account/", Page: ClinicianAccountPage },
  { matches: (pathname) => /^\/patients\/[^/]+\/?$/.test(pathname), Page: PatientMonitoringDetailPage },
  { matches: (pathname) => pathname === "/data-dashboard" || pathname === "/data-dashboard/", Page: DataDashboardPage },
  { matches: (pathname) => pathname === "/patients" || pathname === "/patients/", Page: PatientMonitoringListPage },
  { matches: (pathname) => pathname.includes("/patient/profile"), Page: PatientProfilePage, audience: "patient" },
  { matches: (pathname) => pathname.includes("/patient/study"), Page: PatientStudyPage, audience: "patient" },
  { matches: (pathname) => pathname.includes("/patient/checkin"), Page: PatientCheckinPage, audience: "patient" },
  { matches: (pathname) => pathname.includes("/patient/messages"), Page: PatientMessagesPage, audience: "patient" },
  { matches: (pathname) => pathname.includes("/patient/history"), Page: PatientSessionHistoryPage, audience: "patient" },
  { matches: (pathname) => pathname.includes("/patient/sessions/new"), Page: PatientNewSessionPage, audience: "patient" },
  { matches: (pathname) => pathname.includes("/patient/homework/"), Page: HomeworkPage, audience: "patient" },
  // Checked after the detail route above, so "/patient/homework/{id}" keeps
  // winning and only the bare "/patient/homework" reaches the list.
  { matches: (pathname) => pathname.includes("/patient/homework"), Page: HomeworkListPage, audience: "patient" },
  { matches: (pathname) => pathname.includes("/patient/sessions/") && pathname.endsWith("/complete"), Page: PatientSessionCompletePage, audience: "patient" },
  { matches: (pathname) => pathname.includes("/patient/sessions/"), Page: PatientSessionPage, audience: "patient" },
  { matches: (pathname) => pathname.includes("/patient"), Page: PatientListPage, audience: "patient" },
  // The trial (Postgres, /api/trial/store). The /runtime/pilot pages below
  // are the old browser-only demo and are left to admins for reference.
  { matches: (pathname) => pathname.startsWith("/trial/participants/"), Page: TrialParticipantDetailPage, audience: "trial" },
  { matches: (pathname) => pathname.startsWith("/trial/participants"), Page: TrialParticipantsPage, audience: "trial" },
  { matches: (pathname) => pathname.startsWith("/trial/assessments"), Page: AssessorWorklistPage, audience: "assessor" },
  { matches: (pathname) => pathname.startsWith("/trial/safety"), Page: TrialSafetyPage },
  { matches: (pathname) => pathname.startsWith("/trial"), Page: TrialMonitoringPage, audience: "trial" },
  { matches: (pathname) => pathname.includes("/runtime/pilot/participants/"), Page: RuntimePilotParticipantDetailPage, audience: "admin" },
  { matches: (pathname) => pathname.includes("/runtime/pilot/reports/"), Page: RuntimePilotReportDetailPage, audience: "admin" },
  { matches: (pathname) => pathname.includes("/runtime/pilot/configuration"), Page: RuntimePilotConfigurationPage, audience: "admin" },
  { matches: (pathname) => pathname.includes("/runtime/pilot/sites"), Page: RuntimePilotSitesPage, audience: "admin" },
  { matches: (pathname) => pathname.includes("/runtime/pilot/participants"), Page: RuntimePilotParticipantsPage, audience: "admin" },
  { matches: (pathname) => pathname.includes("/runtime/pilot/screening"), Page: RuntimePilotScreeningPage, audience: "admin" },
  { matches: (pathname) => pathname.includes("/runtime/pilot/enrollment"), Page: RuntimePilotEnrollmentPage, audience: "admin" },
  { matches: (pathname) => pathname.includes("/runtime/pilot/allocation"), Page: RuntimePilotAllocationPage, audience: "admin" },
  { matches: (pathname) => pathname.includes("/runtime/pilot/sessions"), Page: RuntimePilotSessionsPage, audience: "admin" },
  { matches: (pathname) => pathname.includes("/runtime/pilot/deviations"), Page: RuntimePilotDeviationsPage, audience: "admin" },
  { matches: (pathname) => pathname.includes("/runtime/pilot/outcomes"), Page: RuntimePilotOutcomesPage, audience: "admin" },
  { matches: (pathname) => pathname.includes("/runtime/pilot/data-quality"), Page: RuntimePilotDataQualityPage, audience: "admin" },
  { matches: (pathname) => pathname.includes("/runtime/pilot/exports"), Page: RuntimePilotExportsPage, audience: "admin" },
  { matches: (pathname) => pathname.includes("/runtime/pilot/reports"), Page: RuntimePilotReportsPage, audience: "admin" },
  { matches: (pathname) => pathname.includes("/runtime/pilot"), Page: RuntimePilotDashboardPage, audience: "admin" },
  { matches: (pathname) => pathname.includes("/runtime/safety/events/"), Page: RuntimeSafetyEventDetailPage },
  { matches: (pathname) => pathname.includes("/runtime/safety/reports/"), Page: RuntimeSafetyReportDetailPage },
  { matches: (pathname) => pathname.includes("/runtime/safety/events"), Page: RuntimeSafetyEventsPage },
  { matches: (pathname) => pathname.includes("/runtime/safety/my-queue"), Page: RuntimeSafetyMyQueuePage },
  { matches: (pathname) => pathname.includes("/runtime/safety/follow-ups"), Page: RuntimeSafetyFollowUpsPage },
  { matches: (pathname) => pathname.includes("/runtime/safety/notifications"), Page: RuntimeSafetyNotificationsPage },
  { matches: (pathname) => pathname.includes("/runtime/safety/analytics"), Page: RuntimeSafetyAnalyticsPage },
  { matches: (pathname) => pathname.includes("/runtime/safety"), Page: RuntimeSafetyDashboardPage },
  // Was the candidate review queue; now the participant's memory chunks
  // (same path, so existing links keep working).
  { matches: (pathname) => pathname.includes("/runtime/memory-review"), Page: MemoryChunksPage },
  { matches: (pathname) => pathname.includes("/runtime/participants/"), Page: RuntimeParticipantPage },
  { matches: (pathname) => pathname.includes("/runtime/sessions/") && pathname.endsWith("/summary"), Page: RuntimeSessionSummaryPage },
  { matches: (pathname) => pathname.includes("/runtime/escalations"), Page: RuntimeEscalationsPage },
  { matches: (pathname) => pathname.includes("/runtime/sessions/"), Page: RuntimeInspectorPage },
  { matches: (pathname) => pathname.includes("/clinical-assets/new"), Page: ClinicalAssetRegistrationPage },
  { matches: (pathname) => pathname.includes("/assets"), Page: AssetsPage },
  { matches: (pathname) => pathname.includes("/extraction"), Page: ExtractionPage },
  { matches: (pathname) => pathname.includes("/manual-reflection"), Page: ProtocolManualReflectionPage },
  { matches: (pathname) => pathname.includes("/canvas"), Page: ProtocolPage },
  { matches: (pathname) => pathname.includes("/safety"), Page: SafetyPage },
  { matches: (pathname) => pathname.includes("/validation"), Page: ValidationPage },
  { matches: (pathname) => pathname.startsWith("/audit"), Page: AuditPage },
  { matches: (pathname) => pathname.startsWith("/settings"), Page: SettingsPage },
];

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <LoaderCircle className="h-6 w-6 animate-spin text-clinical-blue" />
    </div>
  );
}

export function StudioApp() {
  const pathname = usePathname();
  const router = useRouter();
  const { role, loading, user } = useAuth();
  const route = studioRoutes.find(({ matches }) => matches(pathname));
  // The "Protocol Overview" dashboard used to be the fallback for any
  // unmatched path (including "/" and the old "/dashboard" URL). It's been
  // removed outright, so the fallback is now the Protocol Editor -- the
  // clinician's other primary nav destination -- rather than a page that no
  // longer exists.
  const Page = route?.Page ?? ProtocolPage;
  const audience = route?.audience ?? "clinician";
  // Admin is a superset of clinician access (can reach every clinician
  // page, plus admin-only ones) -- there is no separate admin login, so an
  // admin route unauthorized redirect still goes to the clinician "/login".
  const authorized =
    audience === "public" ||
    (audience === "patient" && role === "patient") ||
    (audience === "clinician" && (role === "clinician" || role === "admin")) ||
    (audience === "admin" && role === "admin") ||
    (audience === "trial" && (role === "clinician" || role === "coordinator" || role === "admin")) ||
    (audience === "assessor" && (role === "assessor" || role === "admin"));

  // Signed in but no granted role (a clinician signup awaiting approval):
  // a notice, not a redirect -- sending them to the login page they just
  // came through would loop.
  const signedInWithoutRole = !loading && Boolean(user) && !role;

  useEffect(() => {
    if (loading || audience === "public" || authorized || signedInWithoutRole) return;
    // Coordinators and assessors have no clinician pages: they land on
    // their own instead of being sent back to the login they came from.
    if (role === "coordinator") return router.replace("/trial/participants");
    if (role === "assessor") return router.replace("/trial/assessments");
    router.replace(audience === "patient" ? "/patient/login" : "/login");
  }, [loading, audience, authorized, signedInWithoutRole, role, router]);

  if (audience !== "public" && signedInWithoutRole) return <AccessPending />;
  if (audience !== "public" && (loading || !authorized)) return <FullPageSpinner />;
  return <Page />;
}
