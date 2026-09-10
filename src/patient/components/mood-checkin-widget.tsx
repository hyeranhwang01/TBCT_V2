"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Card } from "@/components/ui/primitives";
import { submitMoodCheckin, listMoodCheckins } from "@/lib/api/mood-checkin-api";
import { computeStreak, todayInSeoul } from "@/lib/mood-checkins/streak";
import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

const MOOD_EMOJI: Record<1 | 2 | 3 | 4 | 5, string> = { 1: "😞", 2: "😕", 3: "😐", 4: "🙂", 5: "😄" };
const MOOD_VALUES = [1, 2, 3, 4, 5] as const;

/** Daily 1-tap mood check-in -- benchmarked from Daylio/Youper/Wysa's
 * habit-loop pattern, deliberately separate from the heavier PHQ-9/GAD-7
 * periodic screenings (see standardized-assessment-api.ts). Lives on the
 * patient's session-list home page (patient-list-page.tsx). */
export function MoodCheckinWidget({ participantId }: { participantId: string }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const checkinsQuery = useQuery({
    queryKey: ["mood-checkins", participantId],
    queryFn: () => listMoodCheckins(participantId),
    enabled: Boolean(participantId),
  });

  const today = todayInSeoul();
  const checkins = checkinsQuery.data ?? [];
  const todaysCheckin = checkins.find((checkin) => checkin.checkinDate === today);
  const streak = computeStreak(checkins, today);

  const submitMutation = useMutation({
    mutationFn: (mood: 1 | 2 | 3 | 4 | 5) => submitMoodCheckin(participantId, mood),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mood-checkins", participantId] });
    },
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-text-primary">{t("moodCheckin.prompt")}</div>
        {streak > 0 && <Badge tone="primary">{t("moodCheckin.streak", { count: streak })}</Badge>}
      </div>
      <div className="mt-3 flex gap-2">
        {MOOD_VALUES.map((value) => (
          <button
            key={value}
            type="button"
            disabled={submitMutation.isPending}
            onClick={() => submitMutation.mutate(value)}
            aria-label={t(`moodCheckin.mood.${value}`)}
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-full border text-2xl transition disabled:opacity-50",
              todaysCheckin?.mood === value ? "border-clinical-blue bg-clinical-blue-light" : "border-border bg-surface hover:bg-surface-hover",
            )}
          >
            {MOOD_EMOJI[value]}
          </button>
        ))}
      </div>
      {todaysCheckin && <div className="mt-2 text-xs text-text-secondary">{t("moodCheckin.todayDone")}</div>}
    </Card>
  );
}
