"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PatientShell } from "@/patient/components/patient-shell";
import { Card } from "@/shared/components/ui/primitives";
import { appendHomeworkEntry, listHomeworkEntries } from "@/patient/lib/api/homework-api";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
import {
  CDQUEST_ROUND_ENTRY_TYPE,
  CdQuestForm,
  buildCdQuestRoundData,
  toCdQuestRounds,
  type CdQuestDraftRow,
} from "@/patient/sessions/s02/cdquest-form";
import { useT } from "@/shared/i18n/context";
import type { HomeworkRecord } from "@/types/homework";
import type { RuntimeSession } from "@/types/runtime-session";

// S2 homework, as the real second session assigned it (2026-09-18, 53:30):
// a fresh CD-Quest form each week -- a short example per pattern and a score for
// how often it came up and how strongly it was believed
// (.claude/TASK_SCOPE.json note2026_09_21_s02_cognitive_distortions, stage 3).
//
// This replaces the problem/goal re-rating check-in, which read
// session.runtimeContext.fields.problems/goals. S02 no longer collects those, so
// that page had been rendering empty since stage 1.
//
// The scores from the session itself are the baseline the weekly rounds are
// measured against; the form keeps them hidden until the round is complete, per
// the book's rule for a re-rating.
export function CdQuestHomework({ session, homework }: { session: RuntimeSession; homework: HomeworkRecord; label: string }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const queryKey = ["homework-entries", homework.id, CDQUEST_ROUND_ENTRY_TYPE];
  const entriesQuery = useQuery({ queryKey, queryFn: () => listHomeworkEntries(homework.id, CDQUEST_ROUND_ENTRY_TYPE), refetchInterval: 4000 });
  const rounds = toCdQuestRounds(entriesQuery.data ?? []);

  const sessionScores = session.runtimeContext.fields.cdQuestScores;
  const baselineScores = COGNITIVE_DISTORTIONS.map((_, index) => {
    const value = Array.isArray(sessionScores) ? sessionScores[index] : undefined;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  });

  const saveRound = useMutation({
    mutationFn: (rows: CdQuestDraftRow[]) => appendHomeworkEntry(homework.id, CDQUEST_ROUND_ENTRY_TYPE, buildCdQuestRoundData(rows)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return (
    <PatientShell title={t("homework.s02.title")} progressLabel={t("homework.s02.eyebrow")}>
      <div className="space-y-5">
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-text-primary">{t("homework.s02.introTitle")}</h2>
          <p className="mt-1 text-sm text-text-secondary">{t("homework.s02.introBody")}</p>
          <p className="mt-3 text-xs font-semibold text-text-muted">{t("homework.s02.rounds", { count: rounds.length })}</p>
        </Card>
        <Card className="p-6">
          <CdQuestForm rounds={rounds} baselineScores={baselineScores} onSave={(rows) => saveRound.mutateAsync(rows)} />
        </Card>
      </div>
    </PatientShell>
  );
}
