"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X, LoaderCircle, Inbox, TriangleAlert, CircleHelp, PanelRightOpen, Sparkles } from "lucide-react";
import { useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { drawerPanel, modalBackdrop, modalPanel, tooltipEnter } from "@/lib/motion/motion-variants";
import { motionDuration, motionEase } from "@/lib/motion/motion-tokens";
import { useReducedMotionPreference } from "@/lib/motion/use-reduced-motion-preference";
import { cn, reviewStatusMap, severityMap, versionStatusMap } from "@/lib/utils";

type Tone = "neutral" | "primary" | "violet" | "success" | "warning" | "critical";

const toneClass: Record<Tone, string> = {
  neutral: "border-border bg-surface-subtle text-text-secondary",
  primary: "rainbow-fill border-transparent text-white",
  violet: "border-ai-violet-light bg-ai-violet-light text-ai-violet",
  success: "border-success-light bg-success-light text-success",
  warning: "border-warning-light bg-warning-light text-warning",
  critical: "border-critical-light bg-critical-light text-critical",
};

export function Button({
  children,
  className,
  variant = "primary",
  size = "md",
  loading,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd" | "onAnimationIteration"> & {
  // Omitted event names above are the standard motion.button/native-button
  // type conflict (framer-motion's onDrag et al. use a different event
  // signature than the plain DOM one) -- none of this app's Button call
  // sites pass any of them, so this only narrows an unused corner of the
  // type, not real behavior.
  variant?: "primary" | "secondary" | "ghost" | "danger" | "violet" | "authGradient";
  size?: "sm" | "md" | "icon";
  loading?: boolean;
}) {
  const styles = {
    primary: "rainbow-button border-transparent text-white hover:brightness-105",
    secondary: "border-border bg-surface text-text-primary hover:bg-surface-hover",
    ghost: "border-transparent bg-transparent text-text-secondary hover:bg-surface-hover",
    danger: "border-critical bg-critical text-white hover:bg-[#ac3340]",
    violet: "border-ai-violet bg-ai-violet text-white hover:bg-[#674cbc]",
    // Two-tone violet->blue submit button used on the login/signup forms
    // (auth-form.tsx) -- a deliberately calmer accent than the full
    // rainbow-button used for every other primary action in the app, to
    // match the auth screens' own reference design.
    authGradient: "border-transparent bg-gradient-to-r from-ai-violet to-clinical-blue text-white hover:brightness-105 shadow-md",
  };
  const sizes = { sm: "h-8 px-3 text-xs", md: "h-9 px-3.5 text-sm", icon: "h-9 w-9" };
  const reducedMotion = useReducedMotionPreference();
  const interactive = !(loading || props.disabled);
  return (
    <motion.button
      // A satisfying little "press" on every button in the app, from one
      // shared component -- whileTap/whileHover only ever play while the
      // button is actually held/hovered (auto-reverse on release, no
      // separate cleanup needed), so neither can get stuck mid-animation
      // like a manual active-class toggle could. Hover lift is a hair off
      // (-1px), press settles slightly below rest (0.98) rather than a full
      // "squish" -- both within the brief's asked-for ranges.
      whileHover={reducedMotion || !interactive ? undefined : { y: -1 }}
      whileTap={reducedMotion || !interactive ? undefined : { scale: 0.98 }}
      transition={{ duration: motionDuration.instant, ease: motionEase.ui }}
      className={cn(
        "transition-ui inline-flex items-center justify-center gap-2 rounded-full border font-semibold shadow-sm disabled:pointer-events-none disabled:opacity-50",
        styles[variant],
        sizes[size],
        className,
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <LoaderCircle className="h-4 w-4 animate-spin" />}
      {children}
    </motion.button>
  );
}

/** Hover-only label for icon-only buttons (topbar bell/help/theme toggle,
 * collapsed sidebar items) where the action isn't otherwise labeled --
 * appears after a short delay (avoids flashing one on every incidental
 * mouse-pass), one line, no motion beyond a small fade + 3px settle. */
export function Tooltip({ label, children, side = "bottom" }: { label: string; children: ReactNode; side?: "top" | "bottom" }) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reducedMotion = useReducedMotionPreference();
  const tooltipId = useId();

  const show = () => {
    window.clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), 300);
  };
  const hide = () => {
    window.clearTimeout(timerRef.current);
    setOpen(false);
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={open ? tooltipId : undefined}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            id={tooltipId}
            role="tooltip"
            initial={reducedMotion ? false : "initial"}
            animate="animate"
            exit={reducedMotion ? undefined : "exit"}
            variants={reducedMotion ? undefined : tooltipEnter}
            className={cn(
              "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-navy-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg",
              side === "bottom" ? "top-[calc(100%+6px)]" : "bottom-[calc(100%+6px)]",
            )}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rainbow-card overflow-hidden rounded-panel bg-surface/95 shadow-[0_14px_40px_rgba(47,69,110,0.08)] backdrop-blur", className)}>{children}</section>;
}

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  // Semantic motion, not decoration: an in-progress dot pulses very
  // faintly (slow, low-contrast -- never "attention grabbing"); a
  // completed dot plays its check-mark scale-in once on mount and settles,
  // it never repeats. Every other tone (including dot=true elsewhere, e.g.
  // StatusBadge/SaveStatus) stays a plain static dot, unchanged.
  const isInProgressDot = dot && tone === "primary";
  const isCompletedDot = dot && tone === "success";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-semibold",
        toneClass[tone],
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full bg-current",
            isInProgressDot && "badge-dot-pulse",
            isCompletedDot && "badge-dot-complete",
          )}
        />
      )}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const mapped = reviewStatusMap[status as keyof typeof reviewStatusMap] ?? versionStatusMap[status] ?? {
    label: status,
    tone: "neutral",
  };
  return <Badge tone={mapped.tone as Tone} dot>{mapped.label}</Badge>;
}

