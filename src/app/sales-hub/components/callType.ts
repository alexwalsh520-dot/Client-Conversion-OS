import type { SheetRow } from "../types";

// The "Type of call" column on the sales tracker. Anything that isn't a strategy
// session or an onboarding call (including blanks / "Miscellaneous Chat") rolls
// into "misc".
export type CallCategoryKey = "strategy" | "onboarding" | "misc";

export const CALL_CATEGORIES: { key: CallCategoryKey; label: string }[] = [
  { key: "strategy", label: "Strategy Session" },
  { key: "onboarding", label: "Onboarding Call" },
  { key: "misc", label: "Miscellaneous" },
];

export function callCategory(callType: string | undefined | null): CallCategoryKey {
  const t = (callType || "").toLowerCase();
  if (t.includes("strategy")) return "strategy";
  if (t.includes("onboard")) return "onboarding";
  return "misc";
}

export function rowsForCategory(rows: SheetRow[], key: CallCategoryKey): SheetRow[] {
  return rows.filter((r) => callCategory(r.callType) === key);
}
