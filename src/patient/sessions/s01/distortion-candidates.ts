import { S01_COGNITIVE_DISTORTIONS, S01_DISTORTION_IDS, findDistortionById } from "@/patient/sessions/s01/cognitive-distortions";
import { redactDirectIdentifiers } from "@/lib/assessment/privacy-redaction";
import { recordModelUsage } from "@/lib/assessment/model-observability";

// S01's identify-distortion step must never let Claude invent or diagnose a
// distortion (task redesign brief §1-3, .claude/TASK_SCOPE.json's
// note2026_08_17d entry): the model may only pick FROM the 15 approved
// registry entries, and every returned id is re-validated against the
// registry here regardless of which path produced it (real model or the
// deterministic fallback below) before anything is composed into
// patient-facing text.

export type DistortionCandidate = { id: string; relevanceReason: string };
export type DistortionCandidateRequest = { locale: string; situation: string; automaticThought: string; emotion?: string };
export type DistortionCandidateResult = { candidates: DistortionCandidate[]; provider: "anthropic" | "deterministic"; failed: boolean };

const MIN_CANDIDATES = 4;
const MAX_CANDIDATES = 5;

/** Drops any candidate whose id is not in the approved registry, then caps
 * the list -- the one hard safety gate every path (real model or
 * deterministic) must pass through before candidates are usable. */
export function sanitizeCandidates(raw: Array<{ id: unknown; relevanceReason: unknown }>): DistortionCandidate[] {
  return raw
    .filter((item): item is { id: string; relevanceReason: string } => typeof item.id === "string" && typeof item.relevanceReason === "string" && item.relevanceReason.trim().length > 0)
    .filter((item) => S01_DISTORTION_IDS.has(item.id))
    .slice(0, MAX_CANDIDATES);
}

// Deterministic, offline fallback -- used whenever no live Anthropic key is
// configured (mirrors anthropic-patient-renderer.ts's graceful-degradation
// pattern) and by every test in this codebase's fully-offline suite. NOT a
// clinical NLP classifier: a small set of keyword/phrase triggers per
// distortion, scored by how many of its own triggers appear in the
// participant's own situation+thought text. This is deliberately narrow and
// literal (not a general-purpose semantic matcher) -- its only job is to
// reliably surface the small set of distortions whose surface language most
// plainly echoes the participant's own words when no live model is available,
// while the id-registry gate above stays the actual safety guarantee either way.
const DETERMINISTIC_TRIGGERS: Record<string, RegExp> = {
  "dichotomous-thinking": /전부|모두\s*다|다\s*못하면\s*(?:실패|망)|아니면\s*(?:끝|실패)|완벽하게|완전히\s*(?:망|실패)|all[- ]or[- ]nothing|either.*or.*fail|totally\s*(?:fail|ruin)/i,
  "fortune-telling-catastrophizing": /어떡하지|어떻게\s*하지|실패할\s*(?:거|것)|끔찍|망할|잘못될\s*(?:거|것)|will\s*fail|going\s*to\s*fail|disaster|terrible\s*thing/i,
  "discounting-positive": /그냥\s*운이|우연이었|별거\s*아니|just\s*(?:got\s*)?lucky|no\s*big\s*deal/i,
  "emotional-reasoning": /느끼니까|느껴서.*분명|무서우니까.*분명|since\s*i\s*feel.*must\s*be/i,
  "labeling": /나는\s*(?:패배자|실패자|바보|멍청이)|i\s*am\s*a\s*(?:loser|failure|idiot)/i,
  "magnification-minimization": /역시\s*나는|겨우\s*이\s*정도|고작|기껏해야|not\s*that\s*(?:smart|good)/i,
  "selective-abstraction": /하지만.*마음에\s*안|but.*didn'?t\s*(?:really\s*)?like|한\s*가지만\s*보면|only\s*(?:focus|see)\s*(?:on\s*)?(?:the\s*)?(?:one|bad)/i,
  "mind-reading": /생각하고\s*있을\s*거야|알고\s*있어\s*(?:분명|틀림없)|thinks?\s*(?:that\s*)?i\s*(?:failed|messed)|know\s*what.*thinking/i,
  "overgeneralization": /항상|매번|절대\s*안|모두\s*다\s*그래|always\s*happens|every\s*single\s*time|never\s*works/i,
  "personalizing": /나\s*때문에|나를\s*무시|나\s*보라고|because\s*of\s*me|(?:it'?s|that'?s)\s*about\s*me/i,
  "should-statements": /해야만\s*해|했어야\s*(?:했|해)|반드시\s*(?:해야|이래야)|must\s*(?:be|do)|should\s*have|ought\s*to/i,
  "jumping-to-conclusions": /처음\s*보자마자|바로\s*알았어|right\s*away\s*i\s*knew|immediately\s*(?:knew|concluded)/i,
  "blaming": /때문이야|잘못이야|blame|(?:my|their|his|her)\s*fault/i,
  "what-if": /만약|어떡하지|어떻게\s*하지|what\s*if/i,
  "unfair-comparisons": /저\s*사람은.*나보다|남들은\s*다|다른\s*사람들은|compared\s*to.*better|better\s*than\s*me/i,
};

