"use client";

/**
 * Floating "Admin: Manage leads" badge that renders top-right on
 * /testimonials when a logged-in admin views the page. Public visitors
 * never see this.
 *
 * Optionally shows new-lead count as a small chip if there are any.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, ArrowRight } from "lucide-react";

export default function AdminBadge() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [newCount, setNewCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sessionRes = await fetch("/api/auth/session");
        if (!sessionRes.ok) return;
        const session = await sessionRes.json();
        const admin = session?.user?.role === "admin";
        if (cancelled) return;
        setIsAdmin(admin);
        if (!admin) return;

        // If admin, fetch the new-lead count for the badge chip
        const leadsRes = await fetch("/api/testimonials/leads");
        if (!leadsRes.ok) return;
        const leads = await leadsRes.json();
        if (cancelled) return;
        const newOnly = (leads.leads ?? []).filter((l: { status: string }) => l.status === "new").length;
        setNewCount(newOnly);
      } catch {
        // silent — if anything fails, badge just doesn't appear
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isAdmin) return null;

  return (
    <Link
      href="/testimonials/leads"
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 100,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        background: "var(--bg-card)",
        border: "1px solid var(--accent)",
        borderRadius: 8,
        textDecoration: "none",
        color: "var(--accent)",
        fontSize: 12,
        fontWeight: 500,
        backdropFilter: "blur(8px)",
      }}
    >
      <ShieldCheck size={13} />
      <span>Admin: Manage leads</span>
      {typeof newCount === "number" && newCount > 0 && (
        <span
          style={{
            background: "var(--accent)",
            color: "#000",
            fontSize: 10,
            fontWeight: 700,
            padding: "1px 6px",
            borderRadius: 8,
          }}
        >
          {newCount} new
        </span>
      )}
      <ArrowRight size={12} />
    </Link>
  );
}
