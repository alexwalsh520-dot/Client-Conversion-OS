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
  Receipt,
  Clapperboard,
  Handshake,
  Utensils,
  UserRound,
  EyeOff,
  Pill,
  Trophy,
  FlaskConical,
  MessageCircle,
  Factory,
  Film,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/outreach-runs", label: "Client Acquisition", icon: Rocket },
  { href: "/studio-2/auto-outreach-test", label: "Auto Outreach", icon: FileText },
  { href: "/sales-hub", label: "Sales Hub", icon: BarChart3 },
  { href: "/time-to-eat", label: "Time to Eat", icon: Utensils },
  { href: "/coaching", label: "Coaching", icon: Users },
  { href: "/partner-onboarding", label: "Client Onboarding", icon: Handshake },
  { href: "/testimonials", label: "Testimonials", icon: Star },
  { href: "/testimonials/videos", label: "Video Testimonials", icon: Clapperboard },
  { href: "/accountant", label: "Accountant", icon: Calculator },
  { href: "/sop", label: "SOPs", icon: BookOpen },
  // Private single-owner tabs — gated to ownerEmail in canViewItem (overrides admin).
  { href: "/supplements", label: "Supplements", icon: Pill, ownerEmail: "matthew@clientconversion.io" },
  { href: "/invoicing-payouts", label: "Invoicing & Payouts", icon: Receipt, ownerEmail: "matthew@clientconversion.io" },
];

const marketingNavItems = [
  { href: "/cmo", label: "CMO", icon: UserRound },
  { href: "/ads", label: "Ads", icon: Megaphone },
  { href: "/dms", label: "DMs", icon: MessageCircle },
  { href: "/content", label: "Content", icon: Film },
  { href: "/lab", label: "Lab", icon: FlaskConical },
  { href: "/factory", label: "Factory", icon: Factory },
  { href: "/ads-leaderboard", label: "Ads Leaderboard", icon: Trophy },
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
  // per-user hidden tabs (two-finger click any tab → Hide; reveal/unhide from the bottom)
  const [hidden, setHidden] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem("sidebar-hidden-tabs") || "[]"); } catch { return []; }
  });
  const [showHidden, setShowHidden] = useState(false);
  const [menu, setMenu] = useState<{ href: string; label: string; x: number; y: number; hidden: boolean } | null>(null);
  const persistHidden = (next: string[]) => { setHidden(next); localStorage.setItem("sidebar-hidden-tabs", JSON.stringify(next)); };
  const toggleHide = (href: string) => { persistHidden(hidden.includes(href) ? hidden.filter((h) => h !== href) : [...hidden, href]); setMenu(null); };
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [menu]);

  const isAdmin = session?.user?.role === "admin";
  const userEmail = session?.user?.email?.toLowerCase();
  const allowedTabs = session?.user?.allowedTabs;
  const hasPermissions = !!session?.user?.role && !!allowedTabs;

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/studio-2") return pathname === "/studio-2";
    return pathname === href || pathname.startsWith(href + "/");
  };

  const canViewItem = (item: { href: string; adminOnly?: boolean; ownerEmail?: string }) => {
    // ownerEmail restricts a tab to exactly one person — overrides the admin bypass.
    if (item.ownerEmail) return userEmail === item.ownerEmail.toLowerCase();
    if (item.adminOnly) return isAdmin;
    return (
      !hasPermissions ||
      isAdmin ||
      allowedTabs?.includes(item.href) ||
      (item.href === "/time-to-eat" && allowedTabs?.includes("/sales-hub")) ||
      // Video Testimonials manager rides on Coaching access (view + download).
      (item.href === "/testimonials/videos" && allowedTabs?.includes("/coaching"))
    );
  };
  const isHidden = (href: string) => hidden.includes(href);
  const visibleNavItems = navItems.filter(canViewItem).filter((i) => !isHidden(i.href));
  const visibleMarketingItems = marketingNavItems.filter(canViewItem).filter((i) => !isHidden(i.href));
  const hiddenItems = [...navItems, ...marketingNavItems].filter((i) => canViewItem(i) && isHidden(i.href));
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
  // Public shareable testimonial watch page (Slack link) — token URL, no CCOS chrome.
  if (pathname.startsWith("/testimonials/watch/")) return null;
  // Public client check-in form — coach-shared URL, no CCOS chrome.
  if (pathname === "/check-in") return null;
  // Public partner onboarding portal — partner-shared token URL, no CCOS chrome.
  if (pathname.startsWith("/welcome/")) return null;
  // Public Instagram connection setup — client-shared token URL, no CCOS chrome.
  if (pathname.startsWith("/connect/instagram/")) return null;
  // Public Ads Leaderboard contestant flow — client-shared token URL, no chrome.
  if (pathname.startsWith("/ads-leaderboard/compete/")) return null;
  // Public front-facing Ads Leaderboard — no CCOS chrome.
  if (pathname === "/ads-leaderboard/board") return null;

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
        onContextMenu={(e) => { e.preventDefault(); setMenu({ href: item.href, label: item.label, x: e.clientX, y: e.clientY, hidden: isHidden(item.href) }); }}
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
          {/* Hidden tabs (revealable) */}
          {hiddenItems.length > 0 && (
            <div className="sidebar-section">
              <button type="button" className="sidebar-section-label sidebar-section-toggle" onClick={() => setShowHidden((s) => !s)} title="Hidden tabs">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <EyeOff size={14} />{!collapsed && <span>Hidden ({hiddenItems.length})</span>}
                </span>
                {!collapsed && <ChevronDown size={13} className={`sidebar-section-chevron ${showHidden ? "sidebar-section-chevron-open" : ""}`} />}
              </button>
              {showHidden && (
                <div className="sidebar-section-links" style={{ opacity: 0.6 }}>
                  {hiddenItems.map((item) => renderLink(item, true))}
                </div>
              )}
            </div>
          )}

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

      {/* right-click / two-finger-tap context menu for hide/unhide */}
      {menu && (
        <div
          style={{ position: "fixed", left: Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 180), top: menu.y, zIndex: 2000, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 9, boxShadow: "0 8px 28px rgba(0,0,0,.28)", padding: 4, minWidth: 156 }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            onClick={() => toggleHide(menu.href)}
            style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 11px", border: "none", background: "transparent", color: "var(--text-primary)", fontSize: 13, fontWeight: 500, cursor: "pointer", borderRadius: 6, fontFamily: "inherit", textAlign: "left" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-secondary)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <EyeOff size={14} /> {menu.hidden ? `Unhide “${menu.label}”` : `Hide “${menu.label}”`}
          </button>
        </div>
      )}
    </>
  );
}
