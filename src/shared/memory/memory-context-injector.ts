import type { LongitudinalMemory } from "@/types/longitudinal-memory";
import type { RuntimeContext } from "@/types/runtime-session";

export function injectLongitudinalMemory(current: RuntimeContext, memories: LongitudinalMemory[]): RuntimeContext {
  return {
    ...current,
    longitudinalMemory: {
      treatmentGoals: memories.filter((memory) => ["session_goal", "treatment_goal"].includes(memory.memoryType)).map((memory) => memory.content),
      patientPreferences: memories.filter((memory) => ["patient_preference", "communication_preference"].includes(memory.memoryType)).map((memory) => memory.content),
      activeHomework: memories.filter((memory) => memory.memoryType === "homework_assignment").map((memory) => memory.content),
      relevantBarriers: memories.filter((memory) => memory.memoryType === "barrier").map((memory) => memory.content),
      copingStrategies: memories.filter((memory) => memory.memoryType === "coping_strategy").map((memory) => memory.content),
    },
  };
}
