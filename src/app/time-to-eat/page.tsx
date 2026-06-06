"use client";

import { useState } from "react";
import { Utensils } from "lucide-react";
import TimeToEat from "@/app/sales-hub/components/TimeToEat";
import type { Client } from "@/app/sales-hub/types";

const CLIENTS: Array<{ value: Client; label: string }> = [
  { value: "all", label: "All Clients" },
  { value: "tyson", label: "Tyson" },
  { value: "keith", label: "Keith" },
  { value: "lucy", label: "Lucy" },
];

export default function TimeToEatPage() {
  const [client, setClient] = useState<Client>("all");

  return (
    <main className="fade-in" style={{ maxWidth: 1240, margin: "0 auto", padding: "48px 24px 80px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 22 }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--accent-soft)",
            color: "var(--accent)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <Utensils size={21} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title" style={{ marginBottom: 6 }}>
            Time to Eat
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 14, margin: 0 }}>
            Leads that replied and have not heard back in 24 hours.
          </p>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          padding: 10,
          marginBottom: 18,
          borderRadius: 8,
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-card)",
        }}
      >
        {CLIENTS.map((option) => {
          const active = option.value === client;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setClient(option.value)}
              style={{
                border: `1px solid ${active ? "var(--accent)" : "var(--border-primary)"}`,
                borderRadius: 6,
                background: active ? "var(--accent-soft)" : "var(--hover-bg-subtle)",
                color: active ? "var(--accent)" : "var(--text-secondary)",
                padding: "7px 12px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <TimeToEat selectedClient={client} />
    </main>
  );
}
