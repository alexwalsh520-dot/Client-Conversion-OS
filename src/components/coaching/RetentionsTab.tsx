"use client";

/**
 * Retentions tab. Renders one card per client currently in the retention
 * window, grouped by coach. Global chat box at the top fans a single note
 * out to every open cycle. Each card has a per-client manual note button
 * and three action buttons: Opp Lost / +4 weeks / +12 weeks.
 *
 * All state lives on the server (retention_cycles + retention_notes). This
 * component is a thin controller: fetch on mount and after each mutation.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Heart,
  Send,
  Loader2,
  MessageSquarePlus,
  XCircle,
  Calendar,
  RefreshCw,
} from "lucide-react";

type ClientLite = {
  id: number;
  name: string;
  email: string;
  coach_name: string;
  program: string;
  offer: string;
  start_date: string;
  end_date: string;
  status: string;
  phone_number: string | null;
};

type NoteRow = {
  id: number;
  cycle_id: number;
  note_text: string;
  source: "chat_batch" | "manual";
  batch_id: string | null;
  author_email: string;
  created_at: string;
};

type CycleRow = {
  cycleId: number;
  enteredWindowAt: string;
  endDateAtEntry: string;
  client: ClientLite;
  notes: NoteRow[];
};

function daysRemaining(endDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function daysColor(days: number): string {
  if (days < 0) return "#ef4444";
  if (days <= 3) return "#f59e0b";
  return "var(--text-muted)";
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = (now.getTime() - d.getTime()) / (1000 * 60);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${Math.floor(diffMin)}m ago`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function RetentionsTab() {
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [chatText, setChatText] = useState("");
  const [chatSending, setChatSending] = useState(false);

  const [coachFilter, setCoachFilter] = useState<string>("__all__");
  const [manualClientId, setManualClientId] = useState<number | null>(null);
  const [manualText, setManualText] = useState("");
  const [pendingClientAction, setPendingClientAction] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/coaching/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setCycles(body.cycles ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const coaches = useMemo(() => {
    const set = new Set<string>();
    for (const c of cycles) set.add(c.client.coach_name?.trim() || "Unassigned");
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [cycles]);

  const visibleCycles = useMemo(() => {
    if (coachFilter === "__all__") return cycles;
    return cycles.filter((c) => (c.client.coach_name?.trim() || "Unassigned") === coachFilter);
  }, [cycles, coachFilter]);

  const grouped = useMemo(() => {
    const byCoach = new Map<string, CycleRow[]>();
    for (const c of visibleCycles) {
      const coach = c.client.coach_name?.trim() || "Unassigned";
      const arr = byCoach.get(coach) ?? [];
      arr.push(c);
      byCoach.set(coach, arr);
    }
    // Sort clients inside each coach by most urgent first (lowest days remaining).
    for (const arr of byCoach.values()) {
      arr.sort((a, b) => daysRemaining(a.client.end_date) - daysRemaining(b.client.end_date));
    }
    return [...byCoach.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visibleCycles]);

  const sendChatNote = async () => {
    const text = chatText.trim();
    if (!text) return;
    setChatSending(true);
    try {
      const res = await fetch("/api/coaching/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "add_note", text }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setChatText("");
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setChatSending(false);
    }
  };

  const sendManualNote = async (clientId: number) => {
    const text = manualText.trim();
    if (!text) return;
    try {
      const res = await fetch("/api/coaching/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "add_note", text, clientId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setManualClientId(null);
      setManualText("");
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const markOppLost = async (clientId: number, clientName: string) => {
    if (!confirm(`Mark ${clientName} as OPPORTUNITY LOST? This changes their status to Completed.`)) return;
    setPendingClientAction(clientId);
    try {
      const res = await fetch("/api/coaching/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "mark_opp_lost", clientId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingClientAction(null);
    }
  };

  const extend = async (clientId: number, clientName: string, weeks: 4 | 12) => {
    if (!confirm(`Extend ${clientName} by ${weeks} weeks?`)) return;
    setPendingClientAction(clientId);
    try {
      const res = await fetch("/api/coaching/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "extend", clientId, weeks }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingClientAction(null);
    }
  };

  return (
    <div>
      {/* Header + explainer */}
      <div className="glass-static" style={{ padding: 16, marginBottom: 16, borderRadius: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <Heart size={16} style={{ color: "#ef4444" }} />
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Retention Window</h2>
          <span style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444", fontSize: 11, padding: "2px 8px", borderRadius: 10, fontWeight: 600, marginLeft: 4 }}>
            {cycles.length}
          </span>
          <button
            onClick={load}
            title="Refresh"
            style={{ marginLeft: "auto", background: "none", border: "1px solid var(--border-primary)", padding: "4px 8px", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Active clients with 14 or fewer days left on the program, plus any who&apos;ve already run past.
          Each stays in the window until marked <strong>Opp Lost</strong> (status becomes Completed) or extended
          <strong> 4 weeks</strong> / <strong>12 weeks</strong>. Notes typed into the chat below attach to every
          currently open cycle at that moment; when a client leaves the window, their notes stay behind on the
          closed cycle and won&apos;t appear next time they re-enter.
        </p>
      </div>

      {/* Global chat box */}
      <div className="glass-static" style={{ padding: 12, marginBottom: 16, borderRadius: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <MessageSquarePlus size={14} /> Add a note to every client in the window
        </div>
        <textarea
          className="input-field"
          value={chatText}
          onChange={(e) => setChatText(e.target.value)}
          placeholder="Paste a meeting transcript or type an update. This will attach to every currently open retention cycle."
          rows={3}
          style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Applies to {cycles.length} open cycle{cycles.length === 1 ? "" : "s"}.
          </span>
          <button
            onClick={sendChatNote}
            disabled={chatSending || !chatText.trim() || cycles.length === 0}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 6,
              border: "none",
              background: "var(--accent)",
              color: "#000",
              fontWeight: 600,
              fontSize: 12,
              cursor: chatSending || !chatText.trim() || cycles.length === 0 ? "not-allowed" : "pointer",
              opacity: chatSending || !chatText.trim() || cycles.length === 0 ? 0.5 : 1,
            }}
          >
            {chatSending ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={12} />}
            Post to all
          </button>
        </div>
      </div>

      {/* Coach filter */}
      {coaches.length > 1 && (
        <div style={{ marginBottom: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            onClick={() => setCoachFilter("__all__")}
            style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-primary)", background: coachFilter === "__all__" ? "var(--accent)" : "none", color: coachFilter === "__all__" ? "#000" : "var(--text-muted)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
          >
            All ({cycles.length})
          </button>
          {coaches.map((c) => {
            const count = cycles.filter((cy) => (cy.client.coach_name?.trim() || "Unassigned") === c).length;
            return (
              <button
                key={c}
                onClick={() => setCoachFilter(c)}
                style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-primary)", background: coachFilter === c ? "var(--accent)" : "none", color: coachFilter === c ? "#000" : "var(--text-muted)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
              >
                {c} ({count})
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div style={{ padding: 12, background: "rgba(239,68,68,0.1)", color: "#ef4444", borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
          {error}
        </div>
      )}

      {loading && cycles.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
          <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
        </div>
      )}

      {!loading && cycles.length === 0 && (
        <div className="glass-static" style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", borderRadius: 10 }}>
          Nobody in the retention window right now. Clients appear here as their end date comes within 14 days.
        </div>
      )}

      {/* Grouped by coach */}
      {grouped.map(([coach, coachCycles]) => (
        <div key={coach} style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px 0", color: "var(--text-primary)" }}>
            {coach} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>({coachCycles.length})</span>
          </h3>
          <div style={{ display: "grid", gap: 10 }}>
            {coachCycles.map((cy) => {
              const days = daysRemaining(cy.client.end_date);
              const isBusy = pendingClientAction === cy.client.id;
              return (
                <div key={cy.cycleId} className="glass-static" style={{ padding: 12, borderRadius: 10 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{cy.client.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                          <Calendar size={11} /> ends {new Date(cy.client.end_date).toLocaleDateString()}
                        </span>
                        <span style={{ color: daysColor(days), fontWeight: 600 }}>
                          {days < 0 ? `${Math.abs(days)} days overdue` : `${days} days left`}
                        </span>
                        <span>· {cy.client.program} · {cy.client.offer}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        disabled={isBusy}
                        onClick={() => extend(cy.client.id, cy.client.name, 4)}
                        style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border-primary)", background: "none", color: "var(--text-primary)", cursor: isBusy ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 600 }}
                      >
                        +4 weeks
                      </button>
                      <button
                        disabled={isBusy}
                        onClick={() => extend(cy.client.id, cy.client.name, 12)}
                        style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border-primary)", background: "none", color: "var(--text-primary)", cursor: isBusy ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 600 }}
                      >
                        +12 weeks
                      </button>
                      <button
                        disabled={isBusy}
                        onClick={() => markOppLost(cy.client.id, cy.client.name)}
                        style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.08)", color: "#ef4444", cursor: isBusy ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}
                      >
                        <XCircle size={11} /> Opp Lost
                      </button>
                    </div>
                  </div>

                  {/* Notes */}
                  <div style={{ marginTop: 10 }}>
                    {cy.notes.length === 0 && manualClientId !== cy.client.id && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic", marginBottom: 6 }}>
                        No notes yet for this cycle.
                      </div>
                    )}
                    {cy.notes.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 6 }}>
                        {cy.notes.map((n) => (
                          <div key={n.id} style={{ padding: "8px 10px", background: "var(--hover-bg-subtle)", borderRadius: 6, fontSize: 12 }}>
                            <div style={{ whiteSpace: "pre-wrap", color: "var(--text-primary)" }}>{n.note_text}</div>
                            <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-muted)" }}>
                              {n.source === "chat_batch" ? "chat" : "manual"} · {n.author_email} · {formatWhen(n.created_at)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {manualClientId === cy.client.id ? (
                      <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                        <textarea
                          className="input-field"
                          value={manualText}
                          onChange={(e) => setManualText(e.target.value)}
                          placeholder={`Note for ${cy.client.name}…`}
                          rows={2}
                          autoFocus
                          style={{ flex: 1, resize: "vertical", fontFamily: "inherit", fontSize: 12 }}
                        />
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <button
                            onClick={() => sendManualNote(cy.client.id)}
                            disabled={!manualText.trim()}
                            style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: "var(--accent)", color: "#000", fontWeight: 600, fontSize: 11, cursor: manualText.trim() ? "pointer" : "not-allowed", opacity: manualText.trim() ? 1 : 0.5 }}
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setManualClientId(null); setManualText(""); }}
                            style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border-primary)", background: "none", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setManualClientId(cy.client.id); setManualText(""); }}
                        style={{ padding: "4px 8px", borderRadius: 6, border: "1px dashed var(--border-primary)", background: "none", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                      >
                        <MessageSquarePlus size={11} /> Add manual note
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
