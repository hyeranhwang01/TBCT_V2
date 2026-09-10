import type { LanguageProvider } from "@/shared/runtime/providers/language-provider";
import type { LanguageGenerationInput, LanguageGenerationResult } from "@/types/runtime-session";

const DEFAULT_MODEL = "claude-sonnet-5";

export class AnthropicLanguageProvider implements LanguageProvider {
  constructor(private readonly apiKey = process.env.ANTHROPIC_API_KEY ?? "", private readonly model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL) {}

  async generate(input: LanguageGenerationInput): Promise<LanguageGenerationResult> {
    void input; void this.apiKey;
    return { provider: "anthropic", model: this.model, latencyMs: 0, error: "Deprecated full-prompt Anthropic provider is disabled; use the minimal patient renderer." };
  }
}
