"use client";

import { salesData, onboardingTracker, salesFunnel } from "@/lib/mock-data";
import ExpandableRow from "./ExpandableRow";

export default function SalesXRay() {
  const totalShowUp =
    salesData.liveCallsCompleted / salesData.totalCallsBooked;
  const closeRate = salesData.totalWon / salesData.liveCallsCompleted;
  const pifCount = onboardingTracker.filter(
    (c) => c.pif === true || c.pif === "PIF"
  ).length;
  const threePayCount = onboardingTracker.filter(
    (c) => c.pif === "3-pay"
  ).length;
  const ghosted = onboardingTracker.filter((c) => c.status === "ghosted");
  const active = onboardingTracker.filter((c) => c.status === "active");
  const pending = onboardingTracker.filter((c) => c.status === "pending");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Closer Comparison */}
      <div className="glass" style={{ padding: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "1px",
            color: "var(--text-muted)",
            marginBottom: 20,
          }}
        >
          Closer Performance
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
        >
          {salesData.closerStats.map((closer) => {
            const showUp = closer.callsTaken / closer.callsBooked;
            const cr = closer.closed / closer.callsTaken;
            return (
              <div
                key={closer.name}
                className="glass-subtle"
                style={{ padding: 20, borderRadius: 12 }}
              >
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    marginBottom: 16,
                  }}
                >
                  {closer.name}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        color: "var(--text-muted)",
                        fontWeight: 600,
                      }}
                    >
                      Calls Booked
                    </div>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: "var(--text-primary)",
                        marginTop: 2,
                      }}
                    >
                      {closer.callsBooked}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        color: "var(--text-muted)",
                        fontWeight: 600,
                      }}
                    >
                      Taken
                    </div>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: "var(--text-primary)",
                        marginTop: 2,
                      }}
                    >
                      {closer.callsTaken}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        color: "var(--text-muted)",
                        fontWeight: 600,
                      }}
                    >
                      Close Rate
                    </div>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: "var(--success)",
                        marginTop: 2,
                      }}
                    >
                      {(cr * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        color: "var(--text-muted)",
                        fontWeight: 600,
                      }}
                    >
                      Revenue
                    </div>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: "var(--text-primary)",
                        marginTop: 2,
                      }}
                    >
                      ${(closer.revenue / 1000).toFixed(1)}K
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 12,
                    height: 4,
                    borderRadius: 2,
                    background: "var(--bg-glass)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${showUp * 100}%`,
                      height: "100%",
                      borderRadius: 2,
                      background: "var(--accent)",
                    }}
                  />
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginTop: 4,
                  }}
                >
                  {(showUp * 100).toFixed(0)}% show-up rate
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Overall Sales Summary */}
      <div className="glass" style={{ padding: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "1px",
            color: "var(--text-muted)",
            marginBottom: 16,
          }}
        >
          Sales Summary
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Total Won
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "var(--success)",
                marginTop: 2,
              }}
            >
              {salesData.totalWon}
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Close Rate
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "var(--text-primary)",
                marginTop: 2,
              }}
            >
              {(closeRate * 100).toFixed(1)}%
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Cash Collected
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "var(--text-primary)",
                marginTop: 2,
              }}
            >
              ${(salesData.totalCash / 1000).toFixed(1)}K
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Show-up Rate
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color:
                  totalShowUp < 0.8 ? "var(--warning)" : "var(--text-primary)",
                marginTop: 2,
              }}
            >
              {(totalShowUp * 100).toFixed(1)}%
            </div>
          </div>
        </div>

        {/* PIF vs Subscription bar */}
        <div style={{ marginTop: 20 }}>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              marginBottom: 6,
              fontWeight: 600,
            }}
          >
            Revenue Mix
          </div>
          <div
            style={{
              display: "flex",
              height: 8,
              borderRadius: 4,
              overflow: "hidden",
              gap: 2,
            }}
          >
            <div
              style={{
                width: `${(salesData.cashOnCalls / salesData.revenueTotal) * 100}%`,
                background: "var(--accent)",
                borderRadius: 4,
              }}
            />
            <div
              style={{
                width: `${(salesData.subscriptions / salesData.revenueTotal) * 100}%`,
                background: "var(--tyson)",
                borderRadius: 4,
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 6,
            }}
          >
            <span style={{ fontSize: 11, color: "var(--accent)" }}>
              PIF: ${(salesData.cashOnCalls / 1000).toFixed(1)}K
            </span>
            <span style={{ fontSize: 11, color: "var(--tyson)" }}>
              Subscriptions: ${(salesData.subscriptions / 1000).toFixed(1)}K
            </span>
          </div>
        </div>
      </div>

      {/* Onboarding Pipeline */}
      <div className="glass" style={{ padding: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "1px",
              color: "var(--text-muted)",
            }}
          >
            Onboarding Pipeline
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 4,
                background: "var(--success-soft)",
                color: "var(--success)",
              }}
            >
              Active: {active.length}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 4,
                background: "var(--warning-soft)",
                color: "var(--warning)",
              }}
            >
              Pending: {pending.length}
            </span>
            {ghosted.length > 0 && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "var(--danger-soft)",
                  color: "var(--danger)",
                }}
              >
                Ghosted: {ghosted.length}
              </span>
            )}
          </div>
        </div>

        {/* Ghosted clients (if any) */}
        {ghosted.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            {ghosted.map((client) => (
              <ExpandableRow
                key={client.client}
                title={client.client}
                subtitle={`$${client.amountPaid.toLocaleString()} — ${client.closer}`}
                badge={{
                  text: "GHOSTED",
                  color: "var(--danger)",
                  bg: "var(--danger-soft)",
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    lineHeight: 1.6,
                  }}
                >
                  <p style={{ margin: "0 0 4px 0" }}>
                    <strong style={{ color: "var(--text-primary)" }}>
                      Coach:
                    </strong>{" "}
                    {client.onboarder}
                  </p>
                  <p style={{ margin: "0 0 4px 0" }}>
                    <strong style={{ color: "var(--text-primary)" }}>
                      Payment:
                    </strong>{" "}
                    {client.pif === true
                      ? "PIF"
                      : typeof client.pif === "string"
                        ? client.pif
                        : "Unknown"}
                  </p>
                  <p style={{ margin: "0 0 4px 0" }}>
                    <strong style={{ color: "var(--text-primary)" }}>
                      Notes:
                    </strong>{" "}
                    {client.comments}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      marginTop: 8,
                      fontSize: 11,
                    }}
                  >
                    {client.rescheduleEmailSent && (
                      <span style={{ color: "var(--warning)" }}>
                        Reschedule sent
                      </span>
                    )}
                    {client.reminderEmail && (
                      <span style={{ color: "var(--text-muted)" }}>
                        Reminder sent
                      </span>
                    )}
                    {client.reachOutCloser && (
                      <span style={{ color: "var(--accent)" }}>
                        Closer notified
                      </span>
                    )}
                  </div>
                </div>
              </ExpandableRow>
            ))}
          </div>
        )}

        {/* Recent active clients */}
        {active.slice(0, 5).map((client) => (
          <ExpandableRow
            key={client.client}
            title={client.client}
            subtitle={`$${client.amountPaid.toLocaleString()} — ${client.closer}`}
            badge={{
              text: "ACTIVE",
              color: "var(--success)",
              bg: "var(--success-soft)",
            }}
          >
            <div
              style={{
                fontSize: 13,
                color: "var(--text-secondary)",
                lineHeight: 1.6,
              }}
            >
              <p style={{ margin: "0 0 4px 0" }}>
                <strong style={{ color: "var(--text-primary)" }}>Coach:</strong>{" "}
                {client.onboarder}
              </p>
              <p style={{ margin: "0 0 4px 0" }}>
                <strong style={{ color: "var(--text-primary)" }}>
                  Payment:
                </strong>{" "}
                {client.pif === true
                  ? "PIF"
                  : typeof client.pif === "string"
                    ? client.pif
                    : "Unknown"}
              </p>
              <p style={{ margin: 0 }}>
                <strong style={{ color: "var(--text-primary)" }}>Notes:</strong>{" "}
                {client.comments}
              </p>
            </div>
          </ExpandableRow>
        ))}
      </div>
    </div>
  );
}
