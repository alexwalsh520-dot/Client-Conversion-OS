"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Layers, GitCommit, LogOut } from "lucide-react";
import { useSession, signOut } from "next-auth/react";

const tabs = [
  { href: "/", label: "Pulse", icon: Activity },
  { href: "/xray", label: "X-Ray", icon: Layers },
  { href: "/log", label: "Log", icon: GitCommit },
];

export default function TopNav() {
  const pathname = usePathname();
  const { data: session } = useSession();

  // Don't render nav on login page
  if (pathname === "/login") return null;

  return (
    <nav
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 56,
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border-primary)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 32px",
        zIndex: 50,
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          className="gradient-text"
          style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.5px" }}
        >
          Nerve
        </span>
      </div>

      {/* Tab Navigation */}
      <div
        style={{
          display: "inline-flex",
          gap: 4,
          padding: 4,
          borderRadius: 10,
        }}
        className="glass-subtle"
      >
        {tabs.map((tab) => {
          const isActive =
            tab.href === "/"
              ? pathname === "/"
              : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                color: isActive
                  ? "var(--text-primary)"
                  : "var(--text-muted)",
                background: isActive
                  ? "var(--accent-soft)"
                  : "transparent",
                textDecoration: "none",
                transition: "all 0.15s ease",
              }}
            >
              <Icon size={16} strokeWidth={1.8} />
              {tab.label}
            </Link>
          );
        })}
      </div>

      {/* Right side: Client Filter + User */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {/* Client Filter */}
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { key: "keith", label: "Keith", color: "var(--keith)", bg: "var(--keith-soft)" },
            { key: "tyson", label: "Tyson", color: "var(--tyson)", bg: "var(--tyson-soft)" },
            { key: "both", label: "Both", color: "var(--text-primary)", bg: "var(--accent-soft)" },
          ].map((client) => (
            <button
              key={client.key}
              style={{
                fontSize: 12,
                fontWeight: 500,
                padding: "4px 12px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                background: client.key === "both" ? client.bg : "transparent",
                color: client.key === "both" ? client.color : "var(--text-muted)",
                transition: "all 0.15s ease",
              }}
            >
              {client.label}
            </button>
          ))}
        </div>

        {/* User Avatar / Sign Out */}
        {session?.user && (
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            title={`Sign out (${session.user.email})`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: 0,
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            {session.user.image ? (
              <img
                src={session.user.image}
                alt=""
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  border: "1px solid var(--border-primary)",
                }}
              />
            ) : (
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "var(--accent-soft)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <LogOut size={14} style={{ color: "var(--text-muted)" }} />
              </div>
            )}
          </button>
        )}
      </div>
    </nav>
  );
}
