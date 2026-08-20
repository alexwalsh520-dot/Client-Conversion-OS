"use client";

// Bottleneck tracker: private loop-closing board for Alex + Matt convos.
// One bottleneck gets attacked at a time; commitments get checked off;
// the loop closes with an outcome and the next one moves up.

import React, { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Check,
  Crosshair,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Trash2,
  RotateCcw,
} from "lucide-react";

/* ---------------------------------- types ---------------------------------- */

interface Item {
  id: string;
  bottleneck_id: string;
  kind: "commitment" | "action";
  content: string;
  owner: string;
  done: boolean;
  created_at: string;
}

interface Bottleneck {
  id: string;
  title: string;
  detail: string | null;
  source: string | null;
  status: "open" | "attacking" | "closed";
  outcome: string | null;
  created_at: string;
  closed_at: string | null;
  items: Item[];
}

/* -------------------------------- helpers --------------------------------- */

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const OWNER_COLORS: Record<string, string> = {
  Alex: "var(--accent)",
  Matt: "var(--tyson, #82c5c5)",
  Both: "var(--text-secondary)",
};

const card: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid var(--border-primary)",
  background: "var(--bg-card)",
  padding: 16,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border-primary)",
  background: "var(--bg-glass)",
  color: "var(--text-primary)",
  fontSize: 13,
  outline: "none",
};

const btnStyle: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 8,
  border: "1px solid var(--border-primary)",
  background: "var(--bg-glass)",
  color: "var(--text-secondary)",
  fontSize: 13,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

/* ------------------------------- item row ---------------------------------- */

function ItemRow({
  item,
  onToggle,
  onDelete,
}: {
  item: Item;
  onToggle: (item: Item) => void;
  onDelete: (item: Item) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "6px 0",
        borderBottom: "1px solid var(--border-glass)",
      }}
    >
      <button
        onClick={() => onToggle(item)}
        title={item.done ? "Mark not done" : "Mark done"}
        style={{
          width: 18,
          height: 18,
          marginTop: 1,
          borderRadius: 5,
          flexShrink: 0,
          border: `1px solid ${item.done ? "var(--success)" : "var(--border-hover)"}`,
          background: item.done ? "var(--success-soft)" : "transparent",
          color: "var(--success)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {item.done && <Check size={12} />}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: 13,
            color: item.done ? "var(--text-muted)" : "var(--text-primary)",
            textDecoration: item.done ? "line-through" : "none",
          }}
        >
          {item.content}
        </span>
        <span
          style={{
            marginLeft: 8,
            fontSize: 11,
            fontWeight: 600,
            color: OWNER_COLORS[item.owner] || "var(--text-muted)",
          }}
        >
          {item.owner}
        </span>
        {item.kind === "action" && (
          <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-muted)" }}>
            · logged {fmtDate(item.created_at)}
          </span>
        )}
      </div>
      <button
        onClick={() => onDelete(item)}
        title="Delete"
        style={{
          border: "none",
          background: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          padding: 2,
          flexShrink: 0,
        }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

/* ---------------------------- add item inline form -------------------------- */

function AddItem({
  bottleneckId,
  kind,
  onAdded,
}: {
  bottleneckId: string;
  kind: "commitment" | "action";
  onAdded: () => void;
}) {
  const [content, setContent] = useState("");
  const [owner, setOwner] = useState("Alex");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!content.trim() || saving) return;
    setSaving(true);
    await fetch("/api/bottlenecks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_item", bottleneck_id: bottleneckId, kind, content, owner }),
    });
    setContent("");
    setSaving(false);
    onAdded();
  };

  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <input
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={kind === "commitment" ? "What did we say we'd do?" : "What did you actually do?"}
        style={{ ...inputStyle, flex: 1 }}
      />
      <select
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
        style={{ ...inputStyle, width: 76, flexShrink: 0 }}
      >
        <option>Alex</option>
        <option>Matt</option>
        <option>Both</option>
      </select>
      <button onClick={submit} disabled={saving} style={{ ...btnStyle, flexShrink: 0 }}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
      </button>
    </div>
  );
}

/* ------------------------------ bottleneck card ----------------------------- */

