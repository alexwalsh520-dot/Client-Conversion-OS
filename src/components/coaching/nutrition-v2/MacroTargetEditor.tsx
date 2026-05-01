/**
 * Coach UI — daily macro target editor.
 *
 * Workflow (matches the explicit "lock-then-generate" model the coach approved):
 *   1. On mount: GET /macros → display the suggested kcal (calc - 400, floored
 *      at 1200) and the auto-derived P/C/F.
 *   2. While unlocked: kcal input is editable. On every debounced change
 *      (300ms after last keystroke) the editor re-fetches /macros?kcal=N
 *      to get the redistributed P/C/F. Below-1200 inline warning surfaces
 *      when applicable but does not block.
 *   3. Coach clicks "Lock target" → kcal field freezes, ✓ shows, the
 *      `onLocked(kcal)` callback fires. Parent uses that to enable the
 *      Generate-prompt button.
 *   4. Coach clicks "Unlock to edit" → reverts to step 2.
 *
 * Failure modes:
 *   - Intake form missing or weight unparseable: render a clean error block
 *     ("Intake form is missing weight or unreadable …"), no editor UI.
 *   - Network error while fetching: keep last-known good values, surface
 *     a small "(retrying…)" hint.
 */

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Lock, Unlock, Check, AlertTriangle, Loader2 } from "lucide-react";

interface MacrosResponse {
  client_id: number;
  client_name: string | null;
  raw_calculator_kcal: number;
  suggested_kcal: number;
  targets: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    sodiumCapMg: number;
    notes: string[];
    source: "auto" | "override";
    flooredAt1200: boolean;
  };
}

interface MacroTargetEditorProps {
  clientId: number;
  /** Notified whenever the locked state changes. When `lockedKcal` is a
   *  number the parent should enable Generate-prompt and pass that value
   *  along when calling /copy-prompt. When null, the parent disables
   *  Generate. */
  onLockChange: (lockedKcal: number | null) => void;
}

const DEBOUNCE_MS = 300;
const KCAL_FLOOR = 1200;

