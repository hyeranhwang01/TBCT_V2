import { END } from "@langchain/langgraph";
import type { ClinicalStageNode, PromptItem, SourceFidelityEdge } from "@/shared/protocol/source-fidelity-types";
import type { RuntimeContext, RuntimeSessionState } from "@/types/runtime-session";
import { evaluateRuntimeCondition } from "@/shared/runtime/runtime-step-resolver";
import { selectNextRuntimeEdge } from "@/shared/runtime/runtime-condition-evaluator";
import type { TrialStateType } from "./state";

export const SAFETY_NODE = "safety_pause";

/** deliver / collect 노드 id. 노드명은 prompt id 기반이어야 한다(인덱스 금지:
 *  단계가 삽입되면 재번호로 기존 체크포인트가 무효화된다).
 *  '|' 와 ':' 는 체크포인트 네임스페이스 구분자라 사용할 수 없다. */
export const deliverId = (p: Pick<PromptItem, "id">) => `deliver__${sanitize(p.id)}`;
export const collectId = (p: Pick<PromptItem, "id">) => `collect__${sanitize(p.id)}`;
const sanitize = (id: string) => id.replace(/[|:]/g, "_");

export type Catalog = {
  nodes: ClinicalStageNode[];
  promptItems: PromptItem[];
  edges: SourceFidelityEdge[];
};

/** 이 그래프의 상태를 evaluateRuntimeCondition 이 요구하는 형태로 투영한다.
 *  turn.* 합성 플래그는 호출부에서 flags 로 넘긴다 — S08 51개 프롬프트 중 37개가
 *  명시적 completionCondition 없이 이 플래그로만 완료하므로 누락하면 아무것도 진행되지 않는다. */
export function toSessionState(s: TrialStateType, nodeId: string): RuntimeSessionState {
  return {
    releaseId: "langgraph",
    activeNodeId: nodeId,
    activePromptItemId: s.currentPromptId,
    activePromptIndex: 0,
    completedNodeIds: [],
    completedPromptItemIds: [],
    fields: s.ctx.fields,
    turnCount: s.turn,
    nodeIterationCount: 0,
    promptIterationCounts: s.iterations,
  };
}

export const TURN_FLAGS_PATIENT = { "turn.patient_input_validated": true } as const;
export const TURN_FLAGS_ASSISTANT = { "turn.assistant_message_delivered": true } as const;

const promptsOfNode = (node: ClinicalStageNode, cat: Catalog) =>
  node.promptItemIds
    .map((id) => cat.promptItems.find((p) => p.id === id))
    .filter((p): p is PromptItem => Boolean(p))
    .sort((a, b) => (a.sequenceIndex ?? a.order) - (b.sequenceIndex ?? b.order));

const firstPromptOfNode = (nodeId: string, cat: Catalog) => {
  const node = cat.nodes.find((n) => n.id === nodeId);
  return node ? promptsOfNode(node, cat)[0] : undefined;
};

/** 같은 노드에서 다음으로 활성화되는 프롬프트.
 *  activationCondition 이 거짓인 프롬프트는 건너뛴다(원본 resolveNextRuntimePrompt 시맨틱). */
function nextActivePrompt(
  p: PromptItem, node: ClinicalStageNode, cat: Catalog, s: TrialStateType,
): PromptItem | undefined {
  const seq = promptsOfNode(node, cat);
  const idx = seq.findIndex((x) => x.id === p.id);
  const state = toSessionState(s, node.id);
  for (let i = idx + 1; i < seq.length; i += 1) {
    const cand = seq[i];
    const cond = cand.activationCondition as Parameters<typeof evaluateRuntimeCondition>[0];
    if (!cond || evaluateRuntimeCondition(cond, state)) return cand;
  }
  return undefined;
}

export type Router = (s: TrialStateType) => string;
export type RouterSpec = { router: Router; pathMap: Record<string, string> };

/**
 * 라우터는 순수 동기 함수다. async / Date / Math.random 금지 —
 * 그래프 없이 상태 픽스처만으로 전수 테스트할 수 있어야 한다.
 */
export function makeRouter(p: PromptItem, node: ClinicalStageNode, cat: Catalog): RouterSpec {
  const targets = new Set<string>();

  const base: Router = (s) => {
    // ① 반복 루프: 완료조건 미충족 + 예산 남음 -> deliver 로 되돌린다.
    //    collect 가 아니라 deliver 인 이유: 반복마다 문구가 바뀐다
    //    (static-messages/s08.ts 가 ${count} 를 보간하고 다음 미반박 항목을 인용한다).
    if (p.executionMode === "repeat_until") {
      const state = toSessionState(s, node.id);
      const done = evaluateRuntimeCondition(p.completionCondition, state, TURN_FLAGS_PATIENT);
      const spent = s.iterations[p.id] ?? 0;
      const budgetLeft = spent < (p.maxIterations ?? 1);
      if (!done && budgetLeft) return deliverId(p);
    }

    // ② 같은 노드의 다음 프롬프트
    const next = nextActivePrompt(p, node, cat, s);
    if (next) return deliverId(next);

    // ③ 노드 전이 — 기존 엣지 선택 로직에 위임한다.
    //    우선순위 정렬과 "safety edge 는 무조건 fallback 이 될 수 없다"가 그대로 보존된다.
    const outgoing = cat.edges.filter((e) => e.source === node.id);
    const edge = selectNextRuntimeEdge(outgoing, s.ctx as RuntimeContext);
    if (!edge) return END; // terminal 노드는 출력 엣지가 0 -> END
    const firstPrompt = firstPromptOfNode(edge.target, cat);
    return firstPrompt ? deliverId(firstPrompt) : END;
  };

  // pathMap 은 항상 명시한다. 생략하면 LangGraph 가 "모든 노드에 도달 가능"으로
  // 가정해 compile() 의 UnreachableNodeError 검사가 무력화된다.
  if (p.executionMode === "repeat_until") targets.add(deliverId(p));
  for (const q of promptsOfNode(node, cat)) targets.add(deliverId(q));
  for (const e of cat.edges.filter((x) => x.source === node.id)) {
    const fp = firstPromptOfNode(e.target, cat);
    if (fp) targets.add(deliverId(fp));
  }

  return withSafetyGate({ router: base, pathMap: mapOf(targets) }, node);
}

const mapOf = (t: Set<string>) => Object.fromEntries([...t].map((x) => [x, x]));

/** 컴파일러가 모든 라우터를 감싼다. 위기 신호는 다른 어떤 라우팅보다 먼저 평가된다.
 *  safety_pause 자신에게 걸면 self-loop 이 되므로 제외한다. */
export function withSafetyGate(spec: RouterSpec, node: ClinicalStageNode): RouterSpec {
  if (node.id.endsWith("safety-pause")) return spec;
  return {
    router: (s) => (s.crisisSignal ? SAFETY_NODE : spec.router(s)),
    pathMap: { ...spec.pathMap, [SAFETY_NODE]: SAFETY_NODE, [END]: END },
  };
}
