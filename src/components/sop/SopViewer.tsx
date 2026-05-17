"use client";

/**
 * Per-SOP viewer page. Renders body_html inline via SopRenderer in the
 * same dark-mode CCOS aesthetic. No file preview iframe — every SOP is
 * a native doc.
 *
 * Admin actions: Edit (in-place via SopEditor), Delete, Copy share link.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Link as LinkIcon,
  Check,
  Trash2,
  Pencil,
  Save,
  X,
} from "lucide-react";
import type { SopWithRelations } from "@/lib/sop/types";
import SopRenderer from "./SopRenderer";
import SopEditor from "./SopEditor";

interface Props {
  sop: SopWithRelations;
}

export default function SopViewer({ sop: initialSop }: Props) {
  const router = useRouter();
  const [sop, setSop] = useState<SopWithRelations>(initialSop);
  const [linkCopied, setLinkCopied] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editingHtml, setEditingHtml] = useState(initialSop.body_html);
  const [saving, setSaving] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setIsAdmin(data?.user?.role === "admin");
      } catch {
        // silent
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleCopyLink() {
    try {
      const fullUrl = `${window.location.origin}/sop/${sop.share_slug}`;
      await navigator.clipboard.writeText(fullUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      setError("Couldn't copy link.");
    }
  }

  async function handlePolish() {
    if (!editingHtml.trim() || polishing) return;
    setPolishing(true);
    setError(null);
    try {
      const res = await fetch("/api/sop/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: editingHtml, title: sop.title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEditingHtml(data.html ?? editingHtml);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Polish failed");
    } finally {
      setPolishing(false);
    }
  }

  async function handleSaveEdit() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sop/${sop.share_slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body_html: editingHtml }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSop(data.sop as SopWithRelations);
      setEditMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
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
    <div style={{ padding: "24px 24px 80px", maxWidth: 900, margin: "0 auto" }}>
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

      {/* Header */}
      <div className="glass-static" style={{ padding: 20, borderRadius: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "var(--text-primary)" }}>
          {sop.title}
        </h1>
        {sop.description && (
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            {sop.description}
          </p>
        )}

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
          {editMode ? "Editing" : "By"} {sop.uploaded_by ?? "Unknown"} · last updated {formatDate(sop.updated_at)}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          {!editMode && (
            <button
              className="btn-secondary"
              onClick={handleCopyLink}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "8px 12px" }}
            >
              {linkCopied ? <Check size={13} style={{ color: "var(--success)" }} /> : <LinkIcon size={13} />}
              {linkCopied ? "Copied" : "Copy share link"}
            </button>
          )}
          {isAdmin && !editMode && (
            <>
              <button
                className="btn-primary"
                onClick={() => { setEditingHtml(sop.body_html); setEditMode(true); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Pencil size={13} /> Edit
              </button>
              {!confirmDelete && (
                <button
                  className="btn-secondary"
                  onClick={() => setConfirmDelete(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "8px 12px", color: "var(--danger)", marginLeft: "auto" }}
                >
                  <Trash2 size={13} /> Delete
                </button>
              )}
              {confirmDelete && (
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
            </>
          )}
          {editMode && (
            <div style={{ display: "inline-flex", gap: 8, marginLeft: "auto" }}>
              <button
                className="btn-secondary"
                onClick={() => { setEditMode(false); setEditingHtml(sop.body_html); setError(null); }}
                disabled={saving}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "8px 12px" }}
              >
                <X size={13} /> Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleSaveEdit}
                disabled={saving}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: saving ? 0.5 : 1 }}
              >
                <Save size={13} /> {saving ? "Saving..." : "Save changes"}
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

      {/* Body */}
      {editMode ? (
        <SopEditor
          initialHtml={editingHtml}
          onChange={setEditingHtml}
          slug={sop.share_slug}
          onPolish={handlePolish}
          polishing={polishing}
          disabled={saving}
        />
      ) : (
        <div className="glass-static" style={{ padding: "24px 32px", borderRadius: 12 }}>
          <SopRenderer bodyHtml={sop.body_html} />
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}
