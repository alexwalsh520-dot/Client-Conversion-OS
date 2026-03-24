"use client";

import { useState } from "react";
import { Users, Plus, ExternalLink, Search, X, Trash2 } from "lucide-react";
import type { Client, ProgramPause } from "@/lib/types";

interface Props {
  clients: Client[];
  pauses: ProgramPause[];
  onSave: (client: Partial<Client>) => Promise<void>;
  onDelete: (clientId: number) => Promise<void>;
}

export default function ClientRosterTab({ clients, pauses, onSave, onDelete }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [coachFilter, setCoachFilter] = useState<string>("all");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<Partial<Client>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
    await onSave(formData);
    setShowAddForm(false);
    setEditingId(null);
    setFormData({});
    setConfirmingDelete(false);
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
  };

  const startAdd = () => {
    setEditingId(null);
    setFormData({ status: "active" });
    setShowAddForm(true);
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "active": return "var(--success)";
      case "paused": return "var(--warning)";
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
          <option value="paused">Paused</option>
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
      <div className="metric-grid metric-grid-4" style={{ marginBottom: 16 }}>
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
          <div className="metric-card-label">Paused</div>
          <div className="metric-card-value" style={{ color: "var(--warning)" }}>
            {clients.filter((c) => c.status === "paused").length}
          </div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Refunded/Cancelled</div>
          <div className="metric-card-value" style={{ color: "var(--danger)" }}>
            {clients.filter((c) => c.status === "refunded" || c.status === "cancelled").length}
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
              <label className="field-label">Coach</label>
              <input className="input-field" value={formData.coachName || ""} onChange={(e) => setFormData({ ...formData, coachName: e.target.value })} />
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
              <select className="input-field" value={formData.status || "active"} onChange={(e) => setFormData({ ...formData, status: e.target.value as Client["status"] })}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="refunded">Refunded</option>
              </select>
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
                  <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{client.name}</td>
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
