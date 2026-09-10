import type { SourceFidelityReleaseSnapshot } from "@/types/protocol-runtime";
import { normalizeRuntimeReleaseFromSourceSnapshot } from "@/shared/runtime/runtime-release-normalizer";
import type { ProtocolReleaseVersion, RuntimeRelease } from "@/types/protocol-runtime";
import type { RuntimeSession, RuntimeSessionState } from "@/types/runtime-session";

function clone<T>(value: T): T {
  return structuredClone(value);
}

const LEGACY_SEMANTIC_FIELD_MAP: Record<string, string> = {
  "tbct-s01-n05-p03-candidate-two-possibility:response": "candidateTwoPossibility",
};

function normalizeClinicalFields(fields: Record<string, unknown>) {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const semanticKey = LEGACY_SEMANTIC_FIELD_MAP[key];
    if (semanticKey) {
      if (!(semanticKey in fields)) normalized[semanticKey] = value;
      continue;
    }
    // PromptItem-derived response keys were implementation evidence, not clinical fields.
    if (/^tbct-s\d+-n\d+-p\d+-.+:response$/i.test(key)) continue;
    normalized[key] = value;
  }
  return normalized;
}

export function getRuntimeReleaseSourceSnapshot(release: ProtocolReleaseVersion): SourceFidelityReleaseSnapshot {
  const snapshot = release.immutableSnapshot.sourceFidelity;
  if (!snapshot) throw new Error(`Release ${release.id} is missing its immutable source snapshot.`);
  return snapshot;
}

export function loadRuntimeRelease(release: ProtocolReleaseVersion): RuntimeRelease {
  const embedded = release.immutableSnapshot.runtimeRelease;
  if (embedded) return clone(embedded);
  const snapshot = getRuntimeReleaseSourceSnapshot(release);
  return normalizeRuntimeReleaseFromSourceSnapshot({
    releaseId: release.id,
    protocolId: release.protocolId,
    version: release.version,
    publishedAt: release.publishedAt,
    snapshot,
    contentHash: `legacy-${snapshot.sourceTextHash}`,
  });
}

export function normalizeRuntimeSessionState(session: RuntimeSession, release: RuntimeRelease): RuntimeSessionState {
  if (session.runtimeState?.releaseId === release.id) {
    const state = clone(session.runtimeState);
    state.fields = normalizeClinicalFields(state.fields);
    return state;
  }
  const activeNodeId = session.currentNodeId ?? release.nodes[0]?.id;
  if (!activeNodeId) throw new Error(`Release ${release.id} has no runtime nodes.`);
  const node = release.nodes.find((item) => item.id === activeNodeId) ?? release.nodes[0];
  const activePromptItemId = session.currentPromptItemId ?? node?.promptSequence[0];
  const activePromptIndex = Math.max(0, node?.promptSequence.indexOf(activePromptItemId ?? "") ?? 0);
  return {
    releaseId: release.id,
    activeNodeId,
    activePromptItemId,
    activePromptIndex,
    completedNodeIds: [...(session.runtimeState?.completedNodeIds ?? [])],
    completedPromptItemIds: [...(session.completedPromptItemIds ?? [])],
    fields: normalizeClinicalFields(session.runtimeContext.fields),
    turnCount: session.runtimeState?.turnCount ?? 0,
    nodeIterationCount: session.runtimeState?.nodeIterationCount ?? 0,
    promptIterationCounts: { ...(session.runtimeState?.promptIterationCounts ?? {}) },
  };
}
