// Cuts a finished session (and later homework) into memory chunks
// (.claude/TASK_SCOPE.json note2026_09_27_memory_rag_m2_chunks). Pure: no
// store access -- memory-indexer.ts reads the session and saves what this
// returns.
//
// Three sources:
//  - worksheet: the values the session recorded. A session with a config
//    (chunk-configs.ts) groups them the way a clinician would read them (S01's
//    own moment as one chunk); any other session gets one chunk per text value.
//  - episodes: the conversation, cut where the step changes (the prompt
//    session's focusField, or the node for the node engine); each chunk is the
//    participant's answers with the tail of the question they answered.
//  - homework: one chunk per entry (per filled row for the CD-Quest round).
//
// Nothing that touched safety is kept: a message the program answered with a
// safety response or the safety clarification, the answer to that
// clarification, and any text in which the risk check finds a signal.

import { assessTurnRisk } from "@/shared/runtime/runtime-context";
import { COGNITIVE_DISTORTIONS, findDistortionById } from "@/shared/protocol/cognitive-distortions";
import { stableId } from "@/shared/memory/stable-id";
import type { RuntimeContext, RuntimeMessage } from "@/types/runtime-session";
import type { HomeworkEntryRecord, HomeworkRecord } from "@/types/homework";
import type { LongitudinalMemory } from "@/types/longitudinal-memory";
import type { MemoryChunk, MemoryChunkAuthor, MemoryChunkKind, MemoryChunkLayer, MemoryElementKind } from "@/types/memory-chunks";

/** Bump when the way chunks are cut changes: chunks get new ids, and a
 * rebuild writes the new cut beside the old one instead of over it. */
export const MEMORY_INDEX_VERSION = "chunks-v1";

export const MAX_CHUNK_CHARS = 1200;
const QUESTION_TAIL_CHARS = 100;
const MIN_EPISODE_PARTICIPANT_CHARS = 10;
const VISIBLE_ASSISTANT_STATUSES = new Set(["validated", "delivered", "replaced_by_fallback"]);

/** A chunk before it has ids and bookkeeping. `key` is unique within its
 * session and stable across rebuilds. */
export type ChunkDraft = {
  key: string;
  elementKind: MemoryElementKind;
  content: string;
  fieldNames?: string[];
  distortionIds?: string[];
  messageIds?: string[];
  sourceRef?: string;
};

/** Per-session worksheet cut (chunk-configs.ts). */
export type WorksheetChunker = (fields: Record<string, unknown>, locale: string) => ChunkDraft[];

export type ChunkSessionInput = {
  participantId: string;
  runtimeSessionId: string;
  sessionDefinitionId: string;
  locale: string;
  fields: Record<string, unknown>;
  messages: RuntimeMessage[];
  completedAt: string;
  worksheetChunker?: WorksheetChunker;
};

export function sessionIndexOf(sessionDefinitionId: string): number {
  const match = /s0*(\d+)$/.exec(sessionDefinitionId);
  return match ? Number(match[1]) : 0;
}

export function isKoreanLocale(locale: string | undefined) {
  return (locale ?? "").toLowerCase().startsWith("ko");
}

export function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function cap(text: string, max = MAX_CHUNK_CHARS) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** What the risk check finds in the text -- a current disclosure or wording
 * that would get the safety clarification. */
export function riskSignalsOf(text: string): string[] {
  return assessTurnRisk({ text, currentContext: {} as RuntimeContext }).riskSignals;
}

export function carriesRiskSignal(text: string): boolean {
  return riskSignalsOf(text).length > 0;
}

/** Provenance by where a chunk came from (sql/043, note2026_10_02_memory_rag_v2_phase_a).
 * Nothing built here is an interpretation: those are Phase B. */
export function provenanceOf(kind: MemoryChunkKind): { author: MemoryChunkAuthor; layer: MemoryChunkLayer } {
  if (kind === "clinician_note") return { author: "clinician", layer: "clinician_note" };
  return { author: "participant", layer: kind === "episode" ? "raw" : "record" };
}

