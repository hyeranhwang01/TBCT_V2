"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge, Button, Card, Modal, textareaClass } from "@/components/ui/primitives";
import { createDataDeletionRequest, listDataDeletionRequestsByParticipant } from "@/lib/api/data-deletion-request-api";
import { useT } from "@/lib/i18n/context";

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Patient self-service data export + deletion request -- export is a
 * live read straight from the existing stores (see
 * src/app/api/patient-data-export/route.ts), a plain link since the
 * route sets its own Content-Disposition. Deletion is a REQUEST, not an
 * automatic delete -- see sql/018_data_deletion_requests.sql's own doc
 * comment for why (clinical record-keeping obligations). */
export function DataPrivacySection({ participantId }: { participantId: string }) {
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
    <Card className="p-4">
      <div className="text-sm font-semibold text-text-primary">{t("dataPrivacy.title")}</div>
      <p className="mt-2 text-xs text-text-secondary">{t("dataPrivacy.description")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {/* Plain <a>, not next/link's <Link>: this triggers a file
            download (the route sets its own Content-Disposition), not a
            page navigation -- Link's client-side routing would try to
            intercept the click instead of letting the browser download it. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/api/patient-data-export">
          <Button variant="secondary">{t("dataPrivacy.export")}</Button>
        </a>
        {pendingRequest ? (
          <Badge tone="warning">{t("dataPrivacy.deletion.pendingSince", { date: formatTimestamp(pendingRequest.createdAt) })}</Badge>
        ) : (
          <Button variant="secondary" onClick={() => setModalOpen(true)}>{t("dataPrivacy.deletion.request")}</Button>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t("dataPrivacy.deletion.modalTitle")} description={t("dataPrivacy.deletion.modalDescription")}>
        <div className="space-y-3 p-5">
          <textarea
            className={textareaClass}
            placeholder={t("dataPrivacy.deletion.reasonPlaceholder")}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>{t("common.cancel")}</Button>
            <Button variant="danger" loading={submitMutation.isPending} onClick={() => submitMutation.mutate()}>{t("dataPrivacy.deletion.confirm")}</Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
