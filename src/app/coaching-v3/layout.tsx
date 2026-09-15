import "./hub.css";
import { auth } from "@/auth";
import TabBar from "./components/TabBar";

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
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin).map(({ href, label }) => ({ href, label }));
  return (
    <div className="h3">
      <div className="h3-head">
        <div>
          <h1>Coaching V3</h1>
          <p className="h3-sub">Question-first coaching hub. Trial phase.</p>
        </div>
      </div>
      <TabBar tabs={visibleTabs} />
      {children}
    </div>
  );
}
