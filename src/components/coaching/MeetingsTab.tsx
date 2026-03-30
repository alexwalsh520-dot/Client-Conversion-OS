"use client";

import { useState } from "react";
import { Calendar, Plus, X, Trash2 } from "lucide-react";
import type { Client, CoachMeeting } from "@/lib/types";

interface Props {
  meetings: CoachMeeting[];
  clients: Client[];
  onSave: (meeting: Partial<CoachMeeting>) => Promise<void>;
  onDelete?: (meetingId: number) => Promise<void>;
}

export default function MeetingsTab({ meetings, clients, onSave, onDelete }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [coachFilter, setCoachFilter] = useState<string>("all");
  const [formData, setFormData] = useState<Partial<CoachMeeting>>({});

  const coaches = [...new Set(meetings.map((m) => m.coachName))];
  const activeClients = clients.filter((c) => c.status === "active");

  const filtered = coachFilter === "all"
    ? meetings
    : meetings.filter((m) => m.coachName === coachFilter);

  // Group by date
  const grouped = filtered.reduce<Record<string, CoachMeeting[]>>((acc, m) => {
    const date = m.meetingDate;
    if (!acc[date]) acc[date] = [];
    acc[date].push(m);
    return acc;
  }, {});

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  const handleSave = async () => {
    if (!formData.clientName || !formData.coachName || !formData.meetingDate) return;
    const client = activeClients.find((c) => c.name === formData.clientName);
    await onSave({
      ...formData,
      clientId: client?.id || 0,
    });
    setShowForm(false);
    setFormData({});
  };

  // Stats
  const totalThisWeek = meetings.filter((m) => {
    const d = new Date(m.meetingDate);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return d >= weekAgo;
  }).length;

  const avgDuration = meetings.length > 0
    ? Math.round(meetings.reduce((s, m) => s + m.durationMinutes, 0) / meetings.length)
    : 0;

  return (
    <div>
      {/* KPIs */}
      <div className="metric-grid metric-grid-4" style={{ marginBottom: 16 }}>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Total Meetings</div>
          <div className="metric-card-value">{meetings.length}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">This Week</div>
          <div className="metric-card-value">{totalThisWeek}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Avg Duration</div>
          <div className="metric-card-value">{avgDuration}m</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Coaches Active</div>
          <div className="metric-card-value">{coaches.length}</div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center" }}>
        <select
          value={coachFilter}
          onChange={(e) => setCoachFilter(e.target.value)}
          className="input-field"
          style={{ width: "auto" }}
        >
          <option value="all">All Coaches</option>
          {coaches.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={14} /> Log Meeting
        </button>
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="glass-static" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ color: "var(--text-primary)", fontSize: 16, fontWeight: 600 }}>Log New Meeting</h3>
            <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
              <X size={16} />
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label className="field-label">Client *</label>
              <select className="input-field" value={formData.clientName || ""} onChange={(e) => {
                const client = activeClients.find((c) => c.name === e.target.value);
                setFormData({ ...formData, clientName: e.target.value, coachName: client?.coachName || formData.coachName });
              }}>
                <option value="">Select client...</option>
                {activeClients.map((c) => (
                  <option key={c.id || c.name} value={c.name}>{c.name} ({c.coachName})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Coach *</label>
              <input className="input-field" value={formData.coachName || ""} onChange={(e) => setFormData({ ...formData, coachName: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Date *</label>
              <input className="input-field" type="date" value={formData.meetingDate || ""} onChange={(e) => setFormData({ ...formData, meetingDate: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Duration (minutes)</label>
              <input className="input-field" type="number" value={formData.durationMinutes || ""} onChange={(e) => setFormData({ ...formData, durationMinutes: Number(e.target.value) })} />
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label className="field-label">Notes</label>
              <textarea className="input-field" rows={3} value={formData.notes || ""} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} style={{ resize: "vertical" }} />
            </div>
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button className="btn-primary" onClick={handleSave}>Save Meeting</button>
            <button className="btn-secondary" onClick={() => { setShowForm(false); setFormData({}); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Meeting History */}
      {sortedDates.map((date) => (
        <div key={date} className="section">
          <h3 style={{ color: "var(--text-secondary)", fontSize: 13, fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <Calendar size={13} /> {date}
          </h3>
          {grouped[date].map((meeting) => (
            <div key={meeting.id} className="glass-static" style={{ padding: 14, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>{meeting.clientName}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: 8 }}>w/ {meeting.coachName}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{meeting.durationMinutes}min</span>
                  {meeting.id && onDelete && (
                    <button onClick={() => onDelete(meeting.id!)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }} title="Delete meeting">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
              {meeting.notes && (
                <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.5 }}>
                  {meeting.notes}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
