"use client";

/**
 * The prototype shell: its own sidebar and its own design controls.
 *
 * Deliberately does NOT reuse the real Sidebar — this app has no session and no
 * permissions, and borrowing the real one would drag both in. The nav here is a
 * replica whose job is to make the screens feel like CCOS while a design is
 * being judged.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ProtoThemeProvider, PRESETS, useProtoTheme } from "./theme";

const NAV = [
  { href: "/proto", label: "Overview" },
  { href: "/proto/ads-v2", label: "Ads v2" },
  { href: "/proto/manager-ads", label: "Manager Ads View" },
  { href: "/proto/sales-hub", label: "Sales Hub" },
  { href: "/proto/factory", label: "Factory" },
  { href: "/proto/content", label: "Content" },
];

const SLIDERS: { key: string; label: string; min: number; max: number; unit: string }[] = [
  { key: "--p-radius", label: "Corner radius", min: 0, max: 20, unit: "px" },
  { key: "--p-gap", label: "Spacing", min: 6, max: 36, unit: "px" },
  { key: "--p-pad", label: "Card padding", min: 8, max: 36, unit: "px" },
  { key: "--p-font", label: "Base text", min: 11, max: 17, unit: "px" },
  { key: "--p-title", label: "Page title", min: 16, max: 34, unit: "px" },
];

function Controls() {
  const { preset, setPresetKey, overrides, setOverride, reset } = useProtoTheme();
  const [open, setOpen] = useState(true);
  const cur = (k: string) => parseFloat(overrides[k] ?? preset.vars[k] ?? "0");

  return (
    <div style={{ borderBottom: "1px solid var(--p-border)", background: "var(--p-surface-solid)", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "12px 24px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--p-muted)", marginRight: 4 }}>
          Design
        </span>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPresetKey(p.key)}
            title={p.blurb}
            style={{
              padding: "6px 13px", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontSize: 13,
              fontWeight: preset.key === p.key ? 600 : 500,
              border: `1px solid ${preset.key === p.key ? "var(--p-accent)" : "var(--p-border)"}`,
              background: preset.key === p.key ? "var(--p-accent-soft)" : "transparent",
              color: preset.key === p.key ? "var(--p-accent)" : "var(--p-text-2)",
            }}
          >
            {p.name}
          </button>
        ))}
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--p-muted)", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}
        >
          {open ? "Hide dials" : "Show dials"}
        </button>
      </div>

      {open && (
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 24px 14px", display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
          {SLIDERS.map((s) => (
            <label key={s.key} style={{ fontSize: 11.5, color: "var(--p-muted)", display: "flex", flexDirection: "column", gap: 3 }}>
              <span>{s.label} <b style={{ color: "var(--p-text-2)" }}>{cur(s.key)}{s.unit}</b></span>
              <input
                type="range" min={s.min} max={s.max} value={cur(s.key)}
                onChange={(e) => setOverride(s.key, `${e.target.value}${s.unit}`)}
                style={{ width: 128, accentColor: "var(--p-accent)" }}
              />
            </label>
          ))}
          <label style={{ fontSize: 11.5, color: "var(--p-muted)", display: "flex", flexDirection: "column", gap: 3 }}>
            <span>Accent</span>
            <input
              type="color"
              value={overrides["--p-accent"] ?? preset.vars["--p-accent"]}
              onChange={(e) => setOverride("--p-accent", e.target.value)}
              style={{ width: 44, height: 24, background: "none", border: "1px solid var(--p-border)", borderRadius: 5, cursor: "pointer" }}
            />
          </label>
          {Object.keys(overrides).length > 0 && (
            <button
              onClick={reset}
              style={{ alignSelf: "flex-end", background: "none", border: "none", color: "var(--p-accent)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
            >
              Reset dials
            </button>
          )}
          <span style={{ fontSize: 11.5, color: "var(--p-muted)", maxWidth: 320, alignSelf: "flex-end" }}>{preset.blurb}</span>
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div style={{ minHeight: "100vh", background: "var(--p-bg)", color: "var(--p-text)", fontFamily: "system-ui,-apple-system,'Segoe UI',sans-serif" }}>
      <Controls />
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "24px", display: "grid", gridTemplateColumns: "190px 1fr", gap: 30, alignItems: "start" }}>
        <nav style={{ position: "sticky", top: 92 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--p-accent)", marginBottom: 14, letterSpacing: "-0.5px" }}>
            CCOS <span style={{ color: "var(--p-muted)", fontWeight: 500, fontSize: 11 }}>prototype</span>
          </div>
          {NAV.map((n) => {
            const active = pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                style={{
                  display: "block", padding: "8px 11px", marginBottom: 2, borderRadius: "var(--p-radius)",
                  fontSize: 13.5, textDecoration: "none",
                  background: active ? "var(--p-accent-soft)" : "transparent",
                  color: active ? "var(--p-accent)" : "var(--p-text-2)",
                  fontWeight: active ? 600 : 500,
                }}
              >
                {n.label}
              </Link>
            );
          })}
          <div style={{ marginTop: 18, fontSize: 11, color: "var(--p-muted)", lineHeight: 1.5 }}>
            Not the real app. Nothing here can reach production or live data.
          </div>
        </nav>
        <main style={{ minWidth: 0 }}>{children}</main>
      </div>
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
