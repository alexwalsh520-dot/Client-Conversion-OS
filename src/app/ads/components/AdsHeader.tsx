"use client";

import { useState } from "react";
import { Megaphone } from "lucide-react";

const CLIENTS = ["All", "Keith", "Tyson", "Cold"] as const;

export default function AdsHeader() {
  const [active, setActive] = useState<(typeof CLIENTS)[number]>("All");

  return (
    <div className="section" style={{ marginBottom: 12 }}>
      <div
        className="glass-static"
        style={{
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "var(--accent-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Megaphone size={18} style={{ color: "var(--accent)" }} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>Ads</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Client acquisition — creative studio and tracker performance
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", marginRight: 4 }}>Client</span>
          {CLIENTS.map((c) => {
            const isActive = active === c;
            return (
              <button
                key={c}
                onClick={() => setActive(c)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 8,
                  border: isActive ? "1px solid var(--accent)" : "1px solid var(--border-primary)",
                  background: isActive ? "var(--accent)" : "var(--bg-glass)",
                  color: isActive ? "#fff" : "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: "inherit",
                  transition: "all 0.15s ease",
                }}
              >
                {c}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
