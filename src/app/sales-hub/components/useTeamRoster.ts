"use client";

import { useEffect, useState } from "react";

interface TeamMemberLite {
  name: string;
  jobRole: "closer" | "setter" | "coach";
}

/**
 * Closer names from the team registry, so Sales Hub components pick up
 * members added in Settings. Renders with the fallback until the fetch lands
 * (and keeps it if the registry is unreachable).
 */
export function useCloserNames(fallback: string[]): string[] {
  const [names, setNames] = useState<string[]>(fallback);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/team-members", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !Array.isArray(d?.members)) return;
        const closers = (d.members as TeamMemberLite[])
          .filter((m) => m.jobRole === "closer")
          .map((m) => m.name);
        if (closers.length > 0) setNames(closers);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return names;
}
