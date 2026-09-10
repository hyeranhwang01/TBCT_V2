import type { LanguageGenerationInput, LanguageGenerationResult } from "@/types/runtime-session";

export interface LanguageProvider {
  generate(input: LanguageGenerationInput): Promise<LanguageGenerationResult>;
}