/** The registry ids of distortion names as a participant or the model wrote
 * them ("마음읽기", "Mind reading"). */
export function distortionIdsFromNames(names: unknown): string[] {
  const list = Array.isArray(names) ? names : typeof names === "string" ? [names] : [];
  const ids = new Set<string>();
  for (const raw of list) {
    const name = clean(raw).toLowerCase();
    if (!name) continue;
    const match = COGNITIVE_DISTORTIONS.find((item) => name.includes(item.nameKo.toLowerCase()) || item.nameEn.some((en) => name.includes(en.toLowerCase())));
    if (match) ids.add(match.id);
  }
  return [...ids];
}

export function distortionName(id: string, locale: string): string {
  const item = findDistortionById(id);
  if (!item) return id;
  return isKoreanLocale(locale) ? item.nameKo : item.nameEn[0];
}

/** Session without a config: one chunk per text value the session recorded,
 * leaving out what the program itself writes. */
const PROGRAM_OWNED_FIELD = /^(previous|prompt|_)/;
export function defaultWorksheetChunks(fields: Record<string, unknown>): ChunkDraft[] {
  const drafts: ChunkDraft[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (PROGRAM_OWNED_FIELD.test(name)) continue;
    const items = Array.isArray(value) ? value.map(clean) : [clean(value)];
    items.forEach((text, index) => {
      if (text.length < 2) return;
      drafts.push({ key: `field:${name}:${index}`, elementKind: "other", content: text, fieldNames: [name] });
    });
  }
  return drafts;
}

function stepKeyOf(message: RuntimeMessage): string | undefined {
  const focus = message.metadata?.focusField;
  if (typeof focus === "string" && focus) return `focus:${focus}`;
  return message.nodeId ? `node:${message.nodeId}` : undefined;
}

function isSafetyAssistantTurn(message: RuntimeMessage) {
  const meta = message.metadata ?? {};
  return meta.turnOutcome === "safety_override" || meta.clarificationReason === "safety_clarification" || typeof meta.promptSessionSafetyReason === "string";
}

/** The conversation cut into episodes. */
export function episodeChunks(messages: RuntimeMessage[]): ChunkDraft[] {
  const ordered = [...messages].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const visible = ordered.filter((message) => (message.role === "patient" && clean(message.content)) || (message.role === "assistant" && VISIBLE_ASSISTANT_STATUSES.has(message.status)));
  // Participant messages the program answered with a safety turn, and answers
  // to the safety clarification.
  const excluded = new Set<string>();
  visible.forEach((message, index) => {
    if (message.role !== "assistant" || !isSafetyAssistantTurn(message)) return;
    const before = visible[index - 1];
    if (before?.role === "patient") excluded.add(before.id);
    const after = visible[index + 1];
    if (after?.role === "patient" && message.metadata?.turnOutcome !== "safety_override") excluded.add(after.id);
  });

  type Line = { text: string; messageId: string };
  const episodes: Array<{ stepKey?: string; lines: Line[]; firstAnswerId?: string; participantChars: number; focusField?: string }> = [];
  let current: (typeof episodes)[number] | undefined;
  let lastQuestion: RuntimeMessage | undefined;
  for (const message of visible) {
    if (message.role === "assistant") {
      if (isSafetyAssistantTurn(message)) {
        lastQuestion = undefined;
        continue;
      }
      const stepKey = stepKeyOf(message);
      if (!current || (stepKey && stepKey !== current.stepKey)) {
        current = { stepKey, lines: [], participantChars: 0, focusField: typeof message.metadata?.focusField === "string" ? message.metadata.focusField : undefined };
        episodes.push(current);
      }
      lastQuestion = message;
      continue;
    }
    const text = clean(message.content);
    if (excluded.has(message.id) || carriesRiskSignal(text)) continue;
    if (!current) {
      current = { lines: [], participantChars: 0 };
      episodes.push(current);
    }
    if (lastQuestion) {
      const question = clean(lastQuestion.content);
      const tail = question.length > QUESTION_TAIL_CHARS ? `…${question.slice(-QUESTION_TAIL_CHARS)}` : question;
      current.lines.push({ text: `Q: ${tail}`, messageId: lastQuestion.id });
      lastQuestion = undefined;
    }
    current.lines.push({ text: `A: ${text}`, messageId: message.id });
    current.firstAnswerId ??= message.id;
    current.participantChars += text.length;
  }

  const drafts: ChunkDraft[] = [];
  for (const episode of episodes) {
    if (episode.participantChars < MIN_EPISODE_PARTICIPANT_CHARS) continue;
    // Split on line boundaries so no answer is cut in the middle.
    const parts: Line[][] = [[]];
    for (const line of episode.lines) {
      const part = parts[parts.length - 1];
      const length = part.reduce((sum, item) => sum + item.text.length + 1, 0);
      if (part.length && length + line.text.length > MAX_CHUNK_CHARS) parts.push([line]);
      else part.push(line);
    }
    parts.forEach((lines, index) => {
      drafts.push({
        key: `episode:${episode.firstAnswerId}:${index}`,
        elementKind: "conversation",
        content: cap(lines.map((line) => line.text).join("\n")),
        fieldNames: episode.focusField ? [episode.focusField] : [],
        messageIds: [...new Set(lines.map((line) => line.messageId))],
      });
    });
  }
  return drafts;
}

