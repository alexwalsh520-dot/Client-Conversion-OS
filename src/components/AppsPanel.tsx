"use client";

/**
 * Settings → Apps.
 *
 * Hiding an app used to live at the bottom of the sidebar, which meant a
 * permanent "Hidden (3)" row cluttering every page. Now the sidebar just
 * hides, and this is the one place you go to add an app back.
 *
 * Collapsed by default so Settings stays clean — it is a spot to go when you
 * want it, not another wall of options.
 */

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { LayoutGrid, Plus, ChevronDown, EyeOff } from "lucide-react";
import {
  ALL_APPS,
  HIDDEN_TABS_EVENT,
  readHiddenTabs,
  writeHiddenTabs,
  canViewApp,
} from "@/lib/sidebar-apps";

export default function AppsPanel() {
  const { data: session } = useSession();
  const [hidden, setHidden] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sync = () => setHidden(readHiddenTabs());
    sync();
    window.addEventListener(HIDDEN_TABS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(HIDDEN_TABS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const viewer = {
    isAdmin: session?.user?.role === "admin",
    userEmail: session?.user?.email?.toLowerCase(),
    allowedTabs: session?.user?.allowedTabs,
    hasPermissions: !!session?.user?.role && !!session?.user?.allowedTabs,
  };

  // Only apps this person is allowed to see in the first place.
  const mine = ALL_APPS.filter((app) => canViewApp(app, viewer));
  const hiddenApps = mine.filter((app) => hidden.includes(app.href));

  const addBack = (href: string) => writeHiddenTabs(readHiddenTabs().filter((h) => h !== href));
  const addAll = () => writeHiddenTabs(readHiddenTabs().filter((h) => !hiddenApps.some((a) => a.href === h)));

  return (
    <div className="glass-static" style={{ padding: 20, marginBottom: 20, borderLeft: "3px solid var(--accent)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
            <LayoutGrid size={15} style={{ color: "var(--accent)" }} />
            Apps
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {hiddenApps.length === 0
              ? "Every app you have access to is in your sidebar. Right-click any app in the sidebar to hide it."
              : `${hiddenApps.length} app${hiddenApps.length === 1 ? "" : "s"} hidden from your sidebar.`}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={hiddenApps.length === 0}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "8px 14px", borderRadius: 8,
            border: "1px solid var(--border)",
            background: hiddenApps.length === 0 ? "transparent" : "var(--accent-soft)",
            color: hiddenApps.length === 0 ? "var(--text-muted)" : "var(--accent)",
            fontSize: 13, fontWeight: 600, fontFamily: "inherit",
            cursor: hiddenApps.length === 0 ? "default" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <Plus size={14} />
          Add apps
          {hiddenApps.length > 0 && (
            <ChevronDown
              size={13}
              style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}
            />
          )}
        </button>
      </div>

      {open && hiddenApps.length > 0 && (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
              <EyeOff size={13} /> Hidden from your sidebar
            </div>
            <button
              type="button"
              onClick={addAll}
              style={{ border: "none", background: "transparent", color: "var(--accent)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              Add all
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 8 }}>
            {hiddenApps.map((app) => {
              const Icon = app.icon;
              return (
                <button
                  key={app.href}
                  type="button"
                  onClick={() => addBack(app.href)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 12px", borderRadius: 8,
                    border: "1px solid var(--border)", background: "var(--bg-secondary)",
                    color: "var(--text-primary)", fontSize: 13, fontWeight: 500,
                    fontFamily: "inherit", cursor: "pointer", textAlign: "left", width: "100%",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
                  title={`Add ${app.label} back to the sidebar`}
                >
                  <Icon size={16} />
                  <span style={{ flex: 1 }}>{app.label}</span>
                  <Plus size={14} style={{ color: "var(--accent)" }} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
