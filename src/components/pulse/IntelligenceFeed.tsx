"use client";

import type { InsightCard } from "@/lib/types";
import BaseCard from "./cards/BaseCard";

interface IntelligenceFeedProps {
  cards: InsightCard[];
}

export default function IntelligenceFeed({ cards }: IntelligenceFeedProps) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "1.5px",
          color: "var(--text-muted)",
          marginBottom: 16,
        }}
      >
        Intelligence Feed
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {cards.map((card, i) => (
          <div
            key={card.id}
            className={`fade-up-delay-${Math.min(i, 3)}`}
          >
            <BaseCard
              type={card.type}
              title={card.title}
              body={card.body}
              metric={card.metric}
              impactLabel={card.impactLabel}
              actions={card.actions}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
