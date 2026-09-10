"use client";

// Keeps "what am I editing right now" visible on mobile without a big
// header — see brief §8/§18. Purely presentational: no data fetching, no
// state of its own, just the values the caller (protocol-page.tsx) already
// has computed for the desktop panels.
export function MobileContextBar({ sessionTitle, stepTitle }: { sessionTitle: string; stepTitle?: string }) {
  return (
    <div className="border-b border-border bg-surface px-4 py-3">
      <div className="truncate text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">{sessionTitle}</div>
      {stepTitle && <div className="truncate text-sm font-semibold text-text-primary">{stepTitle}</div>}
    </div>
  );
}
