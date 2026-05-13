"use client";

/**
 * One card in the SOP library grid. Tappable to open the viewer in a new
 * tab (matches user spec: "opens up that particular SOP in CCOS, like it
 * opens that up as a new tab"). Shows file icon, title, description,
 * department, role chips, and tag chips.
 */

import Link from "next/link";
import { ArrowUpRight, Calendar } from "lucide-react";
import type { SopWithRelations } from "@/lib/sop/types";
import SopFileIcon from "./SopFileIcon";

interface Props {
  sop: SopWithRelations;
}

export default function SopCard({ sop }: Props) {
  return (
    <Link
      href={`/sop/${sop.share_slug}`}
      target="_blank"
      rel="noopener"
      className="glass-static fade-up"
      style={{
        display: "block",
        padding: 16,
        borderRadius: 12,
        textDecoration: "none",
        color: "inherit",
        transition: "border-color 0.15s, transform 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "";
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <SopFileIcon fileType={sop.file_type} size={18} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: 14,
                color: "var(--text-primary)",
                lineHeight: 1.3,
              }}
            >
              {sop.title}
            </span>
            <ArrowUpRight
              size={14}
              style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 2 }}
            />
          </div>

          {sop.description && (
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: "var(--text-secondary)",
                lineHeight: 1.5,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {sop.description}
            </p>
          )}
        </div>
      </div>

      {/* Department + roles */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginTop: 12,
          alignItems: "center",
        }}
      >
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
        {sop.roles.slice(0, 3).map((r) => (
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
        {sop.roles.length > 3 && (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            +{sop.roles.length - 3}
          </span>
        )}
      </div>

      {/* Tags */}
      {sop.tags.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            marginTop: 8,
          }}
        >
          {sop.tags.slice(0, 5).map((t) => (
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
      )}

      {/* Footer: uploader + date */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginTop: 12,
          paddingTop: 10,
          borderTop: "1px solid var(--border-primary)",
          fontSize: 11,
          color: "var(--text-muted)",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sop.uploaded_by ?? "Unknown"}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <Calendar size={11} />
          {formatDate(sop.uploaded_at)}
        </span>
      </div>
    </Link>
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