function scoreDistortion(id: string, text: string): number {
  const pattern = DETERMINISTIC_TRIGGERS[id];
  return pattern && pattern.test(text) ? 1 : 0;
}

export function selectDistortionCandidatesDeterministically(input: { situation: string; automaticThought: string; emotion?: string; locale?: string }): DistortionCandidate[] {
  const text = [input.situation, input.automaticThought, input.emotion ?? ""].join(" \n ");
  const scored = S01_COGNITIVE_DISTORTIONS.map((distortion) => ({ distortion, score: scoreDistortion(distortion.id, text) }));
  const matched = scored.filter((item) => item.score > 0);
  const unmatched = scored.filter((item) => item.score === 0);
  const ordered = [...matched, ...unmatched].slice(0, Math.max(MIN_CANDIDATES, Math.min(MAX_CANDIDATES, matched.length || MIN_CANDIDATES)));
  // English quality parity: previously hardcoded to Korean regardless of
  // locale, so an English-speaking participant on this deterministic
  // (offline) fallback path saw an English distortion name followed by a
  // Korean explanation sentence -- see CognitiveDistortion's doc comment.
  //
  // English drops the quoted example that the Korean line keeps: composing
  // up to MAX_CANDIDATES (5) reasons with both a quote and a description
  // pushed the total patient-facing message past dialogue-output-validator's
  // 700-character limit (Korean fits comfortably -- Hangul syllable blocks
  // convey the same meaning in noticeably fewer characters than English
  // words do), which was silently downgrading every English identify-
  // distortion turn to fallbackUsed even though the text itself was valid.
  // Found via the 8-session simulated-patient audit (en-US) after this pass;
  // descriptionEn was rewritten tersely for the same reason.
  const isKorean = (input.locale ?? "ko-KR").toLowerCase().startsWith("ko");
  return ordered.map(({ distortion }) => ({
    id: distortion.id,
    relevanceReason: isKorean
      ? `"${distortion.exampleKo[0]}"처럼, ${distortion.descriptionKo}`
      : distortion.descriptionEn,
  }));
}

function localeInstruction(locale: string) {
  return locale.toLowerCase().startsWith("ko")
    ? "Write every relevanceReason in Korean (Hangul). Do not respond in English."
    : "Write every relevanceReason in English.";
}

