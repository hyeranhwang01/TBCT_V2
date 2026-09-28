"use client";

import { useState } from "react";
import { ChevronRight, Download, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Modal } from "@/shared/components/ui/primitives";
import { createDataDeletionRequest, listDataDeletionRequestsByParticipant } from "@/shared/api/data-deletion-request-api";
import { useT } from "@/shared/i18n/context";
import { IconTile, ListGroup, ListRow, PtButton, StatusPill, ptTextareaClass } from "@/patient/components/ui/kit";

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Patient self-service data export + deletion request. Export is a live
 * read from the existing stores (src/app/api/patient-data-export/route.ts),
 * a plain link since the route sets its own Content-Disposition. Deletion is
 * a REQUEST, not an automatic delete -- see sql/018_data_deletion_requests.sql
 * for why (clinical record-keeping obligations). */
export function DataPrivacySection({ participantId, title }: { participantId: string; title?: string }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason] = useState("");

  const requestsQuery = useQuery({
    queryKey: ["data-deletion-requests", participantId],
    queryFn: () => listDataDeletionRequestsByParticipant(participantId),
    enabled: Boolean(participantId),
  });
  const pendingRequest = requestsQuery.data?.find((request) => request.status === "pending");

  const submitMutation = useMutation({
    mutationFn: () => createDataDeletionRequest(participantId, reason.trim() || undefined),
    onSuccess: async () => {
      toast.success(t("dataPrivacy.deletion.submitted"));
      setModalOpen(false);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["data-deletion-requests", participantId] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("dataPrivacy.deletion.submitFailed"));
    },
  });

  return (
    <>
      <ListGroup title={title ?? t("dataPrivacy.title")}>
        <p className="px-4 pb-1 pt-3.5 text-[13px] leading-snug text-text-secondary">{t("dataPrivacy.description")}</p>
        {/* Plain <a>, not <Link>: this is a file download (the route sets its
            own Content-Disposition), not a page navigation. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/api/patient-data-export" className="transition-ui flex w-full items-center gap-3.5 px-4 py-3.5 text-left hover:bg-surface-hover">
          <IconTile icon={<Download />} size="sm" tone="neutral" />
          <span className="flex-1 text-[15px] font-semibold text-text-primary">{t("dataPrivacy.export")}</span>
          <ChevronRight className="h-4 w-4 text-text-muted" aria-hidden="true" />
        </a>
        {pendingRequest ? (
          <ListRow icon={<Trash2 />} tone="critical" title={t("dataPrivacy.deletion.request")} trailing={<StatusPill tone="warning">{t("dataPrivacy.deletion.pendingSince", { date: formatTimestamp(pendingRequest.createdAt) })}</StatusPill>} />
        ) : (
          <ListRow icon={<Trash2 />} tone="critical" title={t("dataPrivacy.deletion.request")} onClick={() => setModalOpen(true)} />
        )}
      </ListGroup>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t("dataPrivacy.deletion.modalTitle")} description={t("dataPrivacy.deletion.modalDescription")}>
        <div className="space-y-3 p-5">
          <textarea
            className={ptTextareaClass}
            placeholder={t("dataPrivacy.deletion.reasonPlaceholder")}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <PtButton variant="secondary" onClick={() => setModalOpen(false)}>{t("common.cancel")}</PtButton>
            <PtButton variant="danger" loading={submitMutation.isPending} onClick={() => submitMutation.mutate()}>{t("dataPrivacy.deletion.confirm")}</PtButton>
          </div>
        </div>
      </Modal>
    </>
  );
}
