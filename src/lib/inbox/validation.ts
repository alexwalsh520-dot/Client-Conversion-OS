import { parseCapture, parseSyncPlan } from "@/lib/everfit/sync-validation";
import { record } from "@/lib/everfit/validation";
export { parseSyncPlan };
export function parseInboxCapture(value: unknown) {
  const raw = record(value);
  const capture = parseCapture(raw);
  if (typeof raw.newestReached !== "boolean" || typeof raw.historyStartReached !== "boolean")
    throw new Error("Explicit newest/history boundary evidence is required.");
  // The old weekly collector's historyComplete flag means a date boundary, not full history.
  return { ...capture, activityCaptured: raw.activityCaptured === true, newestReached: raw.newestReached, historyStartReached: raw.historyStartReached };
}

export const MAX_INBOX_BYTES = 3_000_000;
export function parseInboxBatch(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50)
    throw new Error("A batch requires 1–50 conversations.");
  const captures = value.map(parseInboxCapture);
  if (new Set(captures.map(c => c.id)).size !== captures.length)
    throw new Error("Use one capture per conversation in each batch.");
  return captures;
}
