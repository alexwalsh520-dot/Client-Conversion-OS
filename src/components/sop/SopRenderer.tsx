"use client";

/**
 * SopRenderer — read-only display of SOP body HTML.
 *
 * Mirrors the editor's styling so an SOP looks identical whether
 * authored or read. Sanitizes again client-side (server already
 * sanitizes on save) as belt-and-suspenders against any malicious
 * HTML slipping through.
 */

import { useMemo } from "react";
import { sanitizeSopHtml } from "@/lib/sop/sanitize";

interface Props {
  bodyHtml: string;
}

export default function SopRenderer({ bodyHtml }: Props) {
  const clean = useMemo(() => sanitizeSopHtml(bodyHtml ?? ""), [bodyHtml]);

  if (!clean) {
    return (
      <div
        style={{
          padding: 40,
          color: "var(--text-muted)",
          fontStyle: "italic",
          textAlign: "center",
        }}
      >
        This SOP is empty.
      </div>
    );
  }

  return (
    <>
      <div
        className="sop-content"
        dangerouslySetInnerHTML={{ __html: clean }}
      />
      <style jsx global>{`
        .sop-content {
          color: var(--text-primary);
          font-size: 14px;
          line-height: 1.7;
        }
        .sop-content h1 {
          font-size: 26px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 24px 0 8px;
          line-height: 1.25;
        }
        .sop-content h2 {
          font-size: 19px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 24px 0 8px;
          line-height: 1.3;
          padding-top: 8px;
          border-top: 1px solid var(--border-primary);
        }
        .sop-content h2:first-child { border-top: none; padding-top: 0; }
        .sop-content h3 {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-secondary);
          margin: 16px 0 4px;
          line-height: 1.4;
        }
        .sop-content p { margin: 8px 0; }
        .sop-content ul, .sop-content ol { padding-left: 24px; margin: 8px 0; }
        .sop-content li { margin: 4px 0; }
        .sop-content li > p { margin: 0; }
        .sop-content blockquote {
          border-left: 3px solid var(--accent);
          padding: 6px 14px;
          margin: 12px 0;
          background: var(--accent-soft);
          color: var(--text-secondary);
          border-radius: 0 6px 6px 0;
        }
        .sop-content code {
          background: var(--bg-glass);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.92em;
          font-family: var(--font-mono), monospace;
          color: var(--accent);
        }
        .sop-content a {
          color: var(--accent);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .sop-content img {
          max-width: 100%;
          height: auto;
          border-radius: 8px;
          margin: 12px 0;
          border: 1px solid var(--border-primary);
        }
        .sop-content hr {
          border: none;
          border-top: 1px solid var(--border-primary);
          margin: 20px 0;
        }
        .sop-content strong { color: var(--text-primary); font-weight: 600; }
      `}</style>
    </>
  );
}
