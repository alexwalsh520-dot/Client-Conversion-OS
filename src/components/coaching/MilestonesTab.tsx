"use client";

import { AlertTriangle, CheckCircle, Clock, Target } from "lucide-react";
import type { Client, CoachMilestone } from "@/lib/types";

interface Props {
  clients: Client[];
  milestones: CoachMilestone[];
  onToggle: (milestoneId: number, field: string, value: boolean) => Promise<void>;
}

export default function MilestonesTab({ clients, milestones, onToggle }: Props) {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  // For each active client, compute milestone status and flags
  const activeClients = clients.filter((c) => c.status === "active");

  const clientMilestoneData = activeClients.map((client) => {
    const milestone = milestones.find((m) => m.clientId === client.id);
    const startDate = new Date(client.startDate);
    const endDate = new Date(client.endDate);
    const daysSinceStart = Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const daysUntilEnd = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    // TrustPilot: due at week 2 (day 14)
    const tpDue = daysSinceStart >= 14;
    const tpOverdue = tpDue && !milestone?.trustPilotCompleted;

    // Retention: due 3 weeks before end (21 days)
    const retDue = daysUntilEnd <= 21;
    const retOverdue = retDue && !milestone?.retentionCompleted;

    // Video testimonial: due 1 week before end
    const vidDue = daysUntilEnd <= 7;
    const vidOverdue = vidDue && !milestone?.videoTestimonialCompleted;

    // Referral: due 1 week before end
    const refDue = daysUntilEnd <= 7;
    const refOverdue = refDue && !milestone?.referralCompleted;

    const urgentCount = [tpOverdue, retOverdue, vidOverdue, refOverdue].filter(Boolean).length;

    return {
      client,
      milestone,
      daysSinceStart,
      daysUntilEnd,
      tpDue, tpOverdue,
      retDue, retOverdue,
      vidDue, vidOverdue,
      refDue, refOverdue,
      urgentCount,
    };
  });

  // Sort: urgent first, then by days until end
  const sorted = [...clientMilestoneData].sort((a, b) => {
    if (a.urgentCount !== b.urgentCount) return b.urgentCount - a.urgentCount;
    return a.daysUntilEnd - b.daysUntilEnd;
  });

  // Stats
  const totalOverdue = sorted.filter((s) => s.urgentCount > 0).length;
  const tpComplete = milestones.filter((m) => m.trustPilotCompleted).length;
  const vidComplete = milestones.filter((m) => m.videoTestimonialCompleted).length;
  const retComplete = milestones.filter((m) => m.retentionCompleted).length;
  const refComplete = milestones.filter((m) => m.referralCompleted).length;

  const MilestoneCheck = ({ label, done, due, overdue, milestoneId, field }: {
    label: string;
    done: boolean;
    due: boolean;
    overdue: boolean;
    milestoneId?: number;
    field: string;
  }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        borderRadius: 6,
        background: done ? "rgba(126, 201, 160, 0.1)" : overdue ? "rgba(217, 142, 142, 0.1)" : "transparent",
        border: overdue && !done ? "1px solid rgba(217, 142, 142, 0.3)" : "1px solid transparent",
      }}
    >
      <input
        type="checkbox"
        checked={done}
        onChange={() => milestoneId && onToggle(milestoneId, field, !done)}
        disabled={!milestoneId}
        style={{ accentColor: "var(--accent)" }}
      />
      <span style={{
        fontSize: 12,
        color: done ? "var(--success)" : overdue ? "var(--danger)" : due ? "var(--warning)" : "var(--text-muted)",
        fontWeight: overdue ? 600 : 400,
      }}>
        {label}
      </span>
      {overdue && !done && <AlertTriangle size={11} style={{ color: "var(--danger)" }} />}
      {done && <CheckCircle size={11} style={{ color: "var(--success)" }} />}
      {due && !done && !overdue && <Clock size={11} style={{ color: "var(--warning)" }} />}
    </div>
  );

  return (
    <div>
      {/* KPIs */}
      <div className="metric-grid metric-grid-4" style={{ marginBottom: 16 }}>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Clients with Overdue</div>
          <div className="metric-card-value" style={{ color: totalOverdue > 0 ? "var(--danger)" : "var(--success)" }}>{totalOverdue}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">TrustPilot Done</div>
          <div className="metric-card-value">{tpComplete}/{milestones.length}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Retentions Done</div>
          <div className="metric-card-value">{retComplete}/{milestones.length}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Videos + Referrals</div>
          <div className="metric-card-value">{vidComplete + refComplete}/{milestones.length * 2}</div>
        </div>
      </div>

      {/* Timeline Legend */}
      <div className="glass-static" style={{ padding: 12, marginBottom: 16, display: "flex", gap: 20, fontSize: 12, color: "var(--text-secondary)" }}>
        <span><strong>Week 2:</strong> TrustPilot Review</span>
        <span><strong>3 wks before end:</strong> Retention Conversation</span>
        <span><strong>1 wk before end:</strong> Video Testimonial + Referral</span>
      </div>

      {/* Client Milestone Cards */}
      {sorted.map(({ client, milestone, daysSinceStart, daysUntilEnd, tpDue, tpOverdue, retDue, retOverdue, vidDue, vidOverdue, refDue, refOverdue, urgentCount }) => (
        <div
          key={client.id || client.name}
          className="glass-static"
          style={{
            padding: 16,
            marginBottom: 10,
            borderLeft: urgentCount > 0 ? "3px solid var(--danger)" : "3px solid transparent",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>{client.name}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: 8 }}>Coach: {client.coachName}</span>
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--text-muted)" }}>
              <span>Day {daysSinceStart}</span>
              <span style={{ color: daysUntilEnd <= 7 ? "var(--danger)" : daysUntilEnd <= 21 ? "var(--warning)" : "var(--text-muted)" }}>
                {daysUntilEnd}d left
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ height: 4, background: "var(--bg-glass)", borderRadius: 2, marginBottom: 10, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${Math.min(100, Math.max(0, (daysSinceStart / (daysSinceStart + Math.max(0, daysUntilEnd))) * 100))}%`,
              background: "var(--accent)",
              borderRadius: 2,
            }} />
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <MilestoneCheck label="TrustPilot" done={milestone?.trustPilotCompleted || false} due={tpDue} overdue={tpOverdue} milestoneId={milestone?.id} field="trustPilotCompleted" />
            <MilestoneCheck label="Retention" done={milestone?.retentionCompleted || false} due={retDue} overdue={retOverdue} milestoneId={milestone?.id} field="retentionCompleted" />
            <MilestoneCheck label="Video" done={milestone?.videoTestimonialCompleted || false} due={vidDue} overdue={vidOverdue} milestoneId={milestone?.id} field="videoTestimonialCompleted" />
            <MilestoneCheck label="Referral" done={milestone?.referralCompleted || false} due={refDue} overdue={refOverdue} milestoneId={milestone?.id} field="referralCompleted" />
          </div>
        </div>
      ))}
    </div>
  );
}
