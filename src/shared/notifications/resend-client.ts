import { Resend } from "resend";

let client: Resend | undefined;

/** Shared Resend client, lazily constructed from RESEND_API_KEY -- returns
 * undefined (never throws) when the key isn't set, so callers can log and
 * skip sending instead of crashing whatever triggered them. */
export function getResendClient(): Resend | undefined {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return undefined;
  if (!client) client = new Resend(apiKey);
  return client;
}

export const NOTIFICATIONS_FROM_ADDRESS = process.env.NOTIFICATIONS_FROM_EMAIL ?? "TBCT Studio <onboarding@resend.dev>";

/** Best-effort base URL for links inside notification emails -- Vercel injects
 * these two automatically (no env var setup needed); falls back to localhost
 * so links are still well-formed (if unreachable) in local dev. */
export function resolveAppUrl(): string {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : "http://localhost:3000";
}
