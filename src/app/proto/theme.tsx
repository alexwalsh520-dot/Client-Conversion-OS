"use client";

/**
 * The prototype's design layer.
 *
 * Every screen under /proto is built from the same CSS variables the real app
 * uses, so changing a token here restyles all of them at once. That is the
 * whole point of this app: judge a design direction across several real
 * screens in one go, without touching production.
 *
 * Presets are deliberately conservative. This is a Stripe-grade SaaS tool, not
 * a showcase: no glow, no gradients-for-the-sake-of-it, colour only where it
 * carries meaning.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Preset = {
  key: string;
  name: string;
  blurb: string;
  mode: "dark" | "light";
  vars: Record<string, string>;
};

export const PRESETS: Preset[] = [
  {
    key: "current",
    name: "Current",
    blurb: "CCOS as it ships today. The baseline everything else is judged against.",
    mode: "dark",
    vars: {
      "--p-bg": "#09090b",
      "--p-surface": "rgba(18,18,18,0.75)",
      "--p-surface-solid": "#121214",
      "--p-border": "rgba(255,255,255,0.08)",
      "--p-text": "#ffffff",
      "--p-text-2": "#a1a1aa",
      "--p-muted": "#71717a",
      "--p-accent": "#c9a96e",
      "--p-accent-soft": "rgba(201,169,110,0.12)",
      "--p-radius": "12px",
      "--p-gap": "20px",
      "--p-pad": "20px",
      "--p-font": "13px",
      "--p-title": "22px",
      "--p-blur": "12px",
      "--p-shadow": "0 1px 2px rgba(0,0,0,0.3)",
    },
  },
  {
    key: "flat",
    name: "Flat + dense",
    blurb: "No blur, solid surfaces, tighter spacing and smaller radii. More rows on screen, faster to scan, cheaper to render.",
    mode: "dark",
    vars: {
      "--p-bg": "#0b0b0d",
      "--p-surface": "#141417",
      "--p-surface-solid": "#141417",
      "--p-border": "rgba(255,255,255,0.10)",
      "--p-text": "#f4f4f5",
      "--p-text-2": "#a1a1aa",
      "--p-muted": "#71717a",
      "--p-accent": "#c9a96e",
      "--p-accent-soft": "rgba(201,169,110,0.14)",
      "--p-radius": "7px",
      "--p-gap": "12px",
      "--p-pad": "14px",
      "--p-font": "12.5px",
      "--p-title": "19px",
      "--p-blur": "0px",
      "--p-shadow": "none",
    },
  },
  {
    key: "airy",
    name: "Airy",
    blurb: "More whitespace, quieter borders, larger type. Easier on long sessions; you see less per screen.",
    mode: "dark",
    vars: {
      "--p-bg": "#0a0a0c",
      "--p-surface": "#111114",
      "--p-surface-solid": "#111114",
      "--p-border": "rgba(255,255,255,0.06)",
      "--p-text": "#fafafa",
      "--p-text-2": "#b4b4be",
      "--p-muted": "#7c7c88",
      "--p-accent": "#c9a96e",
      "--p-accent-soft": "rgba(201,169,110,0.10)",
      "--p-radius": "14px",
      "--p-gap": "28px",
      "--p-pad": "28px",
      "--p-font": "14px",
      "--p-title": "26px",
      "--p-blur": "0px",
      "--p-shadow": "none",
    },
  },
  {
    key: "light",
    name: "Light",
    blurb: "The same structure in daylight. Worth checking before committing to anything: most dark designs fall apart here.",
    mode: "light",
    vars: {
      "--p-bg": "#fafafa",
      "--p-surface": "#ffffff",
      "--p-surface-solid": "#ffffff",
      "--p-border": "rgba(0,0,0,0.10)",
      "--p-text": "#18181b",
      "--p-text-2": "#52525b",
      "--p-muted": "#71717a",
      "--p-accent": "#a9823f",
      "--p-accent-soft": "rgba(169,130,63,0.10)",
      "--p-radius": "10px",
      "--p-gap": "20px",
      "--p-pad": "20px",
      "--p-font": "13px",
      "--p-title": "22px",
      "--p-blur": "0px",
      "--p-shadow": "0 1px 2px rgba(0,0,0,0.06)",
    },
  },
];

type Ctx = {
  preset: Preset;
  setPresetKey: (k: string) => void;
  overrides: Record<string, string>;
  setOverride: (k: string, v: string) => void;
  reset: () => void;
};

const ThemeCtx = createContext<Ctx | null>(null);
export const useProtoTheme = () => {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error("useProtoTheme outside provider");
  return c;
};

export function ProtoThemeProvider({ children }: { children: ReactNode }) {
  const [presetKey, setPresetKey] = useState("current");
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  // Remember the last look so a reload does not throw away what you were judging.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("proto-theme") || "{}");
      if (saved.presetKey) setPresetKey(saved.presetKey);
      if (saved.overrides) setOverrides(saved.overrides);
    } catch {
      /* first visit */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("proto-theme", JSON.stringify({ presetKey, overrides }));
  }, [presetKey, overrides]);

  const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0];
  const vars = { ...preset.vars, ...overrides };

  useEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset.protoMode = preset.mode;
  }, [vars, preset.mode]);

  return (
    <ThemeCtx.Provider
      value={{
        preset,
        setPresetKey: (k) => { setPresetKey(k); setOverrides({}); },
        overrides,
        setOverride: (k, v) => setOverrides((o) => ({ ...o, [k]: v })),
        reset: () => setOverrides({}),
      }}
    >
      {children}
    </ThemeCtx.Provider>
  );
}
