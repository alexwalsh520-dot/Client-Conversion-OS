"use client";

import { useState, useEffect } from "react";
import { FileText, Plus, X, CheckCircle, XCircle, Video, Calendar, UserCheck, UserX, Clock } from "lucide-react";
import type { Client, CoachEODReport, EODClientCheckin } from "@/lib/types";

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  clientName: string;
  status: string;
}

interface Props {
  reports: CoachEODReport[];
  clients: Client[];
  onSubmit: (report: Partial<CoachEODReport>) => Promise<void>;
}

export default function EODReportsTab({ reports, clients, onSubmit }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
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

  // Fetch Nicole's calendar events when role is "onboarding" and date changes
  useEffect(() => {
    if (formData.role !== "onboarding" || !formData.date || !showForm) {
      setCalendarEvents([]);
      return;
    }

    const fetchCalendar = async () => {
      setCalendarLoading(true);
      setCalendarError(null);
      try {
        const res = await fetch(`/api/coaching/calendar?date=${formData.date}`);
        if (!res.ok) throw new Error("Failed to fetch calendar");
        const data = await res.json();
        setCalendarEvents(data.events || []);

        // Auto-populate onboarding checkins from calendar events
        const checkins: EODClientCheckin[] = (data.events || []).map((evt: CalendarEvent) => ({
          eodId: 0,
          clientName: evt.clientName,
          checkedIn: false,
          notes: "",
          onboardingStatus: "onboarded" as const,
        }));
        setFormData((prev) => ({ ...prev, clientCheckins: checkins }));
      } catch (err) {
        console.error("Calendar fetch error:", err);
        setCalendarError("Could not load calendar events. You can add clients manually.");
        setFormData((prev) => ({ ...prev, clientCheckins: [] }));
      } finally {
        setCalendarLoading(false);
      }
    };

    fetchCalendar();
  }, [formData.role, formData.date, showForm]);

  const handleSubmit = async () => {
    if (!formData.submittedBy || !formData.date) return;
    await onSubmit(formData);
    setShowForm(false);
    setFormData({ role: "coach", date: new Date().toISOString().split("T")[0], clientCheckins: [] });
    setCalendarEvents([]);
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

  const updateOnboardingStatus = (idx: number, status: "onboarded" | "no_show" | "rescheduled") => {
    const checkins = [...(formData.clientCheckins || [])];
    checkins[idx] = {
      ...checkins[idx],
      onboardingStatus: status,
      checkedIn: status === "onboarded",
    };
    setFormData({ ...formData, clientCheckins: checkins });
  };

  const addManualOnboardingClient = () => {
    const checkins = [...(formData.clientCheckins || [])];
    checkins.push({
      eodId: 0,
      clientName: "",
      checkedIn: false,
      notes: "",
      onboardingStatus: "onboarded" as const,
    });
    setFormData({ ...formData, clientCheckins: checkins });
  };

  const removeCheckin = (idx: number) => {
    const checkins = [...(formData.clientCheckins || [])];
    checkins.splice(idx, 1);
    setFormData({ ...formData, clientCheckins: checkins });
  };

  const updateCheckinName = (idx: number, name: string) => {
    const checkins = [...(formData.clientCheckins || [])];
    checkins[idx] = { ...checkins[idx], clientName: name };
    setFormData({ ...formData, clientCheckins: checkins });
  };

  const onboardingStatusColor = (status?: string) => {
    switch (status) {
      case "onboarded": return "var(--success)";
      case "no_show": return "var(--danger)";
      case "rescheduled": return "var(--warning)";
      default: return "var(--text-muted)";
    }
  };

  const onboardingStatusBg = (status?: string) => {
    switch (status) {
      case "onboarded": return "rgba(126, 201, 160, 0.15)";
      case "no_show": return "rgba(217, 142, 142, 0.15)";
      case "rescheduled": return "rgba(201, 169, 110, 0.15)";
      default: return "var(--bg-glass)";
    }
  };

  const onboardingStatusIcon = (status?: string) => {
    switch (status) {
      case "onboarded": return <UserCheck size={14} />;
      case "no_show": return <UserX size={14} />;
      case "rescheduled": return <Clock size={14} />;
      default: return null;
    }
  };

  const onboardingStatusLabel = (status?: string) => {
    switch (status) {
      case "onboarded": return "Onboarded";
      case "no_show": return "No-Show";
      case "rescheduled": return "Rescheduled";
      default: return status || "";
    }
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
            <button onClick={() => { setShowForm(false); setCalendarEvents([]); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
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
                  clientCheckins: formData.role === "coach" ? initCheckins(name) : (formData.clientCheckins || []),
                });
              }} />
            </div>
            <div>
              <label className="field-label">Role *</label>
              <select className="input-field" value={formData.role || "coach"} onChange={(e) => {
                const role = e.target.value as "coach" | "onboarding";
                setFormData({ ...formData, role, clientCheckins: [] });
              }}>
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

          {/* Video Testimonial */}
          {formData.role === "coach" && (
            <div style={{ marginTop: 12, padding: 12, background: "var(--bg-glass)", borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={formData.videoTestimonialToday || false}
                  onChange={(e) => setFormData({
                    ...formData,
                    videoTestimonialToday: e.target.checked,
                    videoTestimonialClient: e.target.checked ? formData.videoTestimonialClient || "" : "",
                  })}
                  style={{ accentColor: "var(--accent)" }}
                />
                <label className="field-label" style={{ margin: 0, display: "flex", alignItems: "center", gap: 4 }}>
                  <Video size={14} /> Got a video testimonial today?
                </label>
              </div>
              {formData.videoTestimonialToday && (
                <div>
                  <label className="field-label">Which client?</label>
                  <select
                    className="input-field"
                    value={formData.videoTestimonialClient || ""}
                    onChange={(e) => setFormData({ ...formData, videoTestimonialClient: e.target.value })}
                  >
                    <option value="">Select client...</option>
                    {activeClients.filter((c) => c.coachName === formData.submittedBy).map((c) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

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

          {/* Onboarding Checkins (for Nicole) */}
          {formData.role === "onboarding" && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <label className="field-label" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
                  <Calendar size={14} /> Today&apos;s Onboarding Clients
                </label>
                <button
                  className="btn-secondary"
                  onClick={addManualOnboardingClient}
                  style={{ fontSize: 12, padding: "4px 10px" }}
                >
                  <Plus size={12} /> Add Client
                </button>
              </div>

              {calendarLoading && (
                <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                  Loading calendar events...
                </div>
              )}

              {calendarError && (
                <div style={{ padding: 10, marginBottom: 8, fontSize: 12, color: "var(--warning)", background: "rgba(201, 169, 110, 0.1)", borderRadius: 6 }}>
                  {calendarError}
                </div>
              )}

              {!calendarLoading && (formData.clientCheckins?.length || 0) === 0 && (
                <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 13, background: "var(--bg-glass)", borderRadius: 8 }}>
                  {calendarEvents.length === 0
                    ? "No onboarding events found on the calendar for this date. Add clients manually."
                    : "No clients to display."}
                </div>
              )}

              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {formData.clientCheckins?.map((checkin, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: "10px 12px",
                      background: onboardingStatusBg(checkin.onboardingStatus),
                      borderRadius: 8,
                      border: `1px solid ${onboardingStatusColor(checkin.onboardingStatus)}22`,
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                      {/* Client name - editable for manually added, read-only for calendar */}
                      {calendarEvents.some((e) => e.clientName === checkin.clientName) ? (
                        <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14, flex: 1 }}>
                          {checkin.clientName}
                        </span>
                      ) : (
                        <input
                          className="input-field"
                          placeholder="Client name..."
                          value={checkin.clientName}
                          onChange={(e) => updateCheckinName(idx, e.target.value)}
                          style={{ flex: 1, fontSize: 13, padding: "4px 8px", fontWeight: 600 }}
                        />
                      )}
                      <button
                        onClick={() => removeCheckin(idx)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}
                        title="Remove"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {/* Onboarding status buttons */}
                    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                      {(["onboarded", "no_show", "rescheduled"] as const).map((status) => (
                        <button
                          key={status}
                          onClick={() => updateOnboardingStatus(idx, status)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "4px 10px",
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: "pointer",
                            border: checkin.onboardingStatus === status
                              ? `2px solid ${onboardingStatusColor(status)}`
                              : "1px solid rgba(255,255,255,0.1)",
                            background: checkin.onboardingStatus === status
                              ? onboardingStatusBg(status)
                              : "transparent",
                            color: checkin.onboardingStatus === status
                              ? onboardingStatusColor(status)
                              : "var(--text-muted)",
                          }}
                        >
                          {onboardingStatusIcon(status)}
                          {onboardingStatusLabel(status)}
                        </button>
                      ))}
                    </div>

                    {/* Notes */}
                    <input
                      className="input-field"
                      placeholder={
                        checkin.onboardingStatus === "rescheduled"
                          ? "Reason for reschedule / new date..."
                          : checkin.onboardingStatus === "no_show"
                          ? "Any follow-up notes..."
                          : "Notes..."
                      }
                      value={checkin.notes}
                      onChange={(e) => updateCheckinNote(idx, e.target.value)}
                      style={{ fontSize: 12, padding: "4px 8px", width: "100%" }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button className="btn-primary" onClick={handleSubmit}>Submit Report</button>
            <button className="btn-secondary" onClick={() => { setShowForm(false); setCalendarEvents([]); }}>Cancel</button>
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

          {/* Client checkins - show differently for onboarding vs coach */}
          {report.clientCheckins && report.clientCheckins.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>
                {report.role === "onboarding" ? "ONBOARDING STATUS" : "CLIENT CHECK-INS"}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {report.clientCheckins.map((c, i) => {
                  const status = c.onboardingStatus;
                  const isOnboarding = report.role === "onboarding" && status;
                  return (
                    <span key={i} style={{
                      fontSize: 11,
                      padding: "3px 8px",
                      borderRadius: 4,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      background: isOnboarding
                        ? onboardingStatusBg(status)
                        : c.checkedIn ? "rgba(126, 201, 160, 0.1)" : "rgba(217, 142, 142, 0.1)",
                      color: isOnboarding
                        ? onboardingStatusColor(status)
                        : c.checkedIn ? "var(--success)" : "var(--danger)",
                    }}>
                      {isOnboarding
                        ? onboardingStatusIcon(status)
                        : c.checkedIn ? <CheckCircle size={10} /> : <XCircle size={10} />
                      }
                      {c.clientName}
                      {isOnboarding && (
                        <span style={{ fontSize: 10, opacity: 0.8, marginLeft: 2 }}>
                          ({onboardingStatusLabel(status)})
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {report.videoTestimonialToday && report.videoTestimonialClient && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <Video size={12} style={{ color: "var(--accent)" }} />
              <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                Video testimonial from {report.videoTestimonialClient}
              </span>
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