async function selectDistortionCandidatesViaAnthropic(request: DistortionCandidateRequest, context: { sessionId: string; turnId: string }): Promise<{ candidates: DistortionCandidate[]; failed: boolean }> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const model = process.env.ANTHROPIC_MODEL ?? "";
  if (!apiKey || !model) return { candidates: [], failed: true };
  const started = performance.now();
  const timeoutMs = Math.min(6000, Math.max(500, Number(process.env.ANTHROPIC_TIMEOUT_MS ?? 5000)));
  try {
    const registryForModel = S01_COGNITIVE_DISTORTIONS.map((item) => ({ id: item.id, name: item.nameKo, description: item.descriptionKo, example: item.exampleKo[0] }));
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        system: [
          "You help a participant explore which of a FIXED, APPROVED list of cognitive distortions might resemble their own automatic thought.",
          "You must choose ids ONLY from the approved list provided in the user message -- never invent a new distortion name or id.",
          "Choose 4 to 5 ids whose description/example are plausibly similar to the participant's situation and automatic thought. Never fewer than 4 unless the approved list itself has fewer than 4 entries.",
          "For each chosen id, write ONE short, plain-language sentence explaining why it might resemble their thought -- describe a possible resemblance, never assert or diagnose ('this IS your distortion').",
          "Never rank, confirm, or pick a single 'correct' one -- these are candidates for the participant to consider themselves.",
          localeInstruction(request.locale),
          'Return JSON only, no other text: {"candidates":[{"id":"...","relevanceReason":"..."}]}',
        ].join(" "),
        messages: [{ role: "user", content: JSON.stringify({ situation: redactDirectIdentifiers(request.situation), automaticThought: redactDirectIdentifiers(request.automaticThought), emotion: request.emotion ? redactDirectIdentifiers(request.emotion) : undefined, approvedDistortions: registryForModel }) }],
      }),
    });
    if (!response.ok) throw new Error(`Anthropic distortion classifier failed (${response.status})`);
    const json = await response.json() as { content?: Array<{ text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = json.content?.map((part) => part.text ?? "").join("").replace(/```(?:json)?/g, "").trim() ?? "";
    const parsed = JSON.parse(text) as { candidates?: Array<{ id: unknown; relevanceReason: unknown }> };
    const candidates = sanitizeCandidates(parsed.candidates ?? []);
    recordModelUsage({ sessionId: context.sessionId, turnId: context.turnId, provider: "anthropic", model, purpose: "distortion_candidates", llmCalled: true, inputTokens: json.usage?.input_tokens ?? null, outputTokens: json.usage?.output_tokens ?? null, totalTokens: json.usage?.input_tokens !== undefined && json.usage.output_tokens !== undefined ? json.usage.input_tokens + json.usage.output_tokens : null, latencyMs: Math.round(performance.now() - started), retryCount: 0, cacheStatus: "none", estimatedCost: null, success: candidates.length > 0 });
    if (candidates.length === 0) return { candidates: [], failed: true };
    return { candidates, failed: false };
  } catch (error) {
    recordModelUsage({ sessionId: context.sessionId, turnId: context.turnId, provider: "anthropic", model, purpose: "distortion_candidates", llmCalled: true, inputTokens: null, outputTokens: null, totalTokens: null, latencyMs: Math.round(performance.now() - started), retryCount: 0, cacheStatus: "none", estimatedCost: null, success: false, failureReason: error instanceof Error ? error.message : "distortion classification failed" });
    return { candidates: [], failed: true };
  }
}

export async function selectDistortionCandidates(request: DistortionCandidateRequest, context: { sessionId: string; turnId: string }): Promise<DistortionCandidateResult> {
  const viaModel = await selectDistortionCandidatesViaAnthropic(request, context);
  if (!viaModel.failed && viaModel.candidates.length > 0) return { candidates: viaModel.candidates, provider: "anthropic", failed: false };
  const fallback = selectDistortionCandidatesDeterministically(request);
  return { candidates: fallback, provider: "deterministic", failed: viaModel.failed };
}

const FALLBACK_INTRO_KO = "아까 말씀하신 생각과 비교해보기 쉬운 몇 가지 생각 패턴을 골라봤어요.";
const FALLBACK_INTRO_EN = "Here are a few thinking patterns worth comparing with what you shared.";
const FALLBACK_OUTRO_KO = "이 중에서 본인의 생각과 비슷하다고 느껴지는 것이 있나요? 꼭 하나를 고르지 않아도 괜찮고, 없다고 느끼셔도 괜찮습니다.";
const FALLBACK_OUTRO_EN = "Does any of these feel familiar? It's fine if none of them match, or if you're unsure.";

/** Composes the deterministic patient-facing text from validated candidates
 * -- distortion NAMES always come from the registry (never from the model's
 * own wording), so even if the outer dialogue agent rephrases this turn,
 * the names it has to work with are already the approved ones. */
export function composeDistortionCandidateText(candidates: DistortionCandidate[], locale: string): string {
  const isKorean = locale.toLowerCase().startsWith("ko");
  const lines = candidates.map((candidate, index) => {
    const distortion = findDistortionById(candidate.id);
    if (!distortion) return null;
    const name = isKorean ? distortion.nameKo : distortion.nameEn[0];
    return `${index + 1}. ${name}\n   ${candidate.relevanceReason}`;
  }).filter((line): line is string => Boolean(line));
  const intro = isKorean ? FALLBACK_INTRO_KO : FALLBACK_INTRO_EN;
  const outro = isKorean ? FALLBACK_OUTRO_KO : FALLBACK_OUTRO_EN;
  return [intro, "", ...lines, "", outro].join("\n");
}
