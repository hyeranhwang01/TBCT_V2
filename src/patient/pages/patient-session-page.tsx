"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PatientShell } from "@/components/runtime/patient-shell";
import { PatientInputControls } from "@/components/runtime/patient-input-controls";
import { StreamingText, TypingIndicator } from "@/components/runtime/streaming-text";
import { WorksheetPane } from "@/components/runtime/worksheet-pane";
import { hasWorksheetBindings } from "@/lib/worksheet/worksheet-binding-registry";
import { Badge, Button, Card, ConfirmActionDialog, EmptyState, PageSkeleton } from "@/components/ui/primitives";
import { fadeScale, fadeUp } from "@/lib/motion/motion-variants";
import { useReducedMotionPreference } from "@/lib/motion/use-reduced-motion-preference";
import { getPatientRuntimeSession, getRuntimeSession } from "@/lib/api/runtime-session-api";
import { saveRemoteSessionAuditSnapshot } from "@/lib/audit/remote-session-audit";
import { computeSessionProgressPercent } from "@/lib/runtime/session-progress-estimate";
import { describePatientInputForDisplay } from "@/lib/runtime/patient-input-display";
import { resumeRuntimeSession, retryStalledRuntimeNode, startRuntimeSession, submitPatientInput, terminateRuntimeSession } from "@/lib/api/runtime-execution-api";
import type { PatientInput, PatientRuntimeSessionView } from "@/types/runtime-session";
import { useBrowserTts } from "@/lib/speech/use-browser-tts";
import { useT } from "@/lib/i18n/context";

