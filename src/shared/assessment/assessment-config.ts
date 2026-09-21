import type { AssessmentProviderName } from "@/shared/assessment/assessment-contract";

export function getAssessmentConfig() {
  const provider = (process.env.ASSESSMENT_PROVIDER ?? "deterministic") as AssessmentProviderName;
  if (!["anthropic", "groq", "ollama", "gemini", "deterministic"].includes(provider)) throw new Error(`Unsupported ASSESSMENT_PROVIDER: ${provider}`);
  return {
    provider,
    allowCloudPatientAssessment: process.env.ALLOW_CLOUD_PATIENT_ASSESSMENT === "true",
    redactCloudInput: process.env.REDACT_CLOUD_ASSESSMENT_INPUT !== "false",
    // Reuses the keys the dialogue agent already runs on, so turning the
    // semantic gate on adds no second vendor: the same patient sentence is
    // already going to Anthropic on every turn to be phrased.
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY ?? "", model: process.env.ANTHROPIC_MODEL ?? "" },
    groq: { apiKey: process.env.GROQ_API_KEY ?? "", model: process.env.GROQ_MODEL ?? "" },
    ollama: { baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434", model: process.env.OLLAMA_MODEL ?? "" },
    gemini: { apiKey: process.env.GEMINI_API_KEY ?? "", model: process.env.GEMINI_MODEL ?? "" },
  };
}
