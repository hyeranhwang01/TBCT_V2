"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  BookOpen,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ClipboardCheck,
  FileStack,
  Globe,
  HelpCircle,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button, ConfirmActionDialog, Modal, Tooltip, inputClass } from "@/shared/components/ui/primitives";
import { Logo } from "@/shared/components/ui/logo";
import { ThemeToggle } from "@/shared/components/ui/theme-toggle";
import { OnboardingTour } from "@/shared/components/onboarding/onboarding-tour";
import { getCurrentDemoActor } from "@/lib/demo-actor";
import { useAuth } from "@/lib/auth/auth-context";
import { useT } from "@/lib/i18n/context";
import type { UiLocale } from "@/lib/i18n/locales";
import { pageEnter } from "@/lib/motion/motion-variants";
import { motionDuration } from "@/lib/motion/motion-tokens";
import { useReducedMotionPreference } from "@/lib/motion/use-reduced-motion-preference";
import { CLINICIAN_TOUR_STEPS } from "@/lib/onboarding/tour-steps";
import { useOnboardingTour } from "@/lib/onboarding/use-onboarding-tour";
import { cn } from "@/lib/utils";
import { useStudioStore } from "@/stores/studio-store";

type Audience = "clinician" | "internal" | "admin";

interface NavItem {
  labelKey: string;
  href: string;
  icon: typeof Boxes;
  audience: Audience;
}

const NAV_ITEMS: NavItem[] = [
  // Clinician-facing primary navigation.
  { labelKey: "nav.protocolEditor", href: "/projects/demo/protocols/tbct-br-001/canvas", icon: Boxes, audience: "clinician" },
  { labelKey: "nav.manualReflection", href: "/projects/demo/protocols/tbct-br-001/manual-reflection", icon: BookOpen, audience: "clinician" },
  { labelKey: "nav.patientMonitoring", href: "/patients", icon: Users, audience: "clinician" },
  // Admin-only -- filtered by the real logged-in user's auth role
  // (see visibleNavItems below), independent of the legacy
  // isClinicianAudience/showFullNav toggle above, which is about the old
  // demo-actor picker, not real Supabase Auth roles.
  { labelKey: "nav.adminUsers", href: "/admin/users", icon: ShieldCheck, audience: "admin" },
  { labelKey: "nav.adminDeletionRequests", href: "/admin/deletion-requests", icon: ClipboardCheck, audience: "admin" },
  // Reuses the existing /audit page as-is (Protocol Studio content-change
  // history) -- just makes it discoverable for admin specifically, on top
  // of the direct-URL access clinicians already have via its default
  // "clinician" audience below.
  { labelKey: "nav.auditLog", href: "/audit", icon: ClipboardCheck, audience: "admin" },
  // Internal/engineering routes: still implemented and reachable by direct URL,
  // just hidden from the standard clinician sidebar and command palette.
  // The old "Overview" dashboard was removed entirely (studio-app.tsx now
  // falls back to the Protocol Editor for any unmatched path, including the
  // old "/dashboard" URL) rather than kept as a hidden internal route --
  // unlike the routes below, it had no unique content worth preserving
  // behind a direct link once its own page component was deleted.
  { labelKey: "Clinical Assets", href: "/projects/demo/assets", icon: FileStack, audience: "internal" },
  { labelKey: "Extraction Review", href: "/projects/demo/extraction", icon: Sparkles, audience: "internal" },
  { labelKey: "Safety Rules", href: "/projects/demo/protocols/tbct-br-001/safety", icon: ShieldCheck, audience: "internal" },
  { labelKey: "Validation", href: "/projects/demo/protocols/tbct-br-001/validation", icon: CheckCircle2, audience: "internal" },
  { labelKey: "Audit Log (internal)", href: "/audit", icon: ClipboardCheck, audience: "internal" },
  { labelKey: "Settings", href: "/settings", icon: Settings, audience: "internal" },
];

// The standard clinician workspace always shows only the reduced navigation,
// regardless of which demo actor is active — there is no role-based toggle
// back to the full internal menu. Internal/engineering routes stay in the
// codebase and reachable by direct URL, they are just never listed here.
function isClinicianAudience(_role: string) {
  return true;
}

