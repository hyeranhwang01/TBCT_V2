"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, EmptyState, Modal, PageSkeleton, SectionHeader } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/context";
import { listHomeworkEntries, listHomeworkRecordsByParticipant } from "@/lib/repositories/homework-repository";
import { HOMEWORK_CATEGORY_BY_SESSION, HOMEWORK_LABEL_BY_SESSION, type HomeworkEntryRecord, type HomeworkRecord, type HomeworkStatus } from "@/types/homework";

// The clinician-facing counterpart to the patient homework pages
// (src/components/pages/homework/s0N-*.tsx) -- read-only, split into one
// tab per session (S01..S08) rather than a single mixed list, so records
// from different follow-up activities don't run together. Follows the
// same Card + SectionHeader pattern as the "Clinical notes" panel right
// next to it in patient-detail-page.tsx.

const SESSION_ORDER = Object.keys(HOMEWORK_LABEL_BY_SESSION).sort();

const STATUS_TONE: Record<HomeworkStatus, "primary" | "warning" | "critical" | "success" | "neutral"> = {
  not_started: "neutral",
  in_progress: "primary",
  ongoing: "primary",
  review_available: "warning",
  completed: "success",
};

function formatTimestamp(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

/** "candidateOneEmotion" -> "Candidate one emotion" -- for rendering an
 * untyped homework data/entry payload's own keys as row labels, without a
 * per-session-specific renderer (each session's homework module owns its
 * own shape; see types/homework.ts's header). */
function humanizeKey(key: string) {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());
  return spaced;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.map((item) => formatValue(item)).join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function DataFields({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (!entries.length) return null;
  return (
    <div className="space-y-1.5">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-start justify-between gap-3 text-sm">
          <span className="shrink-0 text-text-secondary">{humanizeKey(key)}</span>
          <span className="text-right font-medium text-text-primary">{formatValue(value)}</span>
        </div>
      ))}
    </div>
  );
}

export function HomeworkPanel({ participantId }: { participantId: string }) {
  const { t } = useT();
  const [openRecord, setOpenRecord] = useState<HomeworkRecord | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const recordsQuery = useQuery({
    queryKey: ["patient-monitoring-homework", participantId],
    queryFn: () => listHomeworkRecordsByParticipant(participantId),
    enabled: Boolean(participantId),
    refetchInterval: 4000,
  });
  const records = useMemo(() => recordsQuery.data ?? [], [recordsQuery.data]);

  const recordsBySession = useMemo(() => {
    const map = new Map<string, HomeworkRecord[]>();
    for (const record of records) {
      const list = map.get(record.sessionDefinitionId) ?? [];
      list.push(record);
      map.set(record.sessionDefinitionId, list);
    }
    for (const list of map.values()) list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return map;
  }, [records]);

  // Defaults to whichever session has the most recently updated record, so
  // the clinician lands on the most relevant tab instead of always S01.
  const mostRecentSession = useMemo(
    () => [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.sessionDefinitionId,
    [records],
  );
  const effectiveSession = selectedSession ?? mostRecentSession ?? SESSION_ORDER[0];
  const activeRecords = recordsBySession.get(effectiveSession) ?? [];

  const entriesQuery = useQuery({
    queryKey: ["patient-monitoring-homework-entries", openRecord?.id],
    queryFn: () => listHomeworkEntries(openRecord!.id),
    enabled: Boolean(openRecord && HOMEWORK_CATEGORY_BY_SESSION[openRecord.sessionDefinitionId] === "ongoing"),
    refetchInterval: 4000,
  });

  return (
    <>
      <Card>
        <SectionHeader title={t("patientDetail.profile.homeworkHeading")} />
        {recordsQuery.isLoading ? (
          <div className="p-4"><PageSkeleton /></div>
        ) : records.length === 0 ? (
          <div className="p-4"><EmptyState title={t("patientDetail.homework.empty")} description="" /></div>
        ) : (
          <>
            <div className="flex gap-1 overflow-x-auto border-b border-border px-4 pt-2">
              {SESSION_ORDER.map((sessionDefinitionId) => {
                const count = recordsBySession.get(sessionDefinitionId)?.length ?? 0;
                const active = effectiveSession === sessionDefinitionId;
                return (
                  <button
                    key={sessionDefinitionId}
                    type="button"
                    onClick={() => setSelectedSession(sessionDefinitionId)}
                    disabled={count === 0}
                    className={`shrink-0 rounded-t-panel border-b-2 px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? "border-clinical-blue text-clinical-blue"
                        : count === 0
                          ? "border-transparent text-text-muted/50"
                          : "border-transparent text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    S{sessionDefinitionId.slice(-2)}
                    {count > 1 && <span className="ml-1 text-[10px] text-text-muted">({count})</span>}
                  </button>
                );
              })}
            </div>
            <div className="space-y-2 p-4">
              {activeRecords.length === 0 ? (
                <EmptyState title={t("patientDetail.homework.empty")} description="" />
              ) : (
                activeRecords.map((record) => (
                  <div key={record.id} className="flex items-center justify-between gap-3 rounded-panel border border-border px-3 py-2">
                    <div>
                      <div className="text-sm text-text-primary">{HOMEWORK_LABEL_BY_SESSION[record.sessionDefinitionId] ?? record.sessionDefinitionId}</div>
                      <div className="mt-0.5 text-[11px] text-text-muted">
                        {t("patientDetail.homework.lastUpdated")}: {formatTimestamp(record.updatedAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={STATUS_TONE[record.status]}>{t(`patientDetail.homework.status.${record.status}`)}</Badge>
                      <Button size="sm" variant="secondary" onClick={() => setOpenRecord(record)}>
                        {t("patientDetail.homework.view")}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </Card>

      <Modal
        open={Boolean(openRecord)}
        onClose={() => setOpenRecord(null)}
        title={t("patientDetail.homework.modalTitle", { session: openRecord ? HOMEWORK_LABEL_BY_SESSION[openRecord.sessionDefinitionId] ?? openRecord.sessionDefinitionId : "" })}
      >
        {openRecord && (
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <Badge tone={STATUS_TONE[openRecord.status]}>{t(`patientDetail.homework.status.${openRecord.status}`)}</Badge>
              <span className="text-xs text-text-muted">
                {t("patientDetail.homework.lastUpdated")}: {formatTimestamp(openRecord.updatedAt)}
              </span>
            </div>
            <DataFields data={openRecord.data} />

            {HOMEWORK_CATEGORY_BY_SESSION[openRecord.sessionDefinitionId] === "ongoing" && (
              <div className="space-y-2 border-t border-border pt-3">
                <div className="text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">{t("patientDetail.homework.entries")}</div>
                {entriesQuery.isLoading ? (
                  <PageSkeleton />
                ) : !entriesQuery.data?.length ? (
                  <p className="text-sm text-text-muted">{t("patientDetail.homework.noEntries")}</p>
                ) : (
                  <div className="space-y-2">
                    {entriesQuery.data.map((entry: HomeworkEntryRecord) => (
                      <div key={entry.id} className="rounded-panel border border-border bg-surface-subtle p-3">
                        <div className="mb-1.5 text-[11px] text-text-muted">{formatTimestamp(entry.createdAt)}</div>
                        <DataFields data={entry.data} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
