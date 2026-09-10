"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, Card, EmptyState, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { approveMemoryCandidateWithReview, getMemoryReviewQueue, rejectMemoryCandidateWithReview } from "@/lib/api/memory-review-api";

export function RuntimeMemoryReviewPage() {
  const queryClient = useQueryClient();
  const queueQuery = useQuery({ queryKey: ["memory-review-queue"], queryFn: getMemoryReviewQueue });
  const approveMutation = useMutation({
    mutationFn: (candidateId: string) => approveMemoryCandidateWithReview(candidateId, "Approved for continuity"),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["memory-review-queue"] }),
  });
  const rejectMutation = useMutation({
    mutationFn: (candidateId: string) => rejectMemoryCandidateWithReview(candidateId, "Rejected during review"),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["memory-review-queue"] }),
  });
  if (queueQuery.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  return (
    <AppShell>
      <PageHeader title="Memory Review Queue" description="Candidate memories are reviewed before longitudinal runtime use." eyebrow="Stage 3" />
      <div className="space-y-4 p-4 lg:p-6">
        {!queueQuery.data?.length && <Card><EmptyState title="No pending memory candidates" /></Card>}
        {queueQuery.data?.map((candidate) => (
          <Card key={candidate.id} className="p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-text-primary">{candidate.title}</div>
                <div className="mt-1 text-sm text-text-secondary">{candidate.content}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tone="primary">{candidate.memoryType}</Badge>
                  <Badge tone={candidate.isSystemDerived ? "warning" : "success"}>{candidate.isSystemDerived ? "system-derived" : "directly reported"}</Badge>
                  <Badge tone="neutral">{candidate.sensitivity}</Badge>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" loading={approveMutation.isPending} onClick={() => approveMutation.mutate(candidate.id)}>Approve</Button>
                <Button variant="ghost" loading={rejectMutation.isPending} onClick={() => rejectMutation.mutate(candidate.id)}>Reject</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
