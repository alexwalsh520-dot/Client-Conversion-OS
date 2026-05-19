"use client";

/**
 * Admin leads view rendered at /testimonials/leads.
 *
 * Fetches the lead list, renders a status-grouped count strip + a sortable
 * table, allows status mutations and deletes.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Copy, Check, ExternalLink, Trash2, Loader2, ChevronDown } from "lucide-react";
import type { TestimonialLead, TestimonialLeadStatus } from "@/lib/testimonials/types";
import { STATUS_LABELS } from "@/lib/testimonials/types";

const PUBLIC_URL = "/testimonials";

export default function AdminLeadsView() {
  const [leads, setLeads] = useState<TestimonialLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/testimonials/leads");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLeads((data.leads ?? []) as TestimonialLead[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load leads");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c = { total: leads.length, new: 0, contacted: 0, dismissed: 0 };
    for (const l of leads) {
      c[l.status] += 1;
    }
    return c;
  }, [leads]);

  async function setStatus(id: number, status: TestimonialLeadStatus) {
    // Optimistic
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, status } : l))
    );
    try {
      const res = await fetch(`/api/testimonials/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Update failed");
    } catch {
      await load(); // revert by refetching
    }
  }

  async function deleteLead(id: number) {
    if (!confirm("Delete this lead permanently? This cannot be undone.")) return;
    setLeads((prev) => prev.filter((l) => l.id !== id));
    try {
      const res = await fetch(`/api/testimonials/leads/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    } catch {
      await load();
    }
  }

  async function copyPublicUrl() {
    const fullUrl = `${window.location.origin}${PUBLIC_URL}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // silent
    }
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 24px 80px" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 600,
            color: "var(--text-primary)",
            margin: "0 0 6px",
          }}
        >
          Testimonials Leads
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          Form submissions from the public testimonials page.
        </p>
      </div>

      {/* Action bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button
          className="btn-secondary"
          onClick={copyPublicUrl}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            padding: "8px 12px",
          }}
        >
          {copied ? <Check size={13} style={{ color: "var(--success)" }} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy public URL"}
        </button>
        <Link
          href={PUBLIC_URL}
          target="_blank"
          rel="noopener"
          className="btn-secondary"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            padding: "8px 12px",
            textDecoration: "none",
          }}
        >
          <ExternalLink size={13} /> View public page
        </Link>
      </div>

      {/* Stat strip */}
      <div className="metric-grid metric-grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Total" value={counts.total} />
        <Stat label="New" value={counts.new} color="var(--accent)" />
        <Stat label="Contacted" value={counts.contacted} color="var(--success)" />
        <Stat label="Dismissed" value={counts.dismissed} color="var(--text-muted)" />
      </div>

      {/* Table */}
      {loading ? (
        <div
          className="glass-static"
          style={{
            padding: 40,
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: 13,
            borderRadius: 12,
          }}
        >
          <Loader2 size={20} className="tm-spin" style={{ marginRight: 8, verticalAlign: "middle" }} />
          Loading leads...
          <style jsx>{`
            :global(.tm-spin) {
              animation: tm-spin-rot 0.8s linear infinite;
            }
            @keyframes tm-spin-rot { to { transform: rotate(360deg); } }
          `}</style>
        </div>
      ) : error ? (
        <div
          style={{
            padding: 20,
            background: "var(--danger-soft)",
            color: "var(--danger)",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : leads.length === 0 ? (
        <div
          className="glass-static"
          style={{
            padding: "60px 24px",
            textAlign: "center",
            borderRadius: 12,
          }}
        >
          <h3
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "var(--text-primary)",
              margin: "0 0 8px",
            }}
          >
            No leads yet
          </h3>
          <p
            style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              margin: 0,
            }}
          >
            When someone fills out the form on the public page, they will show up here.
          </p>
        </div>
      ) : (
        <div className="glass-static" style={{ borderRadius: 12, overflow: "hidden" }}>
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Submitted</th>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th style={{ width: 80 }}>Message</th>
                <th style={{ width: 130 }}>Status</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <>
                  <tr key={l.id}>
                    <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {formatRelative(l.submitted_at)}
                    </td>
                    <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{l.name}</td>
                    <td>
                      <a
                        href={`mailto:${l.email}`}
                        style={{ color: "var(--accent)", textDecoration: "none" }}
                      >
                        {l.email}
                      </a>
                    </td>
                    <td>
                      <a
                        href={`tel:${l.phone}`}
                        style={{ color: "var(--text-secondary)", textDecoration: "none" }}
                      >
                        {l.phone}
                      </a>
                    </td>
                    <td>
                      {l.message ? (
                        <button
                          onClick={() => toggleExpand(l.id)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--accent)",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 12,
                            padding: 0,
                          }}
                        >
                          <ChevronDown
                            size={12}
                            style={{
                              transform: expanded.has(l.id) ? "rotate(180deg)" : "none",
                              transition: "transform 0.15s",
                            }}
                          />
                          {expanded.has(l.id) ? "Hide" : "View"}
                        </button>
                      ) : (
                        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td>
                      <select
                        className="input-field"
                        value={l.status}
                        onChange={(e) => setStatus(l.id, e.target.value as TestimonialLeadStatus)}
                        style={{
                          fontSize: 12,
                          padding: "4px 8px",
                          width: "100%",
                          color: l.status === "new" ? "var(--accent)" : l.status === "contacted" ? "var(--success)" : "var(--text-muted)",
                        }}
                      >
                        {(["new", "contacted", "dismissed"] as TestimonialLeadStatus[]).map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        onClick={() => deleteLead(l.id)}
                        title="Delete lead"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--text-muted)",
                          padding: 4,
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                  {expanded.has(l.id) && l.message && (
                    <tr key={`${l.id}-msg`}>
                      <td colSpan={7} style={{ padding: "8px 16px 16px", background: "var(--bg-glass)" }}>
                        <div
                          style={{
                            fontSize: 13,
                            color: "var(--text-secondary)",
                            lineHeight: 1.6,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {l.message}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="glass-static metric-card">
      <div className="metric-card-label">{label}</div>
      <div className="metric-card-value" style={{ color: color ?? undefined }}>
        {value}
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso);
    const diffMs = Date.now() - then.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return then.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}
