import type { PromptItem } from "@/shared/protocol/source-fidelity-types";
import type { RuntimeContext } from "@/types/runtime-session";
import {
  applyPromptCompletionEffect,
  getPromptCompletionEffectType,
} from "@/shared/api/runtime-execution-api";
import type { TraceEvent } from "./state";

/**
 * completionEffect 는 정규화 과정에서 RuntimeRelease 로 넘어오지 않는다
 * (runtime-release-normalizer 가 버린다 — RuntimePromptItem 에 해당 필드가 없음).
 * 따라서 반드시 카탈로그의 PromptItem 을 원본으로 써야 한다.
 *
 * S08 에서 쓰이는 효과:
 *   copy_field       — 3단계: coreBelief -> charge (혐의문이 참여자 본인의 말이 되게 하는 장치)
 *   complete_session — 21단계
 *   pause_session    — safety-pause
 */
export type EffectOutcome = {
  ctx: RuntimeContext;
  /** 라우터가 읽어 END / safety_pause 로 보낸다 */
  terminal?: "complete_session" | "pause_session";
  trace: TraceEvent[];
};

export function applyEffect(
  promptItem: PromptItem,
  ctx: RuntimeContext,
  turn: number,
  locale = "ko-KR",
): EffectOutcome {
  const kind = getPromptCompletionEffectType(promptItem);

  // 기존 런타임과 동일한 구현을 그대로 호출한다 (재구현 금지)
  const next = applyPromptCompletionEffect(ctx, promptItem, locale);

  const terminal =
    kind === "complete_session" ? ("complete_session" as const)
    : kind === "pause_session" ? ("pause_session" as const)
    : undefined;

  const trace: TraceEvent[] =
    kind === "advance_prompt"
      ? []
      : [{ kind: "effect", turn, promptId: promptItem.id, effect: kind }];

  return { ctx: next, terminal, trace };
}
