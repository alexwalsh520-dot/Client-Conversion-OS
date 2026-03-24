"use client";

import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { ShieldOff } from "lucide-react";

export default function AccessGate({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  // Still loading session
  if (status === "loading") return null;

  // Not authenticated — the login page handles redirect
  if (!session?.user) return null;

  // Public pages (no restriction)
  if (pathname === "/login" || pathname === "/review") {
    return <>{children}</>;
  }

  const isAdmin = session.user.role === "admin";
  const allowedTabs = session.user.allowedTabs;

  // If session doesn't have the new fields yet (old JWT), allow everything
  // User needs to sign out and back in to get proper permissions
  if (!session.user.role || !allowedTabs) return <>{children}</>;

  // Admins always have access
  if (isAdmin) return <>{children}</>;

  // Settings is always accessible (shows limited view for non-admins)
  if (pathname === "/settings") return <>{children}</>;

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
