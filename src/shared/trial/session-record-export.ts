// CSV of sealed session records, one row per message (session-records
// export route, scripts/export-deidentified.ts). Client-safe.

import type { SessionRecordRow } from "@/types/trial";

const COLUMNS = ["participant_id", "module_number", "session_number", "attempt_number", "official", "end_status", "record_sha256", "seq", "role", "created_at", "step", "focus_field", "content"] as const;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  // Spreadsheet formula injection: a cell starting with = + - @ is read as a
  // formula by Excel; a leading apostrophe keeps it text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

type SnapshotMessage = { role: string; content: string; createdAt: string; metadata?: { step?: number | null; focusField?: string | null } };

export function sessionRecordsCsv(records: SessionRecordRow[]): string {
  const lines: string[] = [COLUMNS.join(",")];
  for (const record of records) {
    const conversation = ((record.snapshot as { conversation?: SnapshotMessage[] } | null)?.conversation ?? []);
    conversation.forEach((message, index) => {
      lines.push([
        record.participantId, record.moduleNumber, record.sessionNumber, record.attemptNumber, record.isOfficialAtWrite, record.endStatus, record.contentSha256,
        index + 1, message.role, message.createdAt, message.metadata?.step ?? "", message.metadata?.focusField ?? "", message.content,
      ].map(csvCell).join(","));
    });
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
