"use client";

/**
 * Daily Coacher — main interactive view.
 *
 * Owns: header (back-link + client identity), summary panel state, topic
 * selection state, draft placeholder. Sub-components handle their own
 * fetching for notes & live messages so this stays lean.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import type { ProgramProgress } from "@/lib/daily-coacher/summary-inputs";
import type { TopicKey } from "@/lib/daily-coacher/topics";
import SummaryPanel from "./SummaryPanel";
import TopicSelector from "./TopicSelector";
import CoachNotesInput from "./CoachNotesInput";
import LiveMessagesInput from "./LiveMessagesInput";
import DraftPanel from "./DraftPanel";

interface Props {
  clientId: number;
  clientName: string;
  coachName: string;
  program: string;
  offer: string | null;
  progress: ProgramProgress;
  initialSummary: string | null;
  initialSummaryUpdatedAt: string | null;
  initialStale: boolean;
}

export default function DailyCoacherView({
  clientId,
  clientName,
  coachName,
  program,
  offer,
  progress,
  initialSummary,
  initialSummaryUpdatedAt,
  initialStale,
}: Props) {
  const [selectedTopic, setSelectedTopic] = useState<TopicKey | null>(null);

  const programLine = `${program}${offer ? ` — ${offer}` : ""}`;
  const dayLine =
    progress.daysElapsed !== null && progress.programDays !== null
      ? `Day ${progress.daysElapsed} of ${progress.programDays} · ${progress.daysRemaining} left`
      : "Program dates not on file";

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 24px 80px" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <Link
          href="/coaching"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "var(--text-muted)",
            fontSize: 13,
            textDecoration: "none",
            marginBottom: 12,
          }}
        >
          <ArrowLeft size={14} /> Back to Coaching Hub
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <Sparkles size={20} style={{ color: "var(--accent)" }} />
          <h1
            style={{
              fontSize: 24,
              fontWeight: 600,
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            Daily Coacher · {clientName}
          </h1>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          <span>Coach: <span style={{ color: "var(--text-secondary)" }}>{coachName}</span></span>
          <span>{programLine}</span>
          <span>{dayLine}</span>
          {progress.phase !== "unknown" && (
            <span style={{ color: "var(--accent)" }}>
              Phase: {progress.phase.replace(/_/g, " ")}
            </span>
          )}
        </div>
      </div>

      {/* Summary */}
      <SummaryPanel
        clientId={clientId}
        initialSummary={initialSummary}
        initialUpdatedAt={initialSummaryUpdatedAt}
        initialStale={initialStale}
      />

      {/* Topic selector */}
      <div style={{ marginTop: 24 }}>
        <TopicSelector
          phase={progress.phase}
          selectedKey={selectedTopic}
          onSelect={setSelectedTopic}
        />
      </div>

      {/* Coach notes + live messages — side-by-side on wide screens */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 16,
          marginTop: 24,
        }}
      >
        <CoachNotesInput clientId={clientId} clientName={clientName} />
        <LiveMessagesInput clientId={clientId} />
      </div>

      {/* Draft area */}
      <div style={{ marginTop: 24 }}>
        <DraftPanel clientId={clientId} selectedTopic={selectedTopic} />
      </div>
    </div>
  );
}