function isActive(pathname: string, href: string) {
  return pathname.startsWith(href);
}

// data-tour-id anchors for CLINICIAN_TOUR_STEPS (tour-steps.ts) -- only the
// two primary nav items are part of the tour, everything else gets no
// attribute (querySelector on it just never matches).
function tourIdForNavItem(item: NavItem): string | undefined {
  if (item.href.includes("/canvas")) return "nav-protocol-editor";
  if (item.href.includes("/manual-reflection")) return "nav-manual-reflection";
  if (item.href === "/patients") return "nav-patient-monitoring";
  return undefined;
}

function buildBreadcrumb(pathname: string) {
  const tokens = pathname.split("/").filter(Boolean);
  if (!tokens.length) return ["Protocol Editor"];
  return tokens
    .map((token) => token.replaceAll("-", " "))
    .map((token) => token.replace(/\b\w/g, (char) => char.toUpperCase()));
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const commandOpen = useStudioStore((state) => state.commandOpen);
  const setCommandOpen = useStudioStore((state) => state.setCommandOpen);
  const unsaved = useStudioStore((state) => state.unsaved);
  const activeActorRole = useStudioStore((state) => state.activeActorRole);
  const setActiveActor = useStudioStore((state) => state.setActiveActor);
  const { locale, setLocale, t } = useT();
  const { user, role, signOut } = useAuth();
  const tour = useOnboardingTour("clinician");
  const reducedMotion = useReducedMotionPreference();
  const handleLogout = async () => {
    await signOut();
    router.push("/login");
  };
  const identityInitials = (user?.email ?? "??").slice(0, 2).toUpperCase();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setCommandOpen]);

  useEffect(() => {
    const actor = getCurrentDemoActor();
    setActiveActor(actor.id);
  }, [setActiveActor]);

  const breadcrumbs = useMemo(() => buildBreadcrumb(pathname), [pathname]);
  const sidebarWidth = collapsed ? "lg:pl-[116px]" : "lg:pl-[272px]";
  const showFullNav = !isClinicianAudience(activeActorRole);
  const visibleNavItems = useMemo(
    () =>
      NAV_ITEMS.filter((item) => {
        if (item.audience === "admin") return role === "admin";
        return showFullNav || item.audience === "clinician";
      }),
    [showFullNav, role],
  );
  const navLabel = (item: NavItem) => (item.labelKey.startsWith("nav.") ? t(item.labelKey) : item.labelKey);
  const clinicianNavItems = useMemo(() => NAV_ITEMS.filter((item) => item.audience === "clinician"), []);

  return (
    <div className="clinician-app h-dvh overflow-hidden bg-background">
      <aside
        className={cn(
          "app-sidebar fixed inset-y-0 left-0 z-50 flex border-r border-border bg-surface text-text-primary shadow-xl transition-all duration-200 lg:bottom-6 lg:left-6 lg:top-6 lg:translate-x-0 lg:rounded-l-[32px] lg:shadow-none",
          collapsed ? "w-[92px]" : "w-[248px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex w-full flex-col">
          <div className="flex h-[68px] items-center justify-between gap-2 border-b border-white/10 px-4">
            <Link href="/projects/demo/protocols/tbct-br-001/canvas" className="flex min-w-0 flex-1 items-center gap-3">
              <Logo className="h-10 w-10 shrink-0" />
              {!collapsed && (
                <span className="min-w-0 overflow-hidden whitespace-nowrap">
                  <span className="block truncate whitespace-nowrap text-sm font-semibold">TBCT Studio</span>
                  <span className="block text-[11px] text-blue-100">Medical Research × AI Engineering</span>
                </span>
              )}
            </Link>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="text-white hover:bg-white/10 hover:text-white lg:inline-flex"
                onClick={() => setCollapsed((value) => !value)}
              >
                {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-white hover:bg-white/10 hover:text-white lg:hidden"
                onClick={() => setMobileOpen(false)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {!collapsed && (
            <div className="border-b border-white/10 px-4 py-4">
              <div className="app-sidebar-project rounded-panel border border-border bg-surface-subtle p-3">
                <div className="flex items-center gap-3">
                  <span className="rainbow-fill flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-md">{identityInitials}</span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-text-primary">{user?.email?.split("@")[0] ?? "Clinician"}</div>
                    <div className="truncate text-[11px] text-text-secondary">{role ?? "clinician"}</div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">Workspace</div>
                    <div className="mt-1 text-xs font-semibold">TBCT-BR-001</div>
                  </div>
                  <span className="rounded-full bg-success-light px-2 py-1 text-[10px] font-semibold text-success">Pilot</span>
                </div>
              </div>
            </div>
          )}

          <nav className="flex-1 overflow-auto px-3 py-4">
            <div className="space-y-1">
              {visibleNavItems.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-tour-id={tourIdForNavItem(item)}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "transition-ui group relative flex h-10 items-center gap-3 rounded-panel px-3 text-sm",
                      active ? "bg-clinical-blue-light text-clinical-blue" : "text-blue-100 hover:bg-white/8 hover:text-white",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    {/* Always mounted (not conditionally rendered) so the
                        active indicator transitions in/out via opacity+scale
                        when the current route changes, instead of just
                        popping -- origin-center keeps the scaleY looking
                        like it grows from the middle, not top-anchored. */}
                    <span
                      aria-hidden
                      className={cn(
                        "transition-ui rainbow-fill absolute left-0 top-1/2 h-6 w-[3px] origin-center -translate-y-1/2 rounded-r",
                        active ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0",
                      )}
                    />
                    <item.icon className="transition-ui h-4 w-4 shrink-0 group-hover:scale-[1.04]" />
                    {!collapsed && <span className="transition-ui translate-x-0 truncate group-hover:translate-x-0.5">{navLabel(item)}</span>}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="border-t border-white/10 p-3 space-y-3">
            {!collapsed ? (
              <div className="flex items-center gap-2 rounded-panel border border-white/10 bg-white/5 p-1">
                <Globe className="ml-2 h-3.5 w-3.5 text-blue-100" aria-hidden />
                {(["ko", "en"] as UiLocale[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-label={`${t("nav.language")}: ${option.toUpperCase()}`}
                    onClick={() => setLocale(option)}
                    className={cn(
                      "flex-1 rounded-md px-2 py-1 text-xs font-semibold transition",
                      locale === option ? "bg-white text-navy-900" : "text-blue-100 hover:bg-white/10",
                    )}
                  >
                    {option.toUpperCase()}
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                aria-label={t("nav.language")}
                onClick={() => setLocale(locale === "ko" ? "en" : "ko")}
                className="flex h-9 w-full items-center justify-center rounded-panel border border-white/10 bg-white/5 text-blue-100 hover:bg-white/10"
              >
                <Globe className="h-4 w-4" />
              </button>
            )}
            {!collapsed && (
              <Link href="/account" className="block px-1 text-xs text-blue-100 hover:underline">
                {t("nav.account")}
              </Link>
            )}
            <button
              type="button"
              onClick={() => setLogoutConfirmOpen(true)}
              className={cn("w-full rounded-panel border border-white/10 bg-white/5 p-3 text-left hover:bg-white/10", collapsed && "p-2")}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-clinical-blue-light text-sm font-semibold text-clinical-blue">{identityInitials}</span>
                {!collapsed && (
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{user?.email ?? "—"}</div>
                    <div className="text-xs text-blue-100">{t("auth.logout")}</div>
                  </div>
                )}
              </div>
            </button>
          </div>
        </div>
      </aside>

      {mobileOpen && <button className="fixed inset-0 z-40 bg-[#132A4A]/24 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu" />}

      <div className={cn("app-workspace-shell h-full transition-all lg:mr-6 lg:py-6", sidebarWidth)}>
        {/* flex flex-col + a real height (not min-height) on this element is
            what makes the topbar+main split below actually work: the topbar
            is a shrink-0 flex item and <main> is flex-1 -- <main> gets
            "whatever's left after the topbar" and scrolls internally
            (overflow-y-auto below), instead of this whole shell growing
            past the viewport and leaving the browser page itself to scroll.
            That's also why .app-topbar no longer needs position:sticky: it
            was only ever "sticky" because the page used to scroll around
            it; now nothing outside <main> scrolls at all, so the topbar
            just sits above <main> and never needs to react to a scroll
            position in the first place. See globals.css's
            body:has(.clinician-app) for the matching page-level half of
            this (stops the browser's own scrollbar from ever appearing). */}
        <div className="app-workspace flex h-full min-h-0 flex-col overflow-hidden bg-background lg:h-[calc(100vh-48px)] lg:rounded-r-[32px]">
        <header className="app-topbar shrink-0 flex h-[64px] items-center gap-3 border-b border-border/70 bg-surface/90 px-4 backdrop-blur-xl lg:px-7">
          {/* Mobile (<640px) drops the hamburger entirely -- bottom nav is the
              top-level mobile navigation (see the "sm:hidden" nav below).
              Tablet (640-1024px) keeps today's drawer trigger unchanged, and
              it's already hidden >=1024px (fixed sidebar) same as before. */}
          <Button size="icon" variant="ghost" className="hidden sm:inline-flex lg:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="h-4 w-4" />
          </Button>
          <div className="hidden w-[132px] shrink-0 items-center text-xs text-text-secondary 2xl:flex">
            {breadcrumbs.map((item, index) => (
              <div key={`${item}-${index}`} className={cn("items-center gap-2", index === breadcrumbs.length - 1 ? "flex" : "hidden")}>
                <span className={cn("truncate", index === breadcrumbs.length - 1 && "font-semibold text-text-primary")}>{item}</span>
              </div>
            ))}
          </div>

          <button
            data-tour-id="command-search"
            onClick={() => setCommandOpen(true)}
            className="transition-ui group mx-auto flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-panel border border-border bg-surface-subtle px-3 text-sm text-text-secondary hover:border-border-strong hover:bg-surface focus-visible:border-clinical-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clinical-blue-light md:max-w-[560px] [&>span:last-child]:hidden"
          >
            <Search className="transition-ui h-4 w-4 group-hover:text-clinical-blue group-focus-visible:text-clinical-blue" />
            {/* Same search entry point/scope at every width -- only the label
                text is shorter below 640px so it doesn't clip. */}
            <span className="flex-1 truncate text-left">
              <span className="sm:hidden">Search…</span>
              <span className="hidden sm:inline">Search protocol, assets, or Step ID</span>
            </span>
            <span className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px]">⌘K</span>
          </button>

          <div className="hidden shrink-0 items-center gap-2 2xl:flex">
            <span className="whitespace-nowrap rounded-md border border-border bg-surface-subtle px-2 py-1 text-[11px] text-text-secondary">TBCT-BR-001</span>
            <span className="whitespace-nowrap rounded-md border border-success-light bg-success-light px-2 py-1 text-[11px] text-success">Pilot ready</span>
          </div>

          <SyncStatus unsaved={unsaved} locale={locale} />
          <Tooltip label={locale === "ko" ? "알림" : "Notifications"}>
            <Button size="icon" variant="ghost" className="hidden shrink-0 sm:inline-flex"><Bell className="h-4 w-4" /></Button>
          </Tooltip>
          <Tooltip label={t("onboarding.replayTour")}>
            <Button
              data-tour-id="help-button"
              size="icon"
              variant="ghost"
              className="hidden shrink-0 sm:inline-flex"
              onClick={() => tour.replay()}
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
          </Tooltip>
          <span data-tour-id="theme-toggle" className="hidden shrink-0 sm:flex">
            <ThemeToggle />
          </span>
          <button
            type="button"
            title={t("auth.logout")}
            onClick={() => setLogoutConfirmOpen(true)}
            className="flex shrink-0 items-center gap-2 rounded-panel border border-border bg-surface px-2 py-1.5 hover:bg-surface-hover"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-clinical-blue-light text-xs font-semibold text-clinical-blue">{identityInitials}</span>
            <span className="hidden max-w-[140px] truncate text-xs font-medium text-text-primary 2xl:block">{user?.email ?? "—"}</span>
          </button>
        </header>

        {/* flex-1 min-h-0 overflow-y-auto: this is now THE ONE scroll
            container for every clinician page's content -- the browser
            page itself never scrolls (see .clinician-app/body above), so a
            page whose content runs long just scrolls inside here, still
            fully contained within the rounded shell. Extra bottom
            clearance for the fixed mobile nav below, plus the iOS
            home-indicator safe area on top of that. Unchanged >=640px (no
            bottom nav there). */}
        <main className="app-content min-h-0 flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">
          {/* Every clinician page wraps itself in its own <AppShell> (see
              studio-app.tsx's routing), so this is the one shared place that
              gives every one of them the same subtle enter transition
              instead of popping in instantly -- no per-page edits needed.
              `key={pathname}` re-triggers it on navigation even though in
              practice the whole AppShell instance already remounts too. */}
          <motion.div
            key={pathname}
            initial={reducedMotion ? false : "initial"}
            animate={reducedMotion ? undefined : "animate"}
            variants={reducedMotion ? undefined : pageEnter}
          >
            {children}
          </motion.div>
        </main>
        </div>
      </div>

      {/* Compact bottom navigation for mobile — mirrors the two clinician-facing sidebar entries. */}
      {!showFullNav && (
        <nav className="fixed bottom-[calc(.75rem+env(safe-area-inset-bottom))] left-3 right-3 z-40 flex overflow-hidden rounded-[26px] border border-white/70 bg-surface/90 p-1 shadow-[0_16px_46px_rgba(29,45,75,0.2)] backdrop-blur-xl sm:hidden">
          {clinicianNavItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                data-tour-id={tourIdForNavItem(item)}
                className={cn(
                  "flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px]",
                  active ? "text-clinical-blue" : "text-text-secondary",
                )}
              >
                <item.icon className="h-5 w-5" />
                <span className="truncate">{navLabel(item)}</span>
              </Link>
            );
          })}
        </nav>
      )}
      <ConfirmActionDialog
        open={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={() => void handleLogout()}
        title={locale === "ko" ? "로그아웃하시겠습니까?" : "Log out?"}
        description={locale === "ko" ? "현재 계정에서 안전하게 로그아웃합니다." : "You will be signed out of this account."}
        confirmLabel={locale === "ko" ? "로그아웃" : "Log out"}
      />

      <Modal open={commandOpen} onClose={() => setCommandOpen(false)} title="Quick Navigation" description="Jump pages, search Step IDs, and run key actions">
        <div className="p-4">
          <div className="flex items-center gap-2 rounded-panel border border-border bg-surface-subtle px-3">
            <Search className="h-4 w-4 text-text-secondary" />
            <input autoFocus className={cn(inputClass, "border-0 bg-transparent px-0 focus:ring-0")} placeholder="e.g. STEP-07, Validation, Session 03" />
          </div>
          <div className="mt-4 grid gap-2">
            {visibleNavItems.map((item) => (
              <Link key={item.href} href={item.href} onClick={() => setCommandOpen(false)} className="flex items-center gap-3 rounded-panel border border-transparent px-3 py-3 hover:border-border hover:bg-surface-subtle">
                <item.icon className="h-4 w-4 text-clinical-blue" />
                <span className="text-sm text-text-primary">{navLabel(item)}</span>
              </Link>
            ))}
          </div>
        </div>
      </Modal>

      <OnboardingTour steps={CLINICIAN_TOUR_STEPS} active={tour.active} onDone={tour.finish} />
    </div>
  );
}

/** Topbar's "Synced .../Unsaved changes" indicator -- a one-shot crossfade
 * between the two states instead of a hard swap, no continuous animation
 * (there's no real in-flight "syncing" state tracked yet, just this
 * boolean, so there's nothing to spin/pulse in between). */
function SyncStatus({ unsaved, locale }: { unsaved: boolean; locale: string }) {
  const reducedMotion = useReducedMotionPreference();
  return (
    <div className="relative hidden h-4 shrink-0 2xl:block">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={unsaved ? "unsaved" : "synced"}
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reducedMotion ? undefined : { opacity: 0 }}
          transition={{ duration: motionDuration.fast }}
          className={cn("flex items-center gap-1 whitespace-nowrap text-xs", unsaved ? "text-warning" : "text-text-secondary")}
        >
          {unsaved ? (
            locale === "ko" ? "저장되지 않은 변경사항" : "Unsaved changes"
          ) : (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              {locale === "ko" ? "동기화됨 09:14" : "Synced 09:14"}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
