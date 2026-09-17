import "./hub.css";
import AskShell from "./components/AskShell";

export const dynamic = "force-dynamic";

/**
 * Coaching V3 shell.
 *
 * As of MAS 2026-09-17 the subtabs (Today, Clients, Coaches, Retentions,
 * Onboarding, Nutrition, Money) live in the outer app sidebar — same
 * pattern V2 uses. The sidebar in `src/components/Sidebar.tsx` flips to
 * V3-mode when the pathname is under /coaching-v3/*.
 *
 * Nothing about how the tabs work changes: routes, permissions (Money
 * still admin-only), and page contents are all untouched.
 */
export default async function CoachingV3Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h3">
      <div className="h3-head">
        <div>
          <h1>Coaching V3</h1>
          <p className="h3-sub">Question-first coaching hub. Trial phase.</p>
        </div>
      </div>
      <AskShell>{children}</AskShell>
    </div>
  );
}
