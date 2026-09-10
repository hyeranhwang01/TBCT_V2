import type { AssessmentProviderName } from "@/shared/assessment/assessment-contract";

export function getAssessmentConfig() {
  const provider = (process.env.ASSESSMENT_PROVIDER ?? "deterministic") as AssessmentProviderName;
  if (!["groq", "ollama", "gemini", "deterministic"].includes(provider)) throw new Error(`Unsupported ASSESSMENT_PROVIDER: ${provider}`);
  return {
    provider,
    allowCloudPatientAssessment: process.env.ALLOW_CLOUD_PATIENT_ASSESSMENT === "true",
    redactCloudInput: process.env.REDACT_CLOUD_ASSESSMENT_INPUT !== "false",
    groq: { apiKey: process.env.GROQ_API_KEY ?? "", model: process.env.GROQ_MODEL ?? "" },
    ollama: { baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434", model: process.env.OLLAMA_MODEL ?? "" },
    gemini: { apiKey: process.env.GEMINI_API_KEY ?? "", model: process.env.GEMINI_MODEL ?? "" },
  };
}
