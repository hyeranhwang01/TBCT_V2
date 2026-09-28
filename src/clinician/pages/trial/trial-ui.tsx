"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { callTrialStore } from "@/shared/data/repositories/trial-repository";
import { useT } from "@/shared/i18n/context";
import type { TrialStoreOp } from "@/shared/trial/trial-store-ops";

// Shared bits of the trial pages (.claude/TASK_SCOPE.json
// note2026_09_28_rct_backend): every read and write goes through
// /api/trial/store, which decides what each role may do.

export type TrialOp = TrialStoreOp extends infer T ? (T extends unknown ? Omit<T, "actor"> : never) : never;

export function useTrialQuery<T>(key: unknown[], op: TrialOp | null) {
  return useQuery({ queryKey: ["trial", ...key], queryFn: () => callTrialStore<T>(op as TrialStoreOp), enabled: op !== null });
}

/** A write; on success every trial query is refetched. */
export function useTrialAction(onDone?: (result: unknown) => void) {
  const { t } = useT();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (op: TrialOp) => callTrialStore<unknown>(op as TrialStoreOp),
    onSuccess: async (result) => {
      toast.success(t("trial.saved"));
      onDone?.(result);
      await client.invalidateQueries({ queryKey: ["trial"] });
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : t("trial.failed")),
  });
}

function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "✓" : "✗";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 16).replace("T", " ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** A plain table of rows as the store returns them (camelCase keys). */
export function RowsTable({ rows, columns, labels, empty, onRowClick, actions }: {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  labels?: Record<string, string>;
  empty: string;
  onRowClick?: (row: Record<string, unknown>) => void;
  actions?: (row: Record<string, unknown>) => React.ReactNode;
}) {
  if (!rows.length) return <p className="p-4 text-sm text-text-secondary">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead className="border-b border-border bg-surface-subtle text-text-secondary">
          <tr>
            {columns.map((column) => <th key={column} className="px-3 py-2 font-semibold">{labels?.[column] ?? column}</th>)}
            {actions && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id ?? row.studyParticipantId ?? index)} className={`border-b border-border last:border-0 ${onRowClick ? "cursor-pointer hover:bg-surface-hover" : ""}`} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map((column) => <td key={column} className="px-3 py-2 align-top text-text-primary">{cell(row[column])}</td>)}
              {actions && <td className="px-3 py-2 text-right" onClick={(event) => event.stopPropagation()}>{actions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
