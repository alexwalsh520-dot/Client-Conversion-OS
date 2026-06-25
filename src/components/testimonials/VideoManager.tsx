"use client";

/**
 * Admin manager for submitted video testimonials (used on /testimonials/videos).
 *
 * Each card has an inline player, a download button, a "Feature on public page"
 * toggle (controls whether the video shows in the native gallery on the public
 * /testimonials page, alongside Senja), and a Delete action that removes the R2
 * object + DB row. Server page does auth + the initial fetch; this component
 * owns the interactive state.
 */

import { useState } from "react";
import { Star, Trash2, Download, Globe, Loader2 } from "lucide-react";

export type VideoRow = {
  id: number;
  client_name: string;
  coach_name: string | null;
  submitted_at: string | null;
  file_size: number | null;
  featured: boolean;
};

export default function VideoManager({
  initial,
  canManage = true,
}: {
  initial: VideoRow[];
  // Admins manage (feature + delete). Coaches get view + download only.
  canManage?: boolean;
}) {
  const [rows, setRows] = useState<VideoRow[]>(initial);
  const [busy, setBusy] = useState<Record<number, "feature" | "delete" | undefined>>({});

  const setRowBusy = (id: number, state: "feature" | "delete" | undefined) =>
    setBusy((b) => ({ ...b, [id]: state }));

  const toggleFeature = async (row: VideoRow) => {
    const next = !row.featured;
    setRowBusy(row.id, "feature");
    // Optimistic
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, featured: next } : r)));
    try {
      const res = await fetch(`/api/testimonials/video/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featured: next }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
    } catch (err) {
      // Revert on failure
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, featured: !next } : r)));
      alert(`Could not update: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setRowBusy(row.id, undefined);
    }
  };

  const remove = async (row: VideoRow) => {
    if (!confirm(`Delete ${row.client_name}'s testimonial? This removes the video permanently and cannot be undone.`)) {
      return;
    }
    setRowBusy(row.id, "delete");
    try {
      const res = await fetch(`/api/testimonials/video/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      setRows((rs) => rs.filter((r) => r.id !== row.id));
    } catch (err) {
      alert(`Could not delete: ${err instanceof Error ? err.message : "unknown error"}`);
      setRowBusy(row.id, undefined);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="glass-static" style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>
        No testimonials submitted yet.
      </div>
    );
  }

  const featuredCount = rows.filter((r) => r.featured).length;

  return (
    <>
      <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: "0 0 16px" }}>
        {rows.length} submitted · {featuredCount} featured on the public page
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
        {rows.map((row) => {
          const src = `/api/testimonials/video/stream/${row.id}`;
          const rowBusy = busy[row.id];
          return (
            <div
              key={row.id}
              className="glass-static"
              style={{
                padding: 14,
                border: row.featured ? "1px solid var(--accent)" : undefined,
                position: "relative",
              }}
            >
              {row.featured && (
                <span
                  style={{
                    position: "absolute",
                    top: 20,
                    right: 20,
                    zIndex: 2,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 8px",
                    fontSize: 11,
                    fontWeight: 700,
                    borderRadius: 999,
                    color: "var(--bg-primary)",
                    background: "var(--accent)",
                  }}
                >
                  <Globe size={11} /> Public
                </span>
              )}
              <video
                src={src}
                controls
                playsInline
                preload="metadata"
                style={{ width: "100%", borderRadius: 10, background: "#000", aspectRatio: "9 / 16", objectFit: "contain" }}
              />
              <div style={{ marginTop: 10 }}>
                <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 15 }}>{row.client_name}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                  {row.coach_name || "Unassigned"}
                  {row.submitted_at &&
                    ` · ${new Date(row.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
                  {row.file_size ? ` · ${(row.file_size / (1024 * 1024)).toFixed(1)} MB` : ""}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => toggleFeature(row)}
                    disabled={!!rowBusy}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "7px 12px",
                      fontSize: 13,
                      fontWeight: 600,
                      borderRadius: 8,
                      cursor: rowBusy ? "default" : "pointer",
                      border: row.featured ? "1px solid var(--accent)" : "1px solid var(--border-primary)",
                      color: row.featured ? "var(--bg-primary)" : "var(--text-primary)",
                      background: row.featured ? "var(--accent)" : "transparent",
                    }}
                  >
                    {rowBusy === "feature" ? <Loader2 size={14} className="spin" /> : <Star size={14} />}
                    {row.featured ? "Featured" : "Feature"}
                  </button>
                )}

                <a
                  href={`${src}?download=1`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "7px 12px",
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 8,
                    textDecoration: "none",
                    border: "1px solid var(--border-primary)",
                    color: "var(--text-primary)",
                  }}
                >
                  <Download size={14} /> Download
                </a>

                {canManage && (
                  <button
                    type="button"
                    onClick={() => remove(row)}
                    disabled={!!rowBusy}
                    title="Delete permanently"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "7px 12px",
                      fontSize: 13,
                      fontWeight: 600,
                      borderRadius: 8,
                      cursor: rowBusy ? "default" : "pointer",
                      border: "1px solid rgba(239,68,68,0.4)",
                      color: "var(--danger)",
                      background: "transparent",
                      marginLeft: "auto",
                    }}
                  >
                    {rowBusy === "delete" ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
