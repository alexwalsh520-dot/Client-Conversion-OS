"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Trophy, Users } from "lucide-react";
import type { Client, CoachMilestone, CoachMeeting, CoachEODReport } from "@/lib/types";
import type { CoachPerformanceEntry, CoachingFeedbackEntry } from "@/lib/mock-data";

interface Props {
  clients: Client[];
  milestones: CoachMilestone[];
  meetings: CoachMeeting[];
  eodReports: CoachEODReport[];
  coachPerformance: CoachPerformanceEntry[];
  feedback: CoachingFeedbackEntry[];
}

export default function CoachPerformanceTab({ clients, milestones, meetings, eodReports }: Props) {
  // Get unique coaches from clients
  const coaches = [...new Set(clients.map((c) => c.coachName).filter(Boolean))];

  // Total active clients across ALL coaches
  const totalActiveClients = clients.filter((c) => c.status === "active").length;
  const totalCompletedClients = clients.filter((c) => c.status === "completed").length;
  const totalClients = clients.length;

  // Build comparison data per coach
  const coachData = coaches.map((coachName) => {
    const coachClients = clients.filter((c) => c.coachName === coachName);
    const activeClients = coachClients.filter((c) => c.status === "active");
    const completedClients = coachClients.filter((c) => c.status === "completed");
    const coachMilestones = milestones.filter((m) => m.coachName === coachName);
    const coachMeetings = meetings.filter((m) => m.coachName === coachName);
    const coachEODs = eodReports.filter((r) => r.submittedBy === coachName && r.role === "coach");

    // Milestone completion rates (4 milestones per client)
    const totalMilestoneSlots = coachMilestones.length * 4;
    const completedMilestones =
      coachMilestones.filter((m) => m.trustPilotCompleted).length +
      coachMilestones.filter((m) => m.videoTestimonialCompleted).length +
      coachMilestones.filter((m) => m.retentionCompleted).length +
      coachMilestones.filter((m) => m.referralCompleted).length;

    const milestoneRate = totalMilestoneSlots > 0 ? Math.round((completedMilestones / totalMilestoneSlots) * 100) : 0;

    // Completion rate: clients who completed / (completed + active)
    const relevantClients = activeClients.length + completedClients.length;
    const completionRate = relevantClients > 0 ? Math.round((completedClients.length / relevantClients) * 100) : 0;

    return {
      name: coachName,
      totalClients: coachClients.length,
      activeClients: activeClients.length,
      completedClients: completedClients.length,
      completionRate,
      milestoneRate,
      totalMeetings: coachMeetings.length,
      eodSubmissions: coachEODs.length,
      trustPilot: coachMilestones.filter((m) => m.trustPilotCompleted).length,
      videoTestimonials: coachMilestones.filter((m) => m.videoTestimonialCompleted).length,
      retentions: coachMilestones.filter((m) => m.retentionCompleted).length,
      referrals: coachMilestones.filter((m) => m.referralCompleted).length,
    };
  });

  // Sort by milestone rate for ranking
  const ranked = [...coachData].sort((a, b) => b.milestoneRate - a.milestoneRate);

  // Chart data for comparison
  const chartData = coachData.map((c) => ({
    name: c.name,
    "Milestone %": c.milestoneRate,
    "Completion %": c.completionRate,
    "Active Clients": c.activeClients,
  }));

  return (
    <div>
      {/* Top-level KPIs */}
      <div className="metric-grid metric-grid-4" style={{ marginBottom: 16 }}>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Total Active Clients</div>
          <div className="metric-card-value" style={{ color: "var(--accent)" }}>{totalActiveClients}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Completed</div>
          <div className="metric-card-value" style={{ color: "var(--success)" }}>{totalCompletedClients}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Total Clients</div>
          <div className="metric-card-value">{totalClients}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Coaches</div>
          <div className="metric-card-value">{coaches.length}</div>
        </div>
      </div>

      {/* Ranking */}
      <div className="section">
        <h2 className="section-title">
          <Trophy size={16} />
          Coach Rankings (by Milestone Achievement)
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          {ranked.map((coach, idx) => (
            <div key={coach.name} className="glass-static" style={{ padding: 16, borderLeft: idx === 0 ? "3px solid var(--accent)" : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: 16 }}>
                  #{idx + 1} {coach.name}
                </span>
                <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: 20 }}>
                  {coach.milestoneRate}%
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                <span>Active Clients: <strong>{coach.activeClients}</strong></span>
                <span>Completed: <strong>{coach.completedClients}</strong></span>
                <span>Meetings: <strong>{coach.totalMeetings}</strong></span>
                <span>EOD Reports: <strong>{coach.eodSubmissions}</strong></span>
                <span>TrustPilot: <strong>{coach.trustPilot}</strong></span>
                <span>Videos: <strong>{coach.videoTestimonials}</strong></span>
                <span>Retentions: <strong>{coach.retentions}</strong></span>
                <span>Referrals: <strong>{coach.referrals}</strong></span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Comparison Chart */}
      <div className="section">
        <h2 className="section-title">
          <Users size={16} />
          Performance Comparison
        </h2>
        <div className="glass-static" style={{ padding: 20 }}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
              <XAxis dataKey="name" stroke="var(--text-muted)" />
              <YAxis stroke="var(--text-muted)" />
              <Tooltip
                contentStyle={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-primary)",
                  borderRadius: 8,
                  color: "var(--text-primary)",
                }}
              />
              <Legend />
              <Bar dataKey="Milestone %" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Completion %" fill="var(--success)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Active Clients" fill="var(--tyson)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detailed Table */}
      <div className="section">
        <div className="glass-static" style={{ overflow: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Coach</th>
                <th>Active</th>
                <th>Completed</th>
                <th>Completion %</th>
                <th>Milestone %</th>
                <th>TP</th>
                <th>Video</th>
                <th>Retention</th>
                <th>Referral</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((coach) => (
                <tr key={coach.name}>
                  <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{coach.name}</td>
                  <td>{coach.activeClients}</td>
                  <td>{coach.completedClients}</td>
                  <td>{coach.completionRate}%</td>
                  <td style={{ fontWeight: 600, color: coach.milestoneRate >= 50 ? "var(--success)" : "var(--warning)" }}>
                    {coach.milestoneRate}%
                  </td>
                  <td>{coach.trustPilot}</td>
                  <td>{coach.videoTestimonials}</td>
                  <td>{coach.retentions}</td>
                  <td>{coach.referrals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
