"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { ShieldOff } from "lucide-react";

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
    // /check-in is the public bi-weekly check-in form. Coaches share the
    // URL via Everfit DMs; clients pick themselves from the typeahead
    // and submit. Exact-match (no /check-in/* subroutes today).
    pathname === "/check-in" ||
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

  const isAdmin = session.user.role === "admin";
  const allowedTabs = session.user.allowedTabs;

  // If session doesn't have the new fields yet (old JWT), allow everything
  // User needs to sign out and back in to get proper permissions
  if (!session.user.role || !allowedTabs) return <>{children}</>;

  // Admins always have access
  if (isAdmin) return <>{children}</>;

  // Settings and its child pages are always accessible (shows limited view for non-admins)
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return <>{children}</>;

  // Check if current path matches any allowed tab
  const hasAccess = allowedTabs.some((tab) => {
    if (tab === "/") return pathname === "/";
    return pathname === tab || pathname.startsWith(tab + "/");
  });

  if (!hasAccess) {
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

  return <>{children}</>;
}
