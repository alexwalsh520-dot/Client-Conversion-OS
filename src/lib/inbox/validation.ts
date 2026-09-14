import { parseCapture, parseSyncPlan } from "@/lib/everfit/sync-validation";
import { record } from "@/lib/everfit/validation";
export { parseSyncPlan };
export function parseInboxCapture(value: unknown) {
  const raw = record(value);
  const capture = parseCapture(raw);
  if (typeof raw.newestReached !== "boolean" || typeof raw.historyStartReached !== "boolean")
    throw new Error("Explicit newest/history boundary evidence is required.");
  // The old weekly collector's historyComplete flag means a date boundary, not full history.
  return { ...capture, newestReached: raw.newestReached, historyStartReached: raw.historyStartReached };
}