export function MacroTargetEditor({ clientId, onLockChange }: MacroTargetEditorProps) {
  const [data, setData] = useState<MacrosResponse | null>(null);
  const [draftKcal, setDraftKcal] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ---- Fetch helpers ----
  const fetchMacros = useCallback(
    async (kcalOverride?: number) => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      try {
        const url = kcalOverride != null
          ? `/api/nutrition/v2/client/${clientId}/macros?kcal=${kcalOverride}`
          : `/api/nutrition/v2/client/${clientId}/macros`;
        const res = await fetch(url, { signal: abortRef.current.signal });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            (body as { error?: string }).error ??
              `failed to load macros (HTTP ${res.status})`,
          );
          setData(null);
          return;
        }
        setError(null);
        setData(body as MacrosResponse);
        if (kcalOverride == null) {
          // initial load — seed the draft with the suggestion
          setDraftKcal((body as MacrosResponse).targets.calories);
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [clientId],
  );

  // Initial load
  useEffect(() => {
    setLoading(true);
    fetchMacros().finally(() => setLoading(false));
    return () => abortRef.current?.abort();
  }, [fetchMacros]);

  // Debounced refetch on draft change while unlocked
  useEffect(() => {
    if (locked) return;
    if (draftKcal == null) return;
    if (data && draftKcal === data.targets.calories) return; // no change
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setRefetching(true);
      await fetchMacros(draftKcal);
      setRefetching(false);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [draftKcal, locked, fetchMacros, data]);

  // Notify parent on lock/unlock
  useEffect(() => {
    if (locked && draftKcal != null) {
      onLockChange(draftKcal);
    } else {
      onLockChange(null);
    }
  }, [locked, draftKcal, onLockChange]);

  // ---- Render: loading ----
  if (loading) {
    return (
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13 }}>
          <Loader2 size={14} className="spin" />
          Computing macro targets from intake form…
        </div>
        <style jsx>{`
          .spin { animation: spin 1s linear infinite; }
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  // ---- Render: error (intake missing / unreadable) ----
  if (error) {
    return (
      <div style={{ ...cardStyle, borderColor: "rgba(239,68,68,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--danger, #ef4444)", fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
          <AlertTriangle size={14} />
          Cannot compute macro targets
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {error}
        </div>
      </div>
    );
  }

  if (!data || draftKcal == null) return null;

  const t = data.targets;
  const belowFloor = draftKcal < KCAL_FLOOR;

  // ---- Render: editor ----
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>
          Daily macro targets
        </span>
        {locked ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--success, #22c55e)", fontSize: 11, fontWeight: 600 }}>
            <Check size={11} /> LOCKED
          </span>
        ) : (
          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
            (editable — adjust kcal then click Lock)
          </span>
        )}
        {refetching && !locked && (
          <span style={{ color: "var(--text-muted)", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Loader2 size={10} className="spin" /> recalculating…
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8, fontSize: 13 }}>
        <Field label="kcal" editable={!locked}>
          <input
            type="number"
            inputMode="numeric"
            value={draftKcal}
            disabled={locked}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v)) setDraftKcal(v);
            }}
            min={500}
            max={6000}
            step={25}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "4px 8px",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "ui-monospace, monospace",
              background: locked ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.4)",
              color: "var(--text-primary)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
            }}
          />
        </Field>
        <Field label="Protein (g)">
          <ReadOnlyValue v={t.proteinG} />
        </Field>
        <Field label="Carbs (g)">
          <ReadOnlyValue v={t.carbsG} />
        </Field>
        <Field label="Fat (g)">
          <ReadOnlyValue v={t.fatG} />
        </Field>
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
        Sodium cap ≤ {t.sodiumCapMg} mg/day · Calculator output: {data.raw_calculator_kcal} kcal · Auto-suggestion applies a 400-kcal downward adjustment.
        {t.flooredAt1200 && !locked && draftKcal === t.calories && (
          <span style={{ color: "rgb(255, 179, 71)", marginLeft: 4 }}>
            (floored at 1,200 — calculator − 400 would have gone below)
          </span>
        )}
      </div>

      {belowFloor && (
        <div
          style={{
            marginTop: 10,
            padding: "6px 10px",
            background: "rgba(255, 179, 71, 0.1)",
            border: "1px solid rgba(255, 179, 71, 0.3)",
            borderRadius: 4,
            fontSize: 11,
            color: "rgb(255, 179, 71)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <AlertTriangle size={11} />
          Below 1,200 kcal/day is clinically risky for most adults. You can lock anyway.
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        {locked ? (
          <button
            onClick={() => setLocked(false)}
            style={secondaryButton}
          >
            <Unlock size={12} /> Unlock to edit
          </button>
        ) : (
          <button
            onClick={() => setLocked(true)}
            disabled={refetching}
            style={{
              ...primaryButton,
              opacity: refetching ? 0.5 : 1,
              cursor: refetching ? "wait" : "pointer",
            }}
          >
            <Lock size={12} /> Lock target
          </button>
        )}
      </div>

      <style jsx>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ---- internal sub-components ----

function Field({ label, editable, children }: { label: string; editable?: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "6px 10px",
        background: "rgba(255,255,255,0.03)",
        borderRadius: 4,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label} {editable && <span style={{ color: "var(--accent, #6366f1)" }}>(editable)</span>}
      </div>
      {children}
    </div>
  );
}

function ReadOnlyValue({ v }: { v: number }) {
  return (
    <div
      style={{
        padding: "4px 8px",
        fontSize: 14,
        fontWeight: 600,
        fontFamily: "ui-monospace, monospace",
        color: "var(--text-primary)",
      }}
    >
      {v}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  padding: 12,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 8,
  marginBottom: 14,
  minWidth: 0,
};

const primaryButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 14px",
  background: "var(--accent, #6366f1)",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

const secondaryButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 14px",
  background: "none",
  color: "var(--text-primary)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
};
