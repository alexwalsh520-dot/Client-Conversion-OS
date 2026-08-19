// Pakistan-time week boundaries. Pure date math, no imports, safe to use
// from both server routes and client components.
//
// Extracted so the Coach Rankings tab (browser) and the Sunday weekly
// digest (server) agree on exactly where a week starts. PKT is UTC+5
// year round, no DST, so a fixed offset is correct.

export const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** This Monday at 00:00 PKT, as a real UTC instant in ms. */
export function getThisWeekMondayPktMs(now: Date = new Date()): number {
  const nowPkt = new Date(now.getTime() + PKT_OFFSET_MS);
  const dayOfWeek = nowPkt.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const mondayPkt = new Date(nowPkt);
  mondayPkt.setUTCDate(mondayPkt.getUTCDate() - daysBack);
  mondayPkt.setUTCHours(0, 0, 0, 0);
  return mondayPkt.getTime() - PKT_OFFSET_MS;
}

/** Calendar date (YYYY-MM-DD) in Pakistan time for a UTC instant (ms). */
export function pktDateStr(instantMs: number): string {
  return new Date(instantMs + PKT_OFFSET_MS).toISOString().slice(0, 10);
}
