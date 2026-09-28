"use client";

import Link from "next/link";
import { ChevronRight, LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/shared/utils";
import { useT } from "@/shared/i18n/context";

// The patient app's own small component kit (v2). Every screen under
// src/patient composes these instead of the shared primitives, so the
// patient look can change without touching the clinician app. Colors come
// from the variables in src/patient/styles/patient-theme.css.

type Tone = "brand" | "gold" | "neutral" | "success" | "warning" | "critical";

const toneSoft: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand-ink",
  gold: "bg-gold-soft text-gold-strong",
  neutral: "bg-surface-hover text-text-secondary",
  success: "bg-success-light text-success",
  warning: "bg-warning-light text-warning",
  critical: "bg-critical-light text-critical",
};

/** The lab mark (green A-frame with a gold wedge), redrawn as vector from
 * the lab logo and set on a white app-icon tile. Colours are the logo's own,
 * not theme tokens, so the mark reads the same in light and dark mode. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <rect x="0.5" y="0.5" width="39" height="39" rx="11" fill="#fff" stroke="rgba(25,31,40,0.1)" />
      <g transform="translate(-3.1 -2.9) scale(0.336)">
        <path d="M39.8 101 L62.5 35.5 L75.5 35.5 L97.8 101 L84.6 101 L67.8 55.5 L52.4 101 Z" fill="#033113" />
        <path d="M74.3 73.5 L80.9 92 L77.8 101 L64.4 101 Z" fill="#FFB700" />
      </g>
    </svg>
  );
}

// The lab's deep forest green with depth -- a warm gold light from the top
// right, a lifted green from the bottom left. Fixed colours (not theme
// tokens): the same in light and dark. Used by the home orb and page badges.
export const BOARD_BACKGROUND = [
  "radial-gradient(120% 90% at 100% 0%, rgba(255, 190, 70, 0.16), transparent 55%)",
  "radial-gradient(90% 90% at 0% 100%, rgba(64, 150, 100, 0.30), transparent 60%)",
  "linear-gradient(160deg, #21523A 0%, #193F2B 55%, #123222 100%)",
].join(", ");
// Fine paper grain (SVG noise, tiled).
export const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

/** Quiet shapes behind the home's spotlight: two soft colour fields and
 * faint dotted paths. A radial mask fades every edge so the blurred fields
 * never show the box they are clipped to. Decorative only; the parent must be
 * `relative isolate`. */
