// The 15-distortion registry moved to src/shared/protocol/cognitive-distortions.ts
// on 2026-09-21 (.claude/TASK_SCOPE.json note2026_09_21_s02_cognitive_distortions),
// because S02's walkthrough of the same 15 types needs it too. This file stays
// as the S01 entry point so every existing S01 import and test keeps resolving
// under the names they already use.
export type { CognitiveDistortion } from "@/shared/protocol/cognitive-distortions";
export {
  COGNITIVE_DISTORTIONS as S01_COGNITIVE_DISTORTIONS,
  DISTORTION_IDS as S01_DISTORTION_IDS,
  findDistortionById,
} from "@/shared/protocol/cognitive-distortions";
