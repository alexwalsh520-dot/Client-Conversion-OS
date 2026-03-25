"use client";

import { useState, useEffect, useMemo } from "react";
import { Plus, X, CheckCircle, XCircle, Calendar, UserCheck, UserX, Clock, ChevronDown, Building2, Link, ChevronLeft, ChevronRight, AlertTriangle, Pencil, Trash2 } from "lucide-react";
import type { Client, CoachEODReport, EODClientCheckin } from "@/lib/types";

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  clientName: string;
  clientEmail: string;
  status: string;
}

interface Props {
  reports: CoachEODReport[];
  clients: Client[];
  onSubmit: (report: Partial<CoachEODReport>) => Promise<void>;
  onUpdate: (report: Partial<CoachEODReport>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

export default function EODReportsTab({ reports, clients, onSubmit, onUpdate, onDelete }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingReport, setEditingReport] = useState<CoachEODReport | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<CoachEODReport>>({
    role: "coach",
    date: new Date().toISOString().split("T")[0],
    clientCheckins: [],
    newClientNames: [],
    deactivatedClientNames: [],
  });

  const activeClients = clients.filter((c) => c.status === "active");

  // Get unique coach names from active clients
  const coachNames = useMemo(() => {
    const names = new Set(activeClients.map((c) => c.coachName).filter(Boolean));
    return Array.from(names).sort();
  }, [activeClients]);

  // Clients for the selected coach
  const coachActiveClients = useMemo(() => {
    if (!formData.submittedBy) return [];
    return activeClients.filter((c) => c.coachName === formData.submittedBy);
  }, [activeClients, formData.submittedBy]);

  // Auto-calculated active client count for coaches
  const autoActiveCount = coachActiveClients.length;

  // Recently onboarded clients assigned to this coach (for "New Clients" dropdown)
  // These are clients onboarded in last 7 days that are assigned to this coach
  const recentlyOnboardedForCoach = useMemo(() => {
    if (!formData.submittedBy || formData.role !== "coach") return [];
    const now = new Date();
    return activeClients.filter((c) => {
      if (c.coachName !== formData.submittedBy) return false;
      if (!c.onboardingDate) return false;
      const diff = Math.ceil((now.getTime() - new Date(c.onboardingDate).getTime()) / (1000 * 60 * 60 * 24));
      return diff >= 0 && diff <= 7;
    });
  }, [activeClients, formData.submittedBy, formData.role]);

  // Sync form role with filter
  const openForm = () => {
    const defaultRole = roleFilter === "onboarding" ? "onboarding" : roleFilter === "coach" ? "coach" : "coach";
    const isOnboarding = defaultRole === "onboarding";
    setEditingReport(null);
    setFormData({
      role: defaultRole as "coach" | "onboarding",
      date: new Date().toISOString().split("T")[0],
      clientCheckins: [],
      newClientNames: [],
      deactivatedClientNames: [],
      submittedBy: isOnboarding ? "Nicole" : "",
    });
    setShowForm(true);
  };

  const openEditForm = (report: CoachEODReport) => {
    setEditingReport(report);
    setFormData({
      id: report.id,
      submittedBy: report.submittedBy,
      role: report.role,
      date: report.date,
      activeClientCount: report.activeClientCount,
      newClientNames: report.newClientNames || [],
      deactivatedClientNames: report.deactivatedClientNames || [],
      communityEngagement: report.communityEngagement,
      summary: report.summary,
      questionsForManagement: report.questionsForManagement,
      hoursLogged: report.hoursLogged,
      feelingToday: report.feelingToday,
      clientCheckins: report.clientCheckins || [],
    });
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    await onDelete(id);
    setDeletingId(null);
  };

  const filtered = roleFilter === "all"
    ? reports
    : reports.filter((r) => r.role === roleFilter);

  // When coach name changes, pre-populate client checkins
  // Sorted by days remaining descending (most days remaining at top)
  const initCheckins = (coachName: string) => {
    const now = new Date();
    const coachClients = activeClients
      .filter((c) => c.coachName === coachName)
      .sort((a, b) => {
        const endA = a.endDate ? new Date(a.endDate).getTime() : 0;
        const endB = b.endDate ? new Date(b.endDate).getTime() : 0;
        const daysA = endA ? Math.ceil((endA - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;
        const daysB = endB ? Math.ceil((endB - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;
        return daysB - daysA; // Most days remaining first
      });
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
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch calendar");
        setCalendarEvents(data.events || []);
      } catch (err) {
        console.error("Calendar fetch error:", err);
        const msg = err instanceof Error ? err.message : "Unknown error";
        setCalendarError(`Calendar error: ${msg}. You can add clients manually.`);
      } finally {
        setCalendarLoading(false);
      }
    };

    fetchCalendar();
  }, [formData.role, formData.date, showForm]);

  const handleSubmit = async () => {
    if (!formData.submittedBy || !formData.date) return;

    // Auto-set active client count for coaches
    const submitData = {
      ...formData,
      activeClientCount: formData.role === "coach" ? autoActiveCount : 0,
      newClients: (formData.newClientNames || []).length,
      accountsDeactivated: (formData.deactivatedClientNames || []).length,
    };

    if (editingReport) {
      await onUpdate(submitData);
    } else {
      await onSubmit(submitData);
    }
    setShowForm(false);
    setEditingReport(null);
    setFormData({ role: "coach", date: new Date().toISOString().split("T")[0], clientCheckins: [], newClientNames: [], deactivatedClientNames: [] });
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

  const updateOnboardingStatus = (idx: number, status: "onboarded" | "no_show" | "rescheduled" | "internal_meeting") => {
    const checkins = [...(formData.clientCheckins || [])];
    checkins[idx] = {
      ...checkins[idx],
      onboardingStatus: status,
      checkedIn: status === "onboarded",
      // Clear onboarding details when switching away from "onboarded"
      ...(status !== "onboarded" ? {
        onboardingCoach: undefined,
        onboardingStartDate: undefined,
        onboardingEndDate: undefined,
        onboardingProgram: undefined,
        onboardingOffer: undefined,
        onboardingSalesPerson: undefined,
        onboardingEmail: undefined,
        onboardingFathomLink: undefined,
        onboardingPaymentComments: undefined,
      } : {}),
    };
    setFormData({ ...formData, clientCheckins: checkins });
  };

  const calcEndDate = (startDate: string, program: string): string => {
    if (!startDate || !program) return "";
    const weeksMatch = program.match(/(\d+)/);
    if (!weeksMatch) return "";
    const weeks = parseInt(weeksMatch[1], 10);
    const start = new Date(startDate);
    start.setDate(start.getDate() + weeks * 7);
    return start.toISOString().split("T")[0];
  };

  const updateOnboardingDetail = (idx: number, field: string, value: string) => {
    const checkins = [...(formData.clientCheckins || [])];
    checkins[idx] = { ...checkins[idx], [field]: value };

    // Auto-calculate end date when start date or program duration changes
    if (field === "onboardingStartDate" || field === "onboardingProgram") {
      const startDate = field === "onboardingStartDate" ? value : checkins[idx].onboardingStartDate || "";
      const program = field === "onboardingProgram" ? value : checkins[idx].onboardingProgram || "";
      const endDate = calcEndDate(startDate, program);
      if (endDate) {
        checkins[idx] = { ...checkins[idx], [field]: value, onboardingEndDate: endDate };
      }
    }

    setFormData({ ...formData, clientCheckins: checkins });
  };

  const removeCheckin = (idx: number) => {
    const checkins = [...(formData.clientCheckins || [])];
    checkins.splice(idx, 1);
    setFormData({ ...formData, clientCheckins: checkins });
  };

  // Toggle a client in a multi-select name array
  const toggleNameInList = (field: "newClientNames" | "deactivatedClientNames", name: string) => {
    const current = formData[field] || [];
    const updated = current.includes(name)
      ? current.filter((n) => n !== name)
      : [...current, name];
    setFormData({ ...formData, [field]: updated });
  };

  // For Nicole: add a calendar client to onboarding checkins
  const addCalendarClientToCheckins = (clientName: string, clientEmail?: string) => {
    const checkins = formData.clientCheckins || [];
    // Don't add duplicates
    if (checkins.some((c) => c.clientName === clientName)) return;
    setFormData({
      ...formData,
      newClientNames: [...(formData.newClientNames || []), clientName],
      clientCheckins: [
        ...checkins,
        { eodId: 0, clientName, checkedIn: false, notes: "", onboardingStatus: "onboarded" as const, onboardingEmail: clientEmail || "" },
      ],
    });
  };

  // For Nicole: remove from checkins and names
  const removeOnboardingClient = (idx: number) => {
    const checkins = [...(formData.clientCheckins || [])];
    const removedName = checkins[idx]?.clientName;
    checkins.splice(idx, 1);
    const names = (formData.newClientNames || []).filter((n) => n !== removedName);
    setFormData({ ...formData, clientCheckins: checkins, newClientNames: names });
  };

  const onboardingStatusColor = (status?: string) => {
    switch (status) {
      case "onboarded": return "var(--success)";
      case "no_show": return "var(--danger)";
      case "rescheduled": return "var(--warning)";
      case "internal_meeting": return "var(--info, #6bb8e0)";
      default: return "var(--text-muted)";
    }
  };

  const onboardingStatusBg = (status?: string) => {
    switch (status) {
      case "onboarded": return "rgba(126, 201, 160, 0.15)";
      case "no_show": return "rgba(217, 142, 142, 0.15)";
      case "rescheduled": return "rgba(201, 169, 110, 0.15)";
      case "internal_meeting": return "rgba(107, 184, 224, 0.15)";
      default: return "var(--bg-glass)";
    }
  };

  const onboardingStatusIcon = (status?: string) => {
    switch (status) {
      case "onboarded": return <UserCheck size={14} />;
      case "no_show": return <UserX size={14} />;
      case "rescheduled": return <Clock size={14} />;
      case "internal_meeting": return <Building2 size={14} />;
      default: return null;
    }
  };

  const onboardingStatusLabel = (status?: string) => {
    switch (status) {
      case "onboarded": return "Onboarded";
      case "no_show": return "No-Show";
      case "rescheduled": return "Rescheduled";
      case "internal_meeting": return "Internal Meeting";
      default: return status || "";
    }
  };

  // Available coaches for assignment
  const availableCoaches = useMemo(() => {
    const names = new Set(clients.map((c) => c.coachName).filter(Boolean));
    return Array.from(names).sort();
  }, [clients]);

  // Available salespersons from existing clients
  const availableSalesPeople = useMemo(() => {
    const names = new Set(clients.map((c) => c.salesPerson).filter(Boolean));
    return Array.from(names).sort();
  }, [clients]);

  // ============ RENDER ============

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
        <button className="btn-primary" onClick={openForm}>
          <Plus size={14} /> Submit EOD Report
        </button>
      </div>

      {/* ======================== SUBMIT FORM ======================== */}
      {showForm && (
        <div className="glass-static" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ color: "var(--text-primary)", fontSize: 16, fontWeight: 600 }}>{editingReport ? "Edit EOD Report" : "Submit EOD Report"}</h3>
            <button onClick={() => { setShowForm(false); setCalendarEvents([]); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
              <X size={16} />
            </button>
          </div>

          {/* Row 1: Name, Role, Date */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label className="field-label">Your Name *</label>
              {formData.role === "onboarding" ? (
                <input className="input-field" value="Nicole" readOnly style={{ opacity: 0.7 }} />
              ) : (
                <select
                  className="input-field"
                  value={formData.submittedBy || ""}
                  onChange={(e) => {
                    const name = e.target.value;
                    setFormData({
                      ...formData,
                      submittedBy: name,
                      clientCheckins: name ? initCheckins(name) : [],
                      newClientNames: [],
                      deactivatedClientNames: [],
                    });
                  }}
                >
                  <option value="">Select coach...</option>
                  {coachNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="field-label">Role *</label>
              <select className="input-field" value={formData.role || "coach"} onChange={(e) => {
                const role = e.target.value as "coach" | "onboarding";
                setFormData({
                  ...formData,
                  role,
                  clientCheckins: [],
                  newClientNames: [],
                  deactivatedClientNames: [],
                  submittedBy: role === "onboarding" ? "Nicole" : (formData.submittedBy === "Nicole" ? "" : formData.submittedBy),
                });
              }}>
                <option value="coach">Coach</option>
                <option value="onboarding">Onboarding</option>
              </select>
            </div>
            <div>
              <label className="field-label">Date *</label>
              <input className="input-field" type="date" value={formData.date || ""} onChange={(e) => setFormData({ ...formData, date: e.target.value })} />
            </div>
          </div>

          {/* ==================== COACH-SPECIFIC FIELDS ==================== */}
          {formData.role === "coach" && formData.submittedBy && (
            <>
              {/* Row 2: Active Count (auto), Deactivated (dropdown) */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                <div>
                  <label className="field-label">Active Client Count</label>
                  <div className="input-field" style={{ display: "flex", alignItems: "center", opacity: 0.7, cursor: "default" }}>
                    {autoActiveCount}
                    <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 8 }}>(auto)</span>
                  </div>
                </div>

                {/* Accounts Deactivated Multi-Select */}
                <div>
                  <label className="field-label">Accounts Deactivated</label>
                  <MultiSelectDropdown
                    options={coachActiveClients.map((c) => c.name)}
                    selected={formData.deactivatedClientNames || []}
                    onToggle={(name) => toggleNameInList("deactivatedClientNames", name)}
                    placeholder="Select clients..."
                    emptyText="No active clients"
                  />
                </div>
              </div>

              {/* Row 3: Hours, Feeling */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                <div>
                  <label className="field-label">Hours Logged</label>
                  <input className="input-field" type="number" step="0.5" value={formData.hoursLogged || ""} onChange={(e) => setFormData({ ...formData, hoursLogged: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="field-label">How are you feeling today?</label>
                  <input className="input-field" value={formData.feelingToday || ""} onChange={(e) => setFormData({ ...formData, feelingToday: e.target.value })} />
                </div>
              </div>
            </>
          )}

          {/* ==================== ONBOARDING (NICOLE) SPECIFIC FIELDS ==================== */}
          {formData.role === "onboarding" && (
            <>
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <label className="field-label" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
                    <Calendar size={14} /> Today&apos;s Onboarding Clients
                  </label>
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

                {/* Calendar client dropdown */}
                {!calendarLoading && calendarEvents.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {calendarEvents.map((evt) => {
                        const alreadyAdded = (formData.clientCheckins || []).some(
                          (c) => c.clientName === evt.clientName
                        );
                        return (
                          <button
                            key={evt.id}
                            onClick={() => !alreadyAdded && addCalendarClientToCheckins(evt.clientName, evt.clientEmail)}
                            disabled={alreadyAdded}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "8px 14px",
                              borderRadius: 8,
                              fontSize: 13,
                              fontWeight: 500,
                              cursor: alreadyAdded ? "default" : "pointer",
                              border: alreadyAdded
                                ? "1px solid var(--success)"
                                : "1px solid var(--accent)",
                              background: alreadyAdded
                                ? "rgba(126, 201, 160, 0.15)"
                                : "rgba(201, 169, 110, 0.1)",
                              color: alreadyAdded ? "var(--success)" : "var(--accent)",
                              opacity: alreadyAdded ? 0.7 : 1,
                            }}
                          >
                            {alreadyAdded ? <CheckCircle size={14} /> : <Plus size={14} />}
                            {evt.clientName}
                            {evt.start && (
                              <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 4 }}>
                                {(() => {
                                  try {
                                    return new Date(evt.start).toLocaleTimeString("en-US", {
                                      hour: "numeric",
                                      minute: "2-digit",
                                      timeZone: "America/New_York",
                                    });
                                  } catch {
                                    return "";
                                  }
                                })()}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!calendarLoading && calendarEvents.length === 0 && !calendarError && (
                  <div style={{ padding: 12, textAlign: "center", color: "var(--text-muted)", fontSize: 13, background: "var(--bg-glass)", borderRadius: 8, marginBottom: 12 }}>
                    No onboarding events found on the calendar for this date.
                  </div>
                )}

                {/* Added onboarding clients with status controls */}
                {(formData.clientCheckins || []).length > 0 && (
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
                          <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14, flex: 1 }}>
                            {checkin.clientName}
                          </span>
                          <button
                            onClick={() => removeOnboardingClient(idx)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}
                            title="Remove"
                          >
                            <X size={14} />
                          </button>
                        </div>

                        {/* Onboarding status buttons */}
                        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                          {(["onboarded", "no_show", "rescheduled", "internal_meeting"] as const).map((status) => (
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

                        {/* Expanded onboarding fields when "Onboarded" is selected */}
                        {checkin.onboardingStatus === "onboarded" && (
                          <div style={{ marginBottom: 8, padding: 12, background: "rgba(126, 201, 160, 0.08)", borderRadius: 8, border: "1px solid rgba(126, 201, 160, 0.15)" }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--success)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                              New Client Details
                            </div>

                            {/* Row 1: Coach, Program Duration, Offer */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                              <div>
                                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Assigned Coach *</label>
                                <select
                                  className="input-field"
                                  value={checkin.onboardingCoach || ""}
                                  onChange={(e) => updateOnboardingDetail(idx, "onboardingCoach", e.target.value)}
                                  style={{ fontSize: 12, padding: "6px 8px" }}
                                >
                                  <option value="">Select coach...</option>
                                  {availableCoaches.map((name) => (
                                    <option key={name} value={name}>{name}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Program Duration *</label>
                                <select
                                  className="input-field"
                                  value={checkin.onboardingProgram || ""}
                                  onChange={(e) => updateOnboardingDetail(idx, "onboardingProgram", e.target.value)}
                                  style={{ fontSize: 12, padding: "6px 8px" }}
                                >
                                  <option value="">Select duration...</option>
                                  <option value="4 Weeks">4 Weeks</option>
                                  <option value="12 Weeks">12 Weeks</option>
                                  <option value="24 Weeks">24 Weeks</option>
                                  <option value="48 Weeks">48 Weeks</option>
                                </select>
                              </div>
                              <div>
                                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Offer *</label>
                                <select
                                  className="input-field"
                                  value={checkin.onboardingOffer || ""}
                                  onChange={(e) => updateOnboardingDetail(idx, "onboardingOffer", e.target.value)}
                                  style={{ fontSize: 12, padding: "6px 8px" }}
                                >
                                  <option value="">Select offer...</option>
                                  <option value="Tyson">Tyson</option>
                                  <option value="Keith">Keith</option>
                                </select>
                              </div>
                            </div>

                            {/* Row 2: Start Date, End Date, Salesperson */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                              <div>
                                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Program Start Date *</label>
                                <input
                                  className="input-field"
                                  type="date"
                                  value={checkin.onboardingStartDate || ""}
                                  onChange={(e) => updateOnboardingDetail(idx, "onboardingStartDate", e.target.value)}
                                  style={{ fontSize: 12, padding: "6px 8px" }}
                                />
                              </div>
                              <div>
                                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Program End Date *</label>
                                <input
                                  className="input-field"
                                  type="date"
                                  value={checkin.onboardingEndDate || ""}
                                  onChange={(e) => updateOnboardingDetail(idx, "onboardingEndDate", e.target.value)}
                                  style={{ fontSize: 12, padding: "6px 8px" }}
                                />
                              </div>
                              <div>
                                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Salesperson (Closer) *</label>
                                <select
                                  className="input-field"
                                  value={checkin.onboardingSalesPerson || ""}
                                  onChange={(e) => updateOnboardingDetail(idx, "onboardingSalesPerson", e.target.value)}
                                  style={{ fontSize: 12, padding: "6px 8px" }}
                                >
                                  <option value="">Select closer...</option>
                                  {availableSalesPeople.map((name) => (
                                    <option key={name} value={name}>{name}</option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            {/* Row 3: Client Email */}
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Client Email</label>
                              <input
                                className="input-field"
                                type="email"
                                placeholder="client@email.com"
                                value={checkin.onboardingEmail || ""}
                                onChange={(e) => updateOnboardingDetail(idx, "onboardingEmail", e.target.value)}
                                style={{ fontSize: 12, padding: "6px 8px", width: "100%" }}
                              />
                            </div>

                            {/* Row 4: Fathom Link */}
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4, alignItems: "center", gap: 4 }}>
                                <Link size={10} style={{ display: "inline", marginRight: 4 }} />Fathom Recording Link
                              </label>
                              <input
                                className="input-field"
                                type="url"
                                placeholder="https://fathom.video/..."
                                value={checkin.onboardingFathomLink || ""}
                                onChange={(e) => updateOnboardingDetail(idx, "onboardingFathomLink", e.target.value)}
                                style={{ fontSize: 12, padding: "6px 8px", width: "100%" }}
                              />
                            </div>

                            {/* Row 4: Payment Comments */}
                            <div>
                              <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Payment Comments *</label>
                              <input
                                className="input-field"
                                placeholder="e.g. Paid $1,200 via Stripe, 3 installments..."
                                value={checkin.onboardingPaymentComments || ""}
                                onChange={(e) => updateOnboardingDetail(idx, "onboardingPaymentComments", e.target.value)}
                                style={{ fontSize: 12, padding: "6px 8px", width: "100%" }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Notes */}
                        <input
                          className="input-field"
                          placeholder={
                            checkin.onboardingStatus === "rescheduled"
                              ? "Reason for reschedule / new date..."
                              : checkin.onboardingStatus === "no_show"
                              ? "Any follow-up notes..."
                              : checkin.onboardingStatus === "internal_meeting"
                              ? "Meeting topic / notes..."
                              : "Notes..."
                          }
                          value={checkin.notes}
                          onChange={(e) => updateCheckinNote(idx, e.target.value)}
                          style={{ fontSize: 12, padding: "4px 8px", width: "100%" }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Nicole's other fields */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                <div>
                  <label className="field-label">Hours Logged</label>
                  <input className="input-field" type="number" step="0.5" value={formData.hoursLogged || ""} onChange={(e) => setFormData({ ...formData, hoursLogged: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="field-label">How are you feeling today?</label>
                  <input className="input-field" value={formData.feelingToday || ""} onChange={(e) => setFormData({ ...formData, feelingToday: e.target.value })} />
                </div>
              </div>
            </>
          )}

          {/* ==================== SHARED FIELDS ==================== */}
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
              <label className="field-label">Client Check-ins ({formData.clientCheckins?.length} clients)</label>
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
            <button className="btn-primary" onClick={handleSubmit}>{editingReport ? "Save Changes" : "Submit Report"}</button>
            <button className="btn-secondary" onClick={() => { setShowForm(false); setEditingReport(null); setCalendarEvents([]); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ======================== REPORT HISTORY ======================== */}
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
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => openEditForm(report)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, display: "flex", alignItems: "center" }}
                title="Edit report"
              >
                <Pencil size={14} />
              </button>
              {deletingId === report.id ? (
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button
                    onClick={() => handleDelete(report.id!)}
                    style={{ background: "rgba(217, 142, 142, 0.15)", border: "none", cursor: "pointer", color: "var(--danger)", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setDeletingId(null)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "2px 6px", fontSize: 11 }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setDeletingId(report.id!)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, display: "flex", alignItems: "center" }}
                  title="Delete report"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{report.date}</span>
            {report.createdAt && (
              <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                Submitted {new Date(report.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-secondary)", marginBottom: 8, flexWrap: "wrap" }}>
            {report.role === "coach" && <span>Active: <strong>{report.activeClientCount}</strong></span>}
            {(report.newClientNames?.length > 0 || report.newClients > 0) && (
              <span>
                New: <strong style={{ color: "var(--success)" }}>
                  {report.newClientNames?.length > 0 ? report.newClientNames.join(", ") : report.newClients}
                </strong>
              </span>
            )}
            {(report.deactivatedClientNames?.length > 0 || report.accountsDeactivated > 0) && (
              <span>
                Deactivated: <strong style={{ color: "var(--danger)" }}>
                  {report.deactivatedClientNames?.length > 0 ? report.deactivatedClientNames.join(", ") : report.accountsDeactivated}
                </strong>
              </span>
            )}
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

          {report.feelingToday && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
              Feeling: {report.feelingToday}
            </div>
          )}
        </div>
      ))}

      {/* ======================== EOD SUBMISSION CALENDAR ======================== */}
      <EODSubmissionCalendar reports={reports} eodTeam={[...coachNames, "Nicole"]} />
    </div>
  );
}

// ============ EOD Submission Calendar Component ============

function EODSubmissionCalendar({ reports, eodTeam }: { reports: CoachEODReport[]; eodTeam: string[] }) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0=Sun

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  // Build a map: date -> set of team member names who submitted
  const submissionMap = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    reports.forEach((r) => {
      if (!map[r.date]) map[r.date] = new Set();
      map[r.date].add(r.submittedBy);
    });
    return map;
  }, [reports]);

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  const monthLabel = currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // Generate calendar days
  const days: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);

  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  return (
    <div className="glass-static" style={{ padding: 20, marginTop: 24 }}>
      <h3 style={{ color: "var(--text-primary)", fontSize: 16, fontWeight: 600, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <Calendar size={16} /> EOD Submission Tracker
      </h3>

      {/* Month navigation */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button onClick={prevMonth} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4 }}>
          <ChevronLeft size={18} />
        </button>
        <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>{monthLabel}</span>
        <button onClick={nextMonth} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4 }}>
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Day headers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, textAlign: "center", marginBottom: 4 }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", padding: "4px 0", textTransform: "uppercase" }}>
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {days.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} />;

          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const submitted = submissionMap[dateStr] || new Set();
          const missing = eodTeam.filter((name) => !submitted.has(name));
          const isToday = dateStr === todayStr;
          const isPast = new Date(dateStr) < new Date(todayStr);
          const isFuture = new Date(dateStr) > new Date(todayStr);
          const allSubmitted = !isFuture && eodTeam.length > 0 && missing.length === 0;
          const hasMissing = !isFuture && (isPast || isToday) && missing.length > 0 && eodTeam.length > 0;
          const isSelected = selectedDay === dateStr;

          return (
            <div
              key={dateStr}
              onClick={() => !isFuture && setSelectedDay(isSelected ? null : dateStr)}
              style={{
                padding: "6px 2px",
                borderRadius: 6,
                textAlign: "center",
                cursor: isFuture ? "default" : "pointer",
                background: isSelected
                  ? "rgba(201, 169, 110, 0.2)"
                  : allSubmitted
                  ? "rgba(126, 201, 160, 0.1)"
                  : hasMissing
                  ? "rgba(217, 142, 142, 0.1)"
                  : "transparent",
                border: isToday
                  ? "2px solid var(--accent)"
                  : isSelected
                  ? "1px solid var(--accent)"
                  : "1px solid transparent",
                opacity: isFuture ? 0.3 : 1,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? "var(--accent)" : "var(--text-primary)" }}>
                {day}
              </div>
              {!isFuture && eodTeam.length > 0 && (
                <div style={{ fontSize: 9, marginTop: 2 }}>
                  {allSubmitted ? (
                    <span style={{ color: "var(--success)" }}>{submitted.size}/{eodTeam.length}</span>
                  ) : hasMissing ? (
                    <span style={{ color: "var(--danger)" }}>{submitted.size}/{eodTeam.length}</span>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 11, color: "var(--text-muted)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: "rgba(126, 201, 160, 0.3)" }} />
          All submitted
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: "rgba(217, 142, 142, 0.3)" }} />
          Missing reports
        </div>
      </div>

      {/* Selected day detail */}
      {selectedDay && (
        <div style={{ marginTop: 16, padding: 12, background: "var(--bg-glass)", borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
            {new Date(selectedDay + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </div>

          {/* Submitted coaches */}
          {(submissionMap[selectedDay]?.size || 0) > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--success)", marginBottom: 4, textTransform: "uppercase" }}>
                Submitted ({submissionMap[selectedDay].size})
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {Array.from(submissionMap[selectedDay]).map((name) => (
                  <span key={name} style={{
                    fontSize: 12,
                    padding: "3px 10px",
                    borderRadius: 4,
                    background: "rgba(126, 201, 160, 0.15)",
                    color: "var(--success)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}>
                    <CheckCircle size={10} /> {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Missing coaches */}
          {(() => {
            const submitted = submissionMap[selectedDay] || new Set();
            const missing = eodTeam.filter((name) => !submitted.has(name));
            if (missing.length === 0) return null;
            return (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--danger)", marginBottom: 4, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 4 }}>
                  <AlertTriangle size={10} /> Missing ({missing.length})
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {missing.map((name) => (
                    <span key={name} style={{
                      fontSize: 12,
                      padding: "3px 10px",
                      borderRadius: 4,
                      background: "rgba(217, 142, 142, 0.15)",
                      color: "var(--danger)",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}>
                      <XCircle size={10} /> {name}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ============ Multi-Select Dropdown Component ============

function MultiSelectDropdown({
  options,
  selected,
  onToggle,
  placeholder,
  emptyText,
}: {
  options: string[];
  selected: string[];
  onToggle: (name: string) => void;
  placeholder: string;
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <div
        className="input-field"
        onClick={() => options.length > 0 && setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: options.length > 0 ? "pointer" : "default",
          minHeight: 38,
          flexWrap: "wrap",
          gap: 4,
        }}
      >
        {selected.length === 0 ? (
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{placeholder}</span>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {selected.map((name) => (
              <span
                key={name}
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "rgba(201, 169, 110, 0.2)",
                  color: "var(--accent)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {name}
                <X
                  size={10}
                  style={{ cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(name);
                  }}
                />
              </span>
            ))}
          </div>
        )}
        <ChevronDown size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      </div>

      {open && (
        <>
          {/* Backdrop to close dropdown */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 998 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              zIndex: 999,
              background: "var(--bg-secondary, #1a1a1a)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              marginTop: 4,
              maxHeight: 200,
              overflowY: "auto",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}
          >
            {options.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
                {emptyText}
              </div>
            ) : (
              options.map((name) => (
                <div
                  key={name}
                  onClick={() => onToggle(name)}
                  style={{
                    padding: "8px 12px",
                    fontSize: 13,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    color: selected.includes(name) ? "var(--accent)" : "var(--text-primary)",
                    background: selected.includes(name) ? "rgba(201, 169, 110, 0.1)" : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLElement).style.background = "rgba(201, 169, 110, 0.15)";
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLElement).style.background = selected.includes(name) ? "rgba(201, 169, 110, 0.1)" : "transparent";
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(name)}
                    readOnly
                    style={{ accentColor: "var(--accent)", pointerEvents: "none" }}
                  />
                  {name}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
