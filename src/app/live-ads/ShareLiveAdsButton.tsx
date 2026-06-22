"use client";

// Operator-only "Share public link" affordance for the Live Ads tab.
//
// Clicking it gets-or-mints the public Live Ads share link for the given creator
// (default: Antwan) via the auth-gated /api/ads-tracker/share-link endpoint
// (kind=live-ads), then copies the public URL to the clipboard so the operator
// can paste it in Slack. The PUBLIC page that serves it is /p/live-ads/<token>.
import { useState } from "react";
import { Share2, Check } from "lucide-react";

export default function ShareLiveAdsButton({
  account = "antwan",
}: {
  account?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "copied" | "error">("idle");
  const [url, setUrl] = useState<string | null>(null);

  async function handleShare() {
    setState("loading");
    try {
      const res = await fetch(
        `/api/ads-tracker/share-link?account=${encodeURIComponent(account)}&kind=live-ads`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "Could not create link.");
      setUrl(data.url);
      try {
        await navigator.clipboard.writeText(data.url);
        setState("copied");
        window.setTimeout(() => setState("idle"), 2200);
      } catch {
        // Clipboard blocked — still show the URL so the operator can copy manually.
        setState("idle");
      }
    } catch (error) {
      console.error("[live-ads/share] failed", error);
      setState("error");
      window.setTimeout(() => setState("idle"), 2600);
    }
  }

  const label =
    state === "loading"
      ? "Linking…"
      : state === "copied"
        ? "Link copied"
        : state === "error"
          ? "Try again"
          : "Share public link";

  return (
    <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
      <button
        type="button"
        onClick={handleShare}
        disabled={state === "loading"}
        style={{
          appearance: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          border: "1px solid var(--border-primary)",
          borderRadius: 999,
          background: "var(--bg-glass)",
          color: "var(--text-primary)",
          cursor: state === "loading" ? "default" : "pointer",
          fontSize: 12,
          fontWeight: 650,
          padding: "9px 14px",
          whiteSpace: "nowrap",
        }}
      >
        {state === "copied" ? <Check size={14} /> : <Share2 size={14} />}
        <span>{label}</span>
      </button>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            maxWidth: 320,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--font-mono), ui-monospace, monospace",
          }}
        >
          {url}
        </a>
      ) : null}
    </div>
  );
}
