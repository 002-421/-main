export const AUTO_UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

export function isAutomaticUpdateCheckDue(lastCheckedAt: unknown, now = Date.now()): boolean {
  if (typeof lastCheckedAt !== 'number' || !Number.isFinite(lastCheckedAt)) return true;
  return now - lastCheckedAt >= AUTO_UPDATE_CHECK_INTERVAL_MS;
}
