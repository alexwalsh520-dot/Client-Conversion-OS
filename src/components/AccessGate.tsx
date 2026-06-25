"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { ShieldOff } from "lucide-react";

// Single-owner tabs (e.g. /supplements) restrict to one email, overriding admin.
const OWNER_ONLY_TABS: Record<string, string> = {
  "/supplements": "matthew@clientconversion.io",
};

function RestrictedView() {
  return (
    <div
      className="fade-up"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: 16,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: "rgba(239,68,68,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ShieldOff size={28} style={{ color: "var(--danger)" }} />
      </div>
      <h2 style={{ color: "var(--text-primary)", fontSize: 20, fontWeight: 600, margin: 0 }}>
        Access Restricted
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, maxWidth: 400 }}>
        You don&apos;t have permission to view this page. Contact your admin to request access.
      </p>
    </div>
  );
}

export default function AccessGate({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [localDevState, setLocalDevState] = useState({ checked: false, enabled: false });

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setLocalDevState({
        checked: true,
        enabled: ["localhost", "127.0.0.1"].includes(window.location.hostname),
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const isLocalDev = localDevState.enabled;

  const isLocalPublicCandidate =
    pathname === "/studio-2/auto-outreach-test" ||
    pathname === "/super-doc-editor" ||
    pathname.startsWith("/super-doc-editor/");
  const isLocalSuperDocEditor =
    (pathname === "/super-doc-editor" || pathname.startsWith("/super-doc-editor/")) && isLocalDev;
  const isLocalAutoOutreachTest =
    pathname === "/studio-2/auto-outreach-test" && isLocalDev;
  const isPublicPage =
    pathname === "/login" ||
    pathname === "/review" ||
    pathname === "/voice-notes" ||
    pathname === "/outreach-test" ||
    pathname === "/outreach-run" ||
    // /testimonials is the public-facing testimonials landing page (only
    // public CCOS surface that accepts user input). The /testimonials/leads
    // admin sub-route is gated server-side at the page level, so we keep
    // this as exact-match — startsWith would defeat the admin gate.
    pathname === "/testimonials" ||
    // /testimonials/record/<token> is the public client video-testimonial
    // recording page. Clients open it via an unguessable token link from their
    // coach; no CCOS login required.
    pathname.startsWith("/testimonials/record/") ||
    // /testimonials/watch/<token> is the public shareable watch page (the Slack
    // "Watch testimonial" link). Token-gated, no login, so coaches can view
    // their client's submission without admin access.
    pathname.startsWith("/testimonials/watch/") ||
    // /check-in is the public bi-weekly check-in form. Coaches share the
    // URL via Everfit DMs; clients pick themselves from the typeahead
    // and submit. Exact-match (no /check-in/* subroutes today).
    pathname === "/check-in" ||
    // /welcome/<token> is the public partner-onboarding portal. Partners
    // open it via an unguessable token link; no CCOS login required.
    pathname.startsWith("/welcome/") ||
    // /connect/instagram/<client> is a public client setup link. It uses a
    // signed token in the URL and never exposes the Sales Hub.
    pathname.startsWith("/connect/instagram/") ||
    // /ads-leaderboard/compete/<token> is the public Ads Leaderboard contestant
    // flow. Clients open it via an unguessable token link; no CCOS login. The
    // /ads-leaderboard admin tab itself stays gated (startsWith would defeat it,
    // so this is an explicit /compete/ prefix match).
    pathname.startsWith("/ads-leaderboard/compete/") ||
    // /ads-leaderboard/board is the public front-facing leaderboard (no auth,
    // no financials). Exact match so the admin /ads-leaderboard tab stays gated.
    pathname === "/ads-leaderboard/board" ||
    // /p/ads/<token> is a public, no-login creator share link. It resolves the
    // token server-side to ONE creator and shows only that creator's live Ads
    // view (data hard-scoped by /api/public/ads/<token>). No CCOS login.
    pathname.startsWith("/p/ads/") ||
    // /p/live-ads/<token> is a public, no-login creator share link for the LIVE
    // ADS tab. It resolves the token server-side to ONE creator and shows only
    // that creator's live ad creatives (data hard-scoped to that one account by
    // /api/public/live-ads/<token>). No CCOS login.
    pathname.startsWith("/p/live-ads/") ||
    isLocalSuperDocEditor ||
    isLocalAutoOutreachTest ||
    pathname.startsWith("/super-doc/") ||
    pathname.startsWith("/studio-2/upload/");

  // Redirect to login when not authenticated (must be before conditional returns for hooks rules)
  useEffect(() => {
    if (isLocalPublicCandidate && !localDevState.checked) return;
    if (status === "unauthenticated" && !isPublicPage) {
      router.push("/login");
    }
  }, [status, isPublicPage, isLocalPublicCandidate, localDevState.checked, router]);

  if (isLocalPublicCandidate && !localDevState.checked) return null;

  // Public pages (no restriction)
  if (isPublicPage) {
    return <>{children}</>;
  }

  // Still loading session
  if (status === "loading") return null;

  // Not authenticated — show nothing while redirect happens
  if (!session?.user) return null;

  // Single-owner tabs are gated by email first — this runs BEFORE the admin bypass
  // and old-JWT fallback below, so no other admin can reach them by direct URL.
  const ownerOnly = Object.entries(OWNER_ONLY_TABS).find(
    ([tab]) => pathname === tab || pathname.startsWith(tab + "/"),
  );
  if (ownerOnly) {
    return session.user.email?.toLowerCase() === ownerOnly[1] ? <>{children}</> : <RestrictedView />;
  }

  const isAdmin = session.user.role === "admin";
  const allowedTabs = session.user.allowedTabs;

  // If session doesn't have the new fields yet (old JWT), allow everything
  // User needs to sign out and back in to get proper permissions
  if (!session.user.role || !allowedTabs) return <>{children}</>;

  // Admins always have access
  if (isAdmin) return <>{children}</>;

  // Settings and its child pages are always accessible (shows limited view for non-admins)
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return <>{children}</>;

  // Partner onboarding back office (and per-client detail pages) handle their
  // own admin-vs-PIN gate inside the page (admins straight in; non-admins
  // enter a shared PIN once). Let any authenticated user reach these so the
  // in-page gate can do its job.
  if (pathname === "/partner-onboarding" || pathname.startsWith("/partner-onboarding/")) return <>{children}</>;

  // Video Testimonials manager is open to the whole coaching team for view +
  // download. Management actions (feature/delete) stay admin-only, enforced in
  // the page and the manage API — not by hiding the page.
  if (
    (pathname === "/testimonials/videos" || pathname.startsWith("/testimonials/videos/")) &&
    allowedTabs.includes("/coaching")
  ) {
    return <>{children}</>;
  }

  // Check if current path matches any allowed tab
  const hasAccess = allowedTabs.some((tab) => {
    if (tab === "/") return pathname === "/";
    if (pathname === "/time-to-eat" && tab === "/sales-hub") return true;
    return pathname === tab || pathname.startsWith(tab + "/");
  });

  if (!hasAccess) {
    return <RestrictedView />;
  }

  return <>{children}</>;
}
