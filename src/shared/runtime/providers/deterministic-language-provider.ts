import type { LanguageProvider } from "@/shared/runtime/providers/language-provider";
import type { LanguageGenerationInput } from "@/types/runtime-session";

function patientFacingFallback(input: LanguageGenerationInput) {
  const fallback = input.promptItem.fallbackPatientText?.trim();
  if (fallback && fallback.length <= 600 && !/(?:\bai\b|model|prompt|instruction|system message|runtime state)/i.test(fallback)) return fallback;
  const editableText = input.promptItem.editableText.trim();
  if (editableText && editableText.length <= 600 && !/(?:\bai\b|model|prompt|instruction|system message|runtime state)/i.test(editableText)) return editableText;
  if (input.locale.toLowerCase().startsWith("ko")) return "지금 가장 어렵거나 피하고 싶은 상황은 무엇인가요?";
  if (input.locale.toLowerCase().startsWith("pt")) return "O que está mais difícil ou que você tem evitado neste momento?";
  return "What feels most difficult or most avoided for you right now?";
}

export class DeterministicLanguageProvider implements LanguageProvider {
  async generate(input: LanguageGenerationInput) {
    const startedAt = performance.now();
    const promptText = patientFacingFallback(input);
    return {
      text: input.safetyResult.fixedResponse ?? promptText,
      provider: "deterministic",
      model: "local-template-v1",
      latencyMs: Math.round(performance.now() - startedAt),
      metadata: { locale: input.locale, promptItemId: input.promptItem.id },
    };
  }
}
