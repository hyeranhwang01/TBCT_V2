"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { ArrowLeft, BookOpenCheck, Home, LifeBuoy, MessageCircle, NotebookTabs, UserRound, Wrench } from "lucide-react";
import { motion } from "framer-motion";
import { useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/shared/components/ui/primitives";
import { LocaleToggle } from "@/shared/components/ui/locale-toggle";
import { useT } from "@/shared/i18n/context";
import { useDevMode } from "@/shared/dev-mode/dev-mode";
import { useAuth } from "@/shared/auth/auth-context";
import { getOrCreateParticipantForUiLocale } from "@/shared/api/participant-api";
import { applyPatientLocaleChange } from "@/patient/lib/api/patient-locale-sync";
import { fadeUp } from "@/shared/motion/motion-variants";
import { useReducedMotionPreference } from "@/shared/motion/use-reduced-motion-preference";
import { BrandMark, PageHero, ProgressBar, StatusPill } from "@/patient/components/ui/kit";
import { useTextScale } from "@/patient/lib/text-scale";
import { cn } from "@/shared/utils";

const PRETENDARD_CSS = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";
const BASE = "/projects/demo/patient";
// Every round control in the top bar shares one size and style.
const headerIconClass = "transition-ui inline-flex h-10 w-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover hover:text-text-primary [&_svg]:h-[19px] [&_svg]:w-[19px]";

type NavItem = { href: string; label: string; icon: ReactNode; match: (pathname: string) => boolean; tourId?: string;
  /** Shown as the round profile button at the right end of the desktop top
   * bar rather than as a text link. */
  desktopAside?: boolean };

function useNavItems(): NavItem[] {
  const { t } = useT();
  return [
    { href: BASE, label: t("patientUi.nav.home"), icon: <Home />, match: (p) => p === BASE || p === `${BASE}/` },
    { href: `${BASE}/history`, label: t("patientUi.nav.sessions"), icon: <BookOpenCheck />, match: (p) => p.includes("/patient/history") || p.includes("/patient/sessions/") },
    { href: `${BASE}/homework`, label: t("patientUi.nav.homework"), icon: <NotebookTabs />, match: (p) => p.includes("/patient/homework") },
    { href: `${BASE}/messages`, label: t("patientUi.nav.messages"), icon: <MessageCircle />, match: (p) => p.includes("/patient/messages"), tourId: "messages-link" },
    { href: `${BASE}/profile`, label: t("patientUi.nav.me"), icon: <UserRound />, match: (p) => p.includes("/patient/profile") || p.includes("/patient/checkin"), tourId: "profile-link", desktopAside: true },
  ];
}

/** Logout with the same confirmation step the old header had; used by the
 * profile page. */
export function useLogoutConfirm() {
  const { t } = useT();
  const router = useRouter();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const isKo = t("auth.logout") === "로그아웃";
  const dialog = (
    <ConfirmActionDialog
      open={open}
      onClose={() => setOpen(false)}
      onConfirm={async () => {
        setOpen(false);
        await signOut();
        router.push("/patient/login");
      }}
      title={isKo ? "로그아웃하시겠습니까?" : "Log out?"}
      description={isKo ? "진행 내용은 저장되며 로그인 화면으로 이동합니다." : "Your progress is saved and you will return to sign in."}
      confirmLabel={t("auth.logout")}
    />
  );
  return { openLogout: () => setOpen(true), logoutDialog: dialog };
}

export function PatientShell({
  title,
  eyebrow,
  description,
  sessionLabel,
  progressLabel,
  progressPercent,
  saveState,
  children,
  actions,
  hideHeader = false,
  immersive = false,
  backHref,
}: {
  title: string;
  /** Small line above the title. */
  eyebrow?: string;
  description?: ReactNode;
  /** Legacy badge props -- still passed by the per-session homework screens. */
  sessionLabel?: string;
  progressLabel?: string;
  progressPercent?: number;
  saveState?: string;
  children: ReactNode;
  actions?: ReactNode;
  /** The page draws its own heading. */
  hideHeader?: boolean;
  /** Full-height screen with its own header (the session chat): no page
   * padding, no mobile top/bottom bars. */
  immersive?: boolean;
  backHref?: string;
}) {
  const { t, locale } = useT();
  const pathname = usePathname();
  const textScale = useTextScale();
  const reducedMotion = useReducedMotionPreference();
  const { user } = useAuth();
  const devMode = useDevMode();
  const queryClient = useQueryClient();
  const navItems = useNavItems();
  // Same ["runtime-participant", userId] query every patient page mounts --
  // React Query dedupes it; the shell only needs it for the locale sync.
  const participantQuery = useQuery({
    queryKey: ["runtime-participant", user?.id ?? ""],
    queryFn: () => getOrCreateParticipantForUiLocale(user!.id, locale),
    enabled: Boolean(user?.id),
  });
  // The toggle has already switched the UI language by the time the sync
  // below resolves; reading t through a ref makes the toast use the new one.
  const tRef = useRef(t);
  tRef.current = t;
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
          ? tRef.current("patientShell.localeSynced.withSessions", { count: updatedSessionCount })
          : tRef.current("patientShell.localeSynced.profileOnly"),
      );
    } catch {
      // The UI language already switched inside LocaleToggle; only the
      // participant/session sync failed.
      toast.error(tRef.current("patientShell.localeSyncFailed"));
    }
  };

  // The one crisis entry point on every screen size (the onboarding tour
  // points here): a red lifebuoy, with what it does shown on hover/focus.
  const crisisLink = (
    <span className="group relative inline-flex">
      <Link
        href="/crisis"
        target="_blank"
        rel="noopener noreferrer"
        data-tour-id="crisis-help"
        aria-label={`${t("patientUi.shell.help")} - ${t("patientUi.shell.helpCardBody")}`}
        className={cn(headerIconClass, "bg-critical-light text-critical hover:bg-critical/15 hover:text-critical")}
      >
        <LifeBuoy aria-hidden="true" />
      </Link>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-40 mt-2 w-60 translate-y-1 rounded-2xl bg-[#191F28] px-4 py-3 text-left opacity-0 shadow-[var(--pt-shadow-lg)] transition duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
      >
        <span className="block text-[13px] font-bold text-white">{t("patientUi.shell.help")}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-white/75">{t("patientUi.shell.helpCardBody")}</span>
      </span>
    </span>
  );
  const profileItem = navItems.find((item) => item.desktopAside);

  const devToggle = devMode.available && (
    <button
      type="button"
      onClick={devMode.toggle}
      aria-pressed={devMode.enabled}
      title={t("devMode.toggleHint")}
      aria-label={t("devMode.toggleHint")}
      className={cn(
        headerIconClass,
        devMode.enabled && "bg-gold text-[#2a2208] hover:bg-gold hover:text-[#2a2208]",
      )}
    >
      <Wrench aria-hidden="true" />
    </button>
  );

  const legacyBadges = (sessionLabel || saveState || (eyebrow && progressLabel) || progressPercent !== undefined) && (
    <>
      {(sessionLabel || saveState || (eyebrow && progressLabel)) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {sessionLabel && <StatusPill tone="brand">{sessionLabel}</StatusPill>}
          {eyebrow && progressLabel && <StatusPill tone="neutral">{progressLabel}</StatusPill>}
          {saveState && <StatusPill tone="success">{saveState}</StatusPill>}
        </div>
      )}
      {progressPercent !== undefined && (
        <div className="mt-4 max-w-xs">
          <ProgressBar value={progressPercent} />
          <div className="mt-1.5 text-xs text-text-muted">{t("patientShell.sessionProgress", { percent: progressPercent })}</div>
        </div>
      )}
    </>
  );
  const pageHeader = !hideHeader && !immersive && (
    <PageHero
      title={title}
      eyebrow={eyebrow ?? progressLabel}
      description={(description || legacyBadges) ? <>{description}{legacyBadges}</> : undefined}
      actions={actions}
    />
  );

  return (
    <div className="patient-app min-h-dvh bg-canvas text-text-primary">
      <link rel="stylesheet" href={PRETENDARD_CSS} precedence="default" />

      <div className={cn(immersive && "flex h-dvh flex-col")}>
        {/* One top bar for every size: brand and, on desktop, the main menu
            as text links (a web app's global nav, not a chat product's side
            rail). Phones get the bottom tab bar instead. The immersive session
            screen drops it on every size: a counselling session is its own
            room, with its own quiet header (back, help, more). */}
        <header className={cn("sticky top-0 z-20 shrink-0 border-b border-border bg-surface/90 backdrop-blur-md", immersive && "hidden")}>
          <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-3 px-4 pt-[env(safe-area-inset-top)] sm:px-6 lg:px-10">
            <div className="flex min-w-0 items-center gap-2 md:gap-6 lg:gap-10">
              {backHref && (
                <Link href={backHref} className="transition-ui -ml-2 inline-flex h-10 w-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover md:hidden" aria-label={t("patientUi.shell.back")}>
                  <ArrowLeft className="h-5 w-5" />
                </Link>
              )}
              <Link href={BASE} className={cn("items-center gap-2", backHref ? "hidden md:flex" : "flex")}>
                <BrandMark className="h-8 w-8" />
                <span className="text-[17px] font-extrabold tracking-[-0.03em]">TBCT</span>
              </Link>
              <nav className="hidden h-16 items-stretch gap-1 md:flex" aria-label={t("patientUi.nav.label")}>
                {navItems.filter((item) => !item.desktopAside).map((item) => {
                  const active = item.match(pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      data-tour-id={item.tourId}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "transition-ui relative flex items-center px-3.5 text-[15px] font-semibold",
                        active ? "text-text-primary after:absolute after:inset-x-3.5 after:bottom-0 after:h-[3px] after:rounded-full after:bg-brand" : "text-text-muted hover:text-text-primary",
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
            <div className="flex items-center gap-1">
              {devToggle}
              <LocaleToggle onChange={(next) => void handleLocaleChange(next)} className="h-10 gap-1 rounded-full border-transparent bg-transparent px-3 text-[13px] font-bold text-text-secondary hover:bg-surface-hover hover:text-text-primary" />
              {crisisLink}
              {profileItem && (
                <Link
                  href={profileItem.href}
                  data-tour-id={profileItem.tourId}
                  aria-current={profileItem.match(pathname) ? "page" : undefined}
                  title={profileItem.label}
                  aria-label={profileItem.label}
                  className={cn(
                    headerIconClass,
                    "hidden md:inline-flex",
                    profileItem.match(pathname) ? "bg-brand text-white hover:bg-brand-strong hover:text-white" : "bg-surface-hover",
                  )}
                >
                  {profileItem.icon}
                </Link>
              )}
            </div>
          </div>
        </header>

        {devMode.enabled && (
          <div role="status" className="border-b border-gold/40 bg-gold-soft px-4 py-2 text-center text-xs font-semibold text-gold-strong">
            {t("devMode.banner")}
          </div>
        )}

        <main className={cn(immersive ? "min-h-0 flex-1" : "mx-auto max-w-[1280px] px-4 pb-28 pt-6 sm:px-6 sm:pt-8 md:pb-16 lg:px-10")}>
          {/* Every patient page wraps itself in its own shell, so this is the
              one shared place for the page-enter transition. */}
          <motion.div
            key={pathname}
            initial={reducedMotion ? false : "initial"}
            animate={reducedMotion ? undefined : "animate"}
            variants={reducedMotion ? undefined : fadeUp}
            className={cn(immersive && "h-full")}
            // The immersive session screen scales its own conversation column
            // instead, so its header and worksheet keep their size.
            style={immersive ? undefined : { zoom: textScale }}
          >
            {pageHeader}
            {/* Positioned so the page content paints above the hero's
                backdrop, which can reach below the title. */}
            <div className={cn("relative", immersive && "h-full")}>{children}</div>
          </motion.div>
          {!immersive && (
            <footer className="mt-14 flex flex-col gap-1 border-t border-border pt-5 text-xs text-text-muted sm:flex-row sm:justify-between">
              <span>{t("patientShell.demoNotice")}</span>
              <span>{t("patientShell.safetyNotice")}</span>
            </footer>
          )}
        </main>
      </div>

      {/* Mobile tab bar */}
      {!immersive && (
        <nav
          aria-label={t("patientUi.nav.label")}
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
        >
          <div className="mx-auto grid h-16 max-w-lg grid-cols-5">
            {navItems.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-tour-id={item.tourId}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 text-[11px] font-semibold [&_svg]:h-[22px] [&_svg]:w-[22px]",
                    active ? "text-brand-ink" : "text-text-muted",
                  )}
                >
                  {item.icon}
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
