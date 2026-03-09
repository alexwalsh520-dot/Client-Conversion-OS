"use client";

import { useState } from "react";
import { MessageSquareText, Loader2, AlertCircle, Check, Plus } from "lucide-react";

const SETTERS = ["Amara", "Kelechi", "Gideon", "Debbie"];

export default function SetterSubmitPage() {
  const [setter, setSetter] = useState(SETTERS[0]);
  const [transcript, setTranscript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!transcript.trim() || loading) return;
    setLoading(true);
    setError("");
    setShowSuccess(false);

    try {
      const res = await fetch("/api/sales-hub/transcripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setterName: setter, transcript }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setSubmitted((n) => n + 1);
      setTranscript("");
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-primary)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 700 }} className="fade-up">
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "var(--accent-soft)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <MessageSquareText size={24} style={{ color: "var(--accent)" }} />
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: "var(--text-primary)",
              marginBottom: 6,
            }}
          >
            Daily DM Submission
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Paste each DM conversation from today and submit for review
          </p>
        </div>

        {/* Card */}
        <div className="glass-static" style={{ padding: 24 }}>
          {/* Setter + counter */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginBottom: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label
                className="form-label"
                style={{ margin: 0, whiteSpace: "nowrap" }}
              >
                Your Name
              </label>
              <select
                className="form-input"
                value={setter}
                onChange={(e) => setSetter(e.target.value)}
                style={{ width: "auto", minWidth: 140, padding: "8px 12px" }}
              >
                {SETTERS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {submitted > 0 && (
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 12,
                  color: "var(--success)",
                  fontWeight: 500,
                }}
              >
                {submitted} submitted today
              </span>
            )}
          </div>

          {/* Textarea */}
          <textarea
            className="form-input form-textarea"
            placeholder="Paste the full DM conversation here..."
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            style={{
              minHeight: 280,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              lineHeight: 1.6,
              resize: "vertical",
            }}
          />

          {/* Submit button */}
          <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
            <button
              className="btn-primary"
              onClick={handleSubmit}
              disabled={loading || !transcript.trim()}
              style={{
                opacity: loading || !transcript.trim() ? 0.5 : 1,
                cursor: loading || !transcript.trim() ? "not-allowed" : "pointer",
              }}
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Plus size={14} />
                  Submit Transcript
                </>
              )}
            </button>

            {/* Success toast */}
            {showSuccess && (
              <span
                className="fade-up"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  color: "var(--success)",
                  fontWeight: 500,
                }}
              >
                <Check size={16} />
                Submitted
              </span>
            )}
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                marginTop: 16,
                padding: "12px 16px",
                borderRadius: 8,
                background: "var(--danger-soft)",
                color: "var(--danger)",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <AlertCircle size={16} />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <p
          style={{
            textAlign: "center",
            fontSize: 11,
            color: "var(--text-muted)",
            marginTop: 24,
          }}
        >
          Core Shift LLC
        </p>
      </div>
    </div>
  );
}
