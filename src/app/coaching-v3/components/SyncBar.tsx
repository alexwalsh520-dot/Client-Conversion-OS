"use client";

import { useRef, useState } from "react";
import { Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

type Latest = {
  capturedAt: string | null;
  uploadedAt: string | null;
  clientsCount: number;
  matchedCount: number;
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

/** Renders the current V3 sync freshness + a hidden file input for uploading. */
export default function SyncBar({ latest }: { latest: Latest }) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"ok" | "err">("ok");
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      const text = await file.text();
      // Validate JSON client-side for a friendlier error than the server 400.
      JSON.parse(text);
      const res = await fetch("/api/coaching-v3/everfit-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (body.alreadyUploaded) {
        setMessage("Same payload already on file — no changes.");
        setMessageKind("ok");
      } else {
        setMessage(
          `Uploaded ${body.clientsUploaded} clients (${body.matched} matched, ${body.unmatched} unmatched${
            body.droppedRows ? `, ${body.droppedRows} malformed rows dropped` : ""
          }).`,
        );
        setMessageKind("ok");
      }
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      setMessageKind("err");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
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
          <strong>Everfit V3 sync</strong>{" "}
          {latest
            ? `— captured ${fmt(latest.capturedAt)}, ${latest.matchedCount}/${latest.clientsCount} matched`
            : "— never uploaded"}
        </div>
        {message && (
          <div style={{ color: messageKind === "err" ? "var(--danger)" : "var(--text-muted)" }}>
            {message}
          </div>
        )}
        {!message && latest?.isStale && (
          <div style={{ color: "var(--text-muted)" }}>
            More than 36h since capture — refresh recommended.
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <a
        href="/coaching-v3-sync-prompt.md"
        download
        className="h3-btn s"
        style={{ textDecoration: "none" }}
      >
        Prompt
      </a>
      <button
        className="h3-btn p"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? (
          <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
        ) : latest?.isStale ? (
          <AlertTriangle size={12} />
        ) : latest ? (
          <CheckCircle2 size={12} />
        ) : (
          <Upload size={12} />
        )}
        {uploading ? "Uploading…" : "Upload sync JSON"}
      </button>
    </div>
  );
}
