import { interrupt } from "@langchain/langgraph";
import type { ClinicalStageNode, PromptItem } from "@/shared/protocol/source-fidelity-types";
import type { RuntimeContext } from "@/types/runtime-session";
import { extractRuntimeState } from "@/shared/runtime/runtime-context";
import { resolveStaticPatientMessage } from "@/shared/runtime/runtime-static-message";
import { applyEffect } from "./effects";
import { observeRules } from "./observe";
import type { TraceEvent, TrialStateType, TrialUpdate } from "./state";
import type { Phraser } from "./phrase";

export type NodeOpts = { phraser: Phraser; locale: string; disabledRuleIds: string[] };

/**
 * deliver — 할 말을 만든다. LLM 은 여기서만 호출된다.
 *
 * collect 와 분리하는 이유: interrupt() 는 재개할 때 노드를 처음부터 재실행한다.
 * 한 노드에 합치면 환자가 답할 때마다 LLM 호출이 반복된다.
 */
export function makeDeliver(p: PromptItem, node: ClinicalStageNode, opts: NodeOpts) {
  return async (s: TrialStateType): Promise<TrialUpdate> => {
    const ctx = s.ctx as RuntimeContext;
    const staticMsg = resolveStaticPatientMessage(p, opts.locale, ctx);
    const text = staticMsg?.patientMessage ?? (await opts.phraser(p, node, ctx));

    const deliverTrace: TraceEvent[] = [
      { kind: "deliver", turn: s.turn, promptId: p.id, llmCalled: !staticMsg },
    ];

    // 환자 입력이 필요 없는 프롬프트는 전달 시점에 완료된다 -> 여기서 효과를 적용한다.
    if (!promptRequiresInput(p)) {
      const seenD = [...((ctx.fields.__seen as string[]) ?? []), p.id];
      const eff = applyEffect(
        p,
        { ...ctx, lastAssistantMessage: text, fields: { ...ctx.fields, __seen: seenD } },
        s.turn, opts.locale,
      );
      return {
        pendingPrompt: text,
        currentPromptId: p.id,
        ctx: eff.ctx,
        // 수동 프롬프트(입력 불필요)는 collect 노드가 없으므로 여기서 관찰한다.
        observations: observeRules(p, eff.ctx, s.turn, opts.disabledRuleIds),
        trace: [...deliverTrace, ...eff.trace],
      };
    }
    // 에코 탐지의 전제: 직전 AI 문구를 상태에 남긴다.
    // (기존 duplicatesRecentQuestion 은 AI 자기 반복만 보고, 환자가 AI 말을 되뇌는 것은 못 본다)
    return {
      pendingPrompt: text,
      currentPromptId: p.id,
      ctx: { ...ctx, lastAssistantMessage: text },
      trace: deliverTrace,
    };
  };
}

/**
 * collect — 환자 입력을 받는다.
 *
 * 규칙: 노드당 interrupt() 정확히 1회, 반드시 첫 줄, try/catch 금지, 반복문 안 금지.
 * 재개 시 이 함수가 처음부터 다시 실행되므로 interrupt 앞에 비멱등 부수효과를 두면 안 된다.
 */
export function makeCollect(p: PromptItem, node: ClinicalStageNode, opts: NodeOpts) {
  return async (s: TrialStateType): Promise<TrialUpdate> => {
    const answer = interrupt<{ promptId: string; text: string }, string>({
      promptId: p.id,
      text: s.pendingPrompt,
    });

    const before = s.ctx as RuntimeContext;
    const seen = [...((before.fields.__seen as string[]) ?? []), p.id];
    const res = await extractRuntimeState({
      patientInput: { kind: "text", value: answer },
      currentNode: node,
      currentPromptItem: p,
      currentContext: before,
      locale: opts.locale,
    });

    const after: RuntimeContext = {
      ...before,
      // 실행 이력. 필드 값이 아니라 "어떤 프롬프트를 거쳤는가"로 판정해야 하는
      // 규칙(VD-03 유죄 재검토, SF-02 안전 중단)이 있어 상태에 남긴다.
      fields: { ...before.fields, ...res.fields, __seen: seen },
      riskLevel: res.riskLevel,
      riskSignals: res.riskSignals,
      responseCategory: res.responseCategory,
      emotionalState: res.emotionalState,
      lastPatientMessage: answer,
    };

    // 위기 신호가 있으면 필드 갱신을 생략한다. 기존 런타임이 같은 턴 안에서
    // 선점(deliverSafetyOverrideTurn)하여 위기 발화를 정상 답변으로 기록하지 않는 것과 맞춘다.
    const crisis = res.riskSignals.length > 0 && res.riskLevel !== "low";
    if (crisis) {
      return {
        crisisSignal: true,
        turn: 1,
        trace: [{ kind: "crisis", turn: s.turn, promptId: p.id }],
      };
    }

    const eff = applyEffect(p, after, s.turn, opts.locale);

    return {
      ctx: eff.ctx,
      turn: 1,
      // 반복 예산은 '수용된 답'에만 증가시킨다. 참여자의 상태 정정(state_corrected)은
      // 완료 조건을 재평가하되 예산을 소비해서는 안 된다(runtime-state-reducer.ts 주석 참조).
      iterations: res.inputDisposition === "state_corrected" ? {} : { [p.id]: 1 },
      observations: observeRules(p, eff.ctx, s.turn, opts.disabledRuleIds),
      trace: [
        { kind: "collect", turn: s.turn, promptId: p.id, disposition: res.inputDisposition ?? "answer_accepted" },
        ...eff.trace,
      ],
    };
  };
}

/** 안전 중단 노드 — 종결 상태. */
export function makeSafetyPause() {
  return async (s: TrialStateType): Promise<TrialUpdate> => ({
    pendingPrompt: "",
    trace: [{ kind: "crisis", turn: s.turn, promptId: "safety_pause" }],
  });
}

/** 릴리스의 requiresPatientInput 과 같은 판정을 카탈로그 PromptItem 에 대해 수행한다. */
export function promptRequiresInput(p: PromptItem): boolean {
  const passive = new Set(["instruction", "explanation", "summary", "closing", "transition", "worksheet_instruction"]);
  if (p.completionEffect && typeof (p.completionEffect as { type?: unknown }).type === "string") {
    const t = (p.completionEffect as { type: string }).type;
    if (t === "complete_session" || t === "pause_session") return false;
  }
  return !passive.has(p.type);
}
