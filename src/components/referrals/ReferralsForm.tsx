"use client";

import { useState } from "react";
import type { Client } from "@/lib/types";

interface Props {
  clients: Client[];
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; refereeName: string }
  | { kind: "error"; message: string };

export default function ReferralsForm({ clients }: Props) {
  const activeClients = clients.filter((c) => c.status === "active");

  const [existingClient, setExistingClient] = useState<Client | null>(null);
  const [clientQuery, setClientQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const [refereeName, setRefereeName] = useState("");
  const [refereePhone, setRefereePhone] = useState("");

  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  const suggestions = (() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return activeClients.slice(0, 10);
    return activeClients
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 10);
  })();

  const pickClient = (client: Client) => {
    setExistingClient(client);
    setClientQuery(client.name);
    setShowSuggestions(false);
    setHighlightIndex(0);
  };

  const canSubmit =
    !!existingClient &&
    refereeName.trim().length > 0 &&
    refereePhone.trim().length > 0 &&
    submitState.kind !== "submitting";

  const submit = async () => {
    if (!canSubmit || !existingClient) return;
    setSubmitState({ kind: "submitting" });
    try {
      const res = await fetch("/api/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          existingClientId: existingClient.id,
          refereeName: refereeName.trim(),
          refereePhone: refereePhone.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitState({
          kind: "error",
          message: json.error || `Request failed with status ${res.status}`,
        });
        return;
      }
      setSubmitState({ kind: "success", refereeName: refereeName.trim() });
      setExistingClient(null);
      setClientQuery("");
      setRefereeName("");
      setRefereePhone("");
    } catch (err) {
      setSubmitState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="glass-static" style={{ padding: 20 }}>
      <h3 style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 600, marginTop: 0, marginBottom: 14 }}>
        Log a new referral
      </h3>

      <div style={{ display: "grid", gap: 14 }}>
        {/* Existing client — search combobox */}
        <div style={{ position: "relative" }}>
          <label className="field-label">Existing client *</label>
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
              if (existingClient) setExistingClient(null);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => {
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
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      {c.coachName || "Unassigned"}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
          {existingClient && (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
              Referrer email: {existingClient.email || <em>not on file</em>}
            </div>
          )}
        </div>

        <div>
          <label className="field-label">Referred person&rsquo;s name *</label>
          <input
            className="input-field"
            type="text"
            autoComplete="off"
            placeholder="e.g. Sarah Lopez"
            value={refereeName}
            onChange={(e) => setRefereeName(e.target.value)}
          />
        </div>

        <div>
          <label className="field-label">Referred person&rsquo;s phone *</label>
          <input
            className="input-field"
            type="tel"
            autoComplete="off"
            placeholder="e.g. 3466723280"
            value={refereePhone}
            onChange={(e) => setRefereePhone(e.target.value)}
          />
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
          <button
            className="btn-primary"
            onClick={submit}
            disabled={!canSubmit}
            style={{ opacity: canSubmit ? 1 : 0.6, cursor: canSubmit ? "pointer" : "not-allowed" }}
          >
            {submitState.kind === "submitting" ? "Submitting..." : "Submit referral"}
          </button>
          {submitState.kind === "success" && (
            <span style={{ fontSize: 13, color: "var(--success, #22c55e)" }}>
              ✓ Added &ldquo;{submitState.refereeName}&rdquo; to the tracker.
            </span>
          )}
          {submitState.kind === "error" && (
            <span style={{ fontSize: 13, color: "var(--danger, #ef4444)" }}>
              {submitState.message}
            </span>
          )}
        </div>
      </div>

      <div style={{ marginTop: 20, padding: "10px 12px", background: "var(--bg-secondary, rgba(255,255,255,0.03))", borderRadius: 6, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
        Each referral is added to the Fitness Referral Tracker with status <strong>Pending</strong>. Closers work directly from the sheet and change the status there. Saeed gets a Slack DM every time a new referral is submitted.
      </div>
    </div>
  );
}
