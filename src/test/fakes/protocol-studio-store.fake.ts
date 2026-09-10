import type { AuditEntry } from "@/types";
import type { ProtocolStudioStoreOp } from "@/shared/runtime/protocol-studio-store-ops";

// Minimal in-memory stand-in for src/shared/data/server/protocol-studio-store.ts,
// following the same pattern as safety-store.fake.ts / participant-store.fake.ts.
// saveAuditEntry is called from deep inside ordinary write paths (protocol
// node/session mutations, clinical asset writes), so any test that touches
// those needs this intercepted even if it never asserts on the audit log.

const entries = new Map<string, AuditEntry>();

export function resetFakeProtocolStudioStore() {
  entries.clear();
}

export async function dispatchFakeProtocolStudioStoreOp(op: ProtocolStudioStoreOp): Promise<unknown> {
  switch (op.op) {
    case "listAuditEntries":
      return [...entries.values()].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    case "saveAuditEntry":
      entries.set(op.entry.id, { ...op.entry });
      return op.entry;
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown protocol studio store op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
