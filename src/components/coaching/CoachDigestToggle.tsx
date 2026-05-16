"use client";

/**
 * Per-coach Daily Coacher digest toggle for the Coach Performance scorecard.
 *
 * Hidden for non-admins (the API enforces this regardless). Loads the
 * recipient state on mount; toggling immediately PATCHes the new value
 * and shows a brief confirmation.
 */

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";

interface Props {
  coachName: string;
  isAdmin: boolean;
}

interface RecipientShape {
  coach_name: string;
  enabled: boolean;
  snoozed_until: string | null;
  slack_email: string | null;
}

export default function CoachDigestToggle({ coachName, isAdmin }: Props) {
  const [recipient, setRecipient] = useState<RecipientShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/daily-coacher/recipients?coach=${encodeURIComponent(coachName)}`);
        if (cancelled) return;
        if (res.status === 404) {
          setNotFound(true);
        } else if (res.ok) {
          const data = await res.json();
          setRecipient(data.recipient as RecipientShape);
        }
      } catch {
        // silent — toggle just won't render
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coachName, isAdmin]);

  if (!isAdmin) return null;
  if (loading) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
        <Loader2 size={11} className="dc-toggle-spin" />
        loading
        <style jsx>{`
          :global(.dc-toggle-spin) {
            animation: dc-toggle-spin-rot 0.8s linear infinite;
          }
          @keyframes dc-toggle-spin-rot {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </span>
    );
  }
  if (notFound) {
    // Not yet onboarded — render a quiet placeholder
    return (
      <span
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
          fontStyle: "italic",
        }}
        title="Coach not yet registered for the Daily Coacher digest"
      >
        digest: not set up
      </span>
    );
  }
  if (!recipient) return null;

  const enabled = recipient.enabled;
  const snoozedActive = recipient.snoozed_until && new Date(recipient.snoozed_until) > new Date();

  async function toggle() {
    if (!recipient || saving) return;
    setSaving(true);
    const newEnabled = !recipient.enabled;
    try {
      const res = await fetch(
        `/api/daily-coacher/recipients/${encodeURIComponent(recipient.coach_name)}/toggle`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: newEnabled }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        setRecipient(data.recipient as RecipientShape);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={saving}
      title={
        snoozedActive
          ? `Digest snoozed until ${new Date(recipient.snoozed_until!).toLocaleDateString()}`
          : enabled
            ? "Daily Coacher digest is ON for this coach. Click to disable."
            : "Daily Coacher digest is OFF for this coach. Click to enable."
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "none",
        border: "none",
        padding: 0,
        cursor: saving ? "not-allowed" : "pointer",
        fontSize: 11,
        color: enabled ? "var(--success)" : "var(--text-muted)",
        opacity: saving ? 0.5 : 1,
      }}
    >
      {enabled ? <Bell size={11} /> : <BellOff size={11} />}
      digest: <strong style={{ color: enabled ? "var(--success)" : "var(--text-muted)" }}>{enabled ? "ON" : "OFF"}</strong>
      {snoozedActive && (
        <span style={{ color: "var(--warning)", fontStyle: "italic" }}>
          (snoozed)
        </span>
      )}
    </button>
  );
}
