// Shared guard for every /api/cron/* route. Vercel's Cron feature
// automatically attaches `Authorization: Bearer $CRON_SECRET` to requests it
// sends, once CRON_SECRET is set as a project env var -- this rejects
// everything else, including a guessed URL hit directly from a browser.
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
