"use client";

import { useState } from "react";
import { FileText, Plus, X, CheckCircle, XCircle } from "lucide-react";
import type { Client, CoachEODReport } from "@/lib/types";

interface Props {
  reports: CoachEODReport[];
  clients: Client[];
  onSubmit: (report: Partial<CoachEODReport>) => Promise<void>;
}

export default function EODReportsTab({ reports, clients, onSubmit }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [formData, setFormData] = useState<Partial<CoachEODReport>>({
    role: "coach",
    date: new Date().toISOString().split("T")[0],
    clientCheckins: [],
  });

  const activeClients = clients.filter((c) => c.status === "active");

  const filtered = roleFilter === "all"
    ? reports
    : reports.filter((r) => r.role === roleFilter);

  // When role changes, pre-populate client checkins for coaches
  const initCheckins = (coachName: string) => {
    const coachClients = activeClients.filter((c) => c.coachName === coachName);
    return coachClients.map((c) => ({
      eodId: 0,
      clientName: c.name,
      checkedIn: false,
      notes: "",
    }));
  };

  const handleSubmit = async () => {
    if (!formData.submittedBy || !formData.date) return;
    await onSubmit(formData);
    setShowForm(false);
    setFormData({ role: "coach", date: new Date().toISOString().split("T")[0], clientCheckins: [] });
  };

  const toggleCheckin = (idx: number) => {
    const checkins = [...(formData.clientCheckins || [])];
    checkins[idx] = { ...checkins[idx], checkedIn: !checkins[idx].checkedIn };
    setFormData({ ...formData, clientCheckins: checkins });
  };

  const updateCheckinNote = (idx: number, notes: string) => {
    const checkins = [...(formData.clientCheckins || [])];
    checkins[idx] = { ...checkins[idx], notes };
    setFormData({ ...formData, clientCheckins: checkins });
  };

  return (
    <div>
      {/* KPIs */}
      <div className="metric-grid metric-grid-4" style={{ marginBottom: 16 }}>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Total Reports</div>
          <div className="metric-card-value">{reports.length}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Coach Reports</div>
          <div className="metric-card-value">{reports.filter((r) => r.role === "coach").length}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Onboarding Reports</div>
          <div className="metric-card-value">{reports.filter((r) => r.role === "onboarding").length}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Today</div>
          <div className="metric-card-value">
            {reports.filter((r) => r.date === new Date().toISOString().split("T")[0]).length}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center" }}>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="input-field" style={{ width: "auto" }}>
          <option value="all">All Roles</option>
          <option value="coach">Coach</option>
          <option value="onboarding">Onboarding</option>
        </select>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={14} /> Submit EOD Report
        </button>
      </div>

      {/* Submit Form */}
      {showForm && (
        <div className="glass-static" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ color: "var(--text-primary)", fontSize: 16, fontWeight: 600 }}>Submit EOD Report</h3>
            <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
              <X size={16} />
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label className="field-label">Your Name *</label>
              <input className="input-field" value={formData.submittedBy || ""} onChange={(e) => {
                const name = e.target.value;
                setFormData({
                  ...formData,
                  submittedBy: name,
                  clientCheckins: formData.role === "coach" ? initCheckins(name) : [],
                });
              }} />
            </div>
            <div>
              <label className="field-label">Role *</label>
              <select className="input-field" value={formData.role || "coach"} onChange={(e) => setFormData({ ...formData, role: e.target.value as "coach" | "onboarding" })}>
                <option value="coach">Coach</option>
                <option value="onboarding">Onboarding</option>
              </select>
            </div>
            <div>
              <label className="field-label">Date *</label>
              <input className="input-field" type="date" value={formData.date || ""} onChange={(e) => setFormData({ ...formData, date: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Active Client Count</label>
              <input className="input-field" type="number" value={formData.activeClientCount || ""} onChange={(e) => setFormData({ ...formData, activeClientCount: Number(e.target.value) })} />
            </div>
            <div>
              <label className="field-label">New Clients</label>
              <input className="input-field" type="number" value={formData.newClients || ""} onChange={(e) => setFormData({ ...formData, newClients: Number(e.target.value) })} />
            </div>
            <div>
              <label className="field-label">Accounts Deactivated</label>
              <input className="input-field" type="number" value={formData.accountsDeactivated || ""} onChange={(e) => setFormData({ ...formData, accountsDeactivated: Number(e.target.value) })} />
            </div>
            <div>
              <label className="field-label">Hours Logged</label>
              <input className="input-field" type="number" step="0.5" value={formData.hoursLogged || ""} onChange={(e) => setFormData({ ...formData, hoursLogged: Number(e.target.value) })} />
            </div>
            <div>
              <label className="field-label">How are you feeling today?</label>
              <input className="input-field" value={formData.feelingToday || ""} onChange={(e) => setFormData({ ...formData, feelingToday: e.target.value })} />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="field-label">Community Engagement</label>
            <textarea className="input-field" rows={2} value={formData.communityEngagement || ""} onChange={(e) => setFormData({ ...formData, communityEngagement: e.target.value })} style={{ resize: "vertical", width: "100%" }} />
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="field-label">Summary</label>
            <textarea className="input-field" rows={3} value={formData.summary || ""} onChange={(e) => setFormData({ ...formData, summary: e.target.value })} style={{ resize: "vertical", width: "100%" }} />
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="field-label">Questions for Management</label>
            <textarea className="input-field" rows={2} value={formData.questionsForManagement || ""} onChange={(e) => setFormData({ ...formData, questionsForManagement: e.target.value })} style={{ resize: "vertical", width: "100%" }} />
          </div>

          {/* Client Checkins (for coaches) */}
          {formData.role === "coach" && (formData.clientCheckins?.length || 0) > 0 && (
            <div style={{ marginTop: 16 }}>
              <label className="field-label">Client Check-ins</label>
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {formData.clientCheckins?.map((checkin, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", background: "var(--bg-glass)", borderRadius: 6 }}>
                    <input
                      type="checkbox"
                      checked={checkin.checkedIn}
                      onChange={() => toggleCheckin(idx)}
                      style={{ accentColor: "var(--accent)" }}
                    />
                    <span style={{ fontWeight: 500, color: "var(--text-primary)", fontSize: 13, minWidth: 140 }}>
                      {checkin.clientName}
                    </span>
                    <input
                      className="input-field"
                      placeholder="Notes..."
                      value={checkin.notes}
                      onChange={(e) => updateCheckinNote(idx, e.target.value)}
                      style={{ flex: 1, fontSize: 12, padding: "4px 8px" }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button className="btn-primary" onClick={handleSubmit}>Submit Report</button>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Report History */}
      {filtered.map((report) => (
        <div key={report.id} className="glass-static" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 15 }}>{report.submittedBy}</span>
              <span style={{
                fontSize: 11,
                marginLeft: 8,
                padding: "2px 6px",
                borderRadius: 4,
                background: report.role === "coach" ? "rgba(201, 169, 110, 0.2)" : "rgba(126, 201, 160, 0.2)",
                color: report.role === "coach" ? "var(--accent)" : "var(--success)",
              }}>
                {report.role}
              </span>
            </div>
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{report.date}</span>
          </div>

          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-secondary)", marginBottom: 8, flexWrap: "wrap" }}>
            <span>Active: <strong>{report.activeClientCount}</strong></span>
            {report.newClients > 0 && <span>New: <strong style={{ color: "var(--success)" }}>{report.newClients}</strong></span>}
            {report.accountsDeactivated > 0 && <span>Deactivated: <strong style={{ color: "var(--danger)" }}>{report.accountsDeactivated}</strong></span>}
            <span>Hours: <strong>{report.hoursLogged}h</strong></span>
          </div>

          {report.summary && (
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 8 }}>
              {report.summary}
            </div>
          )}

          {/* Client checkins */}
          {report.clientCheckins && report.clientCheckins.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>CLIENT CHECK-INS</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {report.clientCheckins.map((c, i) => (
                  <span key={i} style={{
                    fontSize: 11,
                    padding: "2px 6px",
                    borderRadius: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    background: c.checkedIn ? "rgba(126, 201, 160, 0.1)" : "rgba(217, 142, 142, 0.1)",
                    color: c.checkedIn ? "var(--success)" : "var(--danger)",
                  }}>
                    {c.checkedIn ? <CheckCircle size={10} /> : <XCircle size={10} />}
                    {c.clientName}
                  </span>
                ))}
              </div>
            </div>
          )}

          {report.feelingToday && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
              Feeling: {report.feelingToday}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
