"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeftRight, Check } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, inputClass, textareaClass } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import {
  getSessionCommonRules,
  getSessionPrompts,
  restorePromptItemFromVerbatim,
  saveSessionCommonRules,
  sessionCatalog,
  updatePromptItem,
} from "@/lib/session-catalog";

/**
 * A companion chapter to the Protocol Editor (linked from its header, see
 * protocol-page.tsx) aimed specifically at clinicians who don't want to work
 * through the canvas/inspector -- for each question a session actually asks,
 * shows the original manual wording next to whatever it's been edited to,
 * plainly labeled, so "did I already change this, and from what" is obvious
 * at a glance instead of a single unlabeled badge buried in a details panel.
 *
 * Reads/writes the exact same local draft store as inspector-panel.tsx
 * (session-catalog.ts's getSessionPrompts/updatePromptItem/
 * restorePromptItemFromVerbatim) -- this is a second, friendlier window
 * onto the same data, not a separate copy of it. Edits made here still only
 * reach real patient sessions once published from Protocol Studio, exactly
 * like edits made in the canvas/inspector view.
 */
export function ProtocolManualReflectionPage() {
  const { t } = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedSessionId = searchParams.get("sessionId") ?? "tbct-session-03";
  // session-catalog.ts's store is a plain local (IndexedDB-backed) module,
  // not a react-query cache -- nothing re-renders this page automatically
  // after a mutation, so a tick counter forces a re-read after every edit.
  const [tick, setTick] = useState(0);
  void tick;
  const rerender = () => setTick((value) => value + 1);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [guideModalOpen, setGuideModalOpen] = useState(false);

  // Nothing else re-renders this page on a schedule (session-catalog.ts is a
  // plain local store, not a react-query cache), so the "저장됨 · N분 전"
  // status below would otherwise freeze at whatever it said right after the
  // last edit -- this just re-evaluates that relative time periodically.
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const sessionMeta = sessionCatalog.find((session) => session.id === selectedSessionId);
  const prompts = getSessionPrompts(selectedSessionId);
  const commonRules = getSessionCommonRules(selectedSessionId);

  const handleEditText = (id: string, value: string) => {
    updatePromptItem(id, { editableText: value });
    setLastSavedAt(Date.now());
    rerender();
  };
  const handleEditGuidance = (id: string, value: string) => {
    updatePromptItem(id, { modelGuidance: value });
    setLastSavedAt(Date.now());
    rerender();
  };
  const handleRestoreVerbatim = (id: string) => {
    restorePromptItemFromVerbatim(id);
    setLastSavedAt(Date.now());
    rerender();
  };
  const handleEditTone = (value: string) => {
    if (!commonRules) return;
    saveSessionCommonRules(selectedSessionId, { ...commonRules, roleAndStance: value });
    setLastSavedAt(Date.now());
    rerender();
  };

  const savedStatusLabel = (() => {
    if (lastSavedAt === null) return t("manualReflection.noChangesYet");
    const elapsedMinutes = Math.max(0, Math.round((Date.now() - lastSavedAt) / 60_000));
    return elapsedMinutes < 1 ? t("manualReflection.savedJustNow") : t("manualReflection.savedMinutesAgo", { minutes: elapsedMinutes });
  })();

  return (
    <AppShell>
      <PageHeader
        title={t("manualReflection.pageTitle")}
        description={t("manualReflection.pageDescription")}
        meta={<Badge tone="neutral">{sessionMeta?.title ?? selectedSessionId}</Badge>}
        actions={
          <div className="flex flex-col gap-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">{t("protocolEditor.session")}</div>
            <select
              className={inputClass}
              value={sessionMeta?.id ?? selectedSessionId}
              onChange={(event) => router.push(`/projects/demo/protocols/tbct-br-001/manual-reflection?sessionId=${event.target.value}`)}
            >
              {sessionCatalog.map((session) => (
                <option key={session.id} value={session.id}>{session.number.toString().padStart(2, "0")} · {session.title}</option>
              ))}
            </select>
          </div>
        }
      />
      <div className="space-y-4 p-4 lg:p-6">
        <Card className="border-clinical-blue-light bg-clinical-blue-light/40 p-4">
          <div className="text-sm font-semibold text-text-primary">{t("manualReflection.introTitle")}</div>
          <p className="mt-1 text-sm text-text-secondary">{t("manualReflection.introBody")}</p>
        </Card>

        {commonRules && (
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-primary">{t("manualReflection.toneLabel")}</div>
                <p className="mt-1 max-w-2xl text-[11px] text-text-secondary">{t("manualReflection.toneHint")}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setGuideModalOpen(true)}>{t("manualReflection.commonGuide")}</Button>
            </div>
            <textarea
              className={cn(textareaClass, "mt-3 font-mono text-xs leading-6")}
              value={commonRules.roleAndStance}
              placeholder={t("manualReflection.tonePlaceholder")}
              onChange={(event) => handleEditTone(event.target.value)}
            />
            <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-text-muted">
              <Check className="h-3 w-3 text-success" />
              <span>{t("manualReflection.autosaved")} · {savedStatusLabel}</span>
            </div>
          </Card>
        )}

        {!prompts.length && (
          <Card><EmptyState title={t("manualReflection.emptyTitle")} description={t("manualReflection.emptyBody")} /></Card>
        )}

        {prompts.map((promptItem) => {
          const changed = promptItem.editableText !== promptItem.verbatimText;
          const trace = promptItem.sourceTrace;
          return (
            <Card key={promptItem.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-text-primary">
                  {t("manualReflection.questionNumber", { number: promptItem.order })}
                </div>
                <Badge tone={changed ? "primary" : "neutral"}>
                  {changed ? t("manualReflection.changed") : t("manualReflection.unchanged")}
                </Badge>
              </div>
              {trace?.sourceSection && (
                <div className="text-xs text-text-muted">
                  {t("manualReflection.sourceLabel", { section: trace.sourceSection })}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                <Field label={t("manualReflection.originalLabel")} hint={t("manualReflection.originalHint")}>
                  <textarea className={textareaClass} value={promptItem.verbatimText} readOnly />
                </Field>
                <div className="hidden shrink-0 sm:flex sm:justify-center">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-subtle text-text-muted" aria-hidden>
                    <ArrowLeftRight className="h-4 w-4" />
                  </span>
                </div>
                <Field label={t("manualReflection.currentLabel")} hint={t("manualReflection.currentHint")}>
                  <textarea
                    className={textareaClass}
                    value={promptItem.editableText}
                    onChange={(event) => handleEditText(promptItem.id, event.target.value)}
                  />
                </Field>
              </div>
              <Field label={t("manualReflection.guidanceLabel")} hint={t("manualReflection.guidanceHint")}>
                <textarea
                  className={textareaClass}
                  value={promptItem.modelGuidance ?? ""}
                  onChange={(event) => handleEditGuidance(promptItem.id, event.target.value)}
                />
              </Field>
              {changed && (
                <Button variant="secondary" size="sm" onClick={() => handleRestoreVerbatim(promptItem.id)}>
                  {t("manualReflection.restoreVerbatim")}
                </Button>
              )}
            </Card>
          );
        })}

        <Card className="p-4 text-xs text-text-secondary">
          {t("manualReflection.publishReminder")}{" "}
          <Link href={`/projects/demo/protocols/tbct-br-001/canvas?sessionId=${selectedSessionId}`} className="text-clinical-blue hover:underline">
            {t("manualReflection.goToPublish")}
          </Link>
        </Card>
      </div>

      <Modal
        open={guideModalOpen}
        onClose={() => setGuideModalOpen(false)}
        title={t("manualReflection.commonGuide")}
        description={t("manualReflection.commonGuideDescription")}
      >
        <div className="space-y-4 p-5">
          <GuideField label={t("manualReflection.fieldSessionObjective")} value={commonRules?.sessionObjective} />
          <GuideField label={t("manualReflection.fieldClinicalContext")} value={commonRules?.clinicalContext} />
          <GuideField label={t("manualReflection.fieldPreviousSessionContext")} value={commonRules?.previousSessionContext} />
          <GuideField label={t("manualReflection.fieldLanguageRules")} value={commonRules?.languageAndTerminologyRules} />
          <GuideField label={t("manualReflection.fieldToneRules")} value={commonRules?.toneAndInteractionRules} />
          <GuideField label={t("manualReflection.fieldSafetyRules")} value={commonRules?.safetyAndEscalationRules} />
        </div>
      </Modal>
    </AppShell>
  );
}

function GuideField({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">{value?.trim() ? value : "—"}</p>
    </div>
  );
}
