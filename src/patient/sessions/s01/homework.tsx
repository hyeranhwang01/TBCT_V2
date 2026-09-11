"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PatientShell } from "@/patient/components/patient-shell";
import { Card } from "@/shared/components/ui/primitives";
import { appendHomeworkEntry, listHomeworkEntries } from "@/patient/lib/api/homework-api";
import { DISTORTION_EXAMPLE_ENTRY_TYPE, DistortionHomeworkTable, buildDistortionExampleData, toDistortionExamples, type DistortionExampleInput } from "@/patient/sessions/s01/distortion-table";
import { useT } from "@/shared/i18n/context";
import type { HomeworkRecord } from "@/types/homework";
import type { RuntimeSession } from "@/types/runtime-session";

// S1 homework, as assigned in the real first session
// (.claude/TASK_SCOPE.json note2026_09_12_s01_redesign): keep the list of 15
// cognitive distortions nearby and, whenever such a thought comes up, write
// a short example in the "내 예시" column of the distortion it fits. The
// participant picks the row themselves -- the app never picks one for them.
// Entries are stored as "distortion_example" (schemaVersion 2); the earlier
// free-form "example" entries are deliberately not loaded. The export name
// is unchanged so homework-page.tsx needs no edit.
export function WeeklyExamplesHomework({ homework }: { session: RuntimeSession; homework: HomeworkRecord; label: string }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const queryKey = ["homework-entries", homework.id, DISTORTION_EXAMPLE_ENTRY_TYPE];
  const entriesQuery = useQuery({ queryKey, queryFn: () => listHomeworkEntries(homework.id, DISTORTION_EXAMPLE_ENTRY_TYPE), refetchInterval: 4000 });
  const examples = toDistortionExamples(entriesQuery.data ?? []);

  const addExample = useMutation({
    mutationFn: (input: DistortionExampleInput) => appendHomeworkEntry(homework.id, DISTORTION_EXAMPLE_ENTRY_TYPE, buildDistortionExampleData(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return (
    <PatientShell title={t("homework.s01.title")} progressLabel={t("homework.s01.eyebrow")}>
      <div className="space-y-5">
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-text-primary">{t("homework.s01.introTitle")}</h2>
          <p className="mt-1 text-sm text-text-secondary">{t("homework.s01.introBody")}</p>
          <p className="mt-3 text-xs font-semibold text-text-muted">{t("homework.s01.total", { count: examples.length })}</p>
        </Card>
        <DistortionHomeworkTable entries={examples} onAdd={(input) => addExample.mutateAsync(input)} />
      </div>
    </PatientShell>
  );
}
