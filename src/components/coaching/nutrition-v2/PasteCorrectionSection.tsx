/**
 * Coach UI v2 — "Paste corrected plan from Claude.ai" collapsible section.
 *
 * Coach pastes JSON, we POST to apply-correction. On success: callback
 * with new plan_id. On schema/parse/audit failure: inline error within
 * the panel — does NOT transition to State 4 (per spec).
 */

"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface PasteCorrectionSectionProps {
  planId: number;
  /** Called with the new plan_id on success. Caller refetches latest plan. */
  onCorrectionApplied: (newPlanId: number) => void;
}

export function PasteCorrectionSection({
  planId,
  onCorrectionApplied,
}: PasteCorrectionSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const handleApply = async () => {
    setSubmitting(true);
    setError(null);
    setErrorDetail(null);
    try {
      const res = await fetch(
        `/api/nutrition/v2/plan/${planId}/apply-correction`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ corrected_plan: text }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = (data as { error?: string }).error ?? "unknown_error";
        const msg = (data as { message?: string }).message ?? "";
        // Map error codes to coach-facing copy
        if (code === "couldn_t_parse_pasted_text") {
          setError("Couldn't parse the JSON.");
          setErrorDetail(`${msg} Try copying again from Claude.ai.`);
        } else if (code === "schema_validation_failed") {
          const issues = (data as { details?: Array<{ path: string; message: string }> }).details ?? [];
          setError("JSON didn't match the correction schema.");
          setErrorDetail(
            issues.length
              ? `Issues: ${issues.slice(0, 3).map((d) => `${d.path}: ${d.message}`).join("; ")}`
              : msg,
          );
        } else if (code === "hard_errors_in_correction") {
          setError("Couldn't apply this correction.");
          setErrorDetail(
            "Claude.ai's correction included slugs that aren't allowed for this client. Ask Claude.ai to retry the correction.",
          );
        } else if (code === "parse_failed") {
          setError("Couldn't apply this correction.");
          setErrorDetail(
            `Parser rejected the corrected plan: ${msg}. Try asking Claude.ai to retry the correction.`,
          );
        } else {
          setError(`Couldn't apply this correction: ${code}`);
          setErrorDetail(msg);
        }
        setSubmitting(false);
        return;
      }
      // Success.
      const newId = (data as { plan_id: number }).plan_id;
      const auditBlocked = Boolean((data as { audit_blocked?: boolean }).audit_blocked);
      if (auditBlocked) {
        setError("Couldn't apply this correction: audit blocked the corrected plan.");
        setErrorDetail(
          "Try asking Claude.ai to retry the correction, or use 'Handle manually & mark Done' if this client needs custom intervention.",
        );
      } else {
        // Clean correction — bubble up.
        setText("");
        setExpanded(false);
        onCorrectionApplied(newId);
      }
      setSubmitting(false);
    } catch (e) {
      setError("Network error.");
      setErrorDetail(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6,
          padding: "8px 12px",
          color: "var(--text-primary)",
          cursor: "pointer",
          fontSize: 13,
          width: "100%",
          textAlign: "left",
        }}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>Paste corrected plan from Claude.ai</span>
      </button>

      {expanded && (
        <div
          style={{
            marginTop: 8,
            padding: 12,
            background: "rgba(255,255,255,0.03)",
            borderRadius: 6,
          }}
        >
          <label
            style={{
              display: "block",
              fontSize: 11,
              color: "var(--text-muted)",
              marginBottom: 6,
            }}
          >
            Paste the JSON output Claude.ai gave you here:
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{"days":[{"day_number":1,"weekday":"monday","meals":[...]}]}'
            rows={10}
            style={{
              width: "100%",
              fontFamily: "ui-monospace, monospace",
              fontSize: 11,
              background: "rgba(0,0,0,0.4)",
              color: "var(--text-primary)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 4,
              padding: 8,
              resize: "vertical",
            }}
          />
          <div
            style={{
              fontSize: 10,
              color: "var(--text-muted)",
              marginTop: 6,
              marginBottom: 8,
            }}
          >
            Format help: Claude.ai should output JSON matching the schema in
            the correction prompt. If it gave you Markdown, ask it to re-output
            as raw JSON. (We strip ```json fences automatically.)
          </div>
          <button
            onClick={handleApply}
            disabled={submitting || text.trim().length === 0}
            style={{
              padding: "6px 14px",
              background: submitting ? "rgba(99,102,241,0.5)" : "var(--accent, #6366f1)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: submitting || text.trim().length === 0 ? "not-allowed" : "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {submitting ? "Applying…" : "Apply Correction"}
          </button>

          {error && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 10px",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: 4,
                fontSize: 11,
                color: "rgb(239, 68, 68)",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{error}</div>
              {errorDetail && (
                <div style={{ color: "rgba(239, 68, 68, 0.85)" }}>
                  {errorDetail}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
