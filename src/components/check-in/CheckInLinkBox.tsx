"use client";

/**
 * Shared "Client Check-In Form" link card.
 *
 * Renders the public /check-in URL with a one-click Copy button. Used
 * inside the Coaching Hub on both the Milestones tab (bottom, under
 * Upcoming Retentions — gives coaches a reason to open that tab) and
 * the Client Progress tab (top, above the table — coaches who already
 * navigated here for review can re-grab the link without tab-hopping).
 *
 * Caller can adjust the surrounding margin via the `style` prop (e.g.
 * marginTop: 0 in Client Progress where it sits at the top vs. the
 * default marginTop: 20 used under Upcoming Retentions).
 */

import { useState } from "react";
import { CheckCircle, ClipboardCheck, Copy } from "lucide-react";

interface Props {
  /** Override the wrapper style. Useful for placement-specific margins. */
  style?: React.CSSProperties;
}

export default function CheckInLinkBox({ style }: Props) {
  const [copied, setCopied] = useState(false);
  // Compute the absolute URL client-side so the copy works correctly
  // whether on production, preview, or local dev.
  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/check-in`
      : "https://client-conversion-os.vercel.app/check-in";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: prompt user to copy manually (rare; clipboard API
      // requires HTTPS or localhost).
      window.prompt("Copy this link:", url);
    }
  };

  return (
    <div
      className="glass-static"
      style={{
        padding: 16,
        marginTop: 20,
        borderLeft: "3px solid var(--accent)",
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <h3
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-primary)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            display: "flex",
            alignItems: "center",
            gap: 6,
            margin: 0,
          }}
        >
          <ClipboardCheck size={14} /> Client Check-In Form
        </h3>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Send to clients weekly via Everfit
        </span>
      </div>
      <p
        style={{
          fontSize: 12,
          color: "var(--text-secondary)",
          margin: "0 0 12px",
          lineHeight: 1.5,
        }}
      >
        Copy this link and DM it to your clients. They&apos;ll pick themselves from a dropdown and answer 4 quick sliders (plus an optional note). Submissions appear in the Client Progress tab.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <code
          style={{
            flex: "1 1 280px",
            padding: "8px 12px",
            borderRadius: 6,
            background: "var(--bg-card)",
            border: "1px solid var(--border-primary)",
            color: "var(--text-primary)",
            fontSize: 13,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            overflow: "auto",
            whiteSpace: "nowrap",
          }}
        >
          {url}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="btn-primary"
          style={{
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
            whiteSpace: "nowrap",
          }}
        >
          {copied ? (
            <>
              <CheckCircle size={14} /> Copied
            </>
          ) : (
            <>
              <Copy size={14} /> Copy link
            </>
          )}
        </button>
      </div>
    </div>
  );
}
