import type { ClinicalStageNode, PromptItem } from "@/shared/protocol/source-fidelity-types";
import { loadRuntimeRelease, normalizeRuntimeSessionState } from "@/shared/runtime/runtime-release-loader";
import { orchestrateRuntimeAssistantTurn } from "@/shared/runtime/runtime-orchestrator";
import { resolveActiveRuntimeStep } from "@/shared/runtime/runtime-step-resolver";
import type { ProtocolReleaseVersion } from "@/types/protocol-runtime";
import type { RuntimeMessage, RuntimeSession } from "@/types/runtime-session";

export async function executeRuntimeNodeMessage(session: RuntimeSession, node: ClinicalStageNode, promptItem: PromptItem, options: {
  release: ProtocolReleaseVersion;
  recentMessages: RuntimeMessage[];
}) {
  const runtimeRelease = loadRuntimeRelease(options.release);
  const runtimeState = normalizeRuntimeSessionState(session, runtimeRelease);
  const activeStep = resolveActiveRuntimeStep(runtimeRelease, runtimeState);
  if (!activeStep || activeStep.node.id !== node.id || activeStep.promptItem.id !== promptItem.id) {
    throw new Error(`Requested runtime step ${node.id}/${promptItem.id} does not match ${activeStep?.node.id ?? "none"}/${activeStep?.promptItem.id ?? "none"}.`);
  }
  return orchestrateRuntimeAssistantTurn({
    session,
    release: runtimeRelease,
    state: runtimeState,
    activeStep,
    sourceNode: node,
    sourcePromptItem: promptItem,
    recentMessages: options.recentMessages,
  });
}