function makeClientTurnId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return `TURN-${globalThis.crypto.randomUUID()}`;
  return `TURN-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function PatientSessionPage() {
  const { locale: uiLocale } = useT();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const reducedMotion = useReducedMotionPreference();
  const sessionId = pathname.split("/").filter(Boolean).at(-1) ?? "";
  const sessionQuery = useQuery({ queryKey: ["patient-runtime-session", sessionId], queryFn: () => getPatientRuntimeSession(sessionId), enabled: Boolean(sessionId) });
  const submittingTurnRef = useRef(false);
  const [isSubmittingTurn, setIsSubmittingTurn] = useState(false);
  const [isLongWait, setIsLongWait] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  // Populated from the same getRuntimeSession call refresh() already makes
  // for the audit snapshot below -- no extra fetch needed, just no longer
  // discarding the result. See session-progress-estimate.ts for why this
  // is an estimate, capped short of 100% until the session actually
  // completes.
  const [progressPercent, setProgressPercent] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!isSubmittingTurn) {
      setIsLongWait(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setIsLongWait(true), 2200);
    return () => window.clearTimeout(timer);
  }, [isSubmittingTurn]);
  const lastAutoReadMessageIdRef = useRef<string | null>(null);
  // Messages already present the first time the session loads are shown in full;
  // only messages that arrive afterwards stream in, so history never replays.
  const historicalMessageIdsRef = useRef<Set<string> | null>(null);
  // One server turn can deliver several new Program messages at once (e.g.
  // a few auto-advanced steps chained before the next one that actually
  // needs a patient answer) -- without this, every one of those bubbles
  // used to mount and start streaming simultaneously the instant they
  // arrived, reading as several replies dumping out in a row instead of a
  // conversation. Tracks which new (post-mount) assistant messages have
  // finished their own reveal; only that many, plus the one currently
  // streaming, are ever rendered -- see displayMessages below.
  const [revealedNewMessageIds, setRevealedNewMessageIds] = useState<Set<string>>(new Set());

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["patient-runtime-session", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["runtime-sessions"] }),
      queryClient.invalidateQueries({ queryKey: ["safety-events"] }),
      queryClient.invalidateQueries({ queryKey: ["worksheet-view", sessionId] }),
    ]);
    // WorksheetPane (see worksheet-pane.tsx) polls on its own 4s timer,
    // independent of the chat turn that actually fills its fields -- with
    // nothing here, a long conversation could sit up to 4s (or, before the
    // await fix in runtime-execution-api.ts, indefinitely) behind what the
    // patient just answered. Invalidating its exact query key right after
    // every turn makes it refetch immediately instead of waiting on its own
    // poll.
    void getRuntimeSession(sessionId).then(async (auditView) => {
      if (!auditView) return;
      setProgressPercent(
        computeSessionProgressPercent({
          sessionDefinitionId: auditView.session.sessionDefinitionId,
          nodes: auditView.nodes,
          promptItems: auditView.promptItems,
          completedPromptItemIds: auditView.session.completedPromptItemIds ?? [],
          skippedPromptItemIds: auditView.session.skippedPromptItemIds ?? [],
          sessionStatus: auditView.session.status,
        }),
      );
      try { await saveRemoteSessionAuditSnapshot(auditView); }
      catch { toast.warning(uiLocale === "ko" ? "세션은 계속 진행되지만, 원격 감사 기록 저장에는 실패했습니다." : "The session continued, but its remote audit copy could not be saved."); }
    }).catch(() => {});
  };

  const startMutation = useMutation({ mutationFn: () => startRuntimeSession(sessionId), onSuccess: async () => { toast.success(uiLocale === "ko" ? "세션이 시작되었습니다" : "Session started"); await refresh(); } });
  const resumeMutation = useMutation({ mutationFn: () => resumeRuntimeSession(sessionId), onSuccess: async () => { toast.success(uiLocale === "ko" ? "세션이 재개되었습니다" : "Session resumed"); await refresh(); } });
  const retryMutation = useMutation({
    mutationFn: () => retryStalledRuntimeNode(sessionId),
    onSuccess: async () => { await refresh(); },
    onError: () => { toast.error(uiLocale === "ko" ? "아직 준비되지 않았습니다 -- 잠시 후 다시 시도해 주세요." : "Still not ready -- please try again in a moment."); },
  });
  const terminateMutation = useMutation({
    mutationFn: () => terminateRuntimeSession(sessionId, "Participant ended session"),
    onSuccess: async () => {
      // Stop all recording and playback when the session ends.
      stop();
      toast.warning(uiLocale === "ko" ? "세션이 종료되었습니다" : "Session terminated");
      await refresh();
    },
  });
  const inputMutation = useMutation({
    mutationFn: ({ currentSessionId, patientInput, clientTurnId, expectedSessionVersion }: { currentSessionId: string; patientInput: PatientInput; clientTurnId: string; expectedSessionVersion: number }) => submitPatientInput(currentSessionId, patientInput, { clientTurnId, expectedSessionVersion, locale: uiLocale === "ko" ? "ko-KR" : "en-US" }),
    onMutate: async ({ patientInput, clientTurnId }) => {
      const queryKey = ["patient-runtime-session", sessionId] as const;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<PatientRuntimeSessionView | null>(queryKey);
      const content = describePatientInputForDisplay(patientInput, displayLocale);
      if (previous) {
        const now = new Date().toISOString();
        queryClient.setQueryData<PatientRuntimeSessionView>(queryKey, {
          ...previous,
          messages: [
            ...previous.messages,
            {
              id: `optimistic-${clientTurnId}`,
              role: "patient",
              content,
              status: "delivered",
              createdAt: now,
              deliveredAt: now,
            },
          ],
        });
      }
      return { previous };
    },
    onSuccess: async (result) => {
      if (result.stateExtraction?.missingFields.length) {
        toast.info(uiLocale === "ko" ? "이 질문에 조금 더 자세히 답해 주시겠어요?" : "Please share a little more so we can stay with this question.");
      }
      await refresh();
    },
    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(["patient-runtime-session", sessionId], context.previous);
      toast.error(uiLocale === "ko" ? "응답을 제출하지 못했습니다. 다시 시도해 주세요." : "We could not submit that response. Please try again.");
    },
    onSettled: () => {
      submittingTurnRef.current = false;
      setIsSubmittingTurn(false);
    },
  });
  const sessionData = sessionQuery.data;
  const session = sessionData?.session;
  const currentNode = sessionData?.currentNode;
  const payload = undefined;
  const currentPromptItem = sessionData?.currentPromptInput;
  const inSafetyHold = session?.status === "safety_paused" || session?.status === "escalated";
  const [showResumeBanner, setShowResumeBanner] = useState(false);
  const [previousHold, setPreviousHold] = useState(inSafetyHold);
  const resumeMessage = useMemo(
    () => (uiLocale === "ko" ? "안전 검토가 완료되었습니다. 이제 세션을 계속 진행하실 수 있어요." : "The safety review is complete. You can continue the session now."),
    [uiLocale],
  );

  // Status "active" is meant to be a brief in-flight moment on the way to the
  // next real state (see executeCurrentNode's recursive chain in
  // runtime-execution-api.ts) -- but if a step in that chain throws, the
  // session can be left sitting here indefinitely with no other recovery
  // path (confirmed live). A few auto-retries with a short, growing pause
  // clear the ordinary transient case without the patient having to do
  // anything; the manual button below covers whatever's left.
  const autoRetryCountRef = useRef(0);
  const isStalledActive = sessionData?.session?.status === "active";
  useEffect(() => {
    if (!isStalledActive) { autoRetryCountRef.current = 0; return undefined; }
    if (autoRetryCountRef.current >= 3) return undefined;
    const delayMs = 4000 * (autoRetryCountRef.current + 1);
    const timer = window.setTimeout(() => {
      autoRetryCountRef.current += 1;
      retryMutation.mutate();
    }, delayMs);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStalledActive, sessionData?.session?.updatedAt]);

  useEffect(() => {
    if (previousHold && !inSafetyHold) {
      setShowResumeBanner(true);
      const timer = window.setTimeout(() => setShowResumeBanner(false), 3200);
      setPreviousHold(false);
      return () => window.clearTimeout(timer);
    }
    setPreviousHold(inSafetyHold);
    return undefined;
  }, [inSafetyHold, previousHold]);

  const messages = sessionData?.messages ?? [];
  const activeSession = sessionData?.session;
  const isKoreanSession = uiLocale === "ko";
  // A freshly-created session sits in "created" status until something
  // calls startRuntimeSession -- patient-new-session-page.tsx used to
  // await that itself (the first AI turn's full generation, sometimes
  // chained through several auto-delivered nodes before the first one
  // that actually needs a patient answer) before ever navigating here,
  // so the "새 세션" button just sat there spinning with no feedback for
  // however long that took. It now navigates immediately once the
  // session row exists; this effect picks up the actual start from here
  // instead, where the existing "처리 중" (processing) state below already
  // gives the patient something to look at while it runs. autoStartedRef
  // guards against re-firing on every refetch/re-render -- if the mutation
  // itself fails, the still-present manual "Start" button (further down)
  // is the fallback, not an automatic retry loop.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (activeSession?.status === "created" && !autoStartedRef.current) {
      autoStartedRef.current = true;
      startMutation.mutate();
    }
  }, [activeSession?.status, startMutation]);
  // The session's own content locale (what language the assistant actually
  // writes/speaks in), NOT the UI chrome locale (uiLocale/isKoreanSession
  // above, which only governs this app's own labels/toasts) -- the two can
  // genuinely differ, e.g. a Korean-UI participant on an English-content
  // test session. Using uiLocale here made TTS select a Korean voice for an
  // English message (or vice versa): a Korean voice given English text
  // commonly spells it out letter by letter rather than reading it as
  // words, since it has no English pronunciation model at all. Falls back
  // to the UI-locale-derived value only until the session record itself
  // has loaded.
  const displayLocale = activeSession?.locale ?? (uiLocale === "ko" ? "ko-KR" : "en-US");
  const tts = useBrowserTts(displayLocale);
  const { supported: ttsSupported, speak, stop } = tts;
  const patientVisibleMessages = messages.filter((message) => message.role === "patient" || message.role === "assistant" || message.role === "system");
  const latestAssistantMessage = [...patientVisibleMessages].reverse().find((message) => message.role === "assistant");

  // Walks patientVisibleMessages in order, including every historical
  // message and every new patient/system message immediately (nothing to
  // gate -- there's no streaming reveal for those), but stopping right
  // after the first new assistant message that hasn't finished revealing
  // yet -- so a batch of several new Program messages still appears one at
  // a time, in order, each one only mounting once the last one is done.
  const displayMessages = useMemo(() => {
    const result: typeof patientVisibleMessages = [];
    for (const message of patientVisibleMessages) {
      const isHistorical = historicalMessageIdsRef.current?.has(message.id) ?? true;
      result.push(message);
      if (!isHistorical && message.role === "assistant" && !revealedNewMessageIds.has(message.id)) break;
    }
    return result;
  }, [patientVisibleMessages, revealedNewMessageIds]);

  useEffect(() => {
    if (historicalMessageIdsRef.current === null && messages.length) {
      historicalMessageIdsRef.current = new Set(messages.map((message) => message.id));
    }
  }, [messages]);

  // Every new approved Program message is read aloud automatically.
  useEffect(() => {
    if (!ttsSupported || !latestAssistantMessage || lastAutoReadMessageIdRef.current === latestAssistantMessage.id) return;
    lastAutoReadMessageIdRef.current = latestAssistantMessage.id;
    speak(latestAssistantMessage.id, latestAssistantMessage.content);
  }, [latestAssistantMessage, speak, ttsSupported]);

  if (sessionQuery.isLoading) return <PatientShell title={uiLocale === "ko" ? "세션" : "Session"}><PageSkeleton /></PatientShell>;
  if (!sessionQuery.data || !activeSession) {
    return (
      <PatientShell title={uiLocale === "ko" ? "세션" : "Session"}>
        <Card>
          <EmptyState
            title={uiLocale === "ko" ? "세션을 찾을 수 없습니다" : "Session not found"}
            description={uiLocale === "ko" ? "세션 목록으로 돌아가 새 세션을 시작해 주세요." : "Return to your session list and start a new session."}
          />
        </Card>
      </PatientShell>
    );
  }

  const submitInput = (patientInput: PatientInput) => {
    if (submittingTurnRef.current || activeSession.status !== "waiting_for_input") return;
    submittingTurnRef.current = true;
    setIsSubmittingTurn(true);
    inputMutation.mutate({
      currentSessionId: sessionId,
      patientInput,
      clientTurnId: makeClientTurnId(),
      expectedSessionVersion: activeSession.version ?? 0,
    });
  };

  return (
    <PatientShell
      title={isKoreanSession && activeSession.patientAlias === "Test Patient" ? "참여자" : activeSession.patientAlias}
      sessionLabel={isKoreanSession ? `${Number(activeSession.sessionDefinitionId.match(/s(\d+)/i)?.[1] ?? 0)}회기` : activeSession.sessionDefinitionId}
      progressLabel={isKoreanSession ? ({ waiting_for_input: "응답 대기", processing: "처리 중", preparing: "준비 중", active: "진행 중", paused: "일시 중지", completed: "완료", created: "생성됨", terminated: "종료됨", safety_paused: "안전 확인 중", escalated: "검토 요청됨", failed: "오류" }[activeSession.status] ?? activeSession.status) : activeSession.status}
      progressPercent={progressPercent}
      saveState={`${isKoreanSession ? "저장됨" : "Saved"} ${new Date(activeSession.updatedAt).toLocaleString(isKoreanSession ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} KST`}
      actions={
        <Button variant="secondary" onClick={() => router.push(`/projects/demo/patient/sessions/${activeSession.id}/complete`)} disabled={activeSession.status !== "completed"}>{isKoreanSession ? "완료 내역" : "Completion"}</Button>
      }
    >
      <div className={hasWorksheetBindings(activeSession.sessionDefinitionId) ? "mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1.1fr_1fr]" : "mx-auto max-w-3xl"}>
        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-text-primary">{isKoreanSession ? "세션" : "Session"}</div>
                <div className="mt-1 text-xs text-text-secondary">{isKoreanSession ? "현재 세션 상태와 참여자에게 승인된 안내만 표시됩니다." : "The patient view shows only the current session state and approved patient-facing safety guidance."}</div>
              </div>
              <div className="flex gap-2">
                {/* claimRuntimeSessionStart (runtime-execution-api.ts) makes a second
                    concurrent start a safe no-op server-side, but disabling
                    this while the auto-start effect's own call is already in
                    flight still avoids a confusing "nothing happened" click. */}
                {activeSession.status === "created" && <Button disabled={startMutation.isPending} onClick={() => startMutation.mutate()}>{isKoreanSession ? "시작" : "Start"}</Button>}
                {activeSession.status === "paused" && <Button disabled={resumeMutation.isPending} onClick={() => resumeMutation.mutate()}>{isKoreanSession ? "재개" : "Resume"}</Button>}
                <Button variant="danger" onClick={() => setEndConfirmOpen(true)}>{isKoreanSession ? "종료" : "End"}</Button>
              </div>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <AnimatePresence initial={false}>
              {displayMessages.map((message) => {
                const isNewAssistantTurn = message.role === "assistant" && historicalMessageIdsRef.current !== null && !historicalMessageIdsRef.current.has(message.id);
                return (
                  <motion.div
                    key={message.id}
                    variants={reducedMotion ? undefined : fadeUp}
                    initial={reducedMotion ? false : "initial"}
                    animate={reducedMotion ? undefined : "animate"}
                    exit={reducedMotion ? undefined : "exit"}
                    layout={reducedMotion ? undefined : true}
                    className={`max-w-[85%] rounded-panel border px-4 py-3 text-sm ${message.role === "patient" ? "ml-auto border-clinical-blue-light bg-clinical-blue-light/60" : message.role === "system" ? "border-warning-light bg-warning-light/60" : "border-border bg-surface-subtle"}`}
                  >
                    <div className="mb-1 text-[11px] font-semibold text-text-muted">{message.role === "assistant" ? (isKoreanSession ? "프로그램" : "Program") : message.role === "patient" ? (isKoreanSession ? "나" : "You") : message.role}</div>
                    <StreamingText
                      streamKey={message.id}
                      text={message.content}
                      active={isNewAssistantTurn}
                      speedMs={8}
                      onDone={() => { if (isNewAssistantTurn) setRevealedNewMessageIds((prev) => (prev.has(message.id) ? prev : new Set(prev).add(message.id))); }}
                      className="whitespace-pre-wrap break-words text-text-primary"
                    />
                  </motion.div>
                );
              })}
              {(activeSession.status === "processing" || isSubmittingTurn) && (
                <motion.div
                  key="typing-indicator"
                  variants={reducedMotion ? undefined : fadeUp}
                  initial={reducedMotion ? false : "initial"}
                  animate={reducedMotion ? undefined : "animate"}
                  exit={reducedMotion ? undefined : "exit"}
                  className="max-w-[85%] rounded-panel border border-border bg-surface-subtle px-4 py-3 text-sm"
                >
                  <div className="mb-1 text-[11px] font-semibold text-text-muted">{isKoreanSession ? "프로그램" : "Program"}</div>
                  <TypingIndicator />
                </motion.div>
              )}
            </AnimatePresence>
            {!messages.length && (
              <EmptyState
                title={isKoreanSession ? "세션을 시작하면 첫 메시지가 표시됩니다." : "Start the session to see the first message."}
                description={isKoreanSession ? "발행된 프로토콜에 따라 현재 단계와 진행 흐름이 결정됩니다." : "The published protocol release will drive the current node and the patient-facing flow."}
              />
            )}
          </div>
          <div className="border-t border-border p-4">
            <AnimatePresence initial={false}>
              {showResumeBanner && !inSafetyHold && (
                <motion.div
                  key="resume-banner"
                  variants={reducedMotion ? undefined : fadeScale}
                  initial={reducedMotion ? false : "initial"}
                  animate={reducedMotion ? undefined : "animate"}
                  exit={reducedMotion ? undefined : "exit"}
                  className="mb-3 rounded-panel border border-success bg-success-light px-4 py-3 text-sm text-text-primary"
                >
                  {resumeMessage}
                </motion.div>
              )}
            </AnimatePresence>
            {activeSession.status === "waiting_for_input" && currentNode && !inSafetyHold && !isSubmittingTurn ? (
              <PatientInputControls
                payload={payload}
                promptItem={currentPromptItem}
                disabled={inputMutation.isPending || isSubmittingTurn}
                onSubmit={submitInput}
                locale={displayLocale}
                onBeforeMic={stop}
              />
            ) : activeSession.status === "processing" || isSubmittingTurn ? (
              <motion.div variants={reducedMotion ? undefined : fadeScale} initial={reducedMotion ? false : "initial"} animate={reducedMotion ? undefined : "animate"} className="text-sm text-text-secondary">
                {isLongWait
                  ? isKoreanSession
                    ? "조금 더 친절한 답변을 준비하고 있으니 잠시만 기다려 주세요."
                    : "We’re preparing a more thoughtful response. Please wait just a little longer."
                  : isKoreanSession
                    ? "응답을 확인하고 다음 단계를 준비하고 있습니다."
                    : "We are reviewing your response and preparing the next step."}
              </motion.div>
            ) : activeSession.status === "paused" ? (
              <div className="text-sm text-text-secondary">
                {isKoreanSession ? "이 세션은 일시중지되었습니다. 준비되시면 재개 버튼을 눌러주세요." : "This session is paused. Use Resume when you are ready to continue."}
              </div>
            ) : inSafetyHold ? (
              <motion.div
                variants={reducedMotion ? undefined : fadeScale}
                initial={reducedMotion ? false : "initial"}
                animate={reducedMotion ? undefined : "animate"}
                className="rounded-panel border border-critical-light bg-critical-light/60 p-4 text-sm text-text-primary"
              >
                <div className="font-semibold">{isKoreanSession ? "이 세션은 안전 검토를 위해 일시중지되었습니다." : "This session is paused for a safety review."}</div>
                <div className="mt-2 text-text-secondary">
                  {isKoreanSession
                    ? "검토가 완료될 때까지 일반 입력과 세션 진행이 일시적으로 제한됩니다."
                    : "Regular input and protocol progression are temporarily unavailable until the review is completed."}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tone="critical">{isKoreanSession ? "세션 보류" : "session hold"}</Badge>
                  <Badge tone="warning">{isKoreanSession ? "검토 대기 중" : "waiting for review"}</Badge>
                </div>
              </motion.div>
            ) : activeSession.status === "completed" ? (
              <div className="text-sm text-text-secondary">
                {isKoreanSession ? "이 세션이 완료되었습니다. 완료 내역에서 저장된 결과를 확인하세요." : "This session is complete. Use Completion to review the saved result."}
              </div>
            ) : activeSession.status === "terminated" ? (
              <div className="text-sm text-text-secondary">
                {isKoreanSession ? "이 세션은 종료되어 더 이상 응답을 제출할 수 없습니다." : "This session has ended and no new input can be submitted."}
              </div>
            ) : activeSession.status === "active" ? (
              <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
                <span>
                  {isKoreanSession
                    ? `세션을 준비하고 있어요${retryMutation.isPending ? "…" : "."}`
                    : `The session is being prepared${retryMutation.isPending ? "…" : "."}`}
                </span>
                <Button variant="secondary" disabled={retryMutation.isPending} onClick={() => retryMutation.mutate()}>
                  {isKoreanSession ? "다시 시도" : "Try again"}
                </Button>
              </div>
            ) : (
              <div className="text-sm text-text-secondary">{isKoreanSession ? "세션을 준비하고 있어요." : "The session is being prepared."}</div>
            )}
          </div>
        </Card>
        {hasWorksheetBindings(activeSession.sessionDefinitionId) && (
          <WorksheetPane
            runtimeSessionId={activeSession.id}
            sessionDefinitionId={activeSession.sessionDefinitionId}
            activeCanonicalFieldKey={currentPromptItem?.outputFields?.[0]}
            variant="patient"
            locale={displayLocale}
            isConversationUpdating={isSubmittingTurn}
          />
        )}
      </div>
      <ConfirmActionDialog
        open={endConfirmOpen}
        onClose={() => setEndConfirmOpen(false)}
        onConfirm={() => { setEndConfirmOpen(false); terminateMutation.mutate(); }}
        title={isKoreanSession ? "세션을 종료하시겠습니까?" : "End this session?"}
        description={isKoreanSession ? "현재까지의 대화는 저장되지만, 종료한 세션은 다시 이어갈 수 없습니다." : "Your conversation is saved, but an ended session cannot be resumed."}
        confirmLabel={isKoreanSession ? "세션 종료" : "End session"}
        confirmDisabled={terminateMutation.isPending}
      />
    </PatientShell>
  );
}
