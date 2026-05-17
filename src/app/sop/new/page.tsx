"use client";

/**
 * /sop/new — create a new SOP via the TipTap editor.
 *
 * Three entry paths:
 *   1. Blank: editor opens empty, user types from scratch
 *   2. Paste: user pastes rich text from anywhere (TipTap cleans up)
 *   3. Import: user drops a PDF/DOCX → /api/sop/import extracts +
 *      auto-polishes → editor opens prefilled
 *
 * On save: POSTs to /api/sop with title, dept, roles, tags, body_html.
 */

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Upload, FileText, Loader2 } from "lucide-react";
import type { SopDepartment, SopRole } from "@/lib/sop/types";
import SopEditor from "@/components/sop/SopEditor";

export default function NewSopPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<SopDepartment[]>([]);
  const [roles, setRoles] = useState<SopRole[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<number>>(new Set());
  const [tagsText, setTagsText] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");

  const [importing, setImporting] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Probe admin
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok) return;
        const data = await res.json();
        setIsAdmin(data?.user?.role === "admin");
      } catch {
        setIsAdmin(false);
      }
    })();
  }, []);

  // Load taxonomy
  useEffect(() => {
    (async () => {
      try {
        const [d, r] = await Promise.all([fetch("/api/sop/departments"), fetch("/api/sop/roles")]);
        if (d.ok) setDepartments((await d.json()).departments ?? []);
        if (r.ok) setRoles((await r.json()).roles ?? []);
      } catch {
        // silent
      }
    })();
  }, []);

  async function handleImportFile(file: File) {
    setImporting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (title.trim()) fd.append("title", title.trim());
      const res = await fetch("/api/sop/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setBodyHtml(data.html ?? "");
      // Suggest a title from the filename if user hasn't entered one
      if (!title.trim() && data.source_filename) {
        const stem = data.source_filename.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ");
        setTitle(stem);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function handlePolish() {
    if (!bodyHtml.trim() || polishing) return;
    setPolishing(true);
    setError(null);
    try {
      const res = await fetch("/api/sop/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: bodyHtml, title: title.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setBodyHtml(data.html ?? bodyHtml);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Polish failed");
    } finally {
      setPolishing(false);
    }
  }

  async function handleSave() {
    if (saving) return;
    setError(null);
    if (!title.trim()) { setError("Title is required."); return; }
    if (!departmentId) { setError("Pick a department."); return; }
    if (!bodyHtml.trim()) { setError("SOP body is empty."); return; }

    setSaving(true);
    try {
      const tags = tagsText.split(",").map((t) => t.trim()).filter(Boolean);
      const res = await fetch("/api/sop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          department_id: departmentId,
          role_ids: [...selectedRoleIds],
          tags,
          body_html: bodyHtml,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      router.push(`/sop/${data.sop.share_slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  }

  const departmentRoles = departmentId
    ? roles.filter((r) => r.department_id === departmentId)
    : [];

  if (isAdmin === false) {
    return (
      <div style={{ padding: 40, maxWidth: 600, margin: "0 auto", color: "var(--text-muted)", fontSize: 14 }}>
        Only admins can create SOPs.{" "}
        <Link href="/sop" style={{ color: "var(--accent)" }}>← Back to library</Link>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 24px 80px", maxWidth: 1000, margin: "0 auto" }}>
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

      <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 6px" }}>
        New SOP
      </h1>
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 20px" }}>
        Write it from scratch, paste rich content, or import a PDF/DOCX and we will auto-format it.
      </p>

      {error && (
        <div
          style={{
            padding: "10px 12px",
            background: "var(--danger-soft)",
            color: "var(--danger)",
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* Metadata */}
      <div className="glass-static" style={{ padding: 16, borderRadius: 12, marginBottom: 16 }}>
        <div style={{ display: "grid", gap: 12 }}>
          <Field label="Title" required>
            <input
              className="input-field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sales Cold Outreach Playbook v2"
              style={{ width: "100%", fontSize: 14 }}
              disabled={saving}
            />
          </Field>

          <Field label="Description (optional)">
            <input
              className="input-field"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short summary of what this SOP covers"
              style={{ width: "100%", fontSize: 13 }}
              disabled={saving}
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Department" required>
              <select
                className="input-field"
                value={departmentId ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setDepartmentId(v ? parseInt(v, 10) : null);
                  setSelectedRoleIds(new Set());
                }}
                style={{ width: "100%", fontSize: 13 }}
                disabled={saving}
              >
                <option value="">Pick a department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Tags (comma separated)">
              <input
                className="input-field"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="onboarding, scripts, ..."
                style={{ width: "100%", fontSize: 13 }}
                disabled={saving}
              />
            </Field>
          </div>

          {departmentId && (
            <Field label="Roles (optional)">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {departmentRoles.length === 0 ? (
                  <span style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                    No roles for this department. Add roles via the Taxonomy panel on the SOPs page.
                  </span>
                ) : (
                  departmentRoles.map((r) => {
                    const isSel = selectedRoleIds.has(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          setSelectedRoleIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                            return next;
                          });
                        }}
                        disabled={saving}
                        style={{
                          fontSize: 12,
                          padding: "4px 10px",
                          borderRadius: 4,
                          border: isSel ? "1px solid var(--accent)" : "1px solid var(--border-primary)",
                          background: isSel ? "var(--accent-soft)" : "var(--bg-glass)",
                          color: isSel ? "var(--accent)" : "var(--text-secondary)",
                          cursor: saving ? "not-allowed" : "pointer",
                        }}
                      >
                        {r.label}
                      </button>
                    );
                  })
                )}
              </div>
            </Field>
          )}
        </div>
      </div>

      {/* Import card */}
      <div
        className="glass-static"
        style={{
          padding: 14,
          borderRadius: 12,
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
          borderStyle: "dashed",
        }}
      >
        <FileText size={20} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: 13, color: "var(--text-secondary)" }}>
          Have an existing PDF or DOCX? Import it and we'll auto-format the contents into the editor below.
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImportFile(f);
            e.target.value = "";
          }}
          style={{ display: "none" }}
        />
        <button
          className="btn-secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing || saving}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "8px 12px" }}
        >
          {importing ? <Loader2 size={13} className="sop-spin" /> : <Upload size={13} />}
          {importing ? "Extracting + formatting..." : "Import file"}
        </button>
        <style jsx>{`
          :global(.sop-spin) {
            animation: sop-spin-rot 0.8s linear infinite;
          }
          @keyframes sop-spin-rot { to { transform: rotate(360deg); } }
        `}</style>
      </div>

      {/* Editor */}
      <SopEditor
        initialHtml={bodyHtml}
        onChange={setBodyHtml}
        onPolish={handlePolish}
        polishing={polishing}
        disabled={saving}
      />

      {/* Save bar */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <Link
          href="/sop"
          className="btn-secondary"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
        >
          Cancel
        </Link>
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={saving || !title.trim() || !departmentId || !bodyHtml.trim()}
          style={{ opacity: saving ? 0.5 : 1 }}
        >
          {saving ? "Saving..." : "Create SOP"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 4,
        }}
      >
        {label} {required && <span style={{ color: "var(--accent)" }}>*</span>}
      </label>
      {children}
    </div>
  );
}
