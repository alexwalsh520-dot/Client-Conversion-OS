/**
 * Coach UI (B6c) — Upload finished PDF.
 *
 * Coach clicks → file picker → uploads via multipart POST. Server
 * persists the row + storage object. On success: callback bumps the
 * panel's refreshKey so the new plan renders immediately.
 *
 * Drag-and-drop is supported via the same hidden <input>; the visible
 * button is a styled label that proxies clicks.
 */

"use client";

import React, { useRef, useState } from "react";
import { Upload, Check, FileText } from "lucide-react";

interface UploadPlanButtonProps {
  clientId: number;
  /** Called with the new plan_id after a successful upload. */
  onUploaded: (planId: number) => void;
  /** Optional label override (e.g. "Replace PDF" when a plan exists). */
  label?: string;
}

export function UploadPlanButton({
  clientId,
  onUploaded,
  label = "Upload PDF",
}: UploadPlanButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    setSuccess(false);
    setProgress(`Uploading ${file.name} (${formatBytes(file.size)})…`);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/nutrition/v2/client/${clientId}/upload-plan`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const newId = (data as { plan_id: number }).plan_id;
      setSuccess(true);
      setProgress(null);
      onUploaded(newId);
      setTimeout(() => setSuccess(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  return (
    <div style={{ marginBottom: 8 }}>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        onChange={handleChange}
        disabled={uploading}
        style={{ display: "none" }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 14px",
          background: success
            ? "var(--success, #22c55e)"
            : uploading
              ? "rgba(99,102,241,0.5)"
              : "var(--accent, #6366f1)",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: uploading ? "wait" : "pointer",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {success ? <Check size={13} /> : uploading ? <FileText size={13} /> : <Upload size={13} />}
        {success ? "Uploaded" : uploading ? "Uploading…" : label}
      </button>
      {progress && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
          {progress}
        </div>
      )}
      {error && (
        <div
          style={{
            marginTop: 6,
            padding: "6px 10px",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 4,
            fontSize: 11,
            color: "rgb(239,68,68)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
