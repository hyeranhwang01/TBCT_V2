import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import {
  CANONICAL_STAGE_NODES,
  CANONICAL_PROMPT_ITEMS,
  CANONICAL_SOURCE_EDGES,
} from "@/shared/protocol/source-fidelity-catalog";
import type { ClinicalStageNode, PromptItem } from "@/shared/protocol/source-fidelity-types";
import { TrialState } from "./state";
import { makeDeliver, makeCollect, makeSafetyPause, promptRequiresInput } from "./nodes";
import { makeRouter, deliverId, collectId, SAFETY_NODE, type Catalog } from "./routers";
import { mockPhraser, type Phraser } from "./phrase";

export type CompileOpts = {
  sessionId?: string;
  locale?: string;
  phraser?: Phraser;
  checkpointer?: BaseCheckpointSaver;
  /** 뮤테이션 검증용 — 지정한 규칙의 관찰을 끈다 */
  disableRules?: string[];
};

export function loadCatalog(sessionId = "tbct-s08"): Catalog {
  return {
    nodes: CANONICAL_STAGE_NODES.filter((n) => n.sessionId === sessionId),
    promptItems: CANONICAL_PROMPT_ITEMS.filter((p) => p.sessionId === sessionId),
    edges: CANONICAL_SOURCE_EDGES.filter((e) => e.sessionId === sessionId),
  };
}

/** 컴파일 전에 스펙 자체를 검사한다. 배선 누락은 런타임이 아니라 여기서 실패해야 한다. */
export function assertWellFormed(cat: Catalog) {
  const ids = new Set<string>();
  for (const p of cat.promptItems) {
    if (/[|:]/.test(deliverId(p))) throw new Error(`노드명에 예약문자: ${p.id}`);
    if (ids.has(p.id)) throw new Error(`중복 프롬프트 id: ${p.id}`);
    ids.add(p.id);
  }
  const nodeIds = new Set(cat.nodes.map((n) => n.id));
  for (const e of cat.edges) {
    if (!nodeIds.has(e.source)) throw new Error(`엣지 출발 노드 없음: ${e.source}`);
    if (!nodeIds.has(e.target)) throw new Error(`엣지 도착 노드 없음: ${e.target}`);
  }
  if (cat.nodes.length === 0) throw new Error("노드가 없다");
}

const orderedPrompts = (node: ClinicalStageNode, cat: Catalog): PromptItem[] =>
  node.promptItemIds
    .map((id) => cat.promptItems.find((p) => p.id === id))
    .filter((p): p is PromptItem => Boolean(p))
    .sort((a, b) => (a.sequenceIndex ?? a.order) - (b.sequenceIndex ?? b.order));

export function compileTrialGraph(opts: CompileOpts = {}) {
  const sessionId = opts.sessionId ?? "tbct-s08";
  const cat = loadCatalog(sessionId);
  assertWellFormed(cat);

  const nodeOpts = {
    phraser: opts.phraser ?? mockPhraser,
    locale: opts.locale ?? "ko-KR",
    disabledRuleIds: opts.disableRules ?? [],
  };

  // StateGraph 는 노드명을 타입 파라미터에 누적하는 fluent 빌더라 루프에서 string 으로
  // 붕괴한다(langgraphjs#676, 미해결). 빌더만 한 번 캐스팅하고 결과를 되돌린다.
  const b = new StateGraph(TrialState) as any;

  const safetyNode = cat.nodes.find((n) => n.id.endsWith("safety-pause"));

  for (const node of cat.nodes) {
    for (const p of orderedPrompts(node, cat)) {
      b.addNode(deliverId(p), makeDeliver(p, node, nodeOpts));
      if (promptRequiresInput(p)) {
        b.addNode(collectId(p), makeCollect(p, node, nodeOpts));
        b.addEdge(deliverId(p), collectId(p));
      }
    }
  }
  b.addNode(SAFETY_NODE, makeSafetyPause());

  // 진입점
  const startNode = cat.nodes.find((n) => n.id === sessionStartNodeId(cat)) ?? cat.nodes[0];
  const firstPrompt = orderedPrompts(startNode, cat)[0];
  if (!firstPrompt) throw new Error("시작 노드에 프롬프트가 없다");
  b.addEdge(START, deliverId(firstPrompt));

  // 라우팅 — pathMap 을 항상 명시해 compile() 의 도달불가 검사를 살린다
  for (const node of cat.nodes) {
    if (node.id === safetyNode?.id) continue;
    for (const p of orderedPrompts(node, cat)) {
      const { router, pathMap } = makeRouter(p, node, cat);
      const from = promptRequiresInput(p) ? collectId(p) : deliverId(p);
      b.addConditionalEdges(from, router, { ...pathMap, [END]: END });
    }
  }
  // safety_pause 내부 프롬프트 -> 종료
  if (safetyNode) {
    for (const p of orderedPrompts(safetyNode, cat)) {
      const from = promptRequiresInput(p) ? collectId(p) : deliverId(p);
      b.addEdge(from, SAFETY_NODE);
    }
  }
  b.addEdge(SAFETY_NODE, END);

  return b.compile({ checkpointer: opts.checkpointer ?? new MemorySaver() });
}

function sessionStartNodeId(cat: Catalog) {
  const targets = new Set(cat.edges.map((e) => e.target));
  const roots = cat.nodes.filter((n) => !targets.has(n.id) && !n.id.endsWith("safety-pause"));
  return roots[0]?.id ?? cat.nodes[0]?.id;
}
