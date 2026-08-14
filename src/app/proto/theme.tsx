"use client";

/**
 * The prototype's design layer.
 *
 * Every screen under /proto is built from the same CSS variables, so changing
 * anything here restyles all of them at once. That is the whole point: judge a
 * direction across several real screens in one go, without touching production.
 *
 * Four things are adjustable, and they are deliberately separate:
 *   preset  — the colour and spacing scale
 *   font    — the type pairing
 *   sidebar — the navigation shape
 *   flags   — the small decisions that separate "fine" from "pristine"
 *
 * Presets stay conservative on purpose. This is a Stripe-grade SaaS tool, not a
 * showcase: no glow, no decoration, colour only where it carries meaning.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { FONT_PAIRS, type FontPair } from "./fonts";

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
      "--p-bg": "#09090b", "--p-surface": "rgba(18,18,18,0.75)", "--p-surface-solid": "#121214",
      "--p-border": "rgba(255,255,255,0.08)", "--p-text": "#ffffff", "--p-text-2": "#a1a1aa",
      "--p-muted": "#71717a", "--p-accent": "#c9a96e", "--p-accent-soft": "rgba(201,169,110,0.12)",
      "--p-radius": "12px", "--p-gap": "20px", "--p-pad": "20px", "--p-font": "13px",
      "--p-title": "22px", "--p-blur": "12px", "--p-shadow": "0 1px 2px rgba(0,0,0,0.3)",
    },
  },
  {
    key: "flat",
    name: "Flat + dense",
    blurb: "No blur, solid surfaces, tighter spacing and smaller radii. More rows on screen, faster to scan.",
    mode: "dark",
    vars: {
      "--p-bg": "#0b0b0d", "--p-surface": "#141417", "--p-surface-solid": "#141417",
      "--p-border": "rgba(255,255,255,0.10)", "--p-text": "#f4f4f5", "--p-text-2": "#a1a1aa",
      "--p-muted": "#71717a", "--p-accent": "#c9a96e", "--p-accent-soft": "rgba(201,169,110,0.14)",
      "--p-radius": "7px", "--p-gap": "12px", "--p-pad": "14px", "--p-font": "12.5px",
      "--p-title": "19px", "--p-blur": "0px", "--p-shadow": "none",
    },
  },
  {
    key: "airy",
    name: "Airy",
    blurb: "More whitespace, quieter borders, larger type. Easier on long sessions; you see less per screen.",
    mode: "dark",
    vars: {
      "--p-bg": "#0a0a0c", "--p-surface": "#111114", "--p-surface-solid": "#111114",
      "--p-border": "rgba(255,255,255,0.06)", "--p-text": "#fafafa", "--p-text-2": "#b4b4be",
      "--p-muted": "#7c7c88", "--p-accent": "#c9a96e", "--p-accent-soft": "rgba(201,169,110,0.10)",
      "--p-radius": "14px", "--p-gap": "28px", "--p-pad": "28px", "--p-font": "14px",
      "--p-title": "26px", "--p-blur": "0px", "--p-shadow": "none",
    },
  },
  {
    key: "slate",
    name: "Slate",
    blurb: "Cool grey instead of near-black, with a blue accent. Reads more like Linear or Vercel than a luxury brand.",
    mode: "dark",
    vars: {
      "--p-bg": "#0e1014", "--p-surface": "#16181d", "--p-surface-solid": "#16181d",
      "--p-border": "rgba(255,255,255,0.09)", "--p-text": "#f2f4f7", "--p-text-2": "#9aa3b2",
      "--p-muted": "#6b7482", "--p-accent": "#7aa2f7", "--p-accent-soft": "rgba(122,162,247,0.13)",
      "--p-radius": "8px", "--p-gap": "16px", "--p-pad": "16px", "--p-font": "13px",
      "--p-title": "21px", "--p-blur": "0px", "--p-shadow": "none",
    },
  },
  {
    key: "paper",
    name: "Paper",
    blurb: "Warm off-white with near-black text and hairline rules. The most 'printed report' of the set.",
    mode: "light",
    vars: {
      "--p-bg": "#f7f6f3", "--p-surface": "#ffffff", "--p-surface-solid": "#ffffff",
      "--p-border": "rgba(0,0,0,0.09)", "--p-text": "#1a1a19", "--p-text-2": "#55534e",
      "--p-muted": "#8a8780", "--p-accent": "#8a6d3b", "--p-accent-soft": "rgba(138,109,59,0.09)",
      "--p-radius": "6px", "--p-gap": "22px", "--p-pad": "20px", "--p-font": "13.5px",
      "--p-title": "23px", "--p-blur": "0px", "--p-shadow": "none",
    },
  },
  {
    key: "light",
    name: "Light",
    blurb: "The same structure in daylight. Worth checking before committing: most dark designs fall apart here.",
    mode: "light",
    vars: {
      "--p-bg": "#fafafa", "--p-surface": "#ffffff", "--p-surface-solid": "#ffffff",
      "--p-border": "rgba(0,0,0,0.10)", "--p-text": "#18181b", "--p-text-2": "#52525b",
      "--p-muted": "#71717a", "--p-accent": "#a9823f", "--p-accent-soft": "rgba(169,130,63,0.10)",
      "--p-radius": "10px", "--p-gap": "20px", "--p-pad": "20px", "--p-font": "13px",
      "--p-title": "22px", "--p-blur": "0px", "--p-shadow": "0 1px 2px rgba(0,0,0,0.06)",
    },
  },
];

export type SidebarVariant = { key: string; name: string; blurb: string };

export const SIDEBARS: SidebarVariant[] = [
  { key: "labels", name: "Labels", blurb: "Icon and word, always visible. What CCOS has now. Clearest, widest." },
  { key: "rail", name: "Icon rail", blurb: "Icons only, names on hover. Gives back about 150px of screen — the single biggest win on dense tables." },
  { key: "grouped", name: "Grouped", blurb: "Section headings above the links. Scales past a dozen tabs, which the flat list does not." },
  { key: "floating", name: "Floating card", blurb: "Nav sits on its own inset panel rather than the page edge. Softer, more app-like, costs a little room." },
  { key: "topbar", name: "Top bar", blurb: "Horizontal nav, no sidebar. Maximum width for wide tables; harder once there are many tabs." },
];

export type Flags = {
  tabularNums: boolean;
  upperLabels: boolean;
  surface: "border" | "shadow" | "filled";
  rows: "lined" | "zebra" | "bare";
  restrainedAccent: boolean;
  wide: boolean;
};

export const DEFAULT_FLAGS: Flags = {
  tabularNums: true,
  upperLabels: true,
  surface: "border",
  rows: "lined",
  restrainedAccent: false,
  wide: false,
};

export const FLAG_HELP: Record<string, string> = {
  tabularNums: "Forces every digit to the same width so decimal points line up down a column. The cheapest thing that makes money tables look professional.",
  upperLabels: "Small caps on column headers and stat labels. Tidy and enterprise, but adds visual noise if overused.",
  surface: "How a card separates from the page: a hairline border, a soft shadow, or just a lighter fill.",
  rows: "Table rows separated by rules, by alternating tint, or by nothing at all.",
  restrainedAccent: "Drops the accent from navigation and headings, keeping it only where it means something. Usually looks more expensive.",
  wide: "Lets content run to 1600px instead of 1240px. Better for wide tables, worse for reading.",
};

type Ctx = {
  preset: Preset;
  setPresetKey: (k: string) => void;
  font: FontPair;
  setFontKey: (k: string) => void;
  sidebar: string;
  setSidebar: (k: string) => void;
  flags: Flags;
  setFlag: <K extends keyof Flags>(k: K, v: Flags[K]) => void;
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
  const [fontKey, setFontKey] = useState("system");
  const [sidebar, setSidebar] = useState("labels");
  const [flags, setFlags] = useState<Flags>(DEFAULT_FLAGS);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  // Remember the last look so a reload does not throw away what you were judging.
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("proto-theme") || "{}");
      if (s.presetKey) setPresetKey(s.presetKey);
      if (s.fontKey) setFontKey(s.fontKey);
      if (s.sidebar) setSidebar(s.sidebar);
      if (s.flags) setFlags({ ...DEFAULT_FLAGS, ...s.flags });
      if (s.overrides) setOverrides(s.overrides);
    } catch {
      /* first visit */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("proto-theme", JSON.stringify({ presetKey, fontKey, sidebar, flags, overrides }));
  }, [presetKey, fontKey, sidebar, flags, overrides]);

  const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0];
  const font = FONT_PAIRS.find((f) => f.key === fontKey) ?? FONT_PAIRS[0];
  const vars = { ...preset.vars, ...overrides };

  useEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.style.setProperty("--p-font-head", font.head);
    root.style.setProperty("--p-font-body", font.body);
    root.style.setProperty("--p-font-mono", font.mono);
    root.style.setProperty("--p-nums", flags.tabularNums ? "tabular-nums" : "normal");
    root.dataset.protoMode = preset.mode;
  }, [vars, font, flags.tabularNums, preset.mode]);

  return (
    <ThemeCtx.Provider
      value={{
        preset,
        setPresetKey: (k) => { setPresetKey(k); setOverrides({}); },
        font,
        setFontKey,
        sidebar,
        setSidebar,
        flags,
        setFlag: (k, v) => setFlags((f) => ({ ...f, [k]: v })),
        overrides,
        setOverride: (k, v) => setOverrides((o) => ({ ...o, [k]: v })),
        reset: () => { setOverrides({}); setFlags(DEFAULT_FLAGS); },
      }}
    >
      {children}
    </ThemeCtx.Provider>
  );
}
