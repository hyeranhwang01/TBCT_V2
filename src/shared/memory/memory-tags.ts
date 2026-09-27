// The closed tag list for memory chunks (tags v1). The tagger may only choose
// from these; anything else is dropped. The same list is what the model picks
// currentThemes from on each turn, so a chunk and a moment in a later session
// meet on the same words even when the participant's own words differ
// ("팀장님" in one session, "상사" in the next -> person "boss").
//
// Distortions are the 15 of src/shared/protocol/cognitive-distortions.ts.
// Core-belief categories are the three of the TBCT/CBT literature (helpless,
// unlovable, worthless). The list is for clinical review (Prof. de Oliveira).

import { DISTORTION_IDS } from "@/shared/protocol/cognitive-distortions";
import type { MemoryChunkTags } from "@/types/memory-chunks";

export const MEMORY_TAGS_VERSION = "tags-v1";

type TagList = ReadonlyArray<{ id: string; ko: string; en: string }>;

export const DOMAIN_TAGS = [
  { id: "work_study", ko: "직장·학업", en: "work or study" },
  { id: "family", ko: "가족", en: "family" },
  { id: "partner", ko: "연인·배우자", en: "partner" },
  { id: "friends_social", ko: "친구·사회관계", en: "friends and social life" },
  { id: "health_body", ko: "건강·신체", en: "health and body" },
  { id: "money", ko: "경제", en: "money" },
  { id: "self", ko: "자기 자신", en: "oneself" },
  { id: "daily_other", ko: "일상·기타", en: "daily life, other" },
] as const satisfies TagList;

export const PERSON_TAGS = [
  { id: "boss", ko: "상사·윗사람", en: "boss or senior" },
  { id: "colleague", ko: "동료", en: "colleague" },
  { id: "parent", ko: "부모", en: "parent" },
  { id: "sibling", ko: "형제자매", en: "sibling" },
  { id: "partner", ko: "배우자·연인", en: "partner" },
  { id: "child", ko: "자녀", en: "child" },
  { id: "friend", ko: "친구", en: "friend" },
  { id: "strangers_public", ko: "낯선 사람·대중", en: "strangers or the public" },
  { id: "self", ko: "자기 자신", en: "oneself" },
] as const satisfies TagList;

export const EMOTION_TAGS = [
  { id: "anxiety", ko: "불안·걱정", en: "anxiety, worry" },
  { id: "sadness", ko: "우울·슬픔", en: "sadness, low mood" },
  { id: "anger", ko: "분노·짜증", en: "anger, irritation" },
  { id: "shame", ko: "수치심", en: "shame" },
  { id: "guilt", ko: "죄책감", en: "guilt" },
  { id: "loneliness", ko: "외로움", en: "loneliness" },
  { id: "positive", ko: "긍정(기쁨·안도)", en: "positive (joy, relief)" },
] as const satisfies TagList;

export const BELIEF_TAGS = [
  { id: "helpless", ko: "무력감", en: "helpless" },
  { id: "unlovable", ko: "사랑받지 못함", en: "unlovable" },
  { id: "worthless", ko: "무가치감", en: "worthless" },
  { id: "unclear", ko: "불분명", en: "unclear" },
] as const satisfies TagList;

export const TAG_AXES = {
  domains: DOMAIN_TAGS.map((tag) => tag.id) as string[],
  persons: PERSON_TAGS.map((tag) => tag.id) as string[],
  emotions: EMOTION_TAGS.map((tag) => tag.id) as string[],
  beliefs: BELIEF_TAGS.map((tag) => tag.id) as string[],
  distortions: [...DISTORTION_IDS] as string[],
} satisfies Record<keyof MemoryChunkTags, string[]>;

export type TagAxis = keyof typeof TAG_AXES;
export const TAG_AXIS_NAMES = Object.keys(TAG_AXES) as TagAxis[];

/** Keeps only known ids, once each, in list order. */
export function sanitizeTags(input: unknown): MemoryChunkTags {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const result = {} as MemoryChunkTags;
  for (const axis of TAG_AXIS_NAMES) {
    const given = new Set(Array.isArray(source[axis]) ? (source[axis] as unknown[]).filter((value): value is string => typeof value === "string") : []);
    result[axis] = TAG_AXES[axis].filter((id) => given.has(id));
  }
  return result;
}

export function emptyTags(): MemoryChunkTags {
  return { domains: [], persons: [], emotions: [], beliefs: [], distortions: [] };
}

/** One line per axis, for a model prompt: "domains: work_study (직장·학업), ...". */
export function describeTagList(): string {
  const labelled = (list: TagList) => list.map((tag) => `${tag.id} (${tag.en})`).join(", ");
  return [
    `domains: ${labelled(DOMAIN_TAGS)}`,
    `persons: ${labelled(PERSON_TAGS)}`,
    `emotions: ${labelled(EMOTION_TAGS)}`,
    `beliefs (core-belief category, only when the words point to one): ${labelled(BELIEF_TAGS)}`,
    `distortions: ${TAG_AXES.distortions.join(", ")}`,
  ].join("\n");
}

/** JSON schema of a tag set, for a tool definition. */
export function tagSetJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: TAG_AXIS_NAMES,
    properties: Object.fromEntries(TAG_AXIS_NAMES.map((axis) => [axis, { type: "array", items: { type: "string", enum: TAG_AXES[axis] } }])),
  };
}
