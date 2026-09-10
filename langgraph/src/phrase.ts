import type { ClinicalStageNode, PromptItem } from "@/shared/protocol/source-fidelity-types";
import type { RuntimeContext } from "@/types/runtime-session";

/**
 * 문구 생성의 최후 수단. 기본은 mock 이라 외부 API 호출이 0건이다.
 * deliver 노드는 이 함수를 부르기 전에 resolveStaticPatientMessage 로
 * 승인된 문구를 먼저 찾는다(기존 runtime-orchestrator 와 동일한 우선순위).
 *
 * LLM 은 여기서만 쓰인다. 반환값은 pendingPrompt / trace 에만 들어가고
 * 라우터가 읽는 채널(ctx.fields, crisisSignal, iterations)에는 쓰기 경로가 없다.
 */
export type Phraser = (
  promptItem: PromptItem,
  node: ClinicalStageNode,
  ctx: RuntimeContext,
) => Promise<string>;

export const mockPhraser: Phraser = async (promptItem, node) => {
  const fallback = promptItem.fallbackPatientText?.trim();
  if (fallback) return fallback;
  const verbatim = promptItem.verbatimText?.trim();
  if (verbatim) return verbatim;
  return `[${node.title}] ${promptItem.id}`;
};
