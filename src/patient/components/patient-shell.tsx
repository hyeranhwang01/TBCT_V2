"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { BookOpen, HelpCircle, ListChecks, MessageCircle, Settings, UserRound } from "lucide-react";
import { motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge, Button, ConfirmActionDialog } from "@/shared/components/ui/primitives";
import { LocaleToggle } from "@/shared/components/ui/locale-toggle";
import { Logo } from "@/shared/components/ui/logo";
import { ThemeToggle } from "@/shared/components/ui/theme-toggle";
import { useT } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/auth-context";
import { getOrCreateParticipantForUiLocale } from "@/lib/api/participant-api";
import { applyPatientLocaleChange } from "@/lib/api/patient-locale-sync";
import { fadeUp } from "@/lib/motion/motion-variants";
import { useReducedMotionPreference } from "@/lib/motion/use-reduced-motion-preference";

export function PatientShell({
  title,
  sessionLabel,
  progressLabel,
  progressPercent,
  saveState,
  children,
  actions,
}: {
  title: string;
  sessionLabel?: string;
  progressLabel?: string;
  /** 0-100 -- renders a thin progress bar under the title/badges row (see
   * computeSessionProgress in patient-session-page.tsx). Distinct from
   * progressLabel, which several other patient pages already use for an
   * unrelated status/locale badge -- adding this as its own prop keeps
   * those call sites unaffected. */
  progressPercent?: number;
  saveState?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const { t, locale } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const reducedMotion = useReducedMotionPreference();
  const { user, signOut } = useAuth();
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const queryClient = useQueryClient();
  // Reuses the same ["runtime-participant", userId] query every patient
  // page already mounts -- React Query dedupes the identical key, so this
  // never fires a second network request, it just gives this shared header
  // a handle on the participant record so the language toggle can sync
  // participant.locale + open sessions (see patient-locale-sync.ts), not
  // only the website's own UI chrome text.
  const participantQuery = useQuery({
    queryKey: ["runtime-participant", user?.id ?? ""],
    queryFn: () => getOrCreateParticipantForUiLocale(user!.id, locale),
    enabled: Boolean(user?.id),
  });
  const handleLogout = async () => {
    await signOut();
    router.push("/patient/login");
  };
  const handleLocaleChange = async (next: "ko" | "en") => {
    const participant = participantQuery.data;
    if (!participant) return;
    try {
      const updatedSessionCount = await applyPatientLocaleChange(participant, next);
      await queryClient.invalidateQueries({ queryKey: ["runtime-participant"] });
      await queryClient.invalidateQueries({ queryKey: ["runtime-sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["patient-runtime-session"] });
      toast.success(
        updatedSessionCount > 0
          ? t("patientShell.localeSynced.withSessions", { count: updatedSessionCount })
          : t("patientShell.localeSynced.profileOnly"),
      );
    } catch {
      // Non-critical -- the UI chrome language itself already switched via
      // LocaleToggle's own setLocale call regardless of this promise's
      // outcome, so a failed sync here degrades to "chrome language changed,
      // participant record/sessions didn't" rather than blocking anything.
      toast.error(t("patientShell.localeSyncFailed"));
    }
  };
  return (
    <div className="patient-app min-h-screen overflow-hidden bg-background lg:m-6 lg:flex lg:min-h-[calc(100vh-48px)] lg:rounded-[32px] lg:shadow-[0_24px_70px_rgba(51,70,112,0.16)]">
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <Link href="/projects/demo/patient" className="flex h-[112px] items-center gap-3 border-b border-border px-7">
          <Logo className="h-12 w-12" />
          <div><div className="text-xl font-black tracking-[-0.04em]">TBCT</div><div className="text-xs text-text-secondary">프로그램</div></div>
        </Link>
        <nav className="flex-1 space-y-2 p-5">
          <PatientNavLink href="/projects/demo/patient" active={pathname === "/projects/demo/patient"} icon={<ListChecks className="h-5 w-5" />} label={t("patientShell.sessionList")} />
          <PatientNavLink href="/projects/demo/patient/profile" active={pathname.includes("/profile")} icon={<UserRound className="h-5 w-5" />} label={t("patientPortal.profile")} />
          <PatientNavLink href="/projects/demo/patient/messages" active={pathname.includes("/messages")} icon={<MessageCircle className="h-5 w-5" />} label={t("messages.title")} />
          <PatientNavLink href="/projects/demo/patient/memory" active={pathname.includes("/memory")} icon={<BookOpen className="h-5 w-5" />} label={t("patientPortal.memory")} />
          <div className="my-5 border-t border-border" />
          <PatientNavLink href="/projects/demo/patient/profile" active={false} icon={<Settings className="h-5 w-5" />} label={t("nav.account")} />
        </nav>
        <div className="m-5 rounded-[24px] border border-clinical-blue-light bg-clinical-blue-light/30 p-5 text-center">
          <div className="text-3xl">🫶</div>
          <div className="mt-3 text-sm font-bold">{t("patientShell.crisisHelp")}</div>
          <div className="mt-1 text-xs leading-5 text-text-secondary">언제든지 도움을 드릴게요.</div>
          <Link href="/crisis" target="_blank"><Button variant="secondary" className="mt-4 w-full"><HelpCircle className="h-4 w-4" />도움말 보기</Button></Link>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
      <header className="patient-app-header border-b border-white/30 px-4 pb-5 pt-[calc(1.25rem+env(safe-area-inset-top))] lg:px-8 lg:py-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Logo className="mt-0.5 h-9 w-9 shrink-0 lg:hidden" />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-clinical-blue">{t("patientShell.eyebrow")}</div>
              <h1 className="mt-1 text-xl font-semibold text-text-primary">{title}</h1>
              <div className="mt-2 flex flex-wrap gap-2">
                {sessionLabel && <Badge tone="primary">{sessionLabel}</Badge>}
                {progressLabel && <Badge tone="neutral">{progressLabel}</Badge>}
                {saveState && <Badge tone="success">{saveState}</Badge>}
              </div>
              {progressPercent !== undefined && (
                <div className="mt-3 max-w-xs">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                    <div className="rainbow-fill h-full rounded-full transition-[width] duration-500" style={{ width: `${progressPercent}%` }} />
                  </div>
                  <div className="mt-1 text-[11px] text-text-muted">{t("patientShell.sessionProgress", { percent: progressPercent })}</div>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {user?.email && <span className="hidden max-w-[160px] truncate text-xs text-text-secondary sm:inline">{user.email}</span>}
            <LocaleToggle onChange={(next) => void handleLocaleChange(next)} />
            <span data-tour-id="theme-toggle" className="hidden sm:inline-flex"><ThemeToggle /></span>
            {/* Replays the onboarding tour -- it only ever mounts on the
                session-list page (see patient-list-page.tsx), so this
                button (present on every patient page via this shared shell)
                links there with a flag that page picks up on load. */}
            <Link href="/projects/demo/patient?tour=1">
              <Button size="icon" variant="ghost" title={t("onboarding.replayTour")}>
                <HelpCircle className="h-4 w-4" />
              </Button>
            </Link>
            <span data-tour-id="crisis-help">
              <Link href="/crisis" target="_blank" rel="noopener noreferrer">
                <Button variant="secondary" className="border-critical text-critical hover:bg-critical-light">{t("patientShell.crisisHelp")}</Button>
              </Link>
            </span>
            <Link href="/projects/demo/patient"><Button variant="secondary">{t("patientShell.sessionList")}</Button></Link>
            {actions}
            <Button variant="ghost" onClick={() => setLogoutConfirmOpen(true)}>{t("auth.logout")}</Button>
          </div>
        </div>
      </header>
      <main className="p-4 lg:p-8">
        {/* Every patient page wraps itself in its own <PatientShell> (see
            studio-app.tsx's routing), so this is the one shared place that
            gives every one of them the same subtle enter transition on
            navigation instead of popping in instantly -- matches the same
            treatment on the clinician side (see app-shell.tsx). */}
        <motion.div
          key={pathname}
          initial={reducedMotion ? false : "initial"}
          animate={reducedMotion ? undefined : "animate"}
          variants={reducedMotion ? undefined : fadeUp}
        >
          {children}
        </motion.div>
      </main>
      <footer className="border-t border-border bg-surface px-4 py-3 text-xs text-text-secondary lg:px-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <span>{t("patientShell.demoNotice")}</span>
          <span>{t("patientShell.safetyNotice")}</span>
        </div>
      </footer>
      </div>
      <ConfirmActionDialog
        open={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={() => void handleLogout()}
        title={t("auth.logout") === "로그아웃" ? "로그아웃하시겠습니까?" : "Log out?"}
        description={t("auth.logout") === "로그아웃" ? "진행 내용은 저장되며 로그인 화면으로 이동합니다." : "Your progress is saved and you will return to sign in."}
        confirmLabel={t("auth.logout")}
      />
    </div>
  );
}

function PatientNavLink({ href, active, icon, label }: { href: string; active: boolean; icon: ReactNode; label: string }) {
  return (
    <Link href={href} className={`relative flex items-center gap-3 rounded-panel px-4 py-3 text-sm font-semibold transition ${active ? "bg-clinical-blue-light text-clinical-blue" : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"}`}>
      {active && <span className="rainbow-fill absolute -left-5 h-8 w-1 rounded-r-full" />}
      {icon}<span>{label}</span>
    </Link>
  );
}
