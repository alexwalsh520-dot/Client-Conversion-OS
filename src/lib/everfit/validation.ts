import type { EverfitBrief, EverfitReport, Priority } from "./types";

export const MAX_IMPORT_BYTES = 2_000_000;
const eventKeys = [
  "workout_log_events",
  "added_meal_events",
  "task_completion_events",
  "community_posts",
] as const;
export function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Expected a JSON object.");
  return v as Record<string, unknown>;
}
function text(v: unknown, label: string, max = 8000): string {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new Error(`Invalid ${label}.`);
  return v.trim();
}
function optionalText(v: unknown, max = 300): string | null {
  return v == null || v === "" ? null : text(v, "text field", max);
}
export function normalizeEmail(v: unknown): string | null {
  const email = optionalText(v, 254)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Invalid email.");
  return email;
}
export function dateOnly(v: unknown): string {
  const s = text(v, "date", 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) !== s
  )
    throw new Error("Invalid calendar date.");
  return s;
}
function percentage(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100)
    throw new Error("Percentages must be 0–100 or null.");
  return v;
}
function clientId(v: unknown): number | null {
  if (v == null) return null;
  if (
    (typeof v !== "number" && typeof v !== "string") ||
    !/^[1-9]\d*$/.test(String(v))
  )
    throw new Error("Invalid CCOS client ID.");
  const id = Number(v);
  if (!Number.isSafeInteger(id)) throw new Error("Invalid CCOS client ID.");
  return id;
}
function brief(value: unknown): EverfitBrief {
  const c = record(value),
    id = text(c.everfit_id, "Everfit ID", 24);
  if (!/^[a-f0-9]{24}$/.test(id)) throw new Error("Invalid Everfit client ID.");
  if (!["Urgent", "Follow up", "Steady"].includes(String(c.priority)))
    throw new Error("Invalid priority.");
  const events = record(c.activity_observed_minimum);
  const counts = Object.fromEntries(
    eventKeys.map((key) => {
      const n = events[key];
      if (
        typeof n !== "number" ||
        !Number.isSafeInteger(n) ||
        n < 0 ||
        n > 100000
      )
        throw new Error("Invalid activity count.");
      return [key, n];
    }),
  ) as EverfitBrief["activity_observed_minimum"];
  return {
    everfit_id: id,
    name: text(c.name, "client name", 200),
    everfit_owner: text(c.everfit_owner, "Everfit owner", 100),
    ccos_candidate_id: clientId(c.ccos_candidate_id),
    linked_client_id: null,
    // Never trust a supplied match flag, URL, live client snapshot, or foreign key.
    match_status: c.ccos_candidate_id == null ? "Unmatched" : "Name candidate",
    email: normalizeEmail(c.everfit_email ?? c.matched_email ?? c.email),
    summary: text(c.summary, "summary"),
    next_step: text(c.next_step, "next step"),
    issue: text(c.issue, "issue", 300),
    priority: c.priority as Priority,
    action_owner: text(c.action_owner, "action owner", 200),
    suggested_due: text(c.suggested_due, "suggested due date", 200),
    end_date: c.end_date == null ? null : dateOnly(c.end_date),
    training_7d_pct: percentage(c.training_7d_pct),
    training_30d_pct: percentage(c.training_30d_pct),
    tasks_7d_pct: percentage(c.tasks_7d_pct),
    last_app_access_display: optionalText(c.last_app_access_display, 100),
    activity_observed_minimum: counts,
    ccos_snapshot: null,
  };
}
export function parseImport(value: unknown, coachName: unknown): EverfitReport {
  const r = record(value),
    coach = text(coachName, "CCOS coach name", 100);
  if (
    !Array.isArray(r.clients) ||
    r.clients.length < 1 ||
    r.clients.length > 600
  )
    throw new Error("Import must contain 1–600 clients.");
  const clients = r.clients.map(brief);
  if (new Set(clients.map((c) => c.everfit_id)).size !== clients.length)
    throw new Error("Duplicate Everfit client IDs in this report.");
  if (r.timezone !== "Asia/Karachi")
    throw new Error("Report timezone must be Asia/Karachi.");
  const window = r.window ? record(r.window) : {};
  const start = optionalText(r.window_start ?? window.start),
    end = optionalText(r.window_end ?? window.end);
  if (Boolean(start) !== Boolean(end))
    throw new Error("Both window timestamps are required.");
  if (start && end) {
    if (
      ![start, end].every(
        (s) =>
          /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s) &&
          Number.isFinite(Date.parse(s)),
      )
    )
      throw new Error("Window timestamps must include a timezone.");
    if (Date.parse(end) - Date.parse(start) !== 7 * 86400000)
      throw new Error("A weekly window must be exactly seven days.");
    if (Date.parse(end) > Date.now())
      throw new Error("A report cannot include a future window.");
  }
  const coverage = r.coverage ? record(r.coverage) : {};
  const notes = r.coverage_notes ?? coverage.notes ?? [];
  if (!Array.isArray(notes) || notes.length > 30)
    throw new Error("Invalid coverage notes.");
  return {
    schema_version: 1,
    coach_name: coach,
    review_date: dateOnly(r.review_date),
    timezone: "Asia/Karachi",
    window_start: start ? new Date(start).toISOString() : null,
    window_end: end ? new Date(end).toISOString() : null,
    precision:
      optionalText(r.precision ?? window.precision, 2000) ??
      "Exact seven-day window; see coverage notes for completeness.",
    preliminary: !start || r.preliminary !== false,
    coverage_notes: notes.map((n) => text(n, "coverage note", 2000)),
    clients,
  };
}
export function pkDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function daysUntil(end: string | null, asOf = pkDate()): number | null {
  return end
    ? Math.round(
        (Date.parse(end + "T00:00:00Z") - Date.parse(asOf + "T00:00:00Z")) /
          86400000,
      )
    : null;
}
export function lastCompletedSaturdayWindow(now = new Date()) {
  // Pakistan is UTC+05:00. Work in shifted UTC calendar fields to avoid host timezone effects.
  const shifted = new Date(now.getTime() + 5 * 3600000);
  const back = (shifted.getUTCDay() + 1) % 7;
  let end = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() - back,
    13,
  );
  if (end > now.getTime()) end -= 7 * 86400000;
  return {
    start: new Date(end - 7 * 86400000).toISOString(),
    end: new Date(end).toISOString(),
  };
}
