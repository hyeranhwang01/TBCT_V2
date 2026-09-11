import { recordModelUsage } from "@/shared/assessment/model-observability";
import { runtimeFetch } from "@/shared/runtime/resolve-store-url";

// S01 three-person example scene (.claude/TASK_SCOPE.json
// note2026_09_12_s01_redesign). The FORM is fixed by the 2026-09-11 real
// first session: one person says the same warm remark to three people they
// have just met. Only the concrete everyday setting is generated, once per
// session, so the example fits a Korean context. No participant data is ever
// sent to the model -- the participant's own words are used locally, only to
// reject a scene that happens to echo their case. Anything that fails
// validateScene falls back to the real-session scene below.

export type S01Scene = { scene: string; hintTwo: string; hintThree: string };
export type S01SceneSource = "generated" | "fixed_fallback";
export type S01SceneResult = S01Scene & { source: S01SceneSource; rejectReason?: string; model?: string };
export type S01SceneRequest = { locale: string; avoidTerms?: string[] };

export const FIXED_S01_SCENE: Record<"ko" | "en", S01Scene> = {
  ko: {
    scene: "상담자가 처음 만난 세 사람에게 헤어질 때 똑같이 말합니다. “만나서 반가웠어요. 좋으신 분 같아요. 다음 주에 뵙겠습니다.”",
    hintTwo: "빈말이겠지, 뭔가 바라는 게 있나?",
    hintThree: "처음 보는 사람한테 저런 말을? 나를 쉽게 보나?",
  },
  en: {
    scene: "As they say goodbye, a counselor says the same thing to three people they have just met: “It was nice to meet you. You seem like a good person. See you next week.”",
    hintTwo: "They say that to everyone -- do they want something from me?",
    hintThree: "Why say that to someone they just met? Do they think I'm easy?",
  },
};

const DEFAULT_MODEL = "claude-sonnet-5";

function sceneLocale(locale: string): "ko" | "en" {
  return locale.toLowerCase().startsWith("ko") ? "ko" : "en";
}

export function fixedS01Scene(locale: string, rejectReason?: string): S01SceneResult {
  return { ...FIXED_S01_SCENE[sceneLocale(locale)], source: "fixed_fallback", ...(rejectReason ? { rejectReason } : {}) };
}

