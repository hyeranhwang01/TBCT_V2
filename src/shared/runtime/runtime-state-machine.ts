import type { RuntimeSessionStatus } from "@/types/runtime-session";

const allowedTransitions: Record<RuntimeSessionStatus, RuntimeSessionStatus[]> = {
  created: ["preparing", "terminated"],
  preparing: ["active", "failed", "terminated"],
  active: ["waiting_for_input", "processing", "paused", "completed", "terminated", "safety_paused", "escalated"],
  waiting_for_input: ["processing", "paused", "terminated", "safety_paused"],
  processing: ["active", "waiting_for_input", "paused", "safety_paused", "escalated", "completed", "failed", "terminated"],
  paused: ["active", "terminated"],
  safety_paused: ["escalated", "terminated"],
  escalated: ["terminated", "completed"],
  completed: [],
  terminated: [],
  failed: ["paused", "terminated"],
};

export function assertRuntimeTransition(from: RuntimeSessionStatus, to: RuntimeSessionStatus) {
  if (!allowedTransitions[from].includes(to)) {
    throw new Error(`Invalid runtime transition: ${from} -> ${to}`);
  }
}