function finish(input: { participantId: string; runtimeSessionId: string; sessionDefinitionId: string; sourceCreatedAt: string; now: string }, kind: MemoryChunkKind, draft: ChunkDraft): MemoryChunk | null {
  const content = cap(clean(draft.content) ? draft.content.trim() : "");
  if (!content) return null;
  // Any risk signal still keeps the text out of memory altogether, as before.
  // sensitivityFlags is the slot the safety code fills when it later keeps a
  // chunk but marks it (retrieval never offers a flagged chunk); from here it
  // is always empty.
  const signals = riskSignalsOf(content);
  if (signals.length) return null;
  return {
    id: `MCH-${stableId(`${MEMORY_INDEX_VERSION}|${input.participantId}|${input.runtimeSessionId}|${draft.key}`)}`,
    participantId: input.participantId,
    runtimeSessionId: input.runtimeSessionId,
    sessionDefinitionId: input.sessionDefinitionId,
    sessionIndex: sessionIndexOf(input.sessionDefinitionId),
    chunkKind: kind,
    elementKind: draft.elementKind,
    fieldNames: draft.fieldNames ?? [],
    sourceMessageIds: draft.messageIds ?? [],
    sourceRef: draft.sourceRef,
    content,
    distortionIds: draft.distortionIds ?? [],
    sourceCreatedAt: input.sourceCreatedAt,
    indexVersion: MEMORY_INDEX_VERSION,
    ...provenanceOf(kind),
    sensitivityFlags: signals,
    tags: null,
    suppressed: false,
    createdAt: input.now,
  };
}

/** Every chunk of a finished session. */
export function buildSessionChunks(input: ChunkSessionInput, now = new Date().toISOString()): MemoryChunk[] {
  const base = { participantId: input.participantId, runtimeSessionId: input.runtimeSessionId, sessionDefinitionId: input.sessionDefinitionId, sourceCreatedAt: input.completedAt, now };
  const worksheet = (input.worksheetChunker ?? ((fields) => defaultWorksheetChunks(fields)))(input.fields, input.locale);
  const chunks = [
    ...worksheet.map((draft) => finish(base, "worksheet", draft)),
    ...episodeChunks(input.messages).map((draft) => finish(base, "episode", draft)),
  ].filter((chunk): chunk is MemoryChunk => chunk !== null);
  return dedupeById(chunks);
}

