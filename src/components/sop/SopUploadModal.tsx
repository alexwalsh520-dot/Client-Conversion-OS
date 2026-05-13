"use client";

/**
 * Upload modal: file + title + description + department + roles + tags.
 * Posts as multipart/form-data to /api/sop. Admins only (the parent
 * filter-bar already gates the trigger, but the API double-checks).
 */

import { useState, useMemo } from "react";
import { X, Upload, Plus } from "lucide-react";
import type { SopDepartment, SopRole } from "@/lib/sop/types";

interface Props {
  open: boolean;
  departments: SopDepartment[];
  roles: SopRole[];
  onClose: () => void;
  onUploaded: () => void;
}

export default function SopUploadModal({
  open,
  departments,
  roles,
  onClose,
  onUploaded,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<number>>(new Set());
  const [tagsText, setTagsText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const departmentRoles = useMemo(
    () => (departmentId ? roles.filter((r) => r.department_id === departmentId) : []),
    [roles, departmentId]
  );

  if (!open) return null;

  function reset() {
    setFile(null);
    setTitle("");
    setDescription("");
    setDepartmentId(null);
    setSelectedRoleIds(new Set());
    setTagsText("");
    setError(null);
    setSubmitting(false);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    if (!file) {
      setError("Pick a file to upload.");
      return;
    }
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!departmentId) {
      setError("Pick a department.");
      return;
    }

    setSubmitting(true);
    try {
      const tags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title.trim());
      if (description.trim()) formData.append("description", description.trim());
      formData.append("department_id", String(departmentId));
      formData.append("role_ids", JSON.stringify([...selectedRoleIds]));
      formData.append("tags", JSON.stringify(tags));

      const res = await fetch("/api/sop", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      reset();
      onUploaded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setSubmitting(false);
    }
  }

  function toggleRole(id: number) {
    setSelectedRoleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={handleClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-static"
        style={{
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 24,
          borderRadius: 12,
          background: "var(--bg-secondary)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>
            Upload SOP
          </h2>
          <button
            onClick={handleClose}
            disabled={submitting}
            style={{ background: "none", border: "none", cursor: submitting ? "not-allowed" : "pointer", color: "var(--text-muted)" }}
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div
            style={{
              fontSize: 12,
              color: "var(--danger)",
              background: "var(--danger-soft)",
              padding: "8px 12px",
              borderRadius: 6,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "grid", gap: 12 }}>
          {/* File */}
          <div>
            <label className="field-label" style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              File <span style={{ color: "var(--accent)" }}>*</span>
            </label>
            <label
              htmlFor="sop-file-input"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: 12,
                marginTop: 4,
                border: "1px dashed var(--border-primary)",
                borderRadius: 8,
                background: "var(--bg-glass)",
                cursor: "pointer",
                fontSize: 13,
                color: file ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              <Upload size={14} />
              {file ? `${file.name} (${formatBytes(file.size)})` : "Click to choose a file (PDF, DOC, DOCX, etc.)"}
            </label>
            <input
              id="sop-file-input"
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.png,.jpg,.jpeg,.gif"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              style={{ display: "none" }}
            />
          </div>

          {/* Title */}
          <div>
            <label className="field-label" style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Title <span style={{ color: "var(--accent)" }}>*</span>
            </label>
            <input
              className="input-field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sales Cold Outreach Playbook v2"
              style={{ marginTop: 4, width: "100%", fontSize: 13 }}
            />
          </div>

          {/* Description */}
          <div>
            <label className="field-label" style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Description (optional)
            </label>
            <textarea
              className="input-field"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short summary of what this SOP covers"
              rows={2}
              style={{ marginTop: 4, width: "100%", fontSize: 13, resize: "vertical" }}
            />
          </div>

          {/* Department */}
          <div>
            <label className="field-label" style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Department <span style={{ color: "var(--accent)" }}>*</span>
            </label>
            <select
              className="input-field"
              value={departmentId ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setDepartmentId(v ? parseInt(v, 10) : null);
                setSelectedRoleIds(new Set()); // reset roles when dept changes
              }}
              style={{ marginTop: 4, width: "100%", fontSize: 13 }}
            >
              <option value="">Pick a department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </div>

          {/* Roles (multi-select via chips) */}
          {departmentId && (
            <div>
              <label className="field-label" style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Roles (optional, multi-select)
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {departmentRoles.length === 0 ? (
                  <span style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                    No roles defined for this department yet. Add roles via the Taxonomy panel; or skip — the SOP will apply to the whole department.
                  </span>
                ) : (
                  departmentRoles.map((r) => {
                    const isSel = selectedRoleIds.has(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => toggleRole(r.id)}
                        style={{
                          fontSize: 12,
                          padding: "4px 10px",
                          borderRadius: 4,
                          border: isSel ? "1px solid var(--accent)" : "1px solid var(--border-primary)",
                          background: isSel ? "var(--accent-soft)" : "var(--bg-glass)",
                          color: isSel ? "var(--accent)" : "var(--text-secondary)",
                          cursor: "pointer",
                          fontWeight: 500,
                        }}
                      >
                        {r.label}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Tags */}
          <div>
            <label className="field-label" style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Tags (optional, comma-separated)
            </label>
            <input
              className="input-field"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="e.g. onboarding, scripts, follow-up"
              style={{ marginTop: 4, width: "100%", fontSize: 13 }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
          <button
            className="btn-secondary"
            onClick={handleClose}
            disabled={submitting}
            style={{ opacity: submitting ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              opacity: submitting ? 0.5 : 1,
            }}
          >
            <Plus size={14} /> {submitting ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
