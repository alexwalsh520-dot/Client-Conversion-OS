import type { ClientSnapshot, EverfitReport } from "./types";
export function matchReport(
  report: EverfitReport,
  roster: ClientSnapshot[],
): EverfitReport {
  const byId = new Map(roster.map((c) => [c.id, c]));
  const emailIndex = new Map<string, ClientSnapshot[]>();
  for (const c of roster) {
    const key = c.email?.trim().toLowerCase();
    if (key) emailIndex.set(key, [...(emailIndex.get(key) ?? []), c]);
  }
  return {
    ...report,
    clients: report.clients.map((c) => {
      const candidate = c.ccos_candidate_id
        ? byId.get(c.ccos_candidate_id)
        : undefined;
      const matches = c.email ? (emailIndex.get(c.email) ?? []) : [];
      const match = matches.length === 1 ? matches[0] : undefined;
      // A candidate that contradicts the email must be resolved, never silently redirected.
      const conflict =
        !!c.email &&
        ((!!candidate?.email &&
          candidate.email.trim().toLowerCase() !== c.email) ||
          matches.length > 1 ||
          (!!match &&
            !!c.ccos_candidate_id &&
            match.id !== c.ccos_candidate_id));
      if (match && !conflict)
        return {
          ...c,
          linked_client_id: match.id,
          match_status: "Email verified",
          ccos_snapshot: match,
          end_date: match.end_date,
        };
      return {
        ...c,
        linked_client_id: null,
        match_status: conflict
          ? "Email conflict"
          : candidate
            ? "Name candidate"
            : "Unmatched",
        ccos_snapshot: candidate ?? null,
        end_date: candidate?.end_date ?? c.end_date,
      };
    }),
  };
}
