"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/clinician/components/app-shell";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, inputClass, textareaClass } from "@/shared/components/ui/primitives";
import { MemoryConsentPanel } from "@/clinician/pages/monitoring/memory-consent-panel";
import { listRuntimeParticipants } from "@/shared/api/participant-api";
import { listMemoryChunks, suppressMemoryChunk } from "@/shared/data/repositories/memory-chunk-repository";
import { useT } from "@/shared/i18n/context";
import type { MemoryChunk } from "@/types/memory-chunks";

/** A participant's memory chunks (sql/027): what later sessions may retrieve,
 * with the tags and the clinician's one control over it -- suppression.
 * Replaces the old candidate review queue, which approved summary-derived
 * memories; memory is now the participant's own words, used with their
 * consent (note2026_09_27_memory_rag_m3_m7). */
export function MemoryChunksPage() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [participantId, setParticipantId] = useState("");
  const [includeSuppressed, setIncludeSuppressed] = useState(false);
  const [target, setTarget] = useState<MemoryChunk | null>(null);
  const [reason, setReason] = useState("");
  const participantsQuery = useQuery({ queryKey: ["runtime-participants"], queryFn: listRuntimeParticipants });
  const participant = participantsQuery.data?.find((item) => item.id === participantId);
  const chunksQuery = useQuery({
    queryKey: ["memory-chunks", participantId, includeSuppressed],
    queryFn: () => listMemoryChunks(participantId, { includeSuppressed }),
    enabled: Boolean(participantId),
  });
  const suppressMutation = useMutation({
    mutationFn: () => suppressMemoryChunk(target!.id, reason.trim()),
    onSuccess: async () => {
      toast.success(t("memoryChunksPage.done"));
      setTarget(null);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["memory-chunks", participantId] });
    },
    onError: () => toast.error(t("memoryChunksPage.failed")),
  });

  return (
    <AppShell>
      <PageHeader title={t("memoryChunksPage.title")} description={t("memoryChunksPage.description")} />
      <div className="space-y-4 p-4 lg:p-6">
        <Card className="flex flex-wrap items-end gap-4 p-4">
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-text-primary">{t("memoryChunksPage.participant")}</span>
            <select className={inputClass} value={participantId} onChange={(event) => setParticipantId(event.target.value)}>
              <option value="">{t("memoryChunksPage.choose")}</option>
              {participantsQuery.data?.map((item) => <option key={item.id} value={item.id}>{item.alias} ({item.id})</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={includeSuppressed} onChange={(event) => setIncludeSuppressed(event.target.checked)} />
            {t("memoryChunksPage.includeSuppressed")}
          </label>
        </Card>
        {participant && <MemoryConsentPanel participant={participant} />}
        {participantId && !chunksQuery.isLoading && !chunksQuery.data?.length && <Card><EmptyState title={t("memoryChunksPage.none")} /></Card>}
        {chunksQuery.data?.map((chunk) => (
          <Card key={chunk.id} className="p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap gap-2">
                  <Badge tone="primary">{chunk.chunkKind === "clinician_note" ? t("memoryChunksPage.note") : t("memoryChunksPage.session", { index: chunk.sessionIndex })}</Badge>
                  <Badge tone="neutral">{chunk.elementKind}</Badge>
                  {chunk.suppressed && <Badge tone="warning">{t("memoryChunksPage.suppressed", { reason: chunk.suppressedReason ?? "" })}</Badge>}
                </div>
                <div className="mt-2 whitespace-pre-line text-sm text-text-primary">{chunk.content}</div>
                <div className="mt-2 text-xs text-text-secondary">{chunk.tags ? Object.values(chunk.tags).flat().join(", ") || "—" : t("memoryChunksPage.untagged")}</div>
              </div>
              {!chunk.suppressed && <Button variant="secondary" onClick={() => setTarget(chunk)}>{t("memoryChunksPage.suppress")}</Button>}
            </div>
          </Card>
        ))}
      </div>
      <Modal open={Boolean(target)} onClose={() => setTarget(null)} title={t("memoryChunksPage.suppressTitle")} description={t("memoryChunksPage.suppressDescription")}>
        <div className="space-y-3 p-5">
          <div className="whitespace-pre-line rounded-panel border border-border p-3 text-sm text-text-secondary">{target?.content}</div>
          <textarea className={textareaClass} placeholder={t("memoryChunksPage.reason")} value={reason} onChange={(event) => setReason(event.target.value)} />
          <div className="flex justify-end">
            <Button variant="danger" disabled={!reason.trim()} loading={suppressMutation.isPending} onClick={() => suppressMutation.mutate()}>{t("memoryChunksPage.confirm")}</Button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
