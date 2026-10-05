"use client";

import { useEffect, type ReactNode } from "react";
import { BOARD_BACKGROUND, BrandMark, GRAIN } from "@/patient/components/ui/kit";
import { PATIENT_SESSIONS } from "@/patient/lib/session-meta";
import { useT } from "@/shared/i18n/context";
import { cn } from "@/shared/utils";

// The patient sign-in/sign-up chrome (.claude/TASK_SCOPE.json
// note2026_10_05_patient_auth_v2_look). The auth screens are shared with the
// clinician app and kept its blue/pink-violet look, so a participant saw a
// different app until the moment they signed in. This frame wraps the same
// form (auth-form.tsx) in the patient app's own look: the deep-green board
// the home's journey sits on, the lab mark, and the form on a white card on
// the grey canvas. `.patient-app` switches patient-theme.css on.

const PRETENDARD_CSS = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";

export function usePretendard() {
  useEffect(() => {
    if (document.querySelector(`link[href="${PRETENDARD_CSS}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = PRETENDARD_CSS;
    document.head.appendChild(link);
  }, []);
}

export const PATIENT_FONT = "'Pretendard Variable', Pretendard, system-ui, sans-serif";

export function PatientAuthLayout({ children }: { children: ReactNode }) {
  const { t, locale } = useT();
  usePretendard();
  return (
    <div className="patient-app min-h-[100dvh] bg-background text-text-primary" style={{ fontFamily: PATIENT_FONT }}>
      <div className="mx-auto grid min-h-[100dvh] max-w-[1200px] lg:grid-cols-[1.05fr_1fr]">
        <aside
          className="relative isolate flex flex-col justify-between overflow-hidden px-7 py-8 text-white sm:px-10 sm:py-10 lg:m-4 lg:rounded-[28px] lg:px-12 lg:py-12"
          style={{ background: BOARD_BACKGROUND }}
        >
          <div className="pointer-events-none absolute inset-0 -z-10 opacity-[0.08] mix-blend-overlay" style={{ backgroundImage: GRAIN }} aria-hidden="true" />
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-9 w-9" />
            <span className="text-[18px] font-extrabold tracking-[-0.03em]">TBCT</span>
          </div>
          <div className="mt-10 lg:mt-0">
            <p className="whitespace-pre-line text-balance text-[30px] font-extrabold leading-[1.15] tracking-[-0.045em] sm:text-[40px]">{t("auth.patientUi.boardTitle")}</p>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/75">{t("auth.patientUi.boardBody")}</p>
          </div>
          {/* The eight sessions, as on the home. Decorative. */}
          <ol className="relative mt-10 hidden grid-cols-8 sm:grid lg:mt-0" aria-hidden="true">
            <span className="absolute left-[6.25%] right-[6.25%] top-[13px] h-[3px] rounded-full bg-white/15" />
            {PATIENT_SESSIONS.map((session, index) => (
              <li key={session.number} className="relative flex flex-col items-center gap-2">
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold tabular-nums",
                    index === 0 ? "bg-gold text-[#2a2208]" : "bg-white/10 text-white/70 ring-1 ring-white/20",
                  )}
                >
                  {session.number}
                </span>
                <span className="hidden text-center text-[11px] leading-tight text-white/60 xl:block">{session.title[locale]}</span>
              </li>
            ))}
          </ol>
        </aside>
        <main className="flex items-center justify-center px-5 py-10 sm:px-10">
          <div className="w-full max-w-[400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** A card title underlined with the gold brush stroke, as on patient pages. */
export function PatientAuthTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="relative inline-block pb-2 text-[26px] font-extrabold tracking-[-0.04em] text-text-primary">
      {children}
      <svg className="absolute -bottom-0.5 left-0 h-3 w-full" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true">
        <path d="M3 8 C 50 3, 120 2, 197 6" fill="none" stroke="rgb(var(--color-gold))" strokeWidth="5" strokeLinecap="round" />
      </svg>
    </h1>
  );
}

export const patientAuthCardClass = "rounded-[24px] bg-surface p-7 shadow-[var(--pt-shadow-md)] sm:p-9";
