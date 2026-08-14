"use client";

/**
 * The prototype shell: navigation variants and the design controls.
 *
 * Deliberately does NOT reuse the real Sidebar — this app has no session and no
 * permissions, and borrowing the real one would drag both in. The nav here is a
 * replica whose job is to make the screens feel like CCOS while a design is
 * being judged, and to let the navigation itself be one of the things judged.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutGrid, Megaphone, BarChart3, Users, Factory as FactoryIcon, Film,
} from "lucide-react";
import { ProtoThemeProvider, PRESETS, SIDEBARS, FLAG_HELP, useProtoTheme, type Flags } from "./theme";
import { FONT_PAIRS } from "./fonts";

const NAV = [
  { href: "/proto", label: "Overview", icon: LayoutGrid, group: "Workspace" },
  { href: "/proto/ads-v2", label: "Ads v2", icon: Megaphone, group: "Marketing" },
  { href: "/proto/manager-ads", label: "Manager Ads View", icon: BarChart3, group: "Marketing" },
  { href: "/proto/content", label: "Content", icon: Film, group: "Marketing" },
  { href: "/proto/factory", label: "Factory", icon: FactoryIcon, group: "Marketing" },
  { href: "/proto/sales-hub", label: "Sales Hub", icon: Users, group: "Revenue" },
];

const SLIDERS = [
  { key: "--p-radius", label: "Radius", min: 0, max: 20, unit: "px" },
  { key: "--p-gap", label: "Spacing", min: 6, max: 36, unit: "px" },
  { key: "--p-pad", label: "Padding", min: 8, max: 36, unit: "px" },
  { key: "--p-font", label: "Text", min: 11, max: 17, unit: "px" },
  { key: "--p-title", label: "Title", min: 16, max: 34, unit: "px" },
];

const chip = (on: boolean): React.CSSProperties => ({
  padding: "5px 11px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5,
  fontWeight: on ? 600 : 500,
  border: `1px solid ${on ? "var(--p-accent)" : "var(--p-border)"}`,
  background: on ? "var(--p-accent-soft)" : "transparent",
  color: on ? "var(--p-accent)" : "var(--p-text-2)",
  whiteSpace: "nowrap",
});

function Row({ title, children, help }: { title: string; children: React.ReactNode; help?: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 0", borderTop: "1px solid var(--p-border)" }}>
      <div style={{ width: 92, flexShrink: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--p-muted)", paddingTop: 5 }}>
        {title}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>{children}</div>
        {help && <div style={{ fontSize: 11.5, color: "var(--p-muted)", marginTop: 6, maxWidth: 620, lineHeight: 1.5 }}>{help}</div>}
      </div>
    </div>
  );
}

function Controls() {
  const { preset, setPresetKey, font, setFontKey, sidebar, setSidebar, flags, setFlag, overrides, setOverride, reset } = useProtoTheme();
  const [open, setOpen] = useState(true);
  const cur = (k: string) => parseFloat(overrides[k] ?? preset.vars[k] ?? "0");
  const sbBlurb = SIDEBARS.find((s) => s.key === sidebar)?.blurb;

  return (
    // Sticky only while collapsed. Expanded it is tall, and a tall sticky bar
    // eats the viewport you are trying to judge.
    <div style={{ borderBottom: "1px solid var(--p-border)", background: "var(--p-surface-solid)", position: open ? "relative" : "sticky", top: 0, zIndex: 50 }}>
      <div style={{ maxWidth: flags.wide ? 1600 : 1240, margin: "0 auto", padding: "11px 24px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--p-muted)", marginRight: 2 }}>Theme</span>
        {PRESETS.map((p) => (
          <button key={p.key} onClick={() => setPresetKey(p.key)} title={p.blurb} style={chip(preset.key === p.key)}>{p.name}</button>
        ))}
        <button onClick={() => setOpen((o) => !o)} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--p-muted)", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
          {open ? "Hide options" : "Show options"}
        </button>
      </div>

      {open && (
        <div style={{ maxWidth: flags.wide ? 1600 : 1240, margin: "0 auto", padding: "0 24px 14px" }}>
          <Row title="Typeface" help={font.blurb}>
            {FONT_PAIRS.map((f) => (
              <button key={f.key} onClick={() => setFontKey(f.key)} title={f.blurb} style={{ ...chip(font.key === f.key), fontFamily: f.body }}>
                {f.name}
              </button>
            ))}
          </Row>

          <Row title="Sidebar" help={sbBlurb}>
            {SIDEBARS.map((s) => (
              <button key={s.key} onClick={() => setSidebar(s.key)} title={s.blurb} style={chip(sidebar === s.key)}>{s.name}</button>
            ))}
          </Row>

          <Row title="Surfaces" help={FLAG_HELP.surface}>
            {(["border", "shadow", "filled"] as const).map((v) => (
              <button key={v} onClick={() => setFlag("surface", v)} style={chip(flags.surface === v)}>
                {v === "border" ? "Hairline border" : v === "shadow" ? "Soft shadow" : "Filled only"}
              </button>
            ))}
          </Row>

          <Row title="Table rows" help={FLAG_HELP.rows}>
            {(["lined", "zebra", "bare"] as const).map((v) => (
              <button key={v} onClick={() => setFlag("rows", v)} style={chip(flags.rows === v)}>
                {v === "lined" ? "Ruled" : v === "zebra" ? "Banded" : "Bare"}
              </button>
            ))}
          </Row>

          <Row title="Polish">
            {([
              ["tabularNums", "Aligned digits"],
              ["upperLabels", "Small-caps labels"],
              ["restrainedAccent", "Restrained accent"],
              ["wide", "Wide content"],
            ] as [keyof Flags, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setFlag(k, !flags[k] as never)} title={FLAG_HELP[k]} style={chip(!!flags[k])}>
                {flags[k] ? "✓ " : ""}{label}
              </button>
            ))}
          </Row>

          <Row title="Dials">
            {SLIDERS.map((s) => (
              <label key={s.key} style={{ fontSize: 11, color: "var(--p-muted)", display: "flex", flexDirection: "column", gap: 2 }}>
                <span>{s.label} <b style={{ color: "var(--p-text-2)" }}>{cur(s.key)}{s.unit}</b></span>
                <input type="range" min={s.min} max={s.max} value={cur(s.key)}
                  onChange={(e) => setOverride(s.key, `${e.target.value}${s.unit}`)}
                  style={{ width: 104, accentColor: "var(--p-accent)" }} />
              </label>
            ))}
            <label style={{ fontSize: 11, color: "var(--p-muted)", display: "flex", flexDirection: "column", gap: 2 }}>
              <span>Accent</span>
              <input type="color" value={overrides["--p-accent"] ?? preset.vars["--p-accent"]}
                onChange={(e) => setOverride("--p-accent", e.target.value)}
                style={{ width: 40, height: 22, background: "none", border: "1px solid var(--p-border)", borderRadius: 4, cursor: "pointer" }} />
            </label>
            <button onClick={reset} style={{ alignSelf: "flex-end", background: "none", border: "none", color: "var(--p-accent)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
              Reset
            </button>
          </Row>
        </div>
      )}
    </div>
  );
}

function NavLinks({ collapsed, grouped }: { collapsed?: boolean; grouped?: boolean }) {
  const pathname = usePathname();
  const { flags } = useProtoTheme();

  const link = (n: (typeof NAV)[number]) => {
    const active = pathname === n.href;
    const Icon = n.icon;
    // With a restrained accent the active state is carried by weight and a
    // neutral fill instead of colour.
    const activeColor = flags.restrainedAccent ? "var(--p-text)" : "var(--p-accent)";
    return (
      <Link
        key={n.href}
        href={n.href}
        title={collapsed ? n.label : undefined}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: collapsed ? "9px 0" : "8px 11px",
          justifyContent: collapsed ? "center" : "flex-start",
          marginBottom: 2, borderRadius: "var(--p-radius)", fontSize: 13.5, textDecoration: "none",
          background: active ? (flags.restrainedAccent ? "var(--p-border)" : "var(--p-accent-soft)") : "transparent",
          color: active ? activeColor : "var(--p-text-2)",
          fontWeight: active ? 600 : 500,
        }}
      >
        <Icon size={16} />
        {!collapsed && <span>{n.label}</span>}
      </Link>
    );
  };

  if (!grouped) return <>{NAV.map(link)}</>;

  const groups = [...new Set(NAV.map((n) => n.group))];
  return (
    <>
      {groups.map((g) => (
        <div key={g} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--p-muted)", padding: "0 11px", marginBottom: 5 }}>
            {g}
          </div>
          {NAV.filter((n) => n.group === g).map(link)}
        </div>
      ))}
    </>
  );
}

function Brand({ small }: { small?: boolean }) {
  const { flags } = useProtoTheme();
  return (
    <div style={{ fontFamily: "var(--p-font-head)", fontSize: small ? 13 : 15, fontWeight: 700, color: flags.restrainedAccent ? "var(--p-text)" : "var(--p-accent)", marginBottom: small ? 10 : 14, letterSpacing: "-0.5px", textAlign: small ? "center" : "left" }}>
      {small ? "C" : <>CCOS <span style={{ color: "var(--p-muted)", fontWeight: 500, fontSize: 11 }}>prototype</span></>}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { sidebar, flags } = useProtoTheme();
  const maxWidth = flags.wide ? 1600 : 1240;
  const footnote = (
    <div style={{ marginTop: 18, fontSize: 11, color: "var(--p-muted)", lineHeight: 1.5 }}>
      Not the real app. Nothing here can reach production or live data.
    </div>
  );

  const page = (inner: React.ReactNode) => (
    <div style={{ minHeight: "100vh", background: "var(--p-bg)", color: "var(--p-text)", fontFamily: "var(--p-font-body)", fontSize: "var(--p-font)" }}>
      <Controls />
      {inner}
    </div>
  );

  if (sidebar === "topbar") {
    return page(
      <>
        <div style={{ borderBottom: "1px solid var(--p-border)", background: "var(--p-surface-solid)" }}>
          <div style={{ maxWidth, margin: "0 auto", padding: "10px 24px", display: "flex", alignItems: "center", gap: 16 }}>
            <Brand />
            <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}><NavLinks /></div>
          </div>
        </div>
        <main style={{ maxWidth, margin: "0 auto", padding: 24 }}>{children}</main>
      </>
    );
  }

  const collapsed = sidebar === "rail";
  const navWidth = collapsed ? 60 : 190;

  return page(
    <div style={{ maxWidth, margin: "0 auto", padding: 24, display: "grid", gridTemplateColumns: `${navWidth}px 1fr`, gap: sidebar === "floating" ? 22 : 30, alignItems: "start" }}>
      <nav
        style={{
          position: "sticky", top: 92,
          ...(sidebar === "floating"
            ? { background: "var(--p-surface-solid)", border: "1px solid var(--p-border)", borderRadius: "var(--p-radius)", padding: "14px 10px" }
            : {}),
        }}
      >
        <Brand small={collapsed} />
        <NavLinks collapsed={collapsed} grouped={sidebar === "grouped"} />
        {!collapsed && footnote}
      </nav>
      <main style={{ minWidth: 0 }}>{children}</main>
    </div>
  );
}

export default function ProtoLayout({ children }: { children: React.ReactNode }) {
  // The prototype only exists where it is switched on. The auth bypass for
  // /proto lives in proxy.ts and AccessGate, which are branch-wide changes — if
  // this branch were ever merged to main, this guard is what stops /proto from
  // becoming an unauthenticated route on production.
  if (process.env.NEXT_PUBLIC_PROTOTYPE !== "1") {
    return (
      <div style={{ padding: 48, fontFamily: "system-ui,sans-serif", color: "#a1a1aa", background: "#09090b", minHeight: "100vh" }}>
        <h1 style={{ fontSize: 18, color: "#fff", marginBottom: 8 }}>Not available</h1>
        <p style={{ fontSize: 14 }}>The design prototype is not enabled in this environment.</p>
      </div>
    );
  }

  return (
    <ProtoThemeProvider>
      <Shell>{children}</Shell>
    </ProtoThemeProvider>
  );
}
