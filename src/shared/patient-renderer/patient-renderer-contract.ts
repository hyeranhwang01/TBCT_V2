import { z } from "zod";
export const patientRendererRequestSchema = z.object({ locale: z.string(), patientInputExcerpt: z.string().max(500), reflectionGoal: z.string().max(500), approvedNextQuestion: z.string().optional(), maxWords: z.number().int().min(5).max(35) });
export const patientRendererResultSchema = z.object({ reflection: z.string().min(1).max(400) }).strict();
export type PatientRendererRequest = z.infer<typeof patientRendererRequestSchema>;
export type PatientRendererResult = z.infer<typeof patientRendererResultSchema>;
