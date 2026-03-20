"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle, Clock } from "lucide-react";
import type { Client, CoachMilestone } from "@/lib/types";

interface Props {
  clients: Client[];
  milestones: CoachMilestone[];
  onToggle: (milestoneId: number, field: string, value: boolean) => Promise<void>;
}

export default function MilestonesTab({ clients, milestones, onToggle }: Props) {
  const today = new Date();

  // Get unique coaches from active clients
  const coaches = [...new Set(clients.filter((c) => c.status === "active").map((c) => c.coachName).filter(Boolean))].sort();

  const [selectedCoach, setSelectedCoach] = useState<string>(coaches[0] || "");

  // Filter to selected coach's active clients
  const activeClients = clients.filter((c) => c.status === "active" && c.coachName === selectedCoach);

  const clientMilestoneData = activeClients.map((client) => {
    const milestone = milestones.find((m) => m.clientId === client.id);
    const startDate = new Date(client.startDate);
    const endDate = new Date(client.endDate);
    const daysSinceStart = Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const daysUntilEnd = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    // Due dates based on start date
    const tpDueDate = new Date(startDate.getTime() + 14 * 86400000); // Week 2
    const retDueDate = new Date(endDate.getTime() - 21 * 86400000); // 3 wks before end
    const vidDueDate = new Date(endDate.getTime() - 7 * 86400000); // 1 wk before end
    const refDueDate = new Date(endDate.getTime() - 7 * 86400000); // 1 wk before end

    const tpDue = today >= tpDueDate;
    const tpOverdue = tpDue && !milestone?.trustPilotCompleted;
    const retDue = today >= retDueDate;
    const retOverdue = retDue && !milestone?.retentionCompleted;
    const vidDue = today >= vidDueDate;
    const vidOverdue = vidDue && !milestone?.videoTestimonialCompleted;
    const refDue = today >= refDueDate;
    const refOverdue = refDue && !milestone?.referralCompleted;

    const urgentCount = [tpOverdue, retOverdue, vidOverdue, refOverdue].filter(Boolean).length;

    // Count completed milestones
    const completedCount = [
      milestone?.trustPilotCompleted,
      milestone?.retentionCompleted,
      milestone?.videoTestimonialCompleted,
      milestone?.referralCompleted,
    ].filter(Boolean).length;

    return {
      client,
      milestone,
      daysSinceStart,
      daysUntilEnd,
      totalDays,
      tpDueDate, tpDue, tpOverdue,
      retDueDate, retDue, retOverdue,
      vidDueDate, vidDue, vidOverdue,
      refDueDate, refDue, refOverdue,
      urgentCount,
      completedCount,
    };
  });

  // Sort: most completed first, then by urgency and days left
  const sorted = [...clientMilestoneData].sort((a, b) => {
    if (a.completedCount !== b.completedCount) return b.completedCount - a.completedCount;
    if (a.urgentCount !== b.urgentCount) return b.urgentCount - a.urgentCount;
    return a.daysUntilEnd - b.daysUntilEnd;
  });

  // Stats for selected coach
  const coachMilestones = milestones.filter((m) => m.coachName === selectedCoach);
  const totalOverdue = sorted.filter((s) => s.urgentCount > 0).length;
  const tpComplete = coachMilestones.filter((m) => m.trustPilotCompleted).length;
  const vidComplete = coachMilestones.filter((m) => m.videoTestimonialCompleted).length;
  const retComplete = coachMilestones.filter((m) => m.retentionCompleted).length;
  const refComplete = coachMilestones.filter((m) => m.referralCompleted).length;

  const formatDueDate = (date: Date) => {
    return `${(date.getMonth() + 1).toString().padStart(2, "0")}/${date.getDate().toString().padStart(2, "0")}`;
  };

  const MilestoneCheck = ({ label, done, due, overdue, milestoneId, field, completionDate, dueDate }: {
    label: string;
    done: boolean;
    due: boolean;
    overdue: boolean;
    milestoneId?: number;
    field: string;
    completionDate?: string | null;
    dueDate: Date;
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
      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
        {done ? (completionDate || "") : `due ${formatDueDate(dueDate)}`}
      </span>
      {overdue && !done && <AlertTriangle size={11} style={{ color: "var(--danger)" }} />}
      {done && <CheckCircle size={11} style={{ color: "var(--success)" }} />}
      {due && !done && !overdue && <Clock size={11} style={{ color: "var(--warning)" }} />}
    </div>
  );

  return (
    <div>
      {/* Coach Filter */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {coaches.map((coach) => (
          <button
            key={coach}
            onClick={() => setSelectedCoach(coach)}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: selectedCoach === coach ? 600 : 400,
              background: selectedCoach === coach ? "var(--accent)" : "var(--bg-glass)",
              color: selectedCoach === coach ? "var(--bg-primary)" : "var(--text-secondary)",
              transition: "all 0.15s ease",
            }}
          >
            {coach}
            <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7 }}>
              ({clients.filter((c) => c.coachName === coach && c.status === "active").length})
            </span>
          </button>
        ))}
      </div>

      {/* KPIs for selected coach */}
      <div className="metric-grid metric-grid-4" style={{ marginBottom: 16 }}>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Overdue Milestones</div>
          <div className="metric-card-value" style={{ color: totalOverdue > 0 ? "var(--danger)" : "var(--success)" }}>{totalOverdue}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">TrustPilot Done</div>
          <div className="metric-card-value">{tpComplete}/{activeClients.length}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Retentions Done</div>
          <div className="metric-card-value">{retComplete}/{activeClients.length}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Videos + Referrals</div>
          <div className="metric-card-value">{vidComplete + refComplete}/{activeClients.length * 2}</div>
        </div>
      </div>

      {/* Timeline Legend */}
      <div className="glass-static" style={{ padding: 12, marginBottom: 16, display: "flex", gap: 20, fontSize: 12, color: "var(--text-secondary)" }}>
        <span><strong>Week 2:</strong> TrustPilot Review</span>
        <span><strong>3 wks before end:</strong> Retention Conversation</span>
        <span><strong>1 wk before end:</strong> Video Testimonial + Referral</span>
      </div>

      {/* Client Milestone Cards */}
      {sorted.length === 0 && (
        <div className="glass-static" style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
          No active clients for {selectedCoach || "this coach"}
        </div>
      )}

      {sorted.map(({ client, milestone, daysSinceStart, daysUntilEnd, totalDays, tpDueDate, tpDue, tpOverdue, retDueDate, retDue, retOverdue, vidDueDate, vidDue, vidOverdue, refDueDate, refDue, refOverdue, urgentCount, completedCount }) => (
        <div
          key={client.id || client.name}
          className="glass-static"
          style={{
            padding: 16,
            marginBottom: 10,
            borderLeft: urgentCount > 0 ? "3px solid var(--danger)" : completedCount === 4 ? "3px solid var(--success)" : "3px solid transparent",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>{client.name}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: 8 }}>
                {completedCount}/4 milestones
              </span>
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--text-muted)" }}>
              <span>Started: {new Date(client.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              <span>Day {daysSinceStart}</span>
              <span style={{ color: daysUntilEnd <= 7 ? "var(--danger)" : daysUntilEnd <= 21 ? "var(--warning)" : "var(--text-muted)" }}>
                {daysUntilEnd > 0 ? `${daysUntilEnd}d left` : "Ended"}
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ height: 4, background: "var(--bg-glass)", borderRadius: 2, marginBottom: 10, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${Math.min(100, Math.max(0, totalDays > 0 ? (daysSinceStart / totalDays) * 100 : 0))}%`,
              background: "var(--accent)",
              borderRadius: 2,
            }} />
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <MilestoneCheck label="TrustPilot" done={milestone?.trustPilotCompleted || false} due={tpDue} overdue={tpOverdue} milestoneId={milestone?.id} field="trustPilotCompleted" completionDate={milestone?.trustPilotCompletionDate} dueDate={tpDueDate} />
            <MilestoneCheck label="Retention" done={milestone?.retentionCompleted || false} due={retDue} overdue={retOverdue} milestoneId={milestone?.id} field="retentionCompleted" completionDate={milestone?.retentionCompletionDate} dueDate={retDueDate} />
            <MilestoneCheck label="Video" done={milestone?.videoTestimonialCompleted || false} due={vidDue} overdue={vidOverdue} milestoneId={milestone?.id} field="videoTestimonialCompleted" completionDate={milestone?.videoTestimonialCompletionDate} dueDate={vidDueDate} />
            <MilestoneCheck label="Referral" done={milestone?.referralCompleted || false} due={refDue} overdue={refOverdue} milestoneId={milestone?.id} field="referralCompleted" completionDate={milestone?.referralCompletionDate} dueDate={refDueDate} />
          </div>
        </div>
      ))}
    </div>
  );
}
