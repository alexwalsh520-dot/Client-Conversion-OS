"use client";

import { ChangelogEntry } from "@/lib/mock-data";
import TimelineEntry from "./TimelineEntry";

interface TimelineProps {
  entries: ChangelogEntry[];
}

export default function Timeline({ entries }: TimelineProps) {
  const sorted = [...entries].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {sorted.map((entry, i) => (
        <TimelineEntry
          key={entry.id}
          entry={entry}
          isLast={i === sorted.length - 1}
        />
      ))}
    </div>
  );
}