// Wording that would make the remark itself sound insincere or tense -- the
// scene must be outwardly positive so the three different reactions come
// only from the three different thoughts. Checked on the scene text only
// (the hints are meant to lead to suspicion and anger).
const SCENE_BLOCKLIST: RegExp[] = [
  /비꼬/, /빈정/, /의심/, /수상/, /억지/, /마지못해/, /형식적/, /비웃/, /눈치/, /어색/, /차갑/, /퉁명/, /한숨/, /무시/, /지적/, /비판/, /실수/, /화가/, /짜증/,
  /sarcas/i, /suspic/i, /reluctant/i, /forced/i, /eye-?roll/i, /\bcold(ly)?\b/i, /\bsigh/i, /\bangry\b/i, /annoy/i,
];
const QUOTED = /[“"「『‘]([^”"」』’]{2,})[”"」』’]/;
const KO_PARTICLE = /(으로|에서|에게|한테|까지|부터|이랑|하고|은|는|이|가|을|를|에|께|와|과|도|로|의|만|랑)$/;
const KO_PLURAL = /들$/;
const AVOID_STOPWORDS = new Set([
  "사람", "그냥", "너무", "조금", "정말", "진짜", "그리고", "그래서", "그런데", "오늘", "다음", "지금", "때문", "생각", "마음", "기분", "같아요", "같습니다", "있었어요", "있었다", "했어요", "했다", "없어요", "뭔가", "약간",
  "people", "person", "just", "really", "today", "next", "because", "think", "feel", "that", "this", "with", "have", "were", "they", "them", "there", "what", "when",
]);

function narrativeSentenceCount(scene: string) {
  const narrative = scene.replace(new RegExp(QUOTED.source, "g"), " ");
  return narrative.split(/(?<=[.!?。])\s+|\n+/).map((part) => part.trim()).filter((part) => part.length > 1).length;
}

/** Content words from the participant's own case (situation, thought,
 * problems ...), used only to reject a generated scene that echoes them. */
export function avoidTermsFrom(texts: Array<string | undefined>): string[] {
  const terms = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const raw of text.split(/[\s.,!?~…'"“”‘’()[\]{}·:;/\\-]+/)) {
      let token = raw.trim().toLowerCase();
      // One particle, then one plural 들 -- never both passes of the same
      // rule, and never down to a single syllable ("차이가" -> "차이", not "차").
      for (const tail of [KO_PARTICLE, KO_PLURAL]) {
        const stripped = token.replace(tail, "");
        if (stripped.length >= 2) token = stripped;
      }
      if (token.length < 2 || AVOID_STOPWORDS.has(token)) continue;
      terms.add(token);
    }
  }
  return [...terms];
}

export function validateScene(candidate: Partial<S01Scene> | null | undefined, request: S01SceneRequest): { ok: true } | { ok: false; reason: string } {
  if (!candidate || typeof candidate.scene !== "string" || typeof candidate.hintTwo !== "string" || typeof candidate.hintThree !== "string") return { ok: false, reason: "malformed" };
  const lang = sceneLocale(request.locale);
  const scene = candidate.scene.trim();
  if (!scene) return { ok: false, reason: "empty_scene" };
  if (scene.length > (lang === "ko" ? 160 : 300)) return { ok: false, reason: "scene_too_long" };
  if (!QUOTED.test(scene)) return { ok: false, reason: "no_quoted_remark" };
  if (lang === "ko" ? !/세\s*(사람|명)/.test(scene) : !/\bthree\b/i.test(scene)) return { ok: false, reason: "three_people_not_mentioned" };
  if (narrativeSentenceCount(scene) > 2) return { ok: false, reason: "too_many_sentences" };
  if (SCENE_BLOCKLIST.some((pattern) => pattern.test(scene))) return { ok: false, reason: "blocklisted_wording" };
  for (const hint of [candidate.hintTwo, candidate.hintThree]) {
    const trimmed = hint.trim();
    if (!trimmed || /\n/.test(trimmed) || trimmed.length > (lang === "ko" ? 40 : 90)) return { ok: false, reason: "bad_hint" };
  }
  const lowered = scene.toLowerCase();
  if ((request.avoidTerms ?? []).some((term) => term.length >= 2 && lowered.includes(term.toLowerCase()))) return { ok: false, reason: "echoes_participant_case" };
  return { ok: true };
}

function sceneSystemPrompt(lang: "ko" | "en") {
  return [
    "You write ONE short everyday scene for a CBT psychoeducation exercise about how the same situation can lead to different thoughts.",
    "The form is fixed: one person says the same warm, sincere remark to three people they have just met (for example as a first meeting ends).",
    lang === "ko"
      ? "Set it in an everyday Korean context. The remark must sound natural, polite and plainly positive to a Korean listener -- nothing that would normally be heard as sarcastic, suspicious, overly familiar, flirtatious or pushy."
      : "Set it in an everyday context. The remark must sound natural, polite and plainly positive -- nothing that would normally be heard as sarcastic, suspicious, overly familiar, flirtatious or pushy.",
    "Write at most 2 short narrative sentences plus the remark in quotation marks. Say explicitly that there are three people. Do not describe anyone's reaction, feeling or thought, and do not add any conflict.",
    "Also write two example thoughts someone could have on hearing the remark: hintTwo leads to feeling suspicious, hintThree leads to feeling irritated or angry. Each is one short line of at most 30 characters.",
    lang === "ko" ? "Write everything in Korean (Hangul)." : "Write everything in English.",
    'Return JSON only, no other text: {"scene":"...","hintTwo":"...","hintThree":"..."}',
  ].join(" ");
}

function sceneModeIsFixed() {
  return typeof process !== "undefined" && (process.env.S01_SCENE_MODE ?? "").trim().toLowerCase() === "fixed";
}

/** Server-side generation (the API route and server-run turns call this). */
export async function generateS01SceneOnServer(request: S01SceneRequest, context: { sessionId: string; turnId: string }): Promise<S01SceneResult> {
  if (sceneModeIsFixed()) return fixedS01Scene(request.locale, "scene_mode_fixed");
  if ((process.env.AI_PROVIDER ?? "").trim().toLowerCase() === "mock") return fixedS01Scene(request.locale, "provider_disabled");
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) return fixedS01Scene(request.locale, "missing_api_key");
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const lang = sceneLocale(request.locale);
  const started = performance.now();
  const timeoutMs = Math.min(6000, Math.max(500, Number(process.env.ANTHROPIC_TIMEOUT_MS ?? 5000)));
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system: sceneSystemPrompt(lang),
        messages: [{ role: "user", content: JSON.stringify({ locale: request.locale, referenceScene: FIXED_S01_SCENE[lang] }) }],
      }),
    });
    if (!response.ok) throw new Error(`Anthropic S01 scene failed (${response.status})`);
    const json = await response.json() as { content?: Array<{ text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = json.content?.map((part) => part.text ?? "").join("").replace(/```(?:json)?/g, "").trim() ?? "";
    const parsed = JSON.parse(text) as Partial<S01Scene>;
    const verdict = validateScene(parsed, request);
    recordModelUsage({ sessionId: context.sessionId, turnId: context.turnId, provider: "anthropic", model, purpose: "s01_scene", llmCalled: true, inputTokens: json.usage?.input_tokens ?? null, outputTokens: json.usage?.output_tokens ?? null, totalTokens: json.usage?.input_tokens !== undefined && json.usage.output_tokens !== undefined ? json.usage.input_tokens + json.usage.output_tokens : null, latencyMs: Math.round(performance.now() - started), retryCount: 0, cacheStatus: "none", estimatedCost: null, success: verdict.ok, ...(verdict.ok ? {} : { failureReason: verdict.reason }) });
    if (!verdict.ok) return { ...fixedS01Scene(request.locale, verdict.reason), model };
    return { scene: parsed.scene!.trim(), hintTwo: parsed.hintTwo!.trim(), hintThree: parsed.hintThree!.trim(), source: "generated", model };
  } catch (error) {
    recordModelUsage({ sessionId: context.sessionId, turnId: context.turnId, provider: "anthropic", model, purpose: "s01_scene", llmCalled: true, inputTokens: null, outputTokens: null, totalTokens: null, latencyMs: Math.round(performance.now() - started), retryCount: 0, cacheStatus: "none", estimatedCost: null, success: false, failureReason: error instanceof Error ? error.message : "S01 scene generation failed" });
    return { ...fixedS01Scene(request.locale, "generation_failed"), model };
  }
}

/** Generates the scene where the turn runs: directly on the server, through
 * /api/s01-generation in the browser. Every failure path returns the fixed
 * real-session scene, never an unvalidated one. */
export async function generateS01Scene(request: S01SceneRequest, context: { sessionId: string; turnId: string }): Promise<S01SceneResult> {
  if (sceneModeIsFixed()) return fixedS01Scene(request.locale, "scene_mode_fixed");
  if (typeof window === "undefined") return generateS01SceneOnServer(request, context);
  try {
    const response = await runtimeFetch("/api/s01-generation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "scene", request, context }) });
    const payload = await response.json().catch(() => null) as { ok?: boolean; data?: S01SceneResult } | null;
    if (!response.ok || !payload?.ok || !payload.data) return fixedS01Scene(request.locale, "route_unavailable");
    if (payload.data.source === "generated" && !validateScene(payload.data, request).ok) return fixedS01Scene(request.locale, "route_result_invalid");
    return payload.data;
  } catch {
    return fixedS01Scene(request.locale, "route_unavailable");
  }
}
