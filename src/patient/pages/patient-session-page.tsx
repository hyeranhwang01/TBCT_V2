"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CircleStop, FileCheck2, LifeBuoy, LoaderCircle, MoreHorizontal, NotebookTabs, ShieldAlert, Sparkles, Type, Volume2, VolumeX, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PatientShell } from "@/patient/components/patient-shell";
import { PatientInputControls } from "@/patient/components/patient-input-controls";
import { StreamingText, TypingIndicator } from "@/patient/components/streaming-text";
import { WorksheetPane } from "@/patient/components/worksheet-pane";
import { BrandMark, EmptyBlock, PtButton, PtCard, PtSkeleton, StatusPill } from "@/patient/components/ui/kit";
import { hasWorksheetBindings } from "@/shared/worksheet/worksheet-binding-registry";
import { ConfirmActionDialog } from "@/shared/components/ui/primitives";
import { fadeScale, fadeUp } from "@/shared/motion/motion-variants";
import { useReducedMotionPreference } from "@/shared/motion/use-reduced-motion-preference";
import { getPatientRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { saveRemoteSessionAuditSnapshot } from "@/patient/lib/audit/remote-session-audit";
import { computeSessionProgressPercent } from "@/shared/runtime/session-progress-estimate";
import { describePatientInputForDisplay } from "@/shared/runtime/patient-input-display";
import { normalizeSpeechText } from "@/patient/lib/speech/normalize-speech-text";
import { readBrowserStorageItem, writeBrowserStorageItem } from "@/shared/browser-storage";
import { resumeRuntimeSession, retryStalledRuntimeNode, startRuntimeSession, submitPatientInput, terminateRuntimeSession } from "@/shared/api/runtime-execution-api";
import type { PatientInput, PatientRuntimeSessionView } from "@/types/runtime-session";
import { useBrowserTts } from "@/patient/lib/speech/use-browser-tts";
import { useT } from "@/shared/i18n/context";
import { sessionLabel, sessionMetaFor, sessionNumberOf } from "@/patient/lib/session-meta";
import { findNewProgressMoment, type ProgressMoment } from "@/patient/lib/progress-moment";
import { TEXT_SCALES, setTextScale, useTextScale } from "@/patient/lib/text-scale";
import { cn } from "@/shared/utils";

// Per-device, not per-participant: muting is a comfort setting for wherever the
// patient happens to be sitting (a shared room, a quiet ward), not a property
// of their record.
const TTS_MUTED_STORAGE_KEY = "tbct.patient.tts.muted";

/** Whether the desktop layout (side worksheet panel) is showing. Only one
 * WorksheetPane may be mounted per session: each opens the same realtime
 * channel, and a second subscriber on it throws. */
function useIsDesktop() {
  const query = "(min-width: 1024px)";
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return matches;
}

function makeClientTurnId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return `TURN-${globalThis.crypto.randomUUID()}`;
  return `TURN-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const STATUS_LABEL_KO: Record<string, string> = { waiting_for_input: "응답 대기", processing: "처리 중", preparing: "준비 중", active: "진행 중", paused: "일시 중지", completed: "완료", created: "생성됨", terminated: "종료됨", safety_paused: "안전 확인 중", escalated: "검토 요청됨", failed: "오류" };
const STATUS_LABEL_EN: Record<string, string> = { waiting_for_input: "Your turn", processing: "Thinking", preparing: "Preparing", active: "In progress", paused: "Paused", completed: "Completed", created: "Created", terminated: "Ended", safety_paused: "Safety check", escalated: "Under review", failed: "Error" };

export function PatientSessionPage() {
  const { t, locale: uiLocale } = useT();
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [worksheetOpen, setWorksheetOpen] = useState(false);
  const isDesktop = useIsDesktop();
  const textScale = useTextScale();
  // The re-rating that landed during this visit, pinned under the answer
  // that produced it -- see findNewProgressMoment.
  const [progressMoment, setProgressMoment] = useState<(ProgressMoment & { afterMessageId?: string }) | null>(null);
  const knownFieldsRef = useRef<Record<string, unknown> | undefined>(undefined);
  // Populated from the same getRuntimeSession call refresh() already makes
  // for the audit snapshot below -- no extra fetch needed. See
  // session-progress-estimate.ts for why this is an estimate, capped short of
  // 100% until the session actually completes.
  const [progressPercent, setProgressPercent] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!isSubmittingTurn) {
      setIsLongWait(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setIsLongWait(true), 2200);
    return () => window.clearTimeout(timer);
  }, [isSubmittingTurn]);
  // Every Program message handed to the speech queue, not only the newest one:
  // a turn can release several at once and all of them have to be read.
  // "Queued" rather than "Read" because an id lands here when it enters the
  // queue, which is well before it is actually spoken.
  const autoQueuedMessageIdsRef = useRef<Set<string>>(new Set());
  // Messages already present the first time the session loads are shown in full;
  // only messages that arrive afterwards stream in, so history never replays.
  const historicalMessageIdsRef = useRef<Set<string> | null>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  // One server turn can deliver several new Program messages at once -- only
  // the ones that finished their own reveal, plus the one currently streaming,
  // are ever rendered (see displayMessages below), so they appear one at a time.
  const [revealedNewMessageIds, setRevealedNewMessageIds] = useState<Set<string>>(new Set());

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["patient-runtime-session", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["runtime-sessions"] }),
      queryClient.invalidateQueries({ queryKey: ["safety-events"] }),
      queryClient.invalidateQueries({ queryKey: ["worksheet-view", sessionId] }),
    ]);
    // WorksheetPane polls on its own timer, independent of the chat turn that
    // fills its fields; invalidating its exact key right after every turn
    // makes it refetch immediately instead of waiting on that poll.
    void getRuntimeSession(sessionId).then(async (auditView) => {
      if (!auditView) return;
      const fields = auditView.session.runtimeContext.fields;
      const moment = knownFieldsRef.current ? findNewProgressMoment(auditView.session.sessionDefinitionId, knownFieldsRef.current, fields) : undefined;
      knownFieldsRef.current = fields;
      if (moment) {
        const lastPatientMessage = [...(queryClient.getQueryData<PatientRuntimeSessionView | null>(["patient-runtime-session", sessionId])?.messages ?? [])].reverse().find((message) => message.role === "patient");
        setProgressMoment({ ...moment, afterMessageId: lastPatientMessage?.id });
      }
      setProgressPercent(
        computeSessionProgressPercent({
          sessionDefinitionId: auditView.session.sessionDefinitionId,
          nodes: auditView.nodes,
          promptItems: auditView.promptItems,
          completedPromptItemIds: auditView.session.completedPromptItemIds ?? [],
          skippedPromptItemIds: auditView.session.skippedPromptItemIds ?? [],
          sessionStatus: auditView.session.status,
          fields: auditView.session.runtimeContext.fields,
        }),
      );
      try { await saveRemoteSessionAuditSnapshot(auditView); }
      catch { toast.warning(uiLocale === "ko" ? "세션은 계속 진행되지만, 원격 감사 기록 저장에는 실패했습니다." : "The session continued, but its remote audit copy could not be saved."); }
    }).catch(() => {});
  };

  // Show the progress estimate as soon as the session opens, not only after
  // the first answer (read-only; the audit snapshot stays tied to turns).
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void getRuntimeSession(sessionId).then((view) => {
      if (!view || cancelled) return;
      knownFieldsRef.current = view.session.runtimeContext.fields;
      setProgressPercent(
        computeSessionProgressPercent({
          sessionDefinitionId: view.session.sessionDefinitionId,
          nodes: view.nodes,
          promptItems: view.promptItems,
          completedPromptItemIds: view.session.completedPromptItemIds ?? [],
          skippedPromptItemIds: view.session.skippedPromptItemIds ?? [],
          sessionStatus: view.session.status,
          fields: view.session.runtimeContext.fields,
        }),
      );
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId]);

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
  // next real state -- but if a step in that chain throws, the session can be
  // left sitting here. A few auto-retries with a growing pause clear the
  // ordinary transient case; the manual button below covers whatever's left.
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

  const messages = useMemo(() => sessionData?.messages ?? [], [sessionData]);
  const activeSession = sessionData?.session;
  const isKoreanSession = uiLocale === "ko";
  // A freshly-created session sits in "created" until something calls
  // startRuntimeSession. The new-session flows navigate here as soon as the
  // row exists, and this effect starts it; autoStartedRef guards re-firing,
  // and the manual Start button is the fallback if the mutation fails.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (activeSession?.status === "created" && !autoStartedRef.current) {
      autoStartedRef.current = true;
      startMutation.mutate();
    }
  }, [activeSession?.status, startMutation]);
  // The session's own content locale (what language the assistant writes and
  // speaks in), NOT the UI chrome locale -- the two can differ, and TTS must
  // pick the voice for the content.
  const displayLocale = activeSession?.locale ?? (uiLocale === "ko" ? "ko-KR" : "en-US");
  const sessionIsOver = activeSession?.status === "completed" || activeSession?.status === "terminated";
  const tts = useBrowserTts(displayLocale);
  const { supported: ttsSupported, speakingMessageId, speak, stop } = tts;
  // Safe to read storage in the initializer: this page is loaded with
  // ssr:false (studio-app.tsx), so there is no server render to mismatch.
  const [ttsMuted, setTtsMuted] = useState(() => readBrowserStorageItem(TTS_MUTED_STORAGE_KEY) === "true");
  const toggleTtsMuted = () => {
    const next = !ttsMuted;
    setTtsMuted(next);
    writeBrowserStorageItem(TTS_MUTED_STORAGE_KEY, String(next));
    if (next) stop();
  };
  // An explicit tap means "say this one, now" -- it interrupts the queue.
  const replayMessage = (messageId: string, content: string) => {
    stop();
    speak(messageId, normalizeSpeechText(content, displayLocale));
  };
  const patientVisibleMessages = useMemo(() => messages.filter((message) => message.role === "patient" || message.role === "assistant" || message.role === "system"), [messages]);
  const latestAssistantMessage = [...patientVisibleMessages].reverse().find((message) => message.role === "assistant");

  // Every historical message and every new patient/system message shows at
  // once; the walk stops right after the first new assistant message that
  // hasn't finished revealing, so a batch appears one message at a time.
  const displayMessages = useMemo(() => {
    const result: typeof patientVisibleMessages = [];
    for (const message of patientVisibleMessages) {
      const isHistorical = historicalMessageIdsRef.current?.has(message.id) ?? true;
      result.push(message);
      if (!isHistorical && message.role === "assistant" && !revealedNewMessageIds.has(message.id)) break;
    }
    return result;
  }, [patientVisibleMessages, revealedNewMessageIds]);

  // Keep the newest message in view: the conversation scrolls inside its own box.
  useEffect(() => {
    const box = messageScrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [displayMessages]);

  useEffect(() => {
    if (historicalMessageIdsRef.current === null && messages.length) {
      historicalMessageIdsRef.current = new Set(messages.map((message) => message.id));
    }
  }, [messages]);

  // Every new approved Program message is read aloud, in the order it
  // appears (driven by displayMessages, the serialized reveal queue).
  useEffect(() => {
    if (!ttsSupported) return;
    for (const message of displayMessages) {
      if (message.role !== "assistant") continue;
      if (autoQueuedMessageIdsRef.current.has(message.id)) continue;
      autoQueuedMessageIdsRef.current.add(message.id);
      // Muting is not a pause: messages that arrive while muted are recorded
      // as handled, so unmuting starts from the next one.
      if (ttsMuted) continue;
      // On reopening, only the question still waiting for an answer is spoken;
      // a finished session opens silently.
      const wasAlreadyOnScreenAtLoad = historicalMessageIdsRef.current?.has(message.id) ?? true;
      if (wasAlreadyOnScreenAtLoad && (sessionIsOver || message.id !== latestAssistantMessage?.id)) continue;
      speak(message.id, normalizeSpeechText(message.content, displayLocale));
    }
  }, [displayMessages, displayLocale, latestAssistantMessage, sessionIsOver, speak, ttsMuted, ttsSupported]);

  // Moving between two sessions does NOT remount this page (studio-app.tsx
  // renders <Page /> with no key), so every per-session ref is dropped on the
  // way out, or session B inherits session A's.
  useEffect(() => () => {
    autoQueuedMessageIdsRef.current = new Set();
    historicalMessageIdsRef.current = null;
    autoStartedRef.current = false;
    knownFieldsRef.current = undefined;
    setProgressMoment(null);
    setRevealedNewMessageIds(new Set());
    stop();
  }, [sessionId, stop]);

  if (sessionQuery.isLoading) return <PatientShell title={uiLocale === "ko" ? "세션" : "Session"} hideHeader><PtSkeleton /></PatientShell>;
  if (!sessionQuery.data || !activeSession) {
    return (
      <PatientShell title={uiLocale === "ko" ? "세션" : "Session"} hideHeader>
        <PtCard>
          <EmptyBlock
            icon={<FileCheck2 />}
            title={uiLocale === "ko" ? "세션을 찾을 수 없습니다" : "Session not found"}
            description={uiLocale === "ko" ? "세션 목록으로 돌아가 새 세션을 시작해 주세요." : "Return to your session list and start a new session."}
            action={<Link href="/projects/demo/patient" className="text-sm font-semibold text-brand-ink underline-offset-4 hover:underline">{t("patientUi.complete.home")}</Link>}
          />
        </PtCard>
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

  const number = sessionNumberOf(activeSession.sessionDefinitionId);
  const meta = sessionMetaFor(activeSession.sessionDefinitionId);
  const hasWorksheet = hasWorksheetBindings(activeSession.sessionDefinitionId);
  const statusLabel = (isKoreanSession ? STATUS_LABEL_KO : STATUS_LABEL_EN)[activeSession.status] ?? activeSession.status;
  const shownPercent = activeSession.status === "completed" ? 100 : progressPercent ?? 0;
  const completionHref = `/projects/demo/patient/sessions/${activeSession.id}/complete`;
  const worksheet = (
    <WorksheetPane
      runtimeSessionId={activeSession.id}
      sessionDefinitionId={activeSession.sessionDefinitionId}
      activeCanonicalFieldKey={currentPromptItem?.outputFields?.[0]}
      variant="patient"
      locale={displayLocale}
      isConversationUpdating={isSubmittingTurn}
    />
  );

  const iconButton = "transition-ui inline-flex h-10 w-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover hover:text-text-primary";

  return (
    <PatientShell title={meta?.title[uiLocale] ?? activeSession.sessionDefinitionId} immersive>
      <div className="flex h-full flex-col">
        {/* Session header */}
        <header className="relative z-10 shrink-0 border-b border-border/70 bg-surface pt-[env(safe-area-inset-top)]">
          <div className="flex h-16 items-center gap-2 px-2 sm:px-4">
            <Link href="/projects/demo/patient" className={iconButton} aria-label={t("patientUi.shell.back")}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-text-secondary">
                {sessionLabel(number, uiLocale)} · <span className="text-text-primary">{meta?.title[uiLocale] ?? activeSession.sessionDefinitionId}</span>
              </h1>
            </div>
            {ttsSupported && (
              <button type="button" onClick={toggleTtsMuted} aria-pressed={ttsMuted} className={cn(iconButton, "hidden sm:inline-flex")} title={ttsMuted ? t("patientUi.session.soundOn") : t("patientUi.session.soundOff")} aria-label={ttsMuted ? t("patientUi.session.soundOn") : t("patientUi.session.soundOff")}>
                {ttsMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
            )}
            {hasWorksheet && (
              <button type="button" onClick={() => setWorksheetOpen(true)} className={cn(iconButton, "lg:hidden")} aria-label={t("patientUi.session.worksheet")} title={t("patientUi.session.worksheet")}>
                <NotebookTabs className="h-5 w-5" />
              </button>
            )}
            <Link href="/crisis" target="_blank" rel="noopener noreferrer" className={cn(iconButton, "text-critical hover:bg-critical-light hover:text-critical")} aria-label={t("patientUi.shell.help")} title={t("patientUi.shell.help")}>
              <LifeBuoy className="h-5 w-5" />
            </Link>
            <div className="relative">
              <button type="button" onClick={() => setMenuOpen((open) => !open)} className={iconButton} aria-haspopup="menu" aria-expanded={menuOpen} aria-label={isKoreanSession ? "더 보기" : "More"}>
                <MoreHorizontal className="h-5 w-5" />
              </button>
              {menuOpen && (
                <>
                  <button type="button" className="fixed inset-0 z-10 cursor-default" aria-hidden="true" tabIndex={-1} onClick={() => setMenuOpen(false)} />
                  <div role="menu" className="pt-rise absolute right-0 top-12 z-20 w-56 overflow-hidden rounded-2xl border border-border bg-surface p-1.5 shadow-[var(--pt-shadow-lg)]">
                    {ttsSupported && (
                      <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={!ttsMuted}
                        onClick={() => { setMenuOpen(false); toggleTtsMuted(); }}
                        className="transition-ui flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-text-primary hover:bg-surface-hover sm:hidden"
                      >
                        {ttsMuted ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                        {ttsMuted ? t("patientUi.session.soundOn") : t("patientUi.session.soundOff")}
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => setTextScale(TEXT_SCALES[(TEXT_SCALES.indexOf(textScale) + 1) % TEXT_SCALES.length])}
                      className="transition-ui flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-text-primary hover:bg-surface-hover"
                    >
                      <Type className="h-4 w-4" />
                      <span className="flex-1">{t("patientUi.profile.textSize")}</span>
                      <span className="text-xs text-text-muted">{t(`patientUi.profile.textSize${TEXT_SCALES.indexOf(textScale) + 1}`)}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={activeSession.status !== "completed"}
                      onClick={() => { setMenuOpen(false); router.push(completionHref); }}
                      className="transition-ui flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-text-primary hover:bg-surface-hover disabled:opacity-40"
                    >
                      <FileCheck2 className="h-4 w-4" />
                      {t("patientUi.session.viewCompletion")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={sessionIsOver}
                      onClick={() => { setMenuOpen(false); setEndConfirmOpen(true); }}
                      className="transition-ui flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-critical hover:bg-critical-light disabled:opacity-40"
                    >
                      <CircleStop className="h-4 w-4" />
                      {t("patientUi.session.end")}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          {meta ? (
            <div className="grid grid-cols-3 gap-1.5 px-4 pb-3 sm:gap-2 sm:px-6" aria-label={progressPercent !== undefined ? t("patientUi.session.progress", { percent: shownPercent }) : statusLabel}>
              {meta.shortSteps[uiLocale].map((step, index) => {
                // The three steps split the progress estimate into thirds; the
                // runtime has no step boundary of its own to report.
                const fill = Math.max(0, Math.min(1, (shownPercent - (index * 100) / 3) / (100 / 3)));
                const reached = shownPercent > (index * 100) / 3 || (index === 0 && shownPercent === 0);
                return (
                  <div key={step} className="min-w-0">
                    <div className="h-1.5 overflow-hidden rounded-full bg-brand-soft">
                      <div className="h-full rounded-full bg-gold transition-[width] duration-700" style={{ width: `${fill * 100}%` }} />
                    </div>
                    <div className={cn("mt-1.5 truncate text-[11px] font-semibold", reached ? "text-text-primary" : "text-text-muted")}>
                      {index + 1}. {step}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-4 pb-3 text-xs text-text-muted sm:px-6">{statusLabel}</div>
          )}
        </header>

        <div className="flex min-h-0 flex-1">
          {/* Conversation */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div ref={messageScrollRef} className="min-h-0 flex-1 overflow-y-auto bg-surface">
              <div className="mx-auto max-w-[680px] space-y-8 px-5 pb-10 pt-4 sm:px-8" style={{ zoom: textScale }}>
                {meta && (
                  // The session opens like a conversation does: what today is
                  // about, said once, then the talk itself.
                  <div className="pb-4 pt-6 text-center sm:pt-10">
                    <div className="text-[13px] font-semibold text-brand-ink">{sessionLabel(number, uiLocale)}</div>
                    <h2 className="mt-1.5 text-[24px] font-bold tracking-[-0.03em] text-text-primary sm:text-[28px]">{meta.title[uiLocale]}</h2>
                    <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-text-secondary">{meta.purpose[uiLocale]}</p>
                    <div className="mx-auto mt-8 flex max-w-lg items-center gap-3 text-[12px] font-medium text-text-muted">
                      <span className="h-px flex-1 bg-border" aria-hidden="true" />
                      {t("patientUi.session.guideNote")}
                      <span className="h-px flex-1 bg-border" aria-hidden="true" />
                    </div>
                  </div>
                )}

                <AnimatePresence initial={false}>
                  {displayMessages.map((message) => {
                    const isNewAssistantTurn = message.role === "assistant" && historicalMessageIdsRef.current !== null && !historicalMessageIdsRef.current.has(message.id);
                    const isSpeaking = message.role === "assistant" && speakingMessageId === message.id;
                    const motionProps = {
                      variants: reducedMotion ? undefined : fadeUp,
                      initial: reducedMotion ? false : ("initial" as const),
                      animate: reducedMotion ? undefined : ("animate" as const),
                      exit: reducedMotion ? undefined : ("exit" as const),
                      layout: reducedMotion ? undefined : true,
                    };
                    if (message.role === "patient") {
                      const showMoment = progressMoment && progressMoment.afterMessageId === message.id;
                      return (
                        <motion.div key={message.id} {...motionProps} className="space-y-4">
                          <div className="flex justify-end">
                            <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-[22px] rounded-br-md bg-brand-soft px-5 py-3.5 text-[16px] leading-relaxed text-text-primary">
                              <span className="sr-only">{t("patientUi.session.you")}: </span>
                              {message.content}
                            </div>
                          </div>
                          {showMoment && <ProgressMomentCard moment={progressMoment} />}
                        </motion.div>
                      );
                    }
                    if (message.role === "system") {
                      return (
                        <motion.div key={message.id} {...motionProps} className="mx-auto max-w-[92%] whitespace-pre-wrap break-words rounded-2xl bg-gold-soft px-4 py-3 text-center text-sm leading-relaxed text-text-primary">
                          {message.content}
                        </motion.div>
                      );
                    }
                    return (
                      <motion.div key={message.id} {...motionProps} className="flex items-start gap-3.5">
                        <span className="relative mt-0.5 shrink-0">
                          <BrandMark className="h-8 w-8" />
                          {isSpeaking && <span className={cn("absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-gold ring-2 ring-surface", !reducedMotion && "animate-pulse")} aria-hidden="true" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <StreamingText
                            streamKey={message.id}
                            text={message.content}
                            active={isNewAssistantTurn}
                            speedMs={8}
                            onDone={() => { if (isNewAssistantTurn) setRevealedNewMessageIds((prev) => (prev.has(message.id) ? prev : new Set(prev).add(message.id))); }}
                            className="whitespace-pre-wrap break-words text-[17px] leading-[1.75] tracking-[-0.01em] text-text-primary"
                          />
                          {isSpeaking && <span className="sr-only" aria-live="polite">{t("patientUi.session.speaking")}</span>}
                          {ttsSupported && !ttsMuted && (
                            <div className="mt-1">
                              <button
                                type="button"
                                onClick={() => replayMessage(message.id, message.content)}
                                title={t("patientUi.session.replay")}
                                aria-label={t("patientUi.session.replay")}
                                className="transition-ui -ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text-primary"
                              >
                                <Volume2 className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                  {progressMoment && !displayMessages.some((message) => message.id === progressMoment.afterMessageId) && (
                    <motion.div key="progress-moment" variants={reducedMotion ? undefined : fadeUp} initial={reducedMotion ? false : "initial"} animate={reducedMotion ? undefined : "animate"}>
                      <ProgressMomentCard moment={progressMoment} />
                    </motion.div>
                  )}
                  {(activeSession.status === "processing" || isSubmittingTurn) && (
                    <motion.div
                      key="typing-indicator"
                      variants={reducedMotion ? undefined : fadeUp}
                      initial={reducedMotion ? false : "initial"}
                      animate={reducedMotion ? undefined : "animate"}
                      exit={reducedMotion ? undefined : "exit"}
                      className="flex items-center gap-3.5"
                    >
                      <BrandMark className="h-8 w-8 shrink-0" />
                      <TypingIndicator />
                    </motion.div>
                  )}
                </AnimatePresence>
                {!messages.length && (
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <LoaderCircle className={cn("h-6 w-6 text-brand", !reducedMotion && "animate-spin")} aria-hidden="true" />
                    <p className="text-sm font-semibold text-text-primary">{isKoreanSession ? "세션을 시작하면 첫 메시지가 표시됩니다." : "Start the session to see the first message."}</p>
                    <p className="max-w-sm text-[13px] text-text-secondary">{isKoreanSession ? "발행된 프로토콜에 따라 현재 단계와 진행 흐름이 결정됩니다." : "The published protocol release will drive the current node and the patient-facing flow."}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Composer dock */}
            <div className="relative shrink-0 bg-surface pb-[env(safe-area-inset-bottom)]">
              <span className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-surface to-transparent" aria-hidden="true" />
              <div className="mx-auto max-w-[680px] px-5 pb-5 pt-2 sm:px-8 sm:pb-6" style={{ zoom: textScale }}>
                <AnimatePresence initial={false}>
                  {showResumeBanner && !inSafetyHold && (
                    <motion.div
                      key="resume-banner"
                      variants={reducedMotion ? undefined : fadeScale}
                      initial={reducedMotion ? false : "initial"}
                      animate={reducedMotion ? undefined : "animate"}
                      exit={reducedMotion ? undefined : "exit"}
                      className="mb-3 rounded-2xl bg-success-light px-4 py-3 text-sm font-medium text-success"
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
                  <motion.div variants={reducedMotion ? undefined : fadeScale} initial={reducedMotion ? false : "initial"} animate={reducedMotion ? undefined : "animate"} className="flex items-center gap-2.5 py-2 text-sm text-text-secondary">
                    <LoaderCircle className={cn("h-4 w-4 shrink-0 text-brand", !reducedMotion && "animate-spin")} aria-hidden="true" />
                    {isLongWait
                      ? isKoreanSession
                        ? "조금 더 친절한 답변을 준비하고 있으니 잠시만 기다려 주세요."
                        : "We’re preparing a more thoughtful response. Please wait just a little longer."
                      : isKoreanSession
                        ? "응답을 확인하고 다음 단계를 준비하고 있습니다."
                        : "We are reviewing your response and preparing the next step."}
                  </motion.div>
                ) : activeSession.status === "paused" ? (
                  <div className="flex flex-col gap-3 py-1 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-text-secondary">{isKoreanSession ? "이 세션은 일시중지되었습니다. 준비되시면 재개 버튼을 눌러주세요." : "This session is paused. Use Resume when you are ready to continue."}</p>
                    <PtButton disabled={resumeMutation.isPending} loading={resumeMutation.isPending} onClick={() => resumeMutation.mutate()}>{isKoreanSession ? "재개" : "Resume"}</PtButton>
                  </div>
                ) : inSafetyHold ? (
                  <motion.div
                    variants={reducedMotion ? undefined : fadeScale}
                    initial={reducedMotion ? false : "initial"}
                    animate={reducedMotion ? undefined : "animate"}
                    className="rounded-2xl border border-critical/25 bg-critical-light p-4 text-sm text-text-primary"
                  >
                    <div className="flex items-center gap-2 font-bold">
                      <ShieldAlert className="h-4 w-4 text-critical" aria-hidden="true" />
                      {isKoreanSession ? "이 세션은 안전 검토를 위해 일시중지되었습니다." : "This session is paused for a safety review."}
                    </div>
                    <div className="mt-2 text-text-secondary">
                      {isKoreanSession
                        ? "검토가 완료될 때까지 일반 입력과 세션 진행이 일시적으로 제한됩니다."
                        : "Regular input and protocol progression are temporarily unavailable until the review is completed."}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <StatusPill tone="critical">{isKoreanSession ? "세션 보류" : "session hold"}</StatusPill>
                      <StatusPill tone="warning">{isKoreanSession ? "검토 대기 중" : "waiting for review"}</StatusPill>
                      <Link href="/crisis" target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1.5 text-[13px] font-bold text-critical underline-offset-4 hover:underline">
                        <LifeBuoy className="h-4 w-4" aria-hidden="true" />
                        {t("patientUi.profile.crisis")}
                      </Link>
                    </div>
                  </motion.div>
                ) : activeSession.status === "completed" ? (
                  <div className="flex flex-col gap-3 py-1 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-text-secondary">{isKoreanSession ? "이 세션이 완료되었습니다. 완료 내역에서 저장된 결과를 확인하세요." : "This session is complete. Use Completion to review the saved result."}</p>
                    <PtButton onClick={() => router.push(completionHref)}>{t("patientUi.session.viewCompletion")}</PtButton>
                  </div>
                ) : activeSession.status === "terminated" ? (
                  <p className="py-2 text-sm text-text-secondary">{isKoreanSession ? "이 세션은 종료되어 더 이상 응답을 제출할 수 없습니다." : "This session has ended and no new input can be submitted."}</p>
                ) : activeSession.status === "active" ? (
                  <div className="flex flex-wrap items-center gap-3 py-1 text-sm text-text-secondary">
                    <span>
                      {isKoreanSession
                        ? `세션을 준비하고 있어요${retryMutation.isPending ? "…" : "."}`
                        : `The session is being prepared${retryMutation.isPending ? "…" : "."}`}
                    </span>
                    <PtButton variant="secondary" size="sm" disabled={retryMutation.isPending} onClick={() => retryMutation.mutate()}>
                      {isKoreanSession ? "다시 시도" : "Try again"}
                    </PtButton>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3 py-1 text-sm text-text-secondary">
                    <span>{isKoreanSession ? "세션을 준비하고 있어요." : "The session is being prepared."}</span>
                    {/* claimRuntimeSessionStart makes a second concurrent start a
                        safe no-op, but disabling while the auto-start is in
                        flight avoids a confusing "nothing happened" click. */}
                    {activeSession.status === "created" && <PtButton size="sm" disabled={startMutation.isPending} onClick={() => startMutation.mutate()}>{isKoreanSession ? "시작" : "Start"}</PtButton>}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Worksheet: side panel on desktop */}
          {hasWorksheet && isDesktop && (
            <aside aria-label={t("patientUi.session.worksheet")} className="hidden min-h-0 w-[44%] max-w-[560px] shrink-0 flex-col border-l border-border bg-surface-subtle lg:flex">
              <div className="min-h-0 flex-1 overflow-y-auto p-4">{worksheet}</div>
            </aside>
          )}
        </div>
      </div>

      {/* Worksheet: bottom sheet on mobile */}
      {hasWorksheet && worksheetOpen && !isDesktop && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={t("patientUi.session.worksheet")}>
          <button type="button" className="absolute inset-0 bg-black/35" aria-label={t("patientUi.session.close")} onClick={() => setWorksheetOpen(false)} />
          <div className="pt-rise absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-[28px] bg-canvas pb-[env(safe-area-inset-bottom)] shadow-[var(--pt-shadow-lg)]">
            <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border-strong" aria-hidden="true" />
            <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-2">
              <div>
                <div className="text-[15px] font-bold text-text-primary">{t("patientUi.session.worksheet")}</div>
                <div className="text-xs text-text-secondary">{t("patientUi.session.worksheetHint")}</div>
              </div>
              <button type="button" onClick={() => setWorksheetOpen(false)} className={iconButton} aria-label={t("patientUi.session.close")}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{worksheet}</div>
          </div>
        </div>
      )}

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

/** The in-conversation "aha": the participant's own starting rating next to
 * the one they just gave. */
function ProgressMomentCard({ moment }: { moment: ProgressMoment }) {
  const { t } = useT();
  const delta = moment.to - moment.from;
  return (
    <div className="pt-rise mx-auto max-w-sm rounded-[22px] border border-gold/40 bg-gold-soft px-5 py-4 text-center" role="status">
      <div className="flex items-center justify-center gap-1.5 text-[13px] font-bold text-gold-strong">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        {t("patientUi.session.momentTitle")}
      </div>
      <div className="mt-1 text-xs font-semibold text-text-secondary">{t(`patientProfile.progress.series.${moment.seriesKey}`)}</div>
      <div className="mt-2 flex items-center justify-center gap-3">
        <span className="text-[26px] font-extrabold tracking-[-0.03em] text-text-muted">{moment.from}%</span>
        <ArrowRight className="h-5 w-5 text-text-muted" aria-hidden="true" />
        <span className="text-[26px] font-extrabold tracking-[-0.03em] text-brand-ink">{moment.to}%</span>
      </div>
      <div className="mt-1 text-xs font-semibold text-text-secondary">
        {delta === 0 ? t("patientUi.session.momentSame") : t(delta < 0 ? "patientUi.session.momentDown" : "patientUi.session.momentUp", { delta: Math.abs(delta) })}
      </div>
    </div>
  );
}

