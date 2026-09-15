"use client";

import { useState } from "react";
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

type Latest = {
  pulledAt: string | null;
  pulledBy: string | null;
  tabsRead: string[];
  rowsIngested: number;
  clientsSeen: number;
  isStale: boolean;
} | null;

function fmt(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const now = new Date();
  const diffH = (now.getTime() - d.getTime()) / (1000 * 60 * 60);
  if (diffH < 1) return `${Math.floor(diffH * 60)}m ago`;
  if (diffH < 48) return `${Math.floor(diffH)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * V3 sync bar. Pulls "Admin Everfit Client Reports" via the server-side
 * Google Sheets API when the button is clicked. The JSON upload path is
 * retired — the sheet is now the source of truth for weekly Everfit numbers.
 */
export default function SyncBar({ latest }: { latest: Latest }) {
  const [pulling, setPulling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"ok" | "err">("ok");

  async function pull() {
    setPulling(true);
    setMessage(null);
    try {
      const res = await fetch("/api/coaching-v3/sheet-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const parts: string[] = [];
      parts.push(`${body.clientsSeen} clients across ${body.tabsRead?.length ?? 0} coach tabs`);
      parts.push(`${body.matched} matched, ${body.unmatched} unmatched`);
      parts.push(`${body.weekRowsIngested} weekly rows`);
      if (body.errors?.length) parts.push(`${body.errors.length} tab warnings`);
      setMessage(`Pulled: ${parts.join(" · ")}.`);
      setMessageKind("ok");
      setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      setMessageKind("err");
    } finally {
      setPulling(false);
    }
  }

  const noticeCls = latest
    ? latest.isStale
      ? "h3-notice warn"
      : "h3-notice ok"
    : "h3-notice err";

  return (
    <div className={noticeCls} role="status">
      <i />
      <div className="meta" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        <div>
          <strong>Assistant Sheet sync</strong>{" "}
          {latest
            ? `— pulled ${fmt(latest.pulledAt)} by ${latest.pulledBy?.split("@")[0] ?? "?"}, ${latest.clientsSeen} clients across ${latest.tabsRead?.length ?? 0} coach tabs`
            : "— never pulled"}
        </div>
        {message && (
          <div style={{ color: messageKind === "err" ? "var(--danger)" : "var(--text-muted)" }}>
            {message}
          </div>
        )}
        {!message && latest?.isStale && (
          <div style={{ color: "var(--text-muted)" }}>
            More than 8 days since last pull — refresh recommended.
          </div>
        )}
      </div>
      <a
        href="https://docs.google.com/spreadsheets/d/1BqpCkDPEWLBmStK_VQJwGe0ju8BwHWi8VzsPz39ufgY/edit"
        target="_blank"
        rel="noreferrer"
        className="h3-btn s"
        style={{ textDecoration: "none" }}
      >
        Open sheet
      </a>
      <button className="h3-btn p" onClick={pull} disabled={pulling}>
        {pulling ? (
          <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
        ) : latest?.isStale ? (
          <AlertTriangle size={12} />
        ) : latest ? (
          <CheckCircle2 size={12} />
        ) : (
          <RefreshCw size={12} />
        )}
        {pulling ? "Pulling…" : "Pull from sheet"}
      </button>
    </div>
  );
}
