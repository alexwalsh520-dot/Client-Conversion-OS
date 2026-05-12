"use client";

/**
 * Daily Coacher — coach notes input.
 *
 * Reuses the existing /api/coaching/client-notes endpoint. Notes added here
 * appear in the Client Roster's notes view too — single source of truth.
 *
 * The endpoint attributes the note to the logged-in user via
 * session.user.name; we just pass clientName and the note text.
 */

import { useEffect, useState } from "react";
import { MessageSquare, Trash2 } from "lucide-react";

interface NoteRow {
  id?: number;
  date: string;
  coachName: string;
  notes: string;
  source: "manual" | "eod";
}

interface ApiResponse {
  notes: NoteRow[];
}

interface Props {
  clientId: number; // unused in this component; kept for API symmetry with sibling
  clientName: string;
}

export default function CoachNotesInput({ clientName }: Props) {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/coaching/client-notes?name=${encodeURIComponent(clientName)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ApiResponse;
      setNotes(data.notes || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientName]);

  async function add(): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/coaching/client-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName, note: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setText("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add note");
    } finally {
      setAdding(false);
    }
  }

  async function del(id: number): Promise<void> {
    try {
      const res = await fetch(
        `/api/coaching/client-notes?id=${encodeURIComponent(String(id))}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete note");
    }
  }

  // Show only the manual notes — EOD checkin notes will appear in the roster
  // notes view but aren't part of Daily Coacher's add/edit surface.
  const manualNotes = notes.filter((n) => n.source === "manual");

  return (
    <div className="glass-static" style={{ padding: 20, borderRadius: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <MessageSquare size={14} style={{ color: "var(--accent)" }} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          Coach Notes
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          className="input-field"
          placeholder="Add a note about this client…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void add();
            }
          }}
          style={{ flex: 1, fontSize: 13 }}
        />
        <button
          className="btn-primary"
          onClick={() => void add()}
          disabled={adding || !text.trim()}
          style={{
            padding: "8px 14px",
            fontSize: 12,
            opacity: adding || !text.trim() ? 0.5 : 1,
          }}
        >
          {adding ? "…" : "Add"}
        </button>
      </div>

      {error && (
        <div
          style={{
            fontSize: 12,
            color: "var(--danger)",
            background: "var(--danger-soft)",
            padding: "6px 10px",
            borderRadius: 6,
            marginBottom: 8,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading…</div>
      ) : manualNotes.length === 0 ? (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            fontStyle: "italic",
          }}
        >
          No notes yet.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gap: 8,
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {manualNotes.map((n, i) => (
            <div
              key={n.id ?? i}
              style={{
                fontSize: 12,
                padding: "8px 10px",
                background: "var(--bg-glass)",
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <span style={{ color: "var(--text-muted)" }}>{n.date}</span>
                <span style={{ color: "var(--accent)", fontWeight: 500 }}>
                  {n.coachName}
                </span>
                {n.id && (
                  <button
                    onClick={() => void del(n.id!)}
                    title="Delete note"
                    style={{
                      marginLeft: "auto",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-muted)",
                      padding: 2,
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
              <div style={{ color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
                {n.notes}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