export function ValidationSeverityBadge({ severity }: { severity: keyof typeof severityMap }) {
  const mapped = severityMap[severity];
  return <Badge tone={mapped.tone as Tone} dot>{mapped.label}</Badge>;
}

export function ProtocolVersionBadge({ version }: { version: string }) {
  return <span className="mono inline-flex rounded-md border border-border bg-surface-subtle px-2 py-1 text-[11px] font-semibold text-text-secondary">{version}</span>;
}

export function SaveStatus({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  const map = {
    idle: { label: "No changes", tone: "neutral" as Tone },
    saving: { label: "Saving", tone: "warning" as Tone },
    saved: { label: "Saved", tone: "success" as Tone },
    error: { label: "Save failed", tone: "critical" as Tone },
  };
  const current = map[state];
  return <Badge tone={current.tone} dot>{current.label}</Badge>;
}

export function SourceReferenceChip({ label, onClick, title }: { label: string; onClick?: () => void; title?: string }) {
  if (onClick) {
    return (
      <button
        type="button"
        title={title}
        onClick={onClick}
        className="inline-flex items-center rounded-md border border-border bg-surface-subtle px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover"
      >
        {label}
      </button>
    );
  }
  return <span title={title} className="inline-flex items-center rounded-md border border-border bg-surface-subtle px-2 py-1 text-[11px] text-text-secondary">{label}</span>;
}

export function MetricCard({
  label,
  value,
  helper,
  accent = "primary",
  action,
}: {
  label: string;
  value: string;
  helper: string;
  accent?: Tone;
  action?: ReactNode;
}) {
  return (
    <Card className="flex min-h-[148px] flex-col justify-between p-5">
      <div className="flex items-start justify-between gap-3">
        <Badge tone={accent}>{label}</Badge>
        {action}
      </div>
      <div>
        <div className="mt-6 text-[32px] font-bold tracking-[-0.04em] text-text-primary">{value}</div>
        <div className="mt-2 text-xs text-text-secondary">{helper}</div>
      </div>
    </Card>
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
  meta,
  actions,
  className,
}: {
  title: string;
  description: string;
  eyebrow?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  // Mobile (<640px) gets a denser title/spacing tier so more of the page's
  // actual content is visible without scrolling; every value below has a
  // "sm:" twin equal to today's unconditional value, so >=640px (tablet and
  // desktop) resolves to the exact same classes as before this change.
  return (
    <div className={cn("page-hero flex flex-col gap-3 border-b border-white/40 px-4 py-5 sm:gap-4 sm:py-7 lg:px-8", className)}>
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          {eyebrow && <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-clinical-blue">{eyebrow}</div>}
          <h1 className="mt-1 text-2xl font-bold tracking-[-0.03em] text-text-primary sm:mt-2 sm:text-[32px]">{title}</h1>
          {/* Descriptive copy is nice-to-have on a full page, but on mobile
              it's pure vertical cost competing with the actual content/tabs
              below it (brief §16) -- still shown unchanged at >=640px. */}
          <p className="mt-1 hidden text-[13px] text-text-secondary sm:block">{description}</p>
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2 sm:mt-3">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("transition-ui flex items-start justify-between gap-4 border-b border-border px-4 py-3", className)}>
      <div>
        <h2 className="text-[16px] font-semibold text-text-primary">{title}</h2>
        {description && <p className="mt-1 text-xs text-text-secondary">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cn("p-3", className)}><div className="flex flex-col gap-3 xl:flex-row xl:items-center">{children}</div></Card>;
}

export function EmptyState({
  title = "No data available",
  description = "Adjust the filter or add more records.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center p-8 text-center">
      <Inbox className="mb-3 h-8 w-8 text-text-muted" />
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      <p className="mt-1 max-w-md text-xs text-text-secondary">{description}</p>
    </div>
  );
}

/** Bigger, illustrated variant of EmptyState for a tab's primary content
 * area (Appointments/Messages/Screening check-ins) -- a soft rainbow-tinted
 * glow behind a circular icon badge plus a small sparkle accent, versus
 * EmptyState's compact inline-icon treatment used for secondary lists. */
export function IllustratedEmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-12 text-center">
      <div className="relative mb-4 flex h-24 w-24 shrink-0 items-center justify-center">
        <span className="rainbow-fill absolute inset-0 rounded-full opacity-[0.14] blur-xl" aria-hidden />
        <span className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full border border-border bg-surface-subtle text-clinical-blue shadow-sm">
          {icon}
        </span>
        <Sparkles className="absolute -right-0.5 -top-0.5 h-5 w-5 text-warning" aria-hidden />
      </div>
      <p className="text-base font-semibold text-text-primary">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-text-secondary">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ retry }: { retry?: () => void }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center p-8 text-center">
      <TriangleAlert className="mb-3 h-8 w-8 text-critical" />
      <p className="text-sm font-semibold text-text-primary">Failed to load data.</p>
      <p className="mt-1 text-xs text-text-secondary">Retry or inspect the current local runtime state.</p>
      {retry && (
        <Button className="mt-4" variant="secondary" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function LoadingSkeleton() {
  return (
    <div className="space-y-5 p-6">
      <div className="skeleton h-8 w-64 rounded-panel" />
      <div className="grid gap-4 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => <div key={item} className="skeleton h-28 rounded-panel" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.25fr_.95fr]">
        <div className="skeleton h-[420px] rounded-panel" />
        <div className="skeleton h-[420px] rounded-panel" />
      </div>
    </div>
  );
}

export function ReviewStatus({ label, helper }: { label: string; helper: string }) {
  return (
    <div className="rounded-panel border border-border bg-surface-subtle p-3">
      <div className="text-xs font-semibold text-text-primary">{label}</div>
      <div className="mt-1 text-[11px] text-text-secondary">{helper}</div>
    </div>
  );
}

export function ConfirmActionDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  confirmDisabled = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmDisabled?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      <div className="flex justify-end gap-2 p-5">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  width = "max-w-xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  width?: string;
}) {
  const reducedMotion = useReducedMotionPreference();
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[#132A4A]/28 p-4"
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
          variants={reducedMotion ? undefined : modalBackdrop}
          initial={reducedMotion ? false : "initial"}
          animate={reducedMotion ? undefined : "animate"}
          exit={reducedMotion ? undefined : "exit"}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cn("max-h-[92dvh] w-full overflow-hidden rounded-[28px] border border-white/70 bg-surface/95 shadow-2xl backdrop-blur-xl", width)}
            variants={reducedMotion ? undefined : modalPanel}
            initial={reducedMotion ? false : "initial"}
            animate={reducedMotion ? undefined : "animate"}
            exit={reducedMotion ? undefined : "exit"}
          >
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-text-primary">{title}</h2>
                {description && <p className="mt-1 text-sm text-text-secondary">{description}</p>}
              </div>
              <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="max-h-[calc(92vh-78px)] overflow-auto">{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function DetailDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = "w-[640px]",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: string;
}) {
  const reducedMotion = useReducedMotionPreference();
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[75] bg-[#132A4A]/18"
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
          variants={reducedMotion ? undefined : modalBackdrop}
          initial={reducedMotion ? false : "initial"}
          animate={reducedMotion ? undefined : "animate"}
          exit={reducedMotion ? undefined : "exit"}
        >
          <motion.aside
            className={cn("absolute bottom-0 right-0 top-0 max-w-[96vw] border-l border-border bg-surface", width)}
            variants={reducedMotion ? undefined : drawerPanel}
            initial={reducedMotion ? false : "initial"}
            animate={reducedMotion ? undefined : "animate"}
            exit={reducedMotion ? undefined : "exit"}
          >
            <div className="flex h-[72px] items-center justify-between border-b border-border px-5">
              <div>
                <h2 className="text-base font-semibold text-text-primary">{title}</h2>
                {subtitle && <p className="mt-1 text-xs text-text-secondary">{subtitle}</p>}
              </div>
              <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
                <PanelRightOpen className="h-4 w-4" />
              </Button>
            </div>
            <div className="h-[calc(100%-72px)] overflow-auto p-5">{children}</div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-text-primary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-text-secondary">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "transition-ui h-9 w-full rounded-panel border border-border bg-surface px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-clinical-blue focus:outline-none focus:ring-2 focus:ring-clinical-blue-light";
export const textareaClass =
  "transition-ui min-h-24 w-full resize-y rounded-panel border border-border bg-surface px-3 py-2 text-sm leading-6 text-text-primary placeholder:text-text-muted focus:border-clinical-blue focus:outline-none focus:ring-2 focus:ring-clinical-blue-light";

export function PageSkeleton() {
  return <LoadingSkeleton />;
}

export function IconLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">{icon}{label}</span>;
}

export function HintCallout({ text }: { text: string }) {
  return (
    <div className="rounded-panel border border-border bg-surface-subtle px-3 py-2 text-xs text-text-secondary">
      <div className="inline-flex items-center gap-2">
        <CircleHelp className="h-3.5 w-3.5 text-clinical-blue" />
        <span>{text}</span>
      </div>
    </div>
  );
}
