"use client";

/**
 * Empty state for the SOP library. Shown when no SOPs match the current
 * filters. Polished because this WILL be empty for the first weeks/months
 * of usage — needs to look intentional, not broken.
 */

import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import type { SopPermissions } from "@/lib/sop/types";

interface Props {
  isFiltered: boolean;
  totalSopsAcrossLibrary: number;
  permissions: SopPermissions;
}

export default function SopEmptyState({
  isFiltered,
  totalSopsAcrossLibrary,
  permissions,
}: Props) {
  // Three flavors of empty:
  //   1. Library is brand-new, nothing uploaded ever
  //   2. Filter narrowed away all results
  //   3. (rare) Library has SOPs but search returned 0 — same as 2
  const libraryEmpty = totalSopsAcrossLibrary === 0;

  return (
    <div
      className="glass-static"
      style={{
        padding: "60px 24px",
        textAlign: "center",
        borderRadius: 12,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          padding: 16,
          borderRadius: 12,
          background: "var(--accent-soft)",
          marginBottom: 16,
        }}
      >
        <BookOpen size={28} style={{ color: "var(--accent)" }} />
      </div>

      {libraryEmpty && !isFiltered && (
        <>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "var(--text-primary)",
              margin: "0 0 8px 0",
            }}
          >
            The SOP library is empty
          </h3>
          <p
            style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              maxWidth: 480,
              margin: "0 auto 20px",
              lineHeight: 1.6,
            }}
          >
            This is where every standard operating procedure lives, organized by department and role. Upload your first SOP to get started. New hires will be able to find what they need by searching, filtering, or following a shared link.
          </p>
        </>
      )}

      {isFiltered && (
        <>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "var(--text-primary)",
              margin: "0 0 8px 0",
            }}
          >
            No SOPs match these filters
          </h3>
          <p
            style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              maxWidth: 480,
              margin: "0 auto 20px",
              lineHeight: 1.6,
            }}
          >
            Try widening your search or clearing the department and role filters.
          </p>
        </>
      )}

      {!libraryEmpty && !isFiltered && (
        <>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "var(--text-primary)",
              margin: "0 0 8px 0",
            }}
          >
            No SOPs found
          </h3>
        </>
      )}

      {permissions.canUpload && libraryEmpty && (
        <Link
          href="/sop/new"
          className="btn-primary"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            textDecoration: "none",
          }}
        >
          <Plus size={14} /> Create first SOP
        </Link>
      )}
    </div>
  );
}
