"use client";

import { useState, useMemo } from "react";
import { AlertTriangle, CheckCircle, XCircle, Clock, ChevronDown, ChevronRight, DollarSign } from "lucide-react";
import type { Client, CoachMilestone } from "@/lib/types";

type MilestoneStatus = "completed" | "failed" | "pending";

interface Props {
  clients: Client[];
  milestones: CoachMilestone[];
  onToggle: (milestoneId: number | null, field: string, status: MilestoneStatus, client?: { id: number; name: string; coachName: string }) => Promise<void>;
}

/** Determine milestone status from DB fields:
 *  completed=true → "completed" (tick)
 *  completed=false + promptedDate set → "failed" (cross / attempted)
 *  completed=false + no promptedDate → "pending"
 */
function getStatus(completed: boolean | undefined, promptedDate: string | null | undefined): MilestoneStatus {
  if (completed) return "completed";
  if (promptedDate) return "failed";
  return "pending";
}

export default function MilestonesTab({ clients, milestones, onToggle }: Props) {
  const today = new Date();
  const [selectedCoach, setSelectedCoach] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [expandedCommission, setExpandedCommission] = useState<string | null>(null);

  // Get unique coaches from active clients
  const coaches = useMemo(
    () => [...new Set(clients.filter((c) => c.status === "active").map((c) => c.coachName).filter(Boolean))].sort(),
    [clients]
  );

  // Auto-select first coach
  const activeCoach = selectedCoach || coaches[0] || "";

  // Filter to selected coach's active clients
  const activeClients = clients.filter((c) => c.status === "active" && c.coachName === activeCoach);

  const clientMilestoneData = activeClients.map((client) => {
    const milestone = milestones.find((m) => m.clientId === client.id);
    const startDate = new Date(client.startDate);
    const endDate = new Date(client.endDate);
    const daysSinceStart = Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const daysUntilEnd = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    // Due dates per requirements:
    // TrustPilot: 1 week after start
    // Video Testimonial: 20 days before end
    // Retention (Extension): 14 days before end
    // Referral: 1 week before end
    const tpDueDate = new Date(startDate.getTime() + 7 * 86400000);
    const vidDueDate = new Date(endDate.getTime() - 20 * 86400000);
    const retDueDate = new Date(endDate.getTime() - 14 * 86400000);
    const refDueDate = new Date(endDate.getTime() - 7 * 86400000);

    const tpStatus = getStatus(milestone?.trustPilotCompleted, milestone?.trustPilotPromptedDate);
    const vidStatus = getStatus(milestone?.videoTestimonialCompleted, milestone?.videoTestimonialPromptedDate);
    const retStatus = getStatus(milestone?.retentionCompleted, milestone?.retentionPromptedDate);
    const refStatus = getStatus(milestone?.referralCompleted, milestone?.referralPromptedDate);

    const tpDue = today >= tpDueDate;
    const vidDue = today >= vidDueDate;
    const retDue = today >= retDueDate;
    const refDue = today >= refDueDate;

    const tpOverdue = tpDue && tpStatus === "pending";
    const vidOverdue = vidDue && vidStatus === "pending";
    const retOverdue = retDue && retStatus === "pending";
    const refOverdue = refDue && refStatus === "pending";

    const urgentCount = [tpOverdue, vidOverdue, retOverdue, refOverdue].filter(Boolean).length;
    const completedCount = [tpStatus === "completed", vidStatus === "completed", retStatus === "completed", refStatus === "completed"].filter(Boolean).length;

    return {
      client, milestone,
      daysSinceStart, daysUntilEnd, totalDays,
      tpDueDate, tpDue, tpOverdue, tpStatus,
      vidDueDate, vidDue, vidOverdue, vidStatus,
      retDueDate, retDue, retOverdue, retStatus,
      refDueDate, refDue, refOverdue, refStatus,
      urgentCount, completedCount,
    };
  });

  // Sort: most completed first, then urgency, then days left
  const sorted = [...clientMilestoneData].sort((a, b) => {
    if (a.completedCount !== b.completedCount) return b.completedCount - a.completedCount;
    if (a.urgentCount !== b.urgentCount) return b.urgentCount - a.urgentCount;
    return a.daysUntilEnd - b.daysUntilEnd;
  });

  // Stats for selected coach
  const coachMilestones = milestones.filter((m) => m.coachName === activeCoach);
  const totalOverdue = sorted.filter((s) => s.urgentCount > 0).length;
  const tpComplete = coachMilestones.filter((m) => m.trustPilotCompleted).length;
  const vidComplete = coachMilestones.filter((m) => m.videoTestimonialCompleted).length;
  const retComplete = coachMilestones.filter((m) => m.retentionCompleted).length;
  const refComplete = coachMilestones.filter((m) => m.referralCompleted).length;

  const formatDueDate = (date: Date) =>
    `${(date.getMonth() + 1).toString().padStart(2, "0")}/${date.getDate().toString().padStart(2, "0")}`;

  // ----- Monthly Commission Summary -----
  // Parse selectedMonth
  const [commYear, commMonth] = selectedMonth.split("-").map(Number);

  // Generate month options (last 6 months + current)
  const monthOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const lbl = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      opts.push({ value: val, label: lbl });
    }
    return opts;
  }, []);

  // Build commission data: which milestones were achieved by each coach in the selected month
  const commissionData = useMemo(() => {
    const allCoaches = [...new Set(milestones.map((m) => m.coachName).filter(Boolean))].sort();
    return allCoaches.map((coach) => {
      const coachMs = milestones.filter((m) => m.coachName === coach);

      const isInMonth = (dateStr: string | null) => {
        if (!dateStr) return false;
        // Completion dates are stored as "MM/DD" — assume current year context
        // or "MM/DD/YYYY"
        const parts = dateStr.split("/");
        if (parts.length < 2) return false;
        const m = parseInt(parts[0], 10);
        const y = parts.length >= 3 ? parseInt(parts[2], 10) : commYear;
        const fullYear = y < 100 ? 2000 + y : y;
        return m === commMonth && fullYear === commYear;
      };

      const tpAchieved = coachMs.filter((m) => m.trustPilotCompleted && isInMonth(m.trustPilotCompletionDate));
      const vidAchieved = coachMs.filter((m) => m.videoTestimonialCompleted && isInMonth(m.videoTestimonialCompletionDate));
      const retAchieved = coachMs.filter((m) => m.retentionCompleted && isInMonth(m.retentionCompletionDate));
      const refAchieved = coachMs.filter((m) => m.referralCompleted && isInMonth(m.referralCompletionDate));

      const total = tpAchieved.length + vidAchieved.length + retAchieved.length + refAchieved.length;

      return {
        coach,
        tpAchieved, vidAchieved, retAchieved, refAchieved,
        total,
      };
    });
  }, [milestones, commMonth, commYear]);

  // ----- Milestone Button Component -----
  const MilestoneButton = ({ label, status, due, overdue, milestoneId, field, completionDate, dueDate, client }: {
    label: string;
    status: MilestoneStatus;
    due: boolean;
    overdue: boolean;
    milestoneId?: number;
    field: string;
    completionDate?: string | null;
    dueDate: Date;
    client: Client;
  }) => {
    const handleClick = (newStatus: MilestoneStatus) => {
      // If clicking same status, reset to pending
      const targetStatus = status === newStatus ? "pending" : newStatus;
      onToggle(milestoneId || null, field, targetStatus, { id: client.id!, name: client.name, coachName: client.coachName });
    };

    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          borderRadius: 8,
          background: status === "completed"
            ? "rgba(126, 201, 160, 0.12)"
            : status === "failed"
              ? "rgba(217, 142, 142, 0.12)"
              : overdue
                ? "rgba(217, 142, 142, 0.08)"
                : "transparent",
          border: overdue && status === "pending"
            ? "1px solid rgba(217, 142, 142, 0.3)"
            : status === "failed"
              ? "1px solid rgba(217, 142, 142, 0.25)"
              : "1px solid var(--border-primary)",
        }}
      >
        <span style={{
          fontSize: 12,
          fontWeight: 500,
          color: status === "completed" ? "var(--success)" : status === "failed" ? "var(--danger)" : overdue ? "var(--danger)" : due ? "var(--warning)" : "var(--text-secondary)",
          minWidth: 60,
        }}>
          {label}
        </span>

        {/* Tick button */}
        <button
          onClick={() => handleClick("completed")}
          title="Achieved"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 24, height: 24, borderRadius: 6, border: "none", cursor: "pointer",
            background: status === "completed" ? "var(--success)" : "var(--bg-glass)",
            color: status === "completed" ? "#fff" : "var(--text-muted)",
            transition: "all 0.15s ease",
          }}
        >
          <CheckCircle size={14} />
        </button>

        {/* Cross button */}
        <button
          onClick={() => handleClick("failed")}
          title="Attempted — not achieved"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 24, height: 24, borderRadius: 6, border: "none", cursor: "pointer",
            background: status === "failed" ? "var(--danger)" : "var(--bg-glass)",
            color: status === "failed" ? "#fff" : "var(--text-muted)",
            transition: "all 0.15s ease",
          }}
        >
          <XCircle size={14} />
        </button>

        {/* Status info */}
        <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 2 }}>
          {status === "completed" ? (completionDate || "done") : status === "failed" ? "attempted" : `due ${formatDueDate(dueDate)}`}
        </span>

        {overdue && status === "pending" && <AlertTriangle size={11} style={{ color: "var(--danger)" }} />}
        {due && status === "pending" && !overdue && <Clock size={11} style={{ color: "var(--warning)" }} />}
      </div>
    );
  };

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
              fontWeight: activeCoach === coach ? 600 : 400,
              background: activeCoach === coach ? "var(--accent)" : "var(--bg-glass)",
              color: activeCoach === coach ? "var(--bg-primary)" : "var(--text-secondary)",
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
          <div className="metric-card-label">Extensions Done</div>
          <div className="metric-card-value">{retComplete}/{activeClients.length}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Videos + Referrals</div>
          <div className="metric-card-value">{vidComplete + refComplete}/{activeClients.length * 2}</div>
        </div>
      </div>

      {/* Timeline Legend */}
      <div className="glass-static" style={{ padding: 12, marginBottom: 16, display: "flex", gap: 20, fontSize: 12, color: "var(--text-secondary)", flexWrap: "wrap" }}>
        <span><strong>1 wk after start:</strong> TrustPilot Review</span>
        <span><strong>20 days before end:</strong> Video Testimonial</span>
        <span><strong>14 days before end:</strong> Extension</span>
        <span><strong>1 wk before end:</strong> Referral</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><CheckCircle size={12} style={{ color: "var(--success)" }} /> Achieved</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><XCircle size={12} style={{ color: "var(--danger)" }} /> Attempted</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Clock size={12} style={{ color: "var(--text-muted)" }} /> Pending</span>
        </span>
      </div>

      {/* Client Milestone Cards */}
      {sorted.length === 0 && (
        <div className="glass-static" style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
          No active clients for {activeCoach || "this coach"}
        </div>
      )}

      {sorted.map(({ client, milestone, daysSinceStart, daysUntilEnd, totalDays,
        tpDueDate, tpDue, tpOverdue, tpStatus,
        vidDueDate, vidDue, vidOverdue, vidStatus,
        retDueDate, retDue, retOverdue, retStatus,
        refDueDate, refDue, refOverdue, refStatus,
        urgentCount, completedCount,
      }) => (
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
            <MilestoneButton label="TrustPilot" status={tpStatus} due={tpDue} overdue={tpOverdue} milestoneId={milestone?.id} field="trustPilotCompleted" completionDate={milestone?.trustPilotCompletionDate} dueDate={tpDueDate} client={client} />
            <MilestoneButton label="Video" status={vidStatus} due={vidDue} overdue={vidOverdue} milestoneId={milestone?.id} field="videoTestimonialCompleted" completionDate={milestone?.videoTestimonialCompletionDate} dueDate={vidDueDate} client={client} />
            <MilestoneButton label="Extension" status={retStatus} due={retDue} overdue={retOverdue} milestoneId={milestone?.id} field="retentionCompleted" completionDate={milestone?.retentionCompletionDate} dueDate={retDueDate} client={client} />
            <MilestoneButton label="Referral" status={refStatus} due={refDue} overdue={refOverdue} milestoneId={milestone?.id} field="referralCompleted" completionDate={milestone?.referralCompletionDate} dueDate={refDueDate} client={client} />
          </div>
        </div>
      ))}

      {/* ===== Monthly Commission Summary ===== */}
      <div style={{ marginTop: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            <DollarSign size={16} />
            Monthly Milestone Commissions
          </h2>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--border-primary)",
              background: "var(--bg-glass)",
              color: "var(--text-primary)",
              fontSize: 13,
            }}
          >
            {monthOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 12 }}>
          {commissionData.map(({ coach, tpAchieved, vidAchieved, retAchieved, refAchieved, total }) => (
            <div
              key={coach}
              className="glass-static"
              style={{ padding: 16, cursor: total > 0 ? "pointer" : "default" }}
              onClick={() => total > 0 && setExpandedCommission(expandedCommission === coach ? null : coach)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 15 }}>{coach}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 20, color: total > 0 ? "var(--accent)" : "var(--text-muted)" }}>
                    {total}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>milestones</span>
                  {total > 0 && (expandedCommission === coach ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
                <span>TrustPilot: <strong>{tpAchieved.length}</strong></span>
                <span>Video: <strong>{vidAchieved.length}</strong></span>
                <span>Extension: <strong>{retAchieved.length}</strong></span>
                <span>Referral: <strong>{refAchieved.length}</strong></span>
              </div>

              {/* Expanded: show which clients */}
              {expandedCommission === coach && total > 0 && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-primary)", fontSize: 12, color: "var(--text-secondary)" }}>
                  {tpAchieved.length > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>TrustPilot:</span>{" "}
                      {tpAchieved.map((m) => m.clientName).join(", ")}
                    </div>
                  )}
                  {vidAchieved.length > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>Video:</span>{" "}
                      {vidAchieved.map((m) => m.clientName).join(", ")}
                    </div>
                  )}
                  {retAchieved.length > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>Extension:</span>{" "}
                      {retAchieved.map((m) => m.clientName).join(", ")}
                    </div>
                  )}
                  {refAchieved.length > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>Referral:</span>{" "}
                      {refAchieved.map((m) => m.clientName).join(", ")}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