function BottleneckCard({
  b,
  focus,
  refresh,
}: {
  b: Bottleneck;
  focus: boolean;
  refresh: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const [outcome, setOutcome] = useState("");

  const post = async (payload: Record<string, unknown>) => {
    await fetch("/api/bottlenecks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    refresh();
  };

  const commitments = b.items.filter((i) => i.kind === "commitment");
  const actions = b.items.filter((i) => i.kind === "action");
  const doneCount = commitments.filter((i) => i.done).length;

  return (
    <div
      style={{
        ...card,
        border: focus ? "1px solid var(--accent)" : card.border,
        background: focus ? "var(--accent-soft)" : card.background,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {focus && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1,
                color: "var(--accent)",
                marginBottom: 4,
              }}
            >
              ATTACKING NOW
            </div>
          )}
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{b.title}</div>
          {b.detail && (
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4, whiteSpace: "pre-wrap" }}>
              {b.detail}
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            {b.source ? `${b.source} · ` : ""}added {fmtDate(b.created_at)}
            {commitments.length > 0 && ` · ${doneCount}/${commitments.length} commitments done`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {!focus && b.status !== "closed" && (
            <button onClick={() => post({ action: "attack", id: b.id })} style={btnStyle}>
              <Crosshair size={14} /> Attack
            </button>
          )}
          {b.status !== "closed" && (
            <button
              onClick={() => setClosing((v) => !v)}
              style={{ ...btnStyle, color: "var(--success)" }}
            >
              <CheckCircle2 size={14} /> Close loop
            </button>
          )}
          <button
            onClick={() => {
              if (confirm(`Delete "${b.title}" and everything under it?`)) {
                post({ action: "delete", id: b.id });
              }
            }}
            title="Delete"
            style={{ ...btnStyle, padding: "7px 9px", color: "var(--text-muted)" }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {closing && (
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <input
            autoFocus
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && post({ action: "close", id: b.id, outcome })}
            placeholder="How did this get solved? (the outcome)"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={() => post({ action: "close", id: b.id, outcome })}
            style={{ ...btnStyle, color: "var(--success)", flexShrink: 0 }}
          >
            Close it
          </button>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: 0.5 }}>
          COMMITMENTS
        </div>
        {commitments.map((i) => (
          <ItemRow
            key={i.id}
            item={i}
            onToggle={(item) => post({ action: "toggle_item", id: item.id, done: !item.done })}
            onDelete={(item) => post({ action: "delete_item", id: item.id })}
          />
        ))}
        <AddItem bottleneckId={b.id} kind="commitment" onAdded={refresh} />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: 0.5 }}>
          ATTACK LOG
        </div>
        {actions.map((i) => (
          <ItemRow
            key={i.id}
            item={i}
            onToggle={(item) => post({ action: "toggle_item", id: item.id, done: !item.done })}
            onDelete={(item) => post({ action: "delete_item", id: item.id })}
          />
        ))}
        <AddItem bottleneckId={b.id} kind="action" onAdded={refresh} />
      </div>
    </div>
  );
}

/* --------------------------------- page ------------------------------------ */

export default function BottlenecksClient() {
  const [bottlenecks, setBottlenecks] = useState<Bottleneck[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [source, setSource] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/bottlenecks");
    if (res.ok) {
      const data = await res.json();
      setBottlenecks(data.bottlenecks || []);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createBottleneck = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    await fetch("/api/bottlenecks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", title, detail, source }),
    });
    setTitle("");
    setDetail("");
    setSource("");
    setSaving(false);
    setShowAdd(false);
    refresh();
  };

  if (!bottlenecks) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 80 }}>
        <Loader2 size={22} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </div>
    );
  }

  const attacking = bottlenecks.find((b) => b.status === "attacking");
  const open = bottlenecks.filter((b) => b.status === "open");
  const closed = bottlenecks.filter((b) => b.status === "closed");

  return (
    <div className="fade-up" style={{ maxWidth: 780, margin: "0 auto", padding: "24px 16px 80px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
            Bottlenecks
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
            One at a time. Say it, attack it, close the loop, next.
          </div>
        </div>
        <button onClick={() => setShowAdd((v) => !v)} style={{ ...btnStyle, color: "var(--accent)" }}>
          <Plus size={15} /> New bottleneck
        </button>
      </div>

      {showAdd && (
        <div style={{ ...card, marginBottom: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The bottleneck (one sentence)"
              style={inputStyle}
            />
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Context from the convo — what's blocked, why it matters (optional)"
              rows={3}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
            />
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder='Where it came from, e.g. "Call with Matt 8/20" (optional)'
              style={inputStyle}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowAdd(false)} style={btnStyle}>
                Cancel
              </button>
              <button
                onClick={createBottleneck}
                disabled={saving}
                style={{ ...btnStyle, color: "var(--accent)", borderColor: "var(--accent)" }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : "Add it"}
              </button>
            </div>
          </div>
        </div>
      )}

      {attacking ? (
        <div style={{ marginBottom: 24 }}>
          <BottleneckCard b={attacking} focus refresh={refresh} />
        </div>
      ) : (
        open.length > 0 && (
          <div
            style={{
              ...card,
              marginBottom: 24,
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: 13,
            }}
          >
            Nothing being attacked right now. Hit <b>Attack</b> on the next one below.
          </div>
        )
      )}

      {open.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1,
              color: "var(--text-muted)",
              marginBottom: 10,
            }}
          >
            UP NEXT ({open.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {open.map((b) => (
              <BottleneckCard key={b.id} b={b} focus={false} refresh={refresh} />
            ))}
          </div>
        </div>
      )}

      {bottlenecks.length === 0 && (
        <div style={{ ...card, textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
            No bottlenecks yet
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>
            After your next convo with Matt, log the bottleneck you two named and what you each
            said you would do about it.
          </div>
        </div>
      )}

      {closed.length > 0 && (
        <div>
          <button
            onClick={() => setShowClosed((v) => !v)}
            style={{
              ...btnStyle,
              border: "none",
              background: "none",
              padding: 0,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1,
              color: "var(--text-muted)",
              marginBottom: 10,
            }}
          >
            {showClosed ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            CLOSED LOOPS ({closed.length})
          </button>
          {showClosed && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {closed.map((b) => (
                <div key={b.id} style={{ ...card, padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <CheckCircle2 size={15} style={{ color: "var(--success)", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                        {b.title}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>
                        closed {fmtDate(b.closed_at)}
                      </span>
                    </div>
                    <button
                      onClick={async () => {
                        await fetch("/api/bottlenecks", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "reopen", id: b.id }),
                        });
                        refresh();
                      }}
                      title="Reopen"
                      style={{ ...btnStyle, padding: "4px 8px" }}
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                  {b.outcome && (
                    <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 6, marginLeft: 23 }}>
                      {b.outcome}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
