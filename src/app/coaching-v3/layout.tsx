import "./hub.css";
import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

const TABS = [
  { href: "/coaching-v3", label: "Today", adminOnly: false },
  { href: "/coaching-v3/clients", label: "Clients", adminOnly: false },
  { href: "/coaching-v3/coaches", label: "Coaches", adminOnly: false },
  { href: "/coaching-v3/retentions", label: "Retentions", adminOnly: false },
  // Money is admin-only. Never visible to coaches even when Coaching V3 as a
  // whole is opened up to them — the tab link itself is filtered out here,
  // and the /money page checks role === "admin" server-side as a defense in
  // depth. Confirmed by MAS 2026-09-15.
  { href: "/coaching-v3/money", label: "Money", adminOnly: true },
];

export default async function CoachingV3Layout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const path = h.get("x-invoke-path") ?? h.get("next-url") ?? "";
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);
  return (
    <div className="h3">
      <div className="h3-head">
        <div>
          <h1>Coaching V3</h1>
          <p className="h3-sub">Question-first coaching hub. Trial phase.</p>
        </div>
      </div>
      <nav className="h3-tabs">
        {visibleTabs.map((t) => (
          <Link key={t.href} href={t.href} className={path.endsWith(t.href) ? "on" : ""}>
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