export function PageBackdrop({ height = 460 }: { height?: number }) {
  const fade = "radial-gradient(ellipse 70% 65% at 50% 45%, #000 45%, transparent 100%)";
  return (
    <div
      className="pointer-events-none absolute -inset-x-4 -top-6 -z-10 sm:-inset-x-6 lg:-inset-x-10"
      style={{ height, maskImage: fade, WebkitMaskImage: fade }}
      aria-hidden="true"
    >
      <div className="absolute left-[2%] top-16 h-72 w-72 rounded-full bg-brand-soft opacity-80 blur-3xl" />
      <div className="absolute right-[10%] top-6 h-80 w-80 rounded-full bg-gold-soft opacity-90 blur-3xl" />
      <svg className="absolute inset-0 hidden h-full w-full sm:block" viewBox="0 0 1200 460" preserveAspectRatio="none">
        <path d="M0 360 C 240 280, 420 400, 640 320 S 1000 170, 1200 220" fill="none" stroke="rgb(var(--color-brand))" strokeOpacity="0.2" strokeWidth="2" strokeDasharray="2 10" strokeLinecap="round" />
        <path d="M0 400 C 260 340, 440 430, 680 360 S 1040 240, 1200 280" fill="none" stroke="rgb(var(--color-gold))" strokeOpacity="0.32" strokeWidth="2" strokeDasharray="2 10" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/** A page's opening: the title, underlined with a gold brush stroke. */
export function PageHero({ title, eyebrow, description, actions }: { title: ReactNode; eyebrow?: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-10 pt-4 sm:mb-12 sm:pt-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="mb-1.5 text-[13px] font-semibold text-brand-ink">{eyebrow}</div>}
          <h1 className="relative inline-block pb-2 text-[30px] font-extrabold leading-tight tracking-[-0.04em] text-text-primary sm:text-[38px]">
            {title}
            <svg className="absolute -bottom-0.5 left-0 h-3 w-full" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true">
              <path d="M3 8 C 50 3, 120 2, 197 6" fill="none" stroke="rgb(var(--color-gold))" strokeWidth="5" strokeLinecap="round" />
            </svg>
          </h1>
          {description && <div className="mt-3 max-w-2xl text-[15px] leading-relaxed text-text-secondary">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "gold" | "danger" | "soft";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariant: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white shadow-[0_6px_16px_rgb(var(--color-brand)/0.22)] hover:bg-brand-strong",
  secondary: "border border-border bg-surface text-text-primary hover:bg-surface-hover",
  ghost: "text-text-secondary hover:bg-surface-hover hover:text-text-primary",
  gold: "bg-gold text-[#2a2208] hover:brightness-95",
  danger: "border border-critical/30 bg-surface text-critical hover:bg-critical-light",
  soft: "bg-brand-soft text-brand-ink hover:bg-brand-soft/80",
};

const buttonSize: Record<ButtonSize, string> = {
  sm: "h-9 gap-1.5 px-3.5 text-sm",
  md: "h-11 gap-2 px-5 text-[15px]",
  lg: "h-14 gap-2 px-6 text-base",
};

export function ptButtonClass({ variant = "primary", size = "md", block = false, className }: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string } = {}) {
  return cn(
    "transition-ui inline-flex select-none items-center justify-center rounded-full font-semibold active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
    buttonVariant[variant],
    buttonSize[size],
    block && "w-full",
    className,
  );
}

export function PtButton({
  variant = "primary",
  size = "md",
  block,
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; loading?: boolean }) {
  return (
    <button type="button" {...props} disabled={loading || props.disabled} className={ptButtonClass({ variant, size, block, className })}>
      {loading && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function PtLinkButton({ href, variant = "primary", size = "md", block, className, children, ...rest }: { href: string; variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string; children: ReactNode; target?: string; rel?: string }) {
  return (
    <Link href={href} className={ptButtonClass({ variant, size, block, className })} {...rest}>
      {children}
    </Link>
  );
}

export const ptInputClass =
  "transition-ui h-12 w-full rounded-xl border border-border bg-surface px-4 text-[15px] text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand-soft";
export const ptTextareaClass =
  "transition-ui min-h-28 w-full resize-y rounded-xl border border-border bg-surface px-4 py-3 text-[15px] leading-relaxed text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand-soft";

export function PtField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-semibold text-text-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-text-muted">{hint}</span>}
    </label>
  );
}

export function PtCard({ children, className, as: Tag = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <Tag className={cn("rounded-card bg-surface shadow-[var(--pt-shadow-sm)]", className)}>{children}</Tag>;
}

export function PageIntro({ eyebrow, title, description, action }: { eyebrow?: string; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-[13px] font-semibold text-brand-ink">{eyebrow}</div>}
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.03em] text-text-primary sm:text-[30px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-text-secondary">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function SectionHeading({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-[17px] font-bold tracking-[-0.02em] text-text-primary">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-text-secondary">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("transition-ui inline-flex items-center gap-0.5 text-[13px] font-semibold text-text-secondary hover:text-text-primary", className)}>
      {children}
      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

export function IconTile({ icon, tone = "brand", size = "md", className }: { icon: ReactNode; tone?: Tone; size?: "sm" | "md" | "lg"; className?: string }) {
  const sizes = { sm: "h-9 w-9 rounded-xl [&_svg]:h-[18px] [&_svg]:w-[18px]", md: "h-11 w-11 rounded-2xl [&_svg]:h-5 [&_svg]:w-5", lg: "h-14 w-14 rounded-2xl [&_svg]:h-6 [&_svg]:w-6" };
  return <span className={cn("flex shrink-0 items-center justify-center", toneSoft[tone], sizes[size], className)} aria-hidden="true">{icon}</span>;
}

/** The session number as the session's visual identity -- a big numeral
 * with a small unit caption, used wherever a session needs a marker. */
export function SessionNumber({ number, caption, size = "md", tone = "brand", className }: { number: number; caption: string; size?: "sm" | "md" | "lg"; tone?: "brand" | "soft" | "gold" | "muted"; className?: string }) {
  // "Session / 1" reads naturally in English, "1 / 회기" in Korean.
  const { locale } = useT();
  // min-width, not width: "Session" needs a little more room than "회기".
  const sizes = { sm: "h-[52px] min-w-[52px] px-1.5 rounded-[14px] [&>b]:text-[18px]", md: "h-14 min-w-[56px] px-2 rounded-2xl [&>b]:text-[21px]", lg: "h-16 min-w-[64px] px-2 rounded-2xl [&>b]:text-[27px]" };
  const tones = { brand: "bg-brand text-white", soft: "bg-brand-soft text-brand-ink", gold: "bg-gold text-[#2a2208]", muted: "bg-surface-hover text-text-muted" };
  return (
    <span className={cn("flex shrink-0 flex-col items-center justify-center leading-none", sizes[size], tones[tone], className)} aria-hidden="true">
      {locale === "en" && <span className="mb-0.5 text-[10px] font-semibold opacity-75">{caption}</span>}
      <b className="font-extrabold tracking-[-0.04em]">{number}</b>
      {locale !== "en" && <span className="mt-0.5 text-[10px] font-semibold opacity-75">{caption}</span>}
    </span>
  );
}

export function StatusPill({ tone = "neutral", children, dot = false, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", toneSoft[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function ProgressRing({ value, size = 64, stroke = 7, children, label }: { value: number; size?: number; stroke?: number; children?: ReactNode; label?: string }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgb(var(--color-brand-soft))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgb(var(--color-gold))"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          style={{ transition: "stroke-dashoffset 700ms var(--ease-ui)" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

export function ProgressBar({ value, className, tone = "gold" }: { value: number; className?: string; tone?: "gold" | "brand" }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-brand-soft", className)} role="progressbar" aria-valuenow={Math.round(clamped)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width] duration-700", tone === "gold" ? "bg-gold" : "bg-brand")} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function ListGroup({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {title && <div className="mb-2 px-1 text-[13px] font-semibold text-text-muted">{title}</div>}
      <div className="divide-y divide-border overflow-hidden rounded-card bg-surface shadow-[var(--pt-shadow-sm)]">{children}</div>
    </div>
  );
}

export function ListRow({
  icon,
  title,
  description,
  trailing,
  href,
  onClick,
  target,
  tone = "brand",
  dataTourId,
  chevron = true,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  target?: string;
  tone?: Tone;
  dataTourId?: string;
  chevron?: boolean;
}) {
  const inner = (
    <>
      {icon && <IconTile icon={icon} tone={tone} size="sm" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-text-primary">{title}</span>
        {description && <span className="mt-0.5 block text-[13px] leading-snug text-text-secondary">{description}</span>}
      </span>
      {trailing}
      {(href || onClick) && chevron && <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />}
    </>
  );
  const rowClass = "flex w-full items-center gap-3.5 px-4 py-3.5 text-left";
  if (href) {
    return (
      <Link href={href} target={target} rel={target === "_blank" ? "noopener noreferrer" : undefined} data-tour-id={dataTourId} className={cn(rowClass, "transition-ui hover:bg-surface-hover")}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} data-tour-id={dataTourId} className={cn(rowClass, "transition-ui hover:bg-surface-hover")}>
        {inner}
      </button>
    );
  }
  return <div className={rowClass} data-tour-id={dataTourId}>{inner}</div>;
}

export function EmptyBlock({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <IconTile icon={icon} tone="brand" size="lg" />
      <p className="mt-4 text-base font-bold text-text-primary">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-text-secondary">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PtSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="skeleton h-8 w-48 rounded-xl" />
      <div className="skeleton h-40 rounded-card" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="skeleton h-28 rounded-card" />
        <div className="skeleton h-28 rounded-card" />
      </div>
    </div>
  );
}