/** Homework entries of one assignment. S01's distortion examples and S02's
 * CD-Quest rounds are read by their shape; any other entry becomes one chunk
 * of its text values. */
export function buildHomeworkChunks(input: { record: HomeworkRecord; entries: HomeworkEntryRecord[]; locale: string }, now = new Date().toISOString()): MemoryChunk[] {
  const { record, locale } = input;
  const ko = isKoreanLocale(locale);
  const chunks: Array<MemoryChunk | null> = [];
  for (const entry of input.entries) {
    const base = { participantId: record.participantId, runtimeSessionId: record.runtimeSessionId, sessionDefinitionId: record.sessionDefinitionId, sourceCreatedAt: entry.createdAt, now };
    const data = entry.data ?? {};
    const date = clean(data.date);
    if (Array.isArray(data.rows)) {
      (data.rows as Array<Record<string, unknown>>).forEach((row, index) => {
        const example = clean(row.example);
        const id = clean(row.distortionId);
        if (!example || example === "—" || !id) return;
        const score = typeof row.score === "number" ? row.score : undefined;
        const name = distortionName(id, locale);
        const content = ko
          ? `과제 CD-Quest${date ? ` (${date})` : ""} — ${name} 예시: ${example}${score !== undefined ? ` · 점수 ${score}` : ""}`
          : `Homework CD-Quest${date ? ` (${date})` : ""} — ${name} example: ${example}${score !== undefined ? ` · score ${score}` : ""}`;
        chunks.push(finish(base, "homework", { key: `homework:${entry.id}:${index}`, elementKind: "homework", content, distortionIds: [id], sourceRef: entry.id }));
      });
      continue;
    }
    const text = clean(data.text);
    const id = clean(data.distortionId);
    if (text && id) {
      const name = distortionName(id, locale);
      const content = ko ? `과제${date ? ` (${date})` : ""} — ${name} 예시: ${text}` : `Homework${date ? ` (${date})` : ""} — ${name} example: ${text}`;
      chunks.push(finish(base, "homework", { key: `homework:${entry.id}`, elementKind: "homework", content, distortionIds: [id], sourceRef: entry.id }));
      continue;
    }
    const values = Object.entries(data).filter(([key]) => !["schemaVersion", "createdAt", "date"].includes(key)).map(([, value]) => clean(value)).filter((value) => value.length > 1);
    if (values.length) {
      const content = `${ko ? "과제" : "Homework"}${date ? ` (${date})` : ""} — ${values.join(" / ")}`;
      chunks.push(finish(base, "homework", { key: `homework:${entry.id}`, elementKind: "homework", content, sourceRef: entry.id }));
    }
  }
  return dedupeById(chunks.filter((chunk): chunk is MemoryChunk => chunk !== null));
}

/** A clinician note as a chunk. Notes belong to no session (index 0), so
 * every later session can retrieve them; they are rendered to the model as
 * the counsellor's background, never as the participant's words. */
export function clinicianNoteChunkId(memoryId: string) {
  return `MCH-note-${memoryId}`;
}

export function clinicianNoteChunk(note: Pick<LongitudinalMemory, "id" | "participantId" | "sourceSessionId" | "content" | "createdAt">, now = new Date().toISOString()): MemoryChunk | null {
  const chunk = finish(
    { participantId: note.participantId, runtimeSessionId: note.sourceSessionId || `participant:${note.participantId}`, sessionDefinitionId: "clinician-note", sourceCreatedAt: note.createdAt, now },
    "clinician_note",
    { key: `note:${note.id}`, elementKind: "clinician_note", content: note.content, sourceRef: note.id },
  );
  return chunk ? { ...chunk, id: clinicianNoteChunkId(note.id), sessionIndex: 0 } : null;
}

function dedupeById(chunks: MemoryChunk[]) {
  const seen = new Set<string>();
  return chunks.filter((chunk) => (seen.has(chunk.id) ? false : (seen.add(chunk.id), true)));
}
