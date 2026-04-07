"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  Home,
  Users,
  Megaphone,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  BarChart3,
  Menu,
  X,
  Monitor,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/coaching", label: "Coaching", icon: Users },
  { href: "/ads", label: "Ads", icon: Megaphone },
  { href: "/sales-hub", label: "Sales Hub", icon: BarChart3 },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [forceDesktop, setForceDesktop] = useState(false);
  const isAdmin = session?.user?.role === "admin";
  const allowedTabs = session?.user?.allowedTabs;
  const hasPermissions = !!session?.user?.role && !!allowedTabs;

  // Persist collapsed state in localStorage
  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored !== null) {
      setCollapsed(stored === "true");
    }
    const storedDesktop = localStorage.getItem("force-desktop-view");
    if (storedDesktop === "true") {
      setForceDesktop(true);
    }
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

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
  if (pathname === "/login" || pathname === "/review") return null;

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
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
          {navItems.filter(item => !hasPermissions || isAdmin || allowedTabs!.includes(item.href)).map(renderLink)}
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

/* ── Add Client Modal ────────────────────────────────────────────── */

function AddClientModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");

  const setupSteps = [
    { name: "Sales Tracker (Google Sheet)", desc: "Add a column in the 'Offer' field matching the client name so revenue and call data can be attributed." },
    { name: "GHL Sub-Account", desc: "Create or link a GHL sub-account with calendar and contact scopes for call tracking." },
    { name: "GHL Calendar", desc: "Set up a booking calendar so calls booked, show rates, and no-shows are tracked." },
    { name: "ManyChat", desc: "Configure ManyChat flows with tags matching the client name for lead and DM metrics." },
    { name: "Ad Platform", desc: "Connect the ad account (Meta, Google, etc.) so ad spend, CPL, and ROAS data flows in." },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Add New Client</h3>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Step {step} of 2</span>
        </div>

        {step === 1 && (
          <>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
              Enter the client&apos;s name. This will appear across all tabs — Home, Sales, and Sales Hub.
            </p>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Client name"
              className="form-input"
              style={{ width: "100%", marginBottom: 16 }}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep(2)}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={() => name.trim() && setStep(2)} disabled={!name.trim()}>Next</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
              To pull accurate metrics for <strong style={{ color: "var(--text-primary)" }}>{name}</strong>, connect these data sources:
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {setupSteps.map((item) => (
                <div key={item.name} style={{ display: "flex", gap: 10, padding: "10px 12px", background: "var(--bg-surface)", border: "1px solid var(--border-primary)", borderRadius: 8 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning)", marginTop: 6, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{item.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", marginBottom: 16 }}>
              The client will appear in all views once added. Metrics populate as data flows in from each source.
            </p>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button className="btn-secondary" onClick={() => setStep(1)}>&larr; Back</button>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-secondary" onClick={onClose}>Cancel</button>
                <button className="btn-primary" onClick={onClose}>Add Client</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Add Team Member Modal ───────────────────────────────────────── */

function AddMemberModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [role, setRole] = useState<"setter" | "closer">("setter");

  const setterSteps = [
    { name: "Sales Tracker Column", desc: "Add the setter's name to the 'Setter' column in the Google Sheet." },
    { name: "GHL User Account", desc: "Create a GHL user so calls and leads can be attributed." },
    { name: "ManyChat Assignment", desc: "Set up lead routing and assignment rules in ManyChat." },
  ];

  const closerSteps = [
    { name: "Sales Tracker Column", desc: "Add the closer's name to the 'Closer' column in the Google Sheet." },
    { name: "GHL Calendar", desc: "Create a booking calendar in GHL for this closer." },
    { name: "GHL User Account", desc: "Create a GHL user so calls and outcomes are tracked." },
  ];

  const steps = role === "setter" ? setterSteps : closerSteps;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Add Team Member</h3>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Step {step} of 2</span>
        </div>

        {step === 1 && (
          <>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
              Enter the team member&apos;s name and role. They&apos;ll appear across all client views.
            </p>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="form-input"
              style={{ width: "100%", marginBottom: 12 }}
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "setter" | "closer")}
              className="form-input"
              style={{ width: "100%", marginBottom: 16 }}
            >
              <option value="setter">Setter</option>
              <option value="closer">Closer</option>
            </select>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={() => name.trim() && setStep(2)} disabled={!name.trim()}>Next</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
              After adding, set up the following for <strong style={{ color: "var(--text-primary)" }}>{name}</strong> ({role}):
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {steps.map((item) => (
                <div key={item.name} style={{ display: "flex", gap: 10, padding: "10px 12px", background: "var(--bg-surface)", border: "1px solid var(--border-primary)", borderRadius: 8 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning)", marginTop: 6, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{item.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", marginBottom: 16 }}>
              The team member will show up in all views once added. Metrics populate as data flows in.
            </p>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button className="btn-secondary" onClick={() => setStep(1)}>&larr; Back</button>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-secondary" onClick={onClose}>Cancel</button>
                <button className="btn-primary" onClick={onClose}>Add Member</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
