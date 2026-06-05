"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  Home,
  Users,
  Megaphone,
  Rocket,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LogOut,
  BarChart3,
  Calculator,
  Menu,
  X,
  Monitor,
  Sparkles,
  BookOpen,
  FileText,
  Star,
  Handshake,
  Bot,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/outreach-runs", label: "Client Acquisition", icon: Rocket },
  { href: "/studio-2/auto-outreach-test", label: "Auto Outreach", icon: FileText },
  { href: "/sales-hub", label: "Sales Hub", icon: BarChart3 },
  { href: "/coaching", label: "Coaching", icon: Users },
  { href: "/partner-onboarding", label: "Client Onboarding", icon: Handshake },
  { href: "/testimonials", label: "Testimonials", icon: Star },
  { href: "/accountant", label: "Accountant", icon: Calculator },
  { href: "/sop", label: "SOPs", icon: BookOpen },
];

const marketingNavItems = [
  { href: "/cmo", label: "CMO", icon: Bot },
  { href: "/ads", label: "Ads", icon: Megaphone },
  { href: "/live-ads", label: "Live Ads", icon: Monitor },
  { href: "/studio-2", label: "Studio 2.0", icon: Sparkles },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sidebar-collapsed") === "true";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [forceDesktop, setForceDesktop] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("force-desktop-view") === "true";
  });
  const [marketingOpen, setMarketingOpen] = useState(true);
  const isAdmin = session?.user?.role === "admin";
  const allowedTabs = session?.user?.allowedTabs;
  const hasPermissions = !!session?.user?.role && !!allowedTabs;

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/studio-2") return pathname === "/studio-2";
    return pathname === href || pathname.startsWith(href + "/");
  };

  const canViewItem = (item: { href: string }) =>
    !hasPermissions || isAdmin || allowedTabs?.includes(item.href);
  const visibleNavItems = navItems.filter(canViewItem);
  const visibleMarketingItems = marketingNavItems.filter(canViewItem);
  const marketingActive = visibleMarketingItems.some((item) => isActive(item.href));

  // Apply/remove force-desktop class on html element
  useEffect(() => {
    if (forceDesktop) {
      document.documentElement.classList.add("force-desktop");
    } else {
      document.documentElement.classList.remove("force-desktop");
    }
  }, [forceDesktop]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  };

  const toggleForceDesktop = () => {
    setForceDesktop((prev) => {
      const next = !prev;
      localStorage.setItem("force-desktop-view", String(next));
      return next;
    });
  };

  // Don't render on login or public pages
  if (pathname.startsWith("/super-doc/")) return null;
  if (pathname.startsWith("/studio-2/upload/")) return null;
  if (pathname === "/login" || pathname === "/review" || pathname === "/voice-notes") return null;
  // Public testimonials page renders as a marketing landing page (no CCOS shell).
  // The /testimonials/leads admin sub-route still gets the sidebar.
  if (pathname === "/testimonials") return null;
  // Public client video-testimonial recording page — coach-shared token URL, no CCOS chrome.
  if (pathname.startsWith("/testimonials/record/")) return null;
  // Public client check-in form — coach-shared URL, no CCOS chrome.
  if (pathname === "/check-in") return null;
  // Public partner onboarding portal — partner-shared token URL, no CCOS chrome.
  if (pathname.startsWith("/welcome/")) return null;

  const renderLink = (
    item: { href: string; label: string; icon: React.ComponentType<{ size?: number }> },
    nested = false
  ) => {
    const Icon = item.icon;
    const active = isActive(item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        className={`sidebar-link ${nested ? "sidebar-link-nested" : ""} ${active ? "sidebar-link-active" : ""}`}
        onClick={() => setMobileOpen(false)}
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
      {/* Mobile hamburger button */}
      <button
        className="mobile-menu-btn"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
      >
        <Menu size={22} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="mobile-overlay"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Spacer to push main content (desktop only) */}
      <div className={`sidebar-spacer ${collapsed ? "sidebar-spacer-collapsed" : "sidebar-spacer-expanded"}`} />

      <aside className={`sidebar ${collapsed ? "sidebar-collapsed" : "sidebar-expanded"} ${mobileOpen ? "sidebar-mobile-open" : ""}`}>
        {/* Mobile close button */}
        <button
          className="mobile-close-btn"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        >
          <X size={20} />
        </button>

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
          {visibleNavItems.map((item) => renderLink(item))}
          {visibleMarketingItems.length > 0 && (
            <div className="sidebar-section">
              {!collapsed && (
                <button
                  type="button"
                  className={`sidebar-section-label sidebar-section-toggle ${marketingActive ? "sidebar-section-toggle-active" : ""}`}
                  aria-expanded={marketingOpen || marketingActive}
                  onClick={() => setMarketingOpen((open) => !open)}
                >
                  <span>Marketing</span>
                  <ChevronDown
                    size={13}
                    className={`sidebar-section-chevron ${marketingOpen ? "sidebar-section-chevron-open" : ""}`}
                  />
                </button>
              )}
              {(collapsed || marketingOpen || marketingActive) && (
                <div className="sidebar-section-links">
                  {visibleMarketingItems.map((item) => renderLink(item, true))}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Bottom section */}
        <div className="sidebar-bottom">
          {/* Settings */}
          {renderLink({ href: "/settings", label: "Settings", icon: Settings })}

          {/* Desktop/Mobile view toggle (mobile only) */}
          <button
            className="mobile-view-toggle"
            onClick={toggleForceDesktop}
            title={forceDesktop ? "Switch to mobile view" : "Switch to desktop view"}
          >
            <Monitor size={14} />
            <span>{forceDesktop ? "Mobile View" : "Desktop View"}</span>
          </button>

          {/* User */}
          {session?.user && (
            <button className="sidebar-user" onClick={() => signOut({ callbackUrl: "/login" })}>
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

          {/* Collapse toggle (desktop only) */}
          <button className="sidebar-toggle-btn desktop-only" onClick={toggleCollapsed}>
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
      </aside>

    </>
  );
}
