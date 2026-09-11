"use client";

import { S01_COGNITIVE_DISTORTIONS } from "@/patient/sessions/s01/cognitive-distortions";

// The 15 cognitive distortions from the list used in the real first session
// (Cognitive Distortions List, Table A1), from the approved S01 registry.
// "reference" is the read-only list shown beside the chat during the
// distortions step; the homework screen builds on the same registry.

export function DistortionTable({ locale }: { locale?: string }) {
  const korean = (locale ?? "").toLowerCase().startsWith("ko");
  return (
    <ol className="mt-2 space-y-2" data-testid="s01-distortion-list">
      {S01_COGNITIVE_DISTORTIONS.map((distortion, index) => (
        <li key={distortion.id} className="rounded-panel border border-border bg-surface p-2.5">
          <div className="text-sm font-semibold text-text-primary">{index + 1}. {korean ? distortion.nameKo : distortion.nameEn[0]}</div>
          <div className="mt-0.5 text-xs text-text-secondary">{korean ? distortion.descriptionKo : distortion.descriptionEn}</div>
          <div className="mt-0.5 text-xs italic text-text-muted">“{korean ? distortion.exampleKo[0] : distortion.exampleEn[0]}”</div>
        </li>
      ))}
    </ol>
  );
}
