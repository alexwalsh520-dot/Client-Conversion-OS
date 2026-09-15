import "./hub.css";
import Link from "next/link";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

const TABS = [
  { href: "/coaching-v3", label: "Today" },
  { href: "/coaching-v3/clients", label: "Clients" },
  { href: "/coaching-v3/coaches", label: "Coaches" },
  { href: "/coaching-v3/retentions", label: "Retentions" },
  { href: "/coaching-v3/money", label: "Money" },
];

export default async function CoachingV3Layout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  // next/headers doesn't expose pathname natively; carrying it forward through
  // x-invoke-path (set by Next in some deploys). Fall back to a null active
  // state — the tabs still work, they just don't highlight.
  const path = h.get("x-invoke-path") ?? h.get("next-url") ?? "";
  return (
    <div className="h3">
      <div className="h3-head">
        <div>
          <h1>Coaching V3</h1>
          <p className="h3-sub">Question-first coaching hub. Trial phase.</p>
        </div>
      </div>
      <nav className="h3-tabs">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={path.endsWith(t.href) ? "on" : ""}>
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
