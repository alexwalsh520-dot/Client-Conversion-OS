"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  Target,
  Users,
  Utensils,
} from "lucide-react";
import { useSession } from "next-auth/react";
// Time to Eat tracks its own client list, separate from the rest of Sales Hub.
// Tyson is live; Antwan is shown as a placeholder until his Instagram is
// connected. Keith and Lucy were removed — we no longer work with them.
export type TimeToEatClient = "all" | "tyson" | "antwan";

interface TimeToEatLead {
  id: string;
  subscriberId: string;
  leadName: string | null;
  manychatUrl: string | null;
  conversationId: string;
  lastProspectResponseAt: string;
  hoursSinceProspectResponse: number;
  initialSetter: string | null;
  setters: string[];
  previousMisses: number;
  preview: string | null;
}

interface TimeToEatResponse {
  status: "ok" | "error";
  error?: string;
  warning?: string;
  staleAfterBusinessMinutes?: number;
  deadMeatAfterMisses?: number;
  businessHours?: string;
  lookbackDays?: number;
  memory?: {
    enabled: boolean;
    trackedLeads: number;
    updatedAt: string | null;
  };
  timeToEat: TimeToEatLead[];
  deadMeat: TimeToEatLead[];
}

function formatWait(hours: number) {
  if (hours < 48) {
    const rounded = Math.max(1, Math.floor(hours));
    return `${rounded}h waiting`;
  }
  const days = Math.floor(hours / 24);
  const leftoverHours = Math.floor(hours % 24);
  return leftoverHours > 0 ? `${days}d ${leftoverHours}h waiting` : `${days}d waiting`;
}

function clientLabel(client: TimeToEatClient) {
  if (client === "all") return "All clients";
  if (client === "tyson") return "Tyson";
  return "Antwan";
}

function setterList(lead: TimeToEatLead, mode: "initial" | "all") {
  if (mode === "initial") return lead.initialSetter || "Unassigned";
  return lead.setters.length > 0 ? lead.setters.join(", ") : lead.initialSetter || "Unassigned";
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px dashed var(--border-subtle)",
        borderRadius: 8,
        padding: "18px 16px",
        color: "var(--text-muted)",
        fontSize: 13,
        textAlign: "center",
        background: "var(--hover-bg-subtle)",
      }}
    >
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--text-muted)",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 2, fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}

function LeadCard({
  lead,
  actionLabel,
  setterMode,
  tone,
  onSteal,
}: {
  lead: TimeToEatLead;
  actionLabel: "Go Hunt" | "Go Revive";
  setterMode: "initial" | "all";
  tone: "hunt" | "revive";
  onSteal: (lead: TimeToEatLead) => void;
}) {
  const canOpen = Boolean(lead.manychatUrl);
  const accent = tone === "hunt" ? "var(--accent)" : "var(--danger)";

  return (
    <article
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(130px, 1.2fr) minmax(120px, 0.9fr) minmax(160px, 1fr)",
        gap: 12,
        alignItems: "center",
        padding: "13px 14px",
        borderRadius: 8,
        border: "1px solid var(--border-subtle)",
        borderLeft: `3px solid ${accent}`,
        background: "var(--bg-elevated)",
        minWidth: 0,
      }}
    >
      <div style={{ minWidth: 0 }}>
        {canOpen ? (
          <a
            href={lead.manychatUrl || undefined}
            target="_blank"
            rel="noreferrer"
            title={lead.leadName || lead.subscriberId}
            onClick={() => onSteal(lead)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: accent,
              fontSize: 14,
              fontWeight: 800,
              textDecoration: "none",
            }}
          >
            {actionLabel}
            <ExternalLink size={13} />
          </a>
        ) : (
          <span
            title="ManyChat link missing. Add Inbox chat URL to the ManyChat External Request."
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: "var(--text-muted)",
              fontSize: 14,
              fontWeight: 800,
            }}
          >
            {actionLabel}
            <ExternalLink size={13} />
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--text-secondary)" }}>
        <Clock size={14} style={{ color: accent, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>{formatWait(lead.hoursSinceProspectResponse)}</span>
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--text-secondary)" }}>
          <Users size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={setterList(lead, setterMode)}
          >
            {setterList(lead, setterMode)}
          </span>
        </div>
        {lead.previousMisses > 0 && (
          <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 11 }}>
            Missed before: {lead.previousMisses}
          </div>
        )}
      </div>
    </article>
  );
}

function LeadGroup({
  title,
  subtitle,
  leads,
  actionLabel,
  setterMode,
  tone,
  onSteal,
}: {
  title: string;
  subtitle: string;
  leads: TimeToEatLead[];
  actionLabel: "Go Hunt" | "Go Revive";
  setterMode: "initial" | "all";
  tone: "hunt" | "revive";
  onSteal: (lead: TimeToEatLead) => void;
}) {
  return (
    <section
      style={{
        border: "1px solid var(--border-subtle)",
        borderRadius: 8,
        background: "var(--bg-card)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "13px 14px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        {tone === "hunt" ? (
          <Target size={16} style={{ color: "var(--accent)" }} />
        ) : (
          <AlertTriangle size={16} style={{ color: "var(--danger)" }} />
        )}
        <div>
          <div
            style={{
              color: "var(--text-primary)",
              fontSize: 13,
              fontWeight: 800,
              textTransform: title === "TIME TO EAT" ? "uppercase" : "none",
              letterSpacing: title === "TIME TO EAT" ? 0.7 : 0,
            }}
          >
            {title}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>{subtitle}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            minWidth: 28,
            height: 24,
            padding: "0 8px",
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: tone === "hunt" ? "var(--accent-soft)" : "var(--danger-soft)",
            color: tone === "hunt" ? "var(--accent)" : "var(--danger)",
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          {leads.length}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12 }}>
        {leads.length === 0 ? (
          <EmptyState>No leads here right now.</EmptyState>
        ) : (
          leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              actionLabel={actionLabel}
              setterMode={setterMode}
              tone={tone}
              onSteal={onSteal}
            />
          ))
        )}
      </div>
    </section>
  );
}

