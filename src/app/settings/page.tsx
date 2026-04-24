"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Settings,
  Users,
  MessageSquare,
  Dumbbell,
  FileSpreadsheet,
  RefreshCw,
  CheckCircle,
  XCircle,
  Plus,
  Trash2,
  Edit3,
  X,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  UserPlus,
  Briefcase,
} from "lucide-react";

interface AppUser {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "client";
  allowed_tabs: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const TAB_LABELS: Record<string, string> = {
  "/": "Home",
  "/mozi-metrics": "Mozi Metrics",
  "/sales": "Sales",
  "/coaching": "Coaching",
  "/onboarding": "Onboarding",
  "/ads": "Ads",
  "/studio": "Studio",
  "/outreach": "Outreach",
  "/leads": "Lead Gen",
  "/outreach-runs": "Outreach",
  "/sales-hub": "Sales Hub",
  "/media-buyer": "Media Buyer",
  "/intelligence": "Intelligence",
  "/log": "Change Log",
  "/settings": "Settings",
};

export default function SettingsPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  // User management state
  const [users, setUsers] = useState<AppUser[]>([]);
  const [allTabs, setAllTabs] = useState<string[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Add form state
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "client">("client");
  const [newTabs, setNewTabs] = useState<string[]>(["/"]);
  const [addLoading, setAddLoading] = useState(false);

  // Edit form state
  const [editTabs, setEditTabs] = useState<string[]>([]);
  const [editRole, setEditRole] = useState<"admin" | "client">("client");
  const [editName, setEditName] = useState("");

  // Add Client / Team Member modals
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [clientName, setClientName] = useState("");
  const [clientStep, setClientStep] = useState(1);
  const [memberName, setMemberName] = useState("");
  const [memberRole, setMemberRole] = useState<"setter" | "closer">("setter");
  const [memberStep, setMemberStep] = useState(1);

  // Fetch last sync on mount
  useEffect(() => {
    fetch("/api/sync")
      .then((r) => r.json())
      .then((data) => {
        if (data.syncs && data.syncs.length > 0) {
          const last = data.syncs[0];
          setLastSync(
            new Date(last.completed_at || last.started_at).toLocaleString()
          );
        }
      })
      .catch(() => {});
  }, []);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      if (!res.ok) {
        setLoadingUsers(false);
        return;
      }
      const data = await res.json();
      setUsers(data.users || []);
      setAllTabs(data.allTabs || []);
    } catch {
      // not admin or network error
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchUsers();
    else setLoadingUsers(false);
  }, [isAdmin, fetchUsers]);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setSyncResult({
          success: true,
          message: `Synced ${data.rows} rows from ${data.sheets?.length || 0} sheets`,
        });
        setLastSync(new Date().toLocaleString());
      } else {
        setSyncResult({
          success: false,
          message: data.error || "Sync failed",
        });
      }
    } catch {
      setSyncResult({
        success: false,
        message: "Network error — could not reach sync endpoint",
      });
    } finally {
      setSyncing(false);
    }
  }

  async function handleAddUser() {
    if (!newEmail.trim()) return;
    setAddLoading(true);
    setActionError(null);

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          name: newName || null,
          role: newRole,
          allowed_tabs: newRole === "admin" ? allTabs : newTabs,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || "Failed to add user");
      } else {
        setShowAddForm(false);
        setNewEmail("");
        setNewName("");
        setNewRole("client");
        setNewTabs(["/"]);
        fetchUsers();
      }
    } catch {
      setActionError("Network error");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleToggleActive(user: AppUser) {
    setActionError(null);
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, is_active: !user.is_active }),
      });
      if (!res.ok) {
        const data = await res.json();
        setActionError(data.error || "Failed to update");
      } else {
        fetchUsers();
      }
    } catch {
      setActionError("Network error");
    }
  }

  async function handleDeleteUser(user: AppUser) {
    if (!confirm(`Remove ${user.name || user.email}? They won't be able to sign in anymore.`)) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/users?id=${user.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setActionError(data.error || "Failed to delete");
      } else {
        fetchUsers();
      }
    } catch {
      setActionError("Network error");
    }
  }

  async function handleSaveEdit(userId: string) {
    setActionError(null);
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: userId,
          name: editName,
          role: editRole,
          allowed_tabs: editRole === "admin" ? allTabs : editTabs,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setActionError(data.error || "Failed to update");
      } else {
        setEditingUser(null);
        fetchUsers();
      }
    } catch {
      setActionError("Network error");
    }
  }

  function startEdit(user: AppUser) {
    setEditingUser(user.id);
    setEditName(user.name || "");
    setEditRole(user.role);
    setEditTabs(user.allowed_tabs || []);
    setExpandedUser(user.id);
  }

  function toggleTab(tab: string, setter: (tabs: string[]) => void, current: string[]) {
    if (current.includes(tab)) {
      setter(current.filter((t) => t !== tab));
    } else {
      setter([...current, tab]);
    }
  }

  function selectAllTabs(setter: (tabs: string[]) => void) {
    setter([...allTabs]);
  }

  function clearAllTabs(setter: (tabs: string[]) => void) {
    setter(["/"]);
  }

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">
          User management and integrations
        </p>
      </div>

      <div
        className="glass-static"
        style={{
          padding: 20,
          marginBottom: 20,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          borderLeft: "3px solid var(--tyson)",
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
            Voice Notes
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Set up Tyson once, then let setters make custom ElevenLabs voice notes.
          </div>
        </div>
        <Link
          href="/settings/voice-notes"
          className="btn-secondary"
          style={{ whiteSpace: "nowrap" }}
        >
          Open Voice Notes
        </Link>
      </div>

      {/* User Management — Admin only */}
      {isAdmin && (
        <div className="section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 className="section-title" style={{ margin: 0 }}>
              <Users size={16} />
              Users &amp; Permissions
            </h2>
            <button
              className="btn-primary"
              onClick={() => { setShowAddForm(!showAddForm); setActionError(null); }}
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "8px 16px" }}
            >
              <Plus size={14} />
              Add User
            </button>
          </div>

          {actionError && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                marginBottom: 12,
                padding: "8px 12px",
                borderRadius: 8,
                background: "rgba(239,68,68,0.1)",
                color: "var(--danger)",
                border: "1px solid rgba(239,68,68,0.2)",
              }}
            >
              <XCircle size={14} />
              {actionError}
            </div>
          )}

          {/* Add User Form */}
          {showAddForm && (
            <div
              className="glass-static"
              style={{
                padding: 20,
                marginBottom: 16,
                borderLeft: "3px solid var(--accent)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>
                  New User
                </span>
                <button
                  onClick={() => setShowAddForm(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4 }}
                >
                  <X size={16} />
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                    Email *
                  </label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="user@example.com"
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                      color: "var(--text-primary)",
                      fontSize: 13,
                      outline: "none",
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                    Name
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Display name"
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                      color: "var(--text-primary)",
                      fontSize: 13,
                      outline: "none",
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                  Role
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => setNewRole("client")}
                    style={{
                      padding: "6px 16px",
                      borderRadius: 6,
                      border: `1px solid ${newRole === "client" ? "var(--accent)" : "var(--border)"}`,
                      background: newRole === "client" ? "var(--accent-soft)" : "transparent",
                      color: newRole === "client" ? "var(--accent)" : "var(--text-secondary)",
                      fontSize: 13,
                      cursor: "pointer",
                      fontWeight: 500,
                    }}
                  >
                    Client
                  </button>
                  <button
                    onClick={() => setNewRole("admin")}
                    style={{
                      padding: "6px 16px",
                      borderRadius: 6,
                      border: `1px solid ${newRole === "admin" ? "var(--accent)" : "var(--border)"}`,
                      background: newRole === "admin" ? "var(--accent-soft)" : "transparent",
                      color: newRole === "admin" ? "var(--accent)" : "var(--text-secondary)",
                      fontSize: 13,
                      cursor: "pointer",
                      fontWeight: 500,
                    }}
                  >
                    Admin
                  </button>
                </div>
              </div>

              {newRole === "client" && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Allowed Tabs
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => selectAllTabs(setNewTabs)}
                        style={{ fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer" }}
                      >
                        Select All
                      </button>
                      <button
                        onClick={() => clearAllTabs(setNewTabs)}
                        style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {allTabs.map((tab) => (
                      <button
                        key={tab}
                        onClick={() => toggleTab(tab, setNewTabs, newTabs)}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          fontSize: 12,
                          border: `1px solid ${newTabs.includes(tab) ? "var(--accent)" : "var(--border)"}`,
                          background: newTabs.includes(tab) ? "var(--accent-soft)" : "transparent",
                          color: newTabs.includes(tab) ? "var(--accent)" : "var(--text-muted)",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {TAB_LABELS[tab] || tab}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                className="btn-primary"
                onClick={handleAddUser}
                disabled={addLoading || !newEmail.trim()}
                style={{
                  opacity: addLoading || !newEmail.trim() ? 0.6 : 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {addLoading ? "Adding..." : "Add User"}
              </button>
            </div>
          )}

          {/* Users Table */}
          <div className="glass-static" style={{ overflow: "hidden" }}>
            {loadingUsers ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                Loading users...
              </div>
            ) : users.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                No users found
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Tabs</th>
                    <th>Status</th>
                    <th style={{ width: 120, textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <>
                      <tr key={user.id}>
                        <td>
                          <div>
                            <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 13 }}>
                              {user.name || "—"}
                            </div>
                            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                              {user.email}
                            </div>
                          </div>
                        </td>
                        <td>
                          {editingUser === user.id ? (
                            <div style={{ display: "flex", gap: 4 }}>
                              <button
                                onClick={() => setEditRole("client")}
                                style={{
                                  padding: "2px 8px",
                                  borderRadius: 4,
                                  fontSize: 11,
                                  border: `1px solid ${editRole === "client" ? "var(--accent)" : "var(--border)"}`,
                                  background: editRole === "client" ? "var(--accent-soft)" : "transparent",
                                  color: editRole === "client" ? "var(--accent)" : "var(--text-muted)",
                                  cursor: "pointer",
                                }}
                              >
                                Client
                              </button>
                              <button
                                onClick={() => setEditRole("admin")}
                                style={{
                                  padding: "2px 8px",
                                  borderRadius: 4,
                                  fontSize: 11,
                                  border: `1px solid ${editRole === "admin" ? "var(--accent)" : "var(--border)"}`,
                                  background: editRole === "admin" ? "var(--accent-soft)" : "transparent",
                                  color: editRole === "admin" ? "var(--accent)" : "var(--text-muted)",
                                  cursor: "pointer",
                                }}
                              >
                                Admin
                              </button>
                            </div>
                          ) : (
                            <span
                              className={`status-badge ${user.role === "admin" ? "status-active" : "status-pending"}`}
                              style={{ fontSize: 11 }}
                            >
                              {user.role}
                            </span>
                          )}
                        </td>
                        <td>
                          <button
                            onClick={() => setExpandedUser(expandedUser === user.id ? null : user.id)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 12,
                              color: "var(--text-secondary)",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                            }}
                          >
                            {user.role === "admin" ? "All" : `${user.allowed_tabs?.length || 0} tabs`}
                            {expandedUser === user.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </button>
                        </td>
                        <td>
                          <button
                            onClick={() => handleToggleActive(user)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              fontSize: 12,
                              color: user.is_active ? "var(--success)" : "var(--text-muted)",
                            }}
                            title={user.is_active ? "Click to disable" : "Click to enable"}
                          >
                            {user.is_active ? <Eye size={14} /> : <EyeOff size={14} />}
                            {user.is_active ? "Active" : "Disabled"}
                          </button>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                            {editingUser === user.id ? (
                              <>
                                <button
                                  onClick={() => handleSaveEdit(user.id)}
                                  className="btn-primary"
                                  style={{ padding: "4px 12px", fontSize: 11 }}
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditingUser(null)}
                                  style={{
                                    padding: "4px 12px",
                                    fontSize: 11,
                                    borderRadius: 6,
                                    border: "1px solid var(--border)",
                                    background: "transparent",
                                    color: "var(--text-muted)",
                                    cursor: "pointer",
                                  }}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => startEdit(user)}
                                  style={{
                                    padding: "4px 8px",
                                    borderRadius: 6,
                                    border: "1px solid var(--border)",
                                    background: "transparent",
                                    color: "var(--text-secondary)",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                  }}
                                  title="Edit permissions"
                                >
                                  <Edit3 size={13} />
                                </button>
                                <button
                                  onClick={() => handleDeleteUser(user)}
                                  style={{
                                    padding: "4px 8px",
                                    borderRadius: 6,
                                    border: "1px solid rgba(239,68,68,0.3)",
                                    background: "transparent",
                                    color: "var(--danger)",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                  }}
                                  title="Remove user"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded row: tab permissions */}
                      {expandedUser === user.id && (
                        <tr key={`${user.id}-tabs`}>
                          <td colSpan={5} style={{ padding: "12px 16px", background: "rgba(255,255,255,0.02)" }}>
                            {editingUser === user.id && editRole === "client" ? (
                              <div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                                    Select which tabs this user can access:
                                  </span>
                                  <div style={{ display: "flex", gap: 8 }}>
                                    <button
                                      onClick={() => selectAllTabs(setEditTabs)}
                                      style={{ fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer" }}
                                    >
                                      Select All
                                    </button>
                                    <button
                                      onClick={() => clearAllTabs(setEditTabs)}
                                      style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}
                                    >
                                      Clear
                                    </button>
                                  </div>
                                </div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                  {allTabs.map((tab) => (
                                    <button
                                      key={tab}
                                      onClick={() => toggleTab(tab, setEditTabs, editTabs)}
                                      style={{
                                        padding: "4px 10px",
                                        borderRadius: 6,
                                        fontSize: 12,
                                        border: `1px solid ${editTabs.includes(tab) ? "var(--accent)" : "var(--border)"}`,
                                        background: editTabs.includes(tab) ? "var(--accent-soft)" : "transparent",
                                        color: editTabs.includes(tab) ? "var(--accent)" : "var(--text-muted)",
                                        cursor: "pointer",
                                        transition: "all 0.15s ease",
                                      }}
                                    >
                                      {TAB_LABELS[tab] || tab}
                                    </button>
                                  ))}
                                </div>
                                {editingUser === user.id && (
                                  <div style={{ marginTop: 12 }}>
                                    <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                                      Display Name
                                    </label>
                                    <input
                                      type="text"
                                      value={editName}
                                      onChange={(e) => setEditName(e.target.value)}
                                      placeholder="Display name"
                                      style={{
                                        padding: "6px 10px",
                                        borderRadius: 6,
                                        border: "1px solid var(--border)",
                                        background: "var(--card)",
                                        color: "var(--text-primary)",
                                        fontSize: 12,
                                        outline: "none",
                                        width: 200,
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                            ) : editingUser === user.id && editRole === "admin" ? (
                              <div>
                                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                                  Admins have access to all tabs and can manage users.
                                </span>
                                <div style={{ marginTop: 12 }}>
                                  <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                                    Display Name
                                  </label>
                                  <input
                                    type="text"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    placeholder="Display name"
                                    style={{
                                      padding: "6px 10px",
                                      borderRadius: 6,
                                      border: "1px solid var(--border)",
                                      background: "var(--card)",
                                      color: "var(--text-primary)",
                                      fontSize: 12,
                                      outline: "none",
                                      width: 200,
                                    }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {user.role === "admin" ? (
                                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                                    Admin — full access to all tabs
                                  </span>
                                ) : user.allowed_tabs?.length ? (
                                  user.allowed_tabs.map((tab) => (
                                    <span
                                      key={tab}
                                      style={{
                                        padding: "3px 8px",
                                        borderRadius: 4,
                                        fontSize: 11,
                                        background: "var(--accent-soft)",
                                        color: "var(--accent)",
                                        border: "1px solid rgba(201,169,110,0.15)",
                                      }}
                                    >
                                      {TAB_LABELS[tab] || tab}
                                    </span>
                                  ))
                                ) : (
                                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>No tabs assigned</span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
            {users.length} user{users.length !== 1 ? "s" : ""} total
            {" · "}
            {users.filter((u) => u.is_active).length} active
            {" · "}
            Users must have a Google account to sign in
          </div>
        </div>
      )}

      {/* Non-admin: show basic team info */}
      {!isAdmin && !loadingUsers && (
        <div className="section">
          <h2 className="section-title">
            <Users size={16} />
            Your Access
          </h2>
          <div className="glass-static" style={{ padding: 20 }}>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
              Signed in as <strong style={{ color: "var(--text-primary)" }}>{session?.user?.email}</strong>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Role: {session?.user?.role || "client"} · {session?.user?.allowedTabs?.length || 0} tabs accessible
            </div>
          </div>
        </div>
      )}

      {/* Onboarding: Add Client / Team Member */}
      {isAdmin && (
        <div className="section">
          <h2 className="section-title" style={{ margin: 0, marginBottom: 16 }}>
            <UserPlus size={16} />
            Onboarding
          </h2>
          <div className="metric-grid metric-grid-2">
            <div className="glass-static" style={{ padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div className="action-card-icon" style={{ background: "var(--accent-soft)" }}>
                  <Briefcase size={18} style={{ color: "var(--accent)" }} />
                </div>
                <div className="action-card-title">Add Client</div>
              </div>
              <div className="action-card-desc" style={{ marginBottom: 16 }}>
                Set up a new coaching client with all required data source connections.
              </div>
              <button
                className="btn-primary"
                onClick={() => { setShowAddClient(true); setClientStep(1); setClientName(""); }}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "8px 16px" }}
              >
                <Plus size={14} />
                Add Client
              </button>
            </div>
            <div className="glass-static" style={{ padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div className="action-card-icon" style={{ background: "var(--accent-soft)" }}>
                  <Users size={18} style={{ color: "var(--accent)" }} />
                </div>
                <div className="action-card-title">Add Team Member</div>
              </div>
              <div className="action-card-desc" style={{ marginBottom: 16 }}>
                Add a setter or closer and connect their data sources for tracking.
              </div>
              <button
                className="btn-primary"
                onClick={() => { setShowAddMember(true); setMemberStep(1); setMemberName(""); }}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "8px 16px" }}
              >
                <Plus size={14} />
                Add Team Member
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Client Modal */}
      {showAddClient && (
        <div className="modal-overlay" onClick={() => setShowAddClient(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Add New Client</h3>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Step {clientStep} of 2</span>
            </div>
            {clientStep === 1 && (
              <>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
                  Enter the client&apos;s name. This will appear across all tabs.
                </p>
                <input
                  autoFocus
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Client name"
                  className="form-input"
                  style={{ width: "100%", marginBottom: 16 }}
                  onKeyDown={(e) => e.key === "Enter" && clientName.trim() && setClientStep(2)}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button className="btn-secondary" onClick={() => setShowAddClient(false)}>Cancel</button>
                  <button className="btn-primary" onClick={() => clientName.trim() && setClientStep(2)} disabled={!clientName.trim()}>Next</button>
                </div>
              </>
            )}
            {clientStep === 2 && (
              <>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
                  To pull accurate metrics for <strong style={{ color: "var(--text-primary)" }}>{clientName}</strong>, connect these data sources:
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {[
                    { name: "Sales Tracker (Google Sheet)", desc: "Add a column in the 'Offer' field matching the client name so revenue and call data can be attributed." },
                    { name: "GHL Sub-Account", desc: "Create or link a GHL sub-account with calendar and contact scopes for call tracking." },
                    { name: "GHL Calendar", desc: "Set up a booking calendar so calls booked, show rates, and no-shows are tracked." },
                    { name: "ManyChat", desc: "Configure ManyChat flows with tags matching the client name for lead and DM metrics." },
                    { name: "Ad Platform", desc: "Connect the ad account (Meta, Google, etc.) so ad spend, CPL, and ROAS data flows in." },
                  ].map((item) => (
                    <div key={item.name} style={{ display: "flex", gap: 10, padding: "10px 12px", background: "var(--bg-surface)", border: "1px solid var(--border-primary)", borderRadius: 8 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning)", marginTop: 6, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{item.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{item.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", marginBottom: 16 }}>
                  The client will appear in all views once added. Metrics populate as data flows in from each source.
                </p>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <button className="btn-secondary" onClick={() => setClientStep(1)}>&larr; Back</button>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn-secondary" onClick={() => setShowAddClient(false)}>Cancel</button>
                    <button className="btn-primary" onClick={() => setShowAddClient(false)}>Add Client</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Add Team Member Modal */}
      {showAddMember && (
        <div className="modal-overlay" onClick={() => setShowAddMember(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Add Team Member</h3>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Step {memberStep} of 2</span>
            </div>
            {memberStep === 1 && (
              <>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
                  Enter the team member&apos;s name and role. They&apos;ll appear across all client views.
                </p>
                <input
                  autoFocus
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  placeholder="Name"
                  className="form-input"
                  style={{ width: "100%", marginBottom: 12 }}
                />
                <select
                  value={memberRole}
                  onChange={(e) => setMemberRole(e.target.value as "setter" | "closer")}
                  className="form-input"
                  style={{ width: "100%", marginBottom: 16 }}
                >
                  <option value="setter">Setter</option>
                  <option value="closer">Closer</option>
                </select>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button className="btn-secondary" onClick={() => setShowAddMember(false)}>Cancel</button>
                  <button className="btn-primary" onClick={() => memberName.trim() && setMemberStep(2)} disabled={!memberName.trim()}>Next</button>
                </div>
              </>
            )}
            {memberStep === 2 && (
              <>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
                  After adding, set up the following for <strong style={{ color: "var(--text-primary)" }}>{memberName}</strong> ({memberRole}):
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {(memberRole === "setter" ? [
                    { name: "Sales Tracker Column", desc: "Add the setter's name to the 'Setter' column in the Google Sheet." },
                    { name: "GHL User Account", desc: "Create a GHL user so calls and leads can be attributed." },
                    { name: "ManyChat Assignment", desc: "Set up lead routing and assignment rules in ManyChat." },
                  ] : [
                    { name: "Sales Tracker Column", desc: "Add the closer's name to the 'Closer' column in the Google Sheet." },
                    { name: "GHL Calendar", desc: "Create a booking calendar in GHL for this closer." },
                    { name: "GHL User Account", desc: "Create a GHL user so calls and outcomes are tracked." },
                  ]).map((item) => (
                    <div key={item.name} style={{ display: "flex", gap: 10, padding: "10px 12px", background: "var(--bg-surface)", border: "1px solid var(--border-primary)", borderRadius: 8 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning)", marginTop: 6, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{item.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{item.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", marginBottom: 16 }}>
                  The team member will show up in all views once added. Metrics populate as data flows in.
                </p>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <button className="btn-secondary" onClick={() => setMemberStep(1)}>&larr; Back</button>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn-secondary" onClick={() => setShowAddMember(false)}>Cancel</button>
                    <button className="btn-primary" onClick={() => setShowAddMember(false)}>Add Member</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Integrations */}
      <div className="section">
        <h2 className="section-title">
          <Settings size={16} />
          Integrations
        </h2>
        <div className="metric-grid metric-grid-2">
          {/* Google Sheets Sync — LIVE */}
          <div
            className="glass-static"
            style={{
              padding: 24,
              borderLeft: "3px solid var(--success)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  className="action-card-icon"
                  style={{ background: "var(--success-soft)" }}
                >
                  <FileSpreadsheet
                    size={18}
                    style={{ color: "var(--success)" }}
                  />
                </div>
                <div className="action-card-title">Google Sheets Sync</div>
              </div>
              <span className="status-badge status-active">Connected</span>
            </div>
            <div
              className="action-card-desc"
              style={{ marginBottom: 16 }}
            >
              Auto-syncs every hour from 5 Google Sheets (coaching, onboarding,
              sales, ads). Data is stored in Supabase with mock-data fallback.
            </div>

            {lastSync && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  marginBottom: 12,
                }}
              >
                Last synced: {lastSync}
              </div>
            )}

            {syncResult && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  marginBottom: 12,
                  color: syncResult.success
                    ? "var(--success)"
                    : "var(--danger)",
                }}
              >
                {syncResult.success ? (
                  <CheckCircle size={14} />
                ) : (
                  <XCircle size={14} />
                )}
                {syncResult.message}
              </div>
            )}

            <button
              className="btn-primary"
              onClick={handleSync}
              disabled={syncing}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                opacity: syncing ? 0.7 : 1,
              }}
            >
              <RefreshCw
                size={14}
                style={{
                  animation: syncing ? "spin 1s linear infinite" : "none",
                }}
              />
              {syncing ? "Syncing..." : "Sync Now"}
            </button>
          </div>

          {/* Slack Integration — Coming Soon */}
          <div className="glass-static" style={{ padding: 24 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  className="action-card-icon"
                  style={{ background: "var(--tyson-soft)" }}
                >
                  <MessageSquare
                    size={18}
                    style={{ color: "var(--tyson)" }}
                  />
                </div>
                <div className="action-card-title">Slack Integration</div>
              </div>
              <span className="coming-soon-badge">Coming Soon</span>
            </div>
            <div className="action-card-desc">
              Connect Slack for automated EOD reports, AI alerts, and daily
              briefings delivered to your channels.
            </div>
          </div>

          {/* EverFit Sync — Coming Soon */}
          <div className="glass-static" style={{ padding: 24 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  className="action-card-icon"
                  style={{ background: "var(--success-soft)" }}
                >
                  <Dumbbell size={18} style={{ color: "var(--success)" }} />
                </div>
                <div className="action-card-title">EverFit Sync</div>
              </div>
              <span className="coming-soon-badge">Coming Soon</span>
            </div>
            <div className="action-card-desc">
              Sync client workout completion, check-in data, and coach metrics
              directly from EverFit.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
