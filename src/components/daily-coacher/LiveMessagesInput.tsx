"use client";

/**
 * Daily Coacher — live messages input.
 *
 * Coach pastes recent client/coach exchanges. Stored in
 * daily_coacher_live_messages; latest 20 feed every topic generation as
 * "live context" alongside the persistent summary.
 *
 * UI: a role toggle (coach | client) + textarea + Add. Each row shows
 * role, timestamp, message; coach can delete a row if pasted in error.
 *
 * Why one-message-at-a-time instead of bulk paste with prefix parsing:
 *   - Bulk parsing is error-prone (Everfit message exports have weird
 *     formatting). One-at-a-time is slower per message but reliable.
 *   - Most exchanges only need 1-3 messages of context per draft, not
 *     a full conversation dump.
 */

import { useEffect, useState } from "react";
import { MessagesSquare, Trash2 } from "lucide-react";

interface LiveMessage {
  id: number;
  role: "coach" | "client";
  message: string;
  created_at: string;
}

interface Props {
  clientId: number;
}

export default function LiveMessagesInput({ clientId }: Props) {
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [role, setRole] = useState<"coach" | "client">("client");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/coaching/daily-coacher/${clientId}/live-messages`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMessages(data.messages || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function add(): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/coaching/daily-coacher/${clientId}/live-messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, message: trimmed }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setText("");
      // Toggle role automatically — most exchanges alternate, saves a click.
      setRole(role === "coach" ? "client" : "coach");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add message");
    } finally {
      setAdding(false);
    }
  }

  async function del(id: number): Promise<void> {
    try {
      const res = await fetch(
        `/api/coaching/daily-coacher/${clientId}/live-messages`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  return (
    <div className="glass-static" style={{ padding: 20, borderRadius: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MessagesSquare size={14} style={{ color: "var(--accent)" }} />
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            Recent Messages
          </span>
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Latest 20 feed every draft
        </span>
      </div>

      {/* Composer */}
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <RoleToggle value={role} onChange={setRole} />
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <textarea
          className="input-field"
          placeholder={`Paste a ${role} message…`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void add();
            }
          }}
          rows={2}
          style={{ flex: 1, fontSize: 13, resize: "vertical", minHeight: 38 }}
        />
        <button
          className="btn-primary"
          onClick={() => void add()}
          disabled={adding || !text.trim()}
          style={{
            padding: "8px 14px",
            fontSize: 12,
            alignSelf: "flex-start",
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
      ) : messages.length === 0 ? (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            fontStyle: "italic",
          }}
        >
          No recent messages.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gap: 6,
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                fontSize: 12,
                padding: "8px 10px",
                background:
                  m.role === "coach" ? "var(--accent-soft)" : "var(--bg-glass)",
                borderRadius: 6,
                borderLeft:
                  m.role === "coach"
                    ? "2px solid var(--accent)"
                    : "2px solid var(--border-primary)",
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
                <span
                  style={{
                    color: m.role === "coach" ? "var(--accent)" : "var(--text-secondary)",
                    fontWeight: 500,
                    textTransform: "capitalize",
                  }}
                >
                  {m.role}
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  {formatShortTimestamp(m.created_at)}
                </span>
                <button
                  onClick={() => void del(m.id)}
                  title="Delete message"
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
              </div>
              <div style={{ color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
                {m.message}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components / helpers
// ---------------------------------------------------------------------------

function RoleToggle({
  value,
  onChange,
}: {
  value: "coach" | "client";
  onChange: (v: "coach" | "client") => void;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        gap: 0,
        background: "var(--bg-glass)",
        padding: 2,
        borderRadius: 6,
      }}
    >
      {(["client", "coach"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          style={{
            padding: "4px 12px",
            fontSize: 11,
            fontWeight: 500,
            border: "none",
            background: value === opt ? "var(--accent-soft)" : "transparent",
            color: value === opt ? "var(--accent)" : "var(--text-muted)",
            borderRadius: 4,
            cursor: "pointer",
            textTransform: "capitalize",
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function formatShortTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  } catch {
    return iso;
  }
}
