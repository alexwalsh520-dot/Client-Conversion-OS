"use client";

import { useState } from "react";
import Timeline from "@/components/log/Timeline";
import AddEntryForm from "@/components/log/AddEntryForm";
import { changelog } from "@/lib/mock-data";
import { Plus, FileText, DollarSign, Activity } from "lucide-react";

export default function LogPage() {
  const [showAddForm, setShowAddForm] = useState(false);

  // Summary stats
  const totalEntries = changelog.length;
  const totalImpact = changelog.reduce(
    (sum, e) => sum + (e.impactDollars || 0),
    0
  );
  const measuring = changelog.filter((e) => e.metricAfter === null).length;

  const formatDollars = (amount: number) =>
    "$" + amount.toLocaleString("en-US");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            Change Log
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "var(--text-muted)",
              marginTop: 4,
            }}
          >
            Track every change. Measure every impact.
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "var(--accent)",
            color: "white",
            padding: "10px 18px",
            borderRadius: 8,
            border: "none",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <Plus size={16} />
          Log a Change
        </button>
      </div>

      {/* Summary stats row */}
      <div style={{ display: "flex", gap: 16 }}>
        {/* Changes Logged */}
        <div
          className="glass-subtle"
          style={{
            flex: 1,
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "var(--accent-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <FileText size={18} style={{ color: "var(--accent)" }} />
          </div>
          <div>
            <p
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--text-muted)",
                fontWeight: 600,
                margin: 0,
              }}
            >
              Changes Logged
            </p>
            <p
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "var(--text-primary)",
                margin: 0,
                marginTop: 2,
              }}
            >
              {totalEntries}
            </p>
          </div>
        </div>

        {/* Total Impact */}
        <div
          className="glass-subtle"
          style={{
            flex: 1,
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "var(--success-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <DollarSign size={18} style={{ color: "var(--success)" }} />
          </div>
          <div>
            <p
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--text-muted)",
                fontWeight: 600,
                margin: 0,
              }}
            >
              Total Impact
            </p>
            <p
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "var(--success)",
                margin: 0,
                marginTop: 2,
              }}
            >
              {formatDollars(totalImpact)}
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--text-muted)",
                  marginLeft: 4,
                }}
              >
                /mo
              </span>
            </p>
          </div>
        </div>

        {/* Currently Measuring */}
        <div
          className="glass-subtle"
          style={{
            flex: 1,
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "var(--warning-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Activity size={18} style={{ color: "var(--warning)" }} />
          </div>
          <div>
            <p
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--text-muted)",
                fontWeight: 600,
                margin: 0,
              }}
            >
              Measuring
            </p>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 2,
              }}
            >
              <p
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: "var(--text-primary)",
                  margin: 0,
                }}
              >
                {measuring}
              </p>
              <span
                className="soft-pulse"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--warning)",
                  display: "inline-block",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <Timeline entries={changelog} />

      {/* Add Entry Modal */}
      <AddEntryForm
        isOpen={showAddForm}
        onClose={() => setShowAddForm(false)}
      />
    </div>
  );
}
