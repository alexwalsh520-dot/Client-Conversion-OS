"use client";

import { useState } from "react";
import { Calendar, Plus, X, Trash2, Pencil, Video } from "lucide-react";
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
  /** True when editing an existing row (formData.id populated); false when
   *  creating a new one. Drives the form title, submit label, and the
   *  client-picker's behavior (in edit mode the client is fixed). */
  const isEditing = Boolean(formData.id);
  /** Server-side save error surfaced to the coach — most commonly the
   *  duplicate-fathom-link 409 from the API. Cleared on every fresh open
   *  and on the next successful save. */
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Client search combobox state. `clientQuery` is the visible input text;
  // `formData.clientName` is only set once the user picks a suggestion.
  const [clientQuery, setClientQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const coaches = [...new Set(meetings.map((m) => m.coachName))];
  const activeClients = clients.filter((c) => c.status === "active");

  const suggestions = (() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return activeClients.slice(0, 10);
    return activeClients
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 10);
  })();

  const pickClient = (client: Client) => {
    setFormData((prev) => ({
      ...prev,
      clientName: client.name,
      coachName: client.coachName?.trim() || "Unassigned",
    }));
    setClientQuery(client.name);
    setShowSuggestions(false);
    setHighlightIndex(0);
  };

  const openForm = (existing?: CoachMeeting) => {
    if (existing) {
      // Edit mode — pre-populate every field so the coach can amend any
      // one thing (typically: adding a Fathom link days after logging).
      setFormData({
        id: existing.id,
        clientId: existing.clientId,
        clientName: existing.clientName,
        coachName: existing.coachName,
        meetingDate: existing.meetingDate,
        durationMinutes: existing.durationMinutes,
        notes: existing.notes,
        fathomLink: existing.fathomLink ?? "",
      });
      setClientQuery(existing.clientName);
    } else {
      setFormData({});
      setClientQuery("");
    }
    setShowSuggestions(false);
    setHighlightIndex(0);
    setSaveError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setFormData({});
    setClientQuery("");
    setShowSuggestions(false);
    setSaveError(null);
  };

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
    if (!formData.clientName || !formData.meetingDate) return;
    setSaveError(null);
    setSaving(true);
    try {
      // For a new row, resolve coach + clientId from the picked client so the
      // credit is uniform and per-coach weekly counts stay reliable. For an
      // edit, keep whatever was already stored — the client isn't editable
      // once the row exists (a coach who mistyped should delete + relog).
      const payload: Partial<CoachMeeting> = { ...formData };
      if (!isEditing) {
        const client = activeClients.find((c) => c.name === formData.clientName);
        payload.coachName = client?.coachName?.trim() || "Unassigned";
        payload.clientId = client?.id || 0;
      }
      // Normalize the fathom field so an empty string clears the link
      // rather than trying to write "".
      const trimmed = (payload.fathomLink ?? "").toString().trim();
      payload.fathomLink = trimmed.length > 0 ? trimmed : null;
      await onSave(payload);
      setShowForm(false);
      setFormData({});
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
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
        <button className="btn-primary" onClick={() => openForm()}>
          <Plus size={14} /> Log Meeting
        </button>
      </div>

      {/* Add / Edit Form */}
      {showForm && (
        <div className="glass-static" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ color: "var(--text-primary)", fontSize: 16, fontWeight: 600 }}>
              {isEditing ? "Edit Meeting" : "Log New Meeting"}
            </h3>
            <button onClick={closeForm} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
              <X size={16} />
            </button>
          </div>
          {saveError && (
            <div
              role="alert"
              style={{
                marginBottom: 12,
                padding: "10px 12px",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.4)",
                borderRadius: 6,
                color: "#fca5a5",
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              {saveError}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div style={{ position: "relative" }}>
              <label className="field-label">Client *</label>
              {isEditing ? (
                // Client is fixed on an edit — coaches don't change WHO the
                // meeting was with, they amend details. Rename via delete + relog.
                <input
                  className="input-field"
                  value={formData.clientName || ""}
                  readOnly
                  disabled
                  title="Client can't be changed on an existing meeting"
                  style={{ opacity: 0.75, cursor: "not-allowed" }}
                />
              ) : (
              <>
              <input
                className="input-field"
                type="text"
                autoComplete="off"
                placeholder="Start typing a client's name..."
                value={clientQuery}
                onChange={(e) => {
                  setClientQuery(e.target.value);
                  setShowSuggestions(true);
                  setHighlightIndex(0);
                  // Typing invalidates any prior confirmed selection until they pick again.
                  if (formData.clientName) {
                    setFormData((prev) => ({ ...prev, clientName: "", coachName: "" }));
                  }
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => {
                  // Delay so a click on a suggestion registers before the dropdown hides.
                  setTimeout(() => setShowSuggestions(false), 150);
                }}
                onKeyDown={(e) => {
                  if (!showSuggestions || suggestions.length === 0) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlightIndex((i) => Math.max(i - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const pick = suggestions[highlightIndex];
                    if (pick) pickClient(pick);
                  } else if (e.key === "Escape") {
                    setShowSuggestions(false);
                  }
                }}
              />
              {showSuggestions && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    marginTop: 2,
                    background: "var(--panel-bg, #1a1a1a)",
                    border: "1px solid var(--border-color, rgba(255,255,255,0.1))",
                    borderRadius: 6,
                    maxHeight: 240,
                    overflowY: "auto",
                    zIndex: 20,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                  }}
                >
                  {suggestions.length === 0 ? (
                    <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-muted)" }}>
                      No active clients match &ldquo;{clientQuery}&rdquo;
                    </div>
                  ) : (
                    suggestions.map((c, i) => (
                      <div
                        key={c.id || c.name}
                        onMouseDown={(e) => {
                          // onMouseDown so it fires before the input's onBlur closes the list.
                          e.preventDefault();
                          pickClient(c);
                        }}
                        onMouseEnter={() => setHighlightIndex(i)}
                        style={{
                          padding: "8px 10px",
                          fontSize: 13,
                          color: "var(--text-primary)",
                          cursor: "pointer",
                          background: i === highlightIndex ? "var(--hover-bg, rgba(255,255,255,0.06))" : "transparent",
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <span>{c.name}</span>
                        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{c.coachName || "Unassigned"}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
              </>
              )}
            </div>
            <div>
              <label className="field-label">Coach</label>
              <input
                className="input-field"
                value={formData.coachName || ""}
                readOnly
                disabled
                placeholder="Set from client"
                title="Automatically credited to the client's assigned coach"
                style={{ opacity: 0.75, cursor: "not-allowed" }}
              />
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
            <div style={{ gridColumn: "span 3" }}>
              <label className="field-label">
                Fathom link{" "}
                <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 12 }}>
                  (optional but strongly encouraged — a Fathom-linked meeting earns +10 in the weekly score)
                </span>
              </label>
              <input
                className="input-field"
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://fathom.video/share/…"
                value={formData.fathomLink ?? ""}
                onChange={(e) => setFormData({ ...formData, fathomLink: e.target.value })}
              />
              {isEditing && formData.fathomLink && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  Editing this field will re-stamp the &quot;added&quot; time to now — the score only credits the coach if the link is added in the current week.
                </div>
              )}
            </div>
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : isEditing ? "Save Changes" : "Save Meeting"}
            </button>
            <button className="btn-secondary" onClick={closeForm}>Cancel</button>
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
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>{meeting.clientName}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 12 }}>w/ {meeting.coachName}</span>
                  {meeting.fathomLink ? (
                    <a
                      href={meeting.fathomLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open Fathom recording"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                        fontSize: 11,
                        color: "#a5b96e",
                        background: "rgba(165,185,110,0.12)",
                        border: "1px solid rgba(165,185,110,0.35)",
                        padding: "2px 6px",
                        borderRadius: 4,
                        textDecoration: "none",
                      }}
                    >
                      <Video size={11} /> Fathom
                    </a>
                  ) : (
                    <span
                      title="No Fathom link yet — add one to earn +10 in the weekly score"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                        fontSize: 11,
                        color: "var(--text-muted)",
                        border: "1px solid var(--border-color, rgba(255,255,255,0.1))",
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                    >
                      <Video size={11} /> No Fathom
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{meeting.durationMinutes}min</span>
                  {meeting.id && (
                    <button
                      onClick={() => openForm(meeting)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}
                      title="Edit meeting"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
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
