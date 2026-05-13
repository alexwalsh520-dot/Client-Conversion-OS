"use client";

/**
 * Per-SOP viewer page. Renders inline preview for PDFs and images;
 * download-only fallback for everything else (DOC/PPT/etc, since
 * browser-native preview only handles PDFs and images cleanly).
 *
 * Includes:
 *   - Title + metadata header
 *   - Copy share-link button
 *   - Download button
 *   - Delete button (admins only)
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Link as LinkIcon,
  Check,
  Trash2,
  AlertTriangle,
  FileText,
} from "lucide-react";
import type { SopWithRelations } from "@/lib/sop/types";
import { previewKindForFile } from "@/lib/sop/types";
import SopFileIcon from "./SopFileIcon";

interface Props {
  sop: SopWithRelations;
  initialSignedUrl: string | null;
}

export default function SopViewer({ sop, initialSignedUrl }: Props) {
  const router = useRouter();
  const [signedUrl, setSignedUrl] = useState<string | null>(initialSignedUrl);
  const [linkCopied, setLinkCopied] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewKind = previewKindForFile(sop.file_type);

  // Probe admin status to gate the Delete button
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setIsAdmin(data?.user?.role === "admin");
      } catch {
        // silent — not having a session means no admin badge
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh the signed URL if it expired (page open for >2hr).
  // Re-fetch when the user clicks Download as a safety net.
  async function ensureFreshUrl(): Promise<string | null> {
    if (signedUrl) return signedUrl;
    try {
      const res = await fetch(`/api/sop/${sop.share_slug}`);
      if (!res.ok) return null;
      const data = await res.json();
      const fresh = data?.signedUrl ?? null;
      setSignedUrl(fresh);
      return fresh;
    } catch {
      return null;
    }
  }

  async function handleDownload() {
    const url = await ensureFreshUrl();
    if (!url) {
      setError("Couldn't generate a download link. Try again in a moment.");
      return;
    }
    window.location.href = url;
  }

  async function handleCopyLink() {
    try {
      const fullUrl = `${window.location.origin}/sop/${sop.share_slug}`;
      await navigator.clipboard.writeText(fullUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      setError("Couldn't copy link. Select the URL bar and copy manually.");
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/sop/${sop.share_slug}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      router.push("/sop");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  return (
    <div style={{ padding: "24px 24px 80px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Back link */}
      <Link
        href="/sop"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--text-muted)",
          fontSize: 13,
          textDecoration: "none",
          marginBottom: 16,
        }}
      >
        <ArrowLeft size={14} /> Back to SOPs
      </Link>

      {/* Header card */}
      <div className="glass-static" style={{ padding: 20, borderRadius: 12, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <SopFileIcon fileType={sop.file_type} size={22} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--text-primary)" }}>
              {sop.title}
            </h1>
            {sop.description && (
              <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                {sop.description}
              </p>
            )}

            {/* Meta row */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12, alignItems: "center" }}>
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                  fontWeight: 500,
                }}
              >
                {sop.department.label}
              </span>
              {sop.roles.map((r) => (
                <span
                  key={r.id}
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: "var(--bg-glass)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-primary)",
                  }}
                >
                  {r.label}
                </span>
              ))}
              {sop.tags.map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: 10,
                    padding: "1px 6px",
                    borderRadius: 3,
                    color: "var(--text-muted)",
                    border: "1px solid var(--border-primary)",
                  }}
                >
                  #{t}
                </span>
              ))}
            </div>

            <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-muted)" }}>
              Uploaded by {sop.uploaded_by ?? "Unknown"} on {formatDate(sop.uploaded_at)}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <button
            className="btn-secondary"
            onClick={handleCopyLink}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "8px 12px" }}
          >
            {linkCopied ? <Check size={13} style={{ color: "var(--success)" }} /> : <LinkIcon size={13} />}
            {linkCopied ? "Copied" : "Copy share link"}
          </button>
          <button
            className="btn-primary"
            onClick={handleDownload}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Download size={13} /> Download
          </button>
          {isAdmin && !confirmDelete && (
            <button
              className="btn-secondary"
              onClick={() => setConfirmDelete(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "8px 12px", color: "var(--danger)", marginLeft: "auto" }}
            >
              <Trash2 size={13} /> Delete
            </button>
          )}
          {isAdmin && confirmDelete && (
            <div style={{ display: "inline-flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
              <span style={{ fontSize: 12, color: "var(--danger)" }}>Delete this SOP?</span>
              <button
                className="btn-secondary"
                onClick={handleDelete}
                disabled={deleting}
                style={{ fontSize: 12, padding: "6px 12px", background: "var(--danger-soft)", color: "var(--danger)" }}
              >
                {deleting ? "Deleting..." : "Yes, delete"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                style={{ fontSize: 12, padding: "6px 12px" }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {error && (
          <div
            style={{
              marginTop: 12,
              fontSize: 12,
              color: "var(--danger)",
              background: "var(--danger-soft)",
              padding: "8px 12px",
              borderRadius: 6,
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Preview */}
      {previewKind === "pdf" && signedUrl && (
        <div
          className="glass-static"
          style={{
            borderRadius: 12,
            overflow: "hidden",
            background: "var(--bg-glass)",
          }}
        >
          <iframe
            src={signedUrl}
            title={sop.title}
            style={{
              display: "block",
              width: "100%",
              height: "calc(100vh - 320px)",
              minHeight: 500,
              border: "none",
            }}
          />
        </div>
      )}

      {previewKind === "image" && signedUrl && (
        <div
          className="glass-static"
          style={{
            padding: 20,
            borderRadius: 12,
            display: "flex",
            justifyContent: "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={signedUrl}
            alt={sop.title}
            style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain", borderRadius: 8 }}
          />
        </div>
      )}

      {previewKind === "download_only" && (
        <div
          className="glass-static"
          style={{
            padding: 40,
            borderRadius: 12,
            textAlign: "center",
          }}
        >
          <FileText size={32} style={{ color: "var(--text-muted)", marginBottom: 12 }} />
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px" }}>
            Inline preview isn&apos;t supported for this file type. Click Download to view the file in its native app.
          </p>
          <button
            className="btn-primary"
            onClick={handleDownload}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: "0 auto" }}
          >
            <Download size={13} /> Download
          </button>
        </div>
      )}

      {!signedUrl && previewKind !== "download_only" && (
        <div
          className="glass-static"
          style={{
            padding: 24,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            color: "var(--warning)",
            fontSize: 13,
          }}
        >
          <AlertTriangle size={16} />
          Couldn&apos;t generate a preview link. Try Download instead.
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}
