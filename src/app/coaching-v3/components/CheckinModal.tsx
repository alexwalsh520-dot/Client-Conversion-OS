"use client";

/**
 * Shared check-in-detail modal + ModalShell for /coaching-v3.
 *
 * Used from the Today page's low-check-in list AND from the Clients page's
 * client drawer (a click on any check-in in the client's history opens the
 * same modal).
 */

import { useEffect } from "react";
import { X } from "lucide-react";

export type CheckInSubmission = {
  id: number;
  clientId: number | null;
  clientName: string;
  coachName: string;
  score: number;
  q1: number;
  q2: number;
  q3: number;
  q4: number;
  text: string;
  submittedAt: string;
};

export function daysAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
}

export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function ModalShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 300 }}
      />
      <div
        role="dialog"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "var(--bg-primary, #0b0b0b)",
          border: "1px solid var(--border-primary)",
          borderRadius: 12,
          padding: 20,
          zIndex: 301,
          width: "min(640px, 92vw)",
          maxHeight: "88vh",
          overflowY: "auto",
          color: "var(--text-secondary)",
          fontSize: 13,
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            background: "none",
            border: "1px solid var(--border-primary)",
            borderRadius: 6,
            padding: "4px 8px",
            color: "var(--text-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <X size={12} /> Close
        </button>
        {children}
      </div>
    </>
  );
}

export default function CheckinModal({
  submission,
  onClose,
}: {
  submission: CheckInSubmission;
  onClose: () => void;
}) {
  // Each subscore is 0-10. The 0-100 composite is round(avg(q1..q4) * 10).
  const rows = [
    { label: "Coaching", val: submission.q1 },
    { label: "Strength", val: submission.q2 },
    { label: "Nutrition + sleep", val: submission.q3 },
    { label: "Progress", val: submission.q4 },
  ];
  return (
    <ModalShell onClose={onClose}>
      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
        {submission.clientName}
      </h3>
      <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 2 }}>
        {submission.coachName} · {fmtDate(submission.submittedAt)} · {daysAgo(submission.submittedAt)}d ago
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "14px 0" }}>
        {rows.map((r) => (
          <div
            key={r.label}
            style={{
              padding: "10px 12px",
              background: "var(--hover-bg-subtle, rgba(148,163,184,0.06))",
              borderRadius: 8,
            }}
          >
            <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{r.label}</div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color:
                  r.val < 5 ? "var(--danger)" : r.val < 7 ? "var(--warning)" : "var(--text-primary)",
              }}
            >
              {r.val}/10
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          padding: "10px 12px",
          background:
            submission.score < 40
              ? "rgba(239,68,68,0.08)"
              : "var(--hover-bg-subtle, rgba(148,163,184,0.06))",
          borderRadius: 8,
          marginBottom: 12,
        }}
      >
        <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Score</div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color:
              submission.score < 40
                ? "var(--danger)"
                : submission.score < 55
                  ? "var(--warning)"
                  : "var(--text-primary)",
          }}
        >
          {submission.score}/100
        </div>
        <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>
          avg of the four subscores × 10
        </div>
      </div>
      {submission.text ? (
        <div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 4 }}>Open response</div>
          <div
            style={{
              padding: "12px 14px",
              background: "var(--bg-card)",
              border: "1px solid var(--border-primary)",
              borderRadius: 8,
              color: "var(--text-primary)",
              whiteSpace: "pre-wrap",
            }}
          >
            {submission.text}
          </div>
        </div>
      ) : (
        <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>No open response.</div>
      )}
    </ModalShell>
  );
}
