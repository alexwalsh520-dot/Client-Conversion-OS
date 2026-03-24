"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  Home,
  Crown,
  TrendingUp,
  Users,
  UserPlus,
  Megaphone,
  Send,
  Crosshair,
  Rocket,
  Brain,
  GitCommit,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  BarChart3,
  DollarSign,
} from "lucide-react";

const mainNav = [
  { href: "/", label: "Home", icon: Home },
  { href: "/mozi-metrics", label: "Mozi Metrics", icon: Crown },
  { href: "/sales", label: "Sales", icon: TrendingUp },
  { href: "/coaching", label: "Coaching", icon: Users },
  { href: "/onboarding", label: "Onboarding", icon: UserPlus },
  { href: "/ads", label: "Ads", icon: Megaphone },
  { href: "/outreach", label: "Outreach", icon: Send },
];

const toolsNav = [
  { href: "/leads", label: "Lead Gen", icon: Crosshair },
  { href: "/outreach-runs", label: "Outreach Runs", icon: Rocket },
  { href: "/sales-hub", label: "Sales Hub", icon: BarChart3 },
  { href: "/media-buyer", label: "Media Buyer", icon: DollarSign },
  { href: "/intelligence", label: "Intelligence", icon: Brain },
  { href: "/log", label: "Change Log", icon: GitCommit },
  { href: "/settings", label: "Settings", icon: Settings },
];

type ClientFilter = "keith" | "tyson" | "both";

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const [collapsed, setCollapsed] = useState(false);
  const [clientFilter, setClientFilter] = useState<ClientFilter>("both");

  const isAdmin = session?.user?.role === "admin";
  const allowedTabs = session?.user?.allowedTabs;
  const hasPermissions = !!session?.user?.role && !!allowedTabs;

  // Persist collapsed state in localStorage
  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored !== null) {
      setCollapsed(stored === "true");
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  };

  // Don't render on login or public pages
  if (pathname === "/login" || pathname === "/review") return null;

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    // Exact match or match with sub-path (e.g. /outreach matches /outreach but not /outreach-runs)
    return pathname === href || pathname.startsWith(href + "/");
  };

  const renderLink = (item: { href: string; label: string; icon: React.ComponentType<{ size?: number }> }) => {
    const Icon = item.icon;
    const active = isActive(item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        className={`sidebar-link ${active ? "sidebar-link-active" : ""}`}
      >
        <span className="sidebar-link-icon">
          <Icon size={18} />
        </span>
        {!collapsed && <span>{item.label}</span>}
        {collapsed && <span className="sidebar-tooltip">{item.label}</span>}
      </Link>
    );
  };

  return (
    <>
      {/* Spacer to push main content */}
      <div className={collapsed ? "sidebar-spacer-collapsed" : "sidebar-spacer-expanded"} />

      <aside className={`sidebar ${collapsed ? "sidebar-collapsed" : "sidebar-expanded"}`}>
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <span className="gradient-text" style={{ fontWeight: 800, fontSize: 16 }}>C</span>
          </div>
          {!collapsed && (
            <span className="gradient-text" style={{ fontWeight: 700, fontSize: 18, letterSpacing: "-0.5px" }}>
              CCOS
            </span>
          )}
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {!collapsed && <div className="sidebar-section-label">Main</div>}
          {mainNav.filter(item => !hasPermissions || isAdmin || allowedTabs!.includes(item.href)).map(renderLink)}

          <div className="sidebar-divider" />

          {!collapsed && <div className="sidebar-section-label">Tools</div>}
          {toolsNav.filter(item => !hasPermissions || isAdmin || allowedTabs!.includes(item.href)).map(renderLink)}
        </nav>

        {/* Bottom section */}
        <div className="sidebar-bottom">
          {/* Client filter */}
          {!collapsed ? (
            <div className="client-filter">
              <button
                className={`client-filter-btn ${clientFilter === "keith" ? "client-filter-btn-active" : ""}`}
                onClick={() => setClientFilter("keith")}
              >
                Keith
              </button>
              <button
                className={`client-filter-btn ${clientFilter === "tyson" ? "client-filter-btn-active" : ""}`}
                onClick={() => setClientFilter("tyson")}
              >
                Tyson
              </button>
              <button
                className={`client-filter-btn ${clientFilter === "both" ? "client-filter-btn-active" : ""}`}
                onClick={() => setClientFilter("both")}
              >
                Both
              </button>
            </div>
          ) : (
            <button
              className="sidebar-toggle-btn"
              title="Client filter"
              onClick={() => {
                const order: ClientFilter[] = ["both", "keith", "tyson"];
                const idx = order.indexOf(clientFilter);
                setClientFilter(order[(idx + 1) % order.length]);
              }}
              style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}
            >
              {clientFilter === "both" ? "B" : clientFilter === "keith" ? "K" : "T"}
            </button>
          )}

          {/* User */}
          {session?.user && (
            <button className="sidebar-user" onClick={() => signOut()}>
              {session.user.image ? (
                <img
                  src={session.user.image}
                  alt=""
                  className="sidebar-user-avatar"
                />
              ) : (
                <div
                  className="sidebar-user-avatar"
                  style={{
                    background: "var(--accent-soft)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--accent)",
                  }}
                >
                  {session.user.name?.[0] ?? "?"}
                </div>
              )}
              {!collapsed && (
                <span style={{ flex: 1, fontSize: 13, color: "var(--text-secondary)" }}>
                  {session.user.name ?? session.user.email}
                </span>
              )}
              {!collapsed && <LogOut size={14} style={{ color: "var(--text-muted)" }} />}
            </button>
          )}

          {/* Collapse toggle */}
          <button className="sidebar-toggle-btn" onClick={toggleCollapsed}>
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
      </aside>
    </>
  );
}
