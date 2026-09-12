import type { AccessContext, ClientSnapshot, EverfitReport } from "./types";
import { everfitCoach } from "./owners";
import { coachAlias } from "@/lib/nutrition/coach-resolver";
export function canReadCoach(access: AccessContext, coach: string): boolean {
  return access.admin || access.coaches.includes(coach);
}
export function scopeReport(
  document: EverfitReport,
  access: AccessContext,
  current: ClientSnapshot[],
): EverfitReport {
  if (access.admin) return document;
  if (!canReadCoach(access, document.coach_name)) throw new Error("Forbidden");
  const norm = (s: string) => s.trim().toLowerCase();
  const aliases = new Set([
    norm(document.coach_name),
    norm(coachAlias(document.coach_name)),
  ]);
  if (document.coach_name === "Shiraad") aliases.add("shaun lundall");
  const live = new Map(current.map((c) => [c.id, c]));
  return {
    ...document,
    clients: document.clients
      .filter((c) => {
        if (!aliases.has(norm(c.everfit_owner)) && everfitCoach(c.everfit_owner) !== document.coach_name) return false;
        if (c.linked_client_id)
          return (
            live.get(c.linked_client_id)?.coach_name === document.coach_name
          );
        return true;
      })
      .map((c) => ({
        ...c,
        email: null,
        // Unverified CCOS context is management-only; do not expose another person's contact data.
        ccos_snapshot: c.linked_client_id ? c.ccos_snapshot : null,
        ccos_candidate_id: c.linked_client_id ?? null,
      })),
  };
}