export default function TimeToEat({ selectedClient }: { selectedClient: TimeToEatClient }) {
  const { data: session } = useSession();
  const [data, setData] = useState<TimeToEatResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // When a setter opens a stale lead, tell the backend who took it. The backend
  // decides if it's a real steal (a different setter than the owner) and posts
  // the "LEAD STOLEN!" alert to Slack. Fire-and-forget with keepalive so it
  // still lands even though the click also opens the ManyChat tab.
  const handleSteal = useCallback(
    (lead: TimeToEatLead) => {
      if (!session?.user) return;
      try {
        fetch("/api/sales-hub/time-to-eat/steal", {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subscriberId: lead.subscriberId,
            oldOwner: lead.initialSetter,
            leadName: lead.leadName,
            lastProspectResponseAt: lead.lastProspectResponseAt,
          }),
        }).catch(() => {});
      } catch {
        // never block opening the lead
      }
    },
    [session?.user],
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/sales-hub/time-to-eat?client=${selectedClient}`);
      const json = (await res.json()) as TimeToEatResponse;
      if (!res.ok || json.status === "error") {
        throw new Error(json.error || "Failed to load Time to Eat");
      }
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Time to Eat");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedClient]);

  useEffect(() => {
    fetchData();
    // Keep an open tab accurate to the minute without paying for extra crons:
    // re-fetch every 60s, but ONLY while the tab is actually visible, and again
    // the moment the user switches back to it. The server recomputes against the
    // live clock on each call, so this is what makes the list tick up on its own.
    const tick = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        fetchData();
      }
    };
    const interval = setInterval(tick, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchData();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchData]);

  const totals = useMemo(() => {
    const hunt = data?.timeToEat.length ?? 0;
    const revive = data?.deadMeat.length ?? 0;
    const oldest = [...(data?.timeToEat ?? []), ...(data?.deadMeat ?? [])]
      .sort((a, b) => b.hoursSinceProspectResponse - a.hoursSinceProspectResponse)[0];
    return {
      hunt,
      revive,
      oldest: oldest ? formatWait(oldest.hoursSinceProspectResponse).replace(" waiting", "") : "0h",
    };
  }, [data]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Utensils size={16} style={{ color: "var(--accent)" }} />
        <div>
          <div style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 800 }}>
            Time to Eat
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>
            {clientLabel(selectedClient)} leads with no team reply after 1 hour (11am–11pm ET)
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 4 }}>
          Live · auto-updates every minute
        </span>
        <button
          onClick={fetchData}
          disabled={loading}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid var(--border-subtle)",
            background: "transparent",
            color: "var(--text-muted)",
            fontSize: 11,
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
        <Stat label="Go Hunt" value={totals.hunt.toLocaleString()} />
        <Stat label="Go Revive" value={totals.revive.toLocaleString()} />
        <Stat label="Oldest wait" value={totals.oldest} />
      </div>

      {error && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 8,
            background: "var(--danger-soft)",
            color: "var(--danger)",
            fontSize: 13,
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      {data?.warning && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 8,
            background: "var(--warning-soft)",
            color: "var(--warning)",
            fontSize: 13,
            marginBottom: 14,
          }}
        >
          {data.warning}
        </div>
      )}

      {selectedClient === "antwan" && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 8,
            background: "var(--accent-soft)",
            color: "var(--accent)",
            fontSize: 13,
            marginBottom: 14,
            border: "1px solid var(--border-subtle)",
          }}
        >
          Antwan&apos;s Instagram isn&apos;t connected to the CCOS yet, so there is no live data here
          yet. This view is ready — leads will start showing automatically once Antwan is set up.
        </div>
      )}

      {loading && !data ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: 28,
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          <Loader2 size={16} className="spin" />
          Loading Time to Eat...
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <LeadGroup
            title="TIME TO EAT"
            subtitle="First time this lead has waited over 1 working hour (11am–11pm ET)."
            leads={data?.timeToEat ?? []}
            actionLabel="Go Hunt"
            setterMode="initial"
            tone="hunt"
            onSteal={handleSteal}
          />
          <LeadGroup
            title="Dead Meat"
            subtitle="This lead has slipped twice — over 1 working hour with no reply, on two separate occasions."
            leads={data?.deadMeat ?? []}
            actionLabel="Go Revive"
            setterMode="all"
            tone="revive"
            onSteal={handleSteal}
          />
        </div>
      )}

      <style jsx>{`
        @media (max-width: 760px) {
          article {
            grid-template-columns: 1fr !important;
            align-items: flex-start !important;
          }
        }
      `}</style>
    </div>
  );
}
