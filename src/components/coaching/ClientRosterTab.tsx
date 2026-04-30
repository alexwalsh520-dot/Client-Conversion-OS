"use client";

import { useState, useEffect } from "react";
import { Users, Plus, ExternalLink, Search, X, Trash2, CheckCircle, XCircle, Clock, Calendar, MessageSquare, Target, Pencil } from "lucide-react";
import type { Client, ProgramPause, CoachMilestone, CoachMeeting, CoachEODReport, NutritionIntakeForm } from "@/lib/types";

interface ClientNote {
  id?: number;
  date: string;
  coachName: string;
  notes: string;
  checkedIn: boolean;
  source?: "eod" | "manual";
}

interface Props {
  clients: Client[];
  pauses: ProgramPause[];
  milestones: CoachMilestone[];
  meetings: CoachMeeting[];
  eodReports: CoachEODReport[];
  nutritionForms: NutritionIntakeForm[];
  onSave: (client: Partial<Client>) => Promise<void>;
  onDelete: (clientId: number) => Promise<void>;
  onDeleteMeeting?: (meetingId: number) => Promise<void>;
  selectedClientName?: string | null;
  onClearSelection?: () => void;
}

export default function ClientRosterTab({ clients, pauses, milestones, meetings, eodReports, nutritionForms, onSave, onDelete, onDeleteMeeting, selectedClientName, onClearSelection }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [coachFilter, setCoachFilter] = useState<string>("all");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<Partial<Client>>({});
  const [nutritionSearch, setNutritionSearch] = useState("");
  const [showNutritionDropdown, setShowNutritionDropdown] = useState(false);
  const [selectedNutritionForm, setSelectedNutritionForm] = useState<NutritionIntakeForm | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [clientNotes, setClientNotes] = useState<ClientNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [retainedDuration, setRetainedDuration] = useState<string>("");

  // Auto-open client detail when navigated from another tab
  useEffect(() => {
    if (selectedClientName) {
      const client = clients.find((c) => c.name === selectedClientName);
      if (client) {
        startEdit(client);
        // Fetch notes for this client
        fetchClientNotes(client.name);
      }
      onClearSelection?.();
    }
  }, [selectedClientName, clients]);

  // Fetch notes when editing a client
  const fetchClientNotes = async (name: string) => {
    setNotesLoading(true);
    try {
      const res = await fetch(`/api/coaching/client-notes?name=${encodeURIComponent(name)}`);
      const data = await res.json();
      setClientNotes(data.notes || []);
    } catch {
      setClientNotes([]);
    } finally {
      setNotesLoading(false);
    }
  };

  const addNote = async (clientName: string) => {
    if (!newNote.trim()) return;
    setAddingNote(true);
    try {
      await fetch("/api/coaching/client-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName, note: newNote.trim() }),
      });
      setNewNote("");
      fetchClientNotes(clientName);
    } catch {
      // silently fail
    } finally {
      setAddingNote(false);
    }
  };

  const deleteNote = async (noteId: number, clientName: string) => {
    await fetch(`/api/coaching/client-notes?id=${noteId}`, { method: "DELETE" });
    fetchClientNotes(clientName);
  };

  const editNote = async (noteId: number, newText: string, clientName: string) => {
    await fetch("/api/coaching/client-notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: noteId, note: newText }),
    });
    fetchClientNotes(clientName);
  };

  const coaches = [...new Set(clients.map((c) => c.coachName).filter(Boolean))];

  // Compute effective end dates (accounting for pauses)
  const getEffectiveEndDate = (client: Client) => {
    const clientPauses = pauses.filter(
      (p) => p.clientId === client.id && p.approved
    );
    const totalPauseDays = clientPauses.reduce((s, p) => s + p.pauseDays, 0);
    if (totalPauseDays === 0) return client.endDate;
    const end = new Date(client.endDate);
    end.setDate(end.getDate() + totalPauseDays);
    return end.toISOString().split("T")[0];
  };

  const filtered = clients.filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (coachFilter !== "all" && c.coachName !== coachFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.coachName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleSave = async () => {
    try {
      await onSave(formData);
      setShowAddForm(false);
      setEditingId(null);
      setFormData({});
      setConfirmingDelete(false);
    } catch (err) {
      console.error("[ClientRoster] Save failed:", err);
      alert("Failed to save: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleDelete = async () => {
    if (!editingId) return;
    await onDelete(editingId);
    setShowAddForm(false);
    setEditingId(null);
    setFormData({});
    setConfirmingDelete(false);
  };

  const startEdit = (client: Client) => {
    setEditingId(client.id || null);
    setFormData({ ...client });
    setShowAddForm(false);
    fetchClientNotes(client.name);
  };

  const startAdd = () => {
    setEditingId(null);
    setFormData({ status: "active" });
    setShowAddForm(true);
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "active": return "var(--success)";
      case "retained": return "var(--success)";
      case "completed": return "var(--accent)";
      case "cancelled": return "var(--danger)";
      case "refunded": return "var(--danger)";
      default: return "var(--text-muted)";
    }
  };

  const daysRemaining = (endDate: string) => {
    const diff = Math.ceil(
      (new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    return diff;
  };

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 200px" }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--text-muted)" }} />
          <input
            type="text"
            placeholder="Search clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field"
            style={{ paddingLeft: 32, width: "100%" }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-field"
          style={{ width: "auto" }}
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="refunded">Refunded</option>
        </select>
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
        <button className="btn-primary" onClick={startAdd}>
          <Plus size={14} /> Add Client
        </button>
      </div>

      {/* Summary */}
      <div className="metric-grid metric-grid-3" style={{ marginBottom: 16 }}>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Total Clients</div>
          <div className="metric-card-value">{clients.length}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Active</div>
          <div className="metric-card-value" style={{ color: "var(--success)" }}>
            {clients.filter((c) => c.status === "active").length}
          </div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Completed</div>
          <div className="metric-card-value" style={{ color: "var(--accent)" }}>
            {clients.filter((c) => c.status === "completed").length}
          </div>
        </div>
      </div>

      {/* Add/Edit Form */}
      {(showAddForm || editingId !== null) && (
        <div className="glass-static" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ color: "var(--text-primary)", fontSize: 16, fontWeight: 600 }}>
              {editingId ? "Edit Client" : "Add New Client"}
            </h3>
            <button onClick={() => { setShowAddForm(false); setEditingId(null); setFormData({}); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
              <X size={16} />
            </button>
          </div>
          {/* Nutrition Form Link — only for new clients */}
          {!editingId && (
            <div style={{ marginBottom: 14, position: "relative" }}>
              <label className="field-label">Link Nutrition Intake Form (optional)</label>
              <input
                className="input-field"
                placeholder="Search by name or email..."
                value={nutritionSearch}
                onChange={(e) => {
                  setNutritionSearch(e.target.value);
                  setShowNutritionDropdown(true);
                }}
                onFocus={() => setShowNutritionDropdown(true)}
              />
              {showNutritionDropdown && nutritionSearch.length > 0 && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
                  background: "var(--card-bg, #1a1a2e)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8, maxHeight: 200, overflowY: "auto", marginTop: 4,
                }}>
                  {nutritionForms
                    .filter((nf) => {
                      const q = nutritionSearch.toLowerCase();
                      const fullName = `${nf.firstName} ${nf.lastName}`.toLowerCase();
                      return fullName.includes(q) || nf.email.toLowerCase().includes(q);
                    })
                    .slice(0, 10)
                    .map((nf) => (
                      <div
                        key={nf.id}
                        onClick={() => {
                          setSelectedNutritionForm(nf);
                          setNutritionSearch(`${nf.firstName} ${nf.lastName} (${nf.email})`);
                          setShowNutritionDropdown(false);
                          setFormData({
                            ...formData,
                            name: `${nf.firstName} ${nf.lastName}`,
                            email: nf.email,
                            phoneNumber: nf.phone,
                            nutritionFormId: nf.id,
                          });
                        }}
                        style={{
                          padding: "8px 12px", cursor: "pointer", fontSize: 13,
                          color: "var(--text-primary)", borderBottom: "1px solid rgba(255,255,255,0.05)",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <span style={{ fontWeight: 600 }}>{nf.firstName} {nf.lastName}</span>
                        <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: 12 }}>{nf.email}</span>
                        {nf.timestamp && (
                          <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: 11 }}>
                            Submitted {new Date(nf.timestamp).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    ))}
                  {nutritionForms.filter((nf) => {
                    const q = nutritionSearch.toLowerCase();
                    return `${nf.firstName} ${nf.lastName}`.toLowerCase().includes(q) || nf.email.toLowerCase().includes(q);
                  }).length === 0 && (
                    <div style={{ padding: "8px 12px", color: "var(--text-muted)", fontSize: 13 }}>
                      No matching intake forms found
                    </div>
                  )}
                </div>
              )}
              {selectedNutritionForm && (
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--success)", display: "flex", alignItems: "center", gap: 4 }}>
                  <CheckCircle size={12} /> Linked to {selectedNutritionForm.firstName} {selectedNutritionForm.lastName}&apos;s intake form
                  <button
                    onClick={() => {
                      setSelectedNutritionForm(null);
                      setNutritionSearch("");
                      setFormData({ ...formData, nutritionFormId: undefined });
                    }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", marginLeft: 4 }}
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label className="field-label">Name *</label>
              <input className="input-field" value={formData.name || ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Email</label>
              <input className="input-field" value={formData.email || ""} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Phone</label>
              <input className="input-field" value={formData.phoneNumber || ""} onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Coach</label>
              <select
                className="input-field"
                value={
                  [...new Set(clients.map((c) => c.coachName).filter(Boolean))].includes(formData.coachName || "")
                    ? formData.coachName
                    : formData.coachName ? "__custom__" : ""
                }
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    const name = prompt("Enter new coach name:");
                    if (name?.trim()) setFormData({ ...formData, coachName: name.trim() });
                  } else if (e.target.value !== "__custom__") {
                    setFormData({ ...formData, coachName: e.target.value });
                  }
                }}
              >
                <option value="">Select coach...</option>
                {[...new Set(clients.map((c) => c.coachName).filter(Boolean))].sort().map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
                {formData.coachName && ![...new Set(clients.map((c) => c.coachName).filter(Boolean))].includes(formData.coachName) && (
                  <option value="__custom__">{formData.coachName}</option>
                )}
                <option value="__new__">+ Add new coach</option>
              </select>
            </div>
            <div>
              <label className="field-label">Program</label>
              <input className="input-field" value={formData.program || ""} onChange={(e) => setFormData({ ...formData, program: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Offer</label>
              <input className="input-field" value={formData.offer || ""} onChange={(e) => setFormData({ ...formData, offer: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Status</label>
              <select
                className="input-field"
                value={formData.status || "active"}
                onChange={(e) => {
                  const newStatus = e.target.value as Client["status"];
                  setFormData({ ...formData, status: newStatus });
                }}
              >
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
              {/* "Extend program" affordance — replaces the legacy
                  Retained dropdown workflow. Available whenever the
                  client is active + has an end date. Selection pushes
                  the end date out by N weeks and posts an auto-note;
                  status stays active throughout. */}
              {formData.status === "active" && formData.endDate && (
                <select
                  className="input-field"
                  value={retainedDuration}
                  onChange={(e) => {
                    const weeks = parseInt(e.target.value, 10);
                    setRetainedDuration(e.target.value);
                    if (weeks && formData.endDate) {
                      const oldEnd = formData.endDate;
                      const newEnd = new Date(formData.endDate);
                      newEnd.setDate(newEnd.getDate() + weeks * 7);
                      const newEndStr = newEnd.toISOString().split("T")[0];
                      setFormData({ ...formData, endDate: newEndStr });
                      const today = new Date().toISOString().split("T")[0];
                      if (formData.name) {
                        fetch("/api/coaching/client-notes", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            clientName: formData.name,
                            note: `Program extended on ${today} by ${weeks} weeks. End date changed from ${oldEnd} to ${newEndStr}.`,
                          }),
                        }).then(() => {
                          if (formData.name) fetchClientNotes(formData.name);
                        }).catch(() => {});
                      }
                      // Reset selection so coach can extend again later
                      setTimeout(() => setRetainedDuration(""), 100);
                    }
                  }}
                  style={{ marginTop: 6 }}
                >
                  <option value="">Extend program by…</option>
                  <option value="4">+4 Weeks</option>
                  <option value="12">+12 Weeks</option>
                </select>
              )}
            </div>
            <div>
              <label className="field-label">Start Date</label>
              <input className="input-field" type="date" value={formData.startDate || ""} onChange={(e) => setFormData({ ...formData, startDate: e.target.value })} />
            </div>
            <div>
              <label className="field-label">End Date</label>
              <input className="input-field" type="date" value={formData.endDate || ""} onChange={(e) => setFormData({ ...formData, endDate: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Amount Paid</label>
              <input className="input-field" type="number" value={formData.amountPaid || ""} onChange={(e) => setFormData({ ...formData, amountPaid: Number(e.target.value) })} />
            </div>
            <div>
              <label className="field-label">Sales Person / Closer</label>
              <input className="input-field" value={formData.salesPerson || ""} onChange={(e) => setFormData({ ...formData, salesPerson: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Payment Platform</label>
              <input className="input-field" value={formData.paymentPlatform || ""} onChange={(e) => setFormData({ ...formData, paymentPlatform: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Sales Fathom Link</label>
              <input className="input-field" value={formData.salesFathomLink || ""} onChange={(e) => setFormData({ ...formData, salesFathomLink: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Onboarding Fathom Link</label>
              <input className="input-field" value={formData.onboardingFathomLink || ""} onChange={(e) => setFormData({ ...formData, onboardingFathomLink: e.target.value })} />
            </div>
            <div style={{ gridColumn: "span 3" }}>
              <label className="field-label">Comments</label>
              <input className="input-field" value={formData.comments || ""} onChange={(e) => setFormData({ ...formData, comments: e.target.value })} />
            </div>
          </div>
          {/* Milestone Info (only when editing existing client) */}
          {editingId && (() => {
            const editingClient = clients.find((c) => c.id === editingId);
            const ms = milestones.find((m) => m.clientName === editingClient?.name || (m.clientId && m.clientId === editingId));
            if (!ms) return null;
            const items = [
              { label: "TrustPilot", done: ms.trustPilotCompleted, attempted: !!ms.trustPilotPromptedDate, date: ms.trustPilotCompletionDate },
              { label: "Video Testimonial", done: ms.videoTestimonialCompleted, attempted: !!ms.videoTestimonialPromptedDate, date: ms.videoTestimonialCompletionDate },
              { label: "Extension", done: ms.retentionCompleted, attempted: !!ms.retentionPromptedDate, date: ms.retentionCompletionDate },
              { label: "Referral", done: ms.referralCompleted, attempted: !!ms.referralPromptedDate, date: ms.referralCompletionDate },
            ];
            return (
              <div style={{ marginTop: 16, padding: 12, background: "var(--bg-glass)", borderRadius: 8 }}>
                <label className="field-label" style={{ marginBottom: 8, display: "block" }}>Milestones</label>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  {items.map((item) => (
                    <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      {item.done ? (
                        <CheckCircle size={14} style={{ color: "var(--success)" }} />
                      ) : item.attempted ? (
                        <XCircle size={14} style={{ color: "var(--danger)" }} />
                      ) : (
                        <Clock size={14} style={{ color: "var(--text-muted)" }} />
                      )}
                      <span style={{ color: item.done ? "var(--success)" : item.attempted ? "var(--danger)" : "var(--text-muted)" }}>
                        {item.label}
                      </span>
                      {item.done && item.date && (
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>({item.date})</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Meetings Section (only when editing) */}
          {editingId && (() => {
            const editingClient = clients.find((c) => c.id === editingId);
            const clientMeetings = meetings.filter(
              (m) => m.clientName === editingClient?.name
            );

            return (
              <div style={{ marginTop: 16, padding: 12, background: "var(--bg-glass)", borderRadius: 8 }}>
                <label className="field-label" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <Calendar size={13} /> Meetings
                </label>
                {clientMeetings.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>No meetings logged</div>
                ) : (
                  <div style={{ display: "grid", gap: 6 }}>
                    {clientMeetings.slice(0, 10).map((m) => (
                      <div key={m.id} style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 12, padding: "6px 0", borderBottom: "1px solid var(--border-primary)" }}>
                        <span style={{ color: "var(--text-muted)", minWidth: 80 }}>{m.meetingDate}</span>
                        <span style={{ color: "var(--accent)", fontWeight: 500 }}>{m.coachName}</span>
                        <span style={{ color: "var(--text-secondary)" }}>{m.durationMinutes}min</span>
                        {m.notes && <span style={{ color: "var(--text-muted)", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.notes}>{m.notes}</span>}
                        {m.id && onDeleteMeeting && (
                          <button onClick={() => onDeleteMeeting(m.id!)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }} title="Delete meeting">
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Coach Notes (only when editing) */}
          {editingId && (() => {
            const editingClient = clients.find((c) => c.id === editingId);
            return (
              <div style={{ marginTop: 16, padding: 12, background: "var(--bg-glass)", borderRadius: 8 }}>
                <label className="field-label" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <MessageSquare size={13} /> Coach Notes
                </label>

                {/* Add new note */}
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <input
                    className="input-field"
                    placeholder="Add a note about this client..."
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && editingClient) addNote(editingClient.name); }}
                    style={{ flex: 1, fontSize: 13 }}
                  />
                  <button
                    className="btn-primary"
                    onClick={() => editingClient && addNote(editingClient.name)}
                    disabled={addingNote || !newNote.trim()}
                    style={{ padding: "8px 16px", fontSize: 12, opacity: addingNote || !newNote.trim() ? 0.5 : 1 }}
                  >
                    {addingNote ? "..." : "Add"}
                  </button>
                </div>

                {notesLoading ? (
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading notes...</div>
                ) : clientNotes.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>No coach notes yet</div>
                ) : (
                  <div style={{ display: "grid", gap: 6, maxHeight: 300, overflowY: "auto" }}>
                    {clientNotes.map((note, i) => (
                      <div key={i} style={{ fontSize: 12, padding: "6px 0", borderBottom: "1px solid var(--border-primary)" }}>
                        <div style={{ display: "flex", gap: 8, marginBottom: 2, alignItems: "center" }}>
                          <span style={{ color: "var(--text-muted)", minWidth: 80 }}>{note.date}</span>
                          <span style={{ color: "var(--accent)", fontWeight: 500 }}>{note.coachName}</span>
                          {note.checkedIn && <CheckCircle size={12} style={{ color: "var(--success)" }} />}
                          {note.source === "manual" && note.id && editingClient && (
                            <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                              <button
                                onClick={() => {
                                  const updated = prompt("Edit note:", note.notes);
                                  if (updated && updated !== note.notes) editNote(note.id!, updated, editingClient.name);
                                }}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}
                                title="Edit"
                              ><Pencil size={11} /></button>
                              <button
                                onClick={() => deleteNote(note.id!, editingClient.name)}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}
                                title="Delete"
                              ><Trash2 size={11} /></button>
                            </span>
                          )}
                        </div>
                        <div style={{ color: "var(--text-secondary)", paddingLeft: 4 }}>{note.notes}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-primary" onClick={handleSave}>Save</button>
              <button className="btn-secondary" onClick={() => { setShowAddForm(false); setEditingId(null); setFormData({}); setConfirmingDelete(false); }}>Cancel</button>
            </div>
            {editingId && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {confirmingDelete ? (
                  <>
                    <span style={{ color: "var(--danger)", fontSize: 13 }}>Are you sure?</span>
                    <button
                      onClick={handleDelete}
                      style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "6px 14px", borderRadius: 6, border: "none",
                        background: "var(--danger)", color: "#fff",
                        cursor: "pointer", fontSize: 13, fontWeight: 600,
                      }}
                    >
                      Yes, Delete
                    </button>
                    <button
                      onClick={() => setConfirmingDelete(false)}
                      className="btn-secondary"
                    >
                      No
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmingDelete(true)}
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      padding: "6px 14px", borderRadius: 6,
                      border: "1px solid var(--danger)", background: "none",
                      color: "var(--danger)", cursor: "pointer", fontSize: 13,
                    }}
                  >
                    <Trash2 size={13} /> Delete Client
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="glass-static" style={{ overflow: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Coach</th>
              <th>Program</th>
              <th>Status</th>
              <th>Start</th>
              <th>End</th>
              <th>Days Left</th>
              <th>Closer</th>
              <th>Paid</th>
              <th>Comments</th>
              <th>Links</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((client) => {
              const effectiveEnd = getEffectiveEndDate(client);
              const days = client.status === "active" ? daysRemaining(effectiveEnd) : null;
              return (
                <tr key={client.id || client.name}>
                  <td style={{ fontWeight: 600, color: "var(--text-primary)", cursor: "pointer" }} onClick={() => startEdit(client)}>{client.name}</td>
                  <td>{client.coachName}</td>
                  <td>{client.program}</td>
                  <td>
                    <span style={{
                      color: statusColor(client.status),
                      fontWeight: 600,
                      fontSize: 12,
                      textTransform: "uppercase",
                    }}>
                      {client.status}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>{client.startDate}</td>
                  <td style={{ fontSize: 12 }}>
                    {effectiveEnd}
                    {effectiveEnd !== client.endDate && (
                      <span style={{ color: "var(--warning)", fontSize: 10, marginLeft: 4 }}>+ext</span>
                    )}
                  </td>
                  <td>
                    {days !== null && (
                      <span style={{ color: days <= 7 ? "var(--danger)" : days <= 21 ? "var(--warning)" : "var(--success)", fontWeight: 600 }}>
                        {days}d
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>{client.salesPerson}</td>
                  <td>${client.amountPaid.toLocaleString()}</td>
                  <td style={{ fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={client.comments}>{client.comments}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    {client.salesFathomLink && (
                      <a href={client.salesFathomLink} target="_blank" rel="noopener noreferrer" title="Sales Recording" style={{ color: "var(--accent)" }}>
                        <ExternalLink size={13} />
                      </a>
                    )}
                    {client.onboardingFathomLink && (
                      <a href={client.onboardingFathomLink} target="_blank" rel="noopener noreferrer" title="Onboarding Recording" style={{ color: "var(--success)" }}>
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </td>
                  <td>
                    <button
                      onClick={() => startEdit(client)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 12 }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
