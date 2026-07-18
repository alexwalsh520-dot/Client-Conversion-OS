"use client";

// The shared look for the creator-facing views (Playbook, Buyers, My Content) — used by both the
// public token page and the operator /content tab, which render the identical components.
//
// The middle ground: the low word count and single calm column stay, but it reads as a designed CCOS
// product rather than an unstyled doc. Each section is a soft rounded card with the app's border and
// a subtle shadow, headed by a small accent kicker in CCOS's established style. Inside a card the
// text stays plain — no score badges, no coloured chips, no icons in the content.
//
// Colours come from the app's own tokens, so this inherits CCOS branding for free. Both surfaces
// render this content light (the token page forces html.light), so the light values are what apply.

import { useState } from "react";
import { ChevronDown } from "lucide-react";

export const PAPER = "var(--bg, #f6f6f4)";
export const CARD = "var(--bg-card)";
export const BORDER = "var(--border-primary)";
export const INK = "var(--text-primary)";
export const BODY = "var(--text-secondary)";
export const MUTED = "var(--text-muted)";
export const RULE = "var(--border-primary)";
export const ACCENT = "var(--accent)";
export const ACCENT_SOFT = "var(--accent-soft)";
export const COLUMN = 700;
export const CARD_SHADOW = "0 1px 2px rgba(0,0,0,.04), 0 6px 20px rgba(0,0,0,.05)";
// Long-form text stops widening past a comfortable measure even when the column doesn't.
export const MEASURE = "75ch";

// The column breathes on a desktop screen and stays exactly as it was on phone/tablet. Inline styles
// can't express a breakpoint, so the width lives in one class rendered alongside it.
const COLUMN_CSS = `
.ccos-col{max-width:${COLUMN}px;margin:0 auto}
@media (min-width:1024px){.ccos-col{max-width:1000px}}
.ccos-2col{display:grid;grid-template-columns:1fr;gap:13px}
@media (min-width:1024px){.ccos-2col{grid-template-columns:1fr 1fr;column-gap:36px}}
`;

export function Column({ children }: { children: React.ReactNode }) {
  return (
    <div className="ccos-col">
      <style>{COLUMN_CSS}</style>
      {children}
    </div>
  );
}

// One collapsed row — the whole Playbook is built from these. Collapsed it shows a single line and
// nothing else (no muted metadata bleeding through); the detail only exists once you open it.
export function Row({
  lead,
  summary,
  detail,
  truncate,
}: {
  lead?: React.ReactNode;
  summary: React.ReactNode;
  detail?: React.ReactNode;
  truncate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(detail);
  return (
    <li style={{ borderTop: `1px solid ${RULE}` }}>
      <div
        onClick={() => expandable && setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          minHeight: 48,
          padding: "4px 0",
          cursor: expandable ? "pointer" : "default",
        }}
      >
        {lead != null && (
          <span style={{ flexShrink: 0, width: 20, fontSize: 13, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{lead}</span>
        )}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 15.5,
            color: INK,
            lineHeight: 1.45,
            ...(truncate && !open ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : null),
          }}
        >
          {summary}
        </span>
        {expandable && (
          <ChevronDown
            size={15}
            style={{ flexShrink: 0, color: MUTED, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}
          />
        )}
      </div>
      {open && expandable && (
        <div style={{ padding: "0 0 16px", paddingLeft: lead != null ? 32 : 0, maxWidth: MEASURE }}>{detail}</div>
      )}
    </li>
  );
}

// A small label that groups things inside a card or expansion. Sits one step
// below the accent kicker (H): readable body-ink, uppercase and tracked so it
// clearly reads as a header over the sentence-case body beneath it — not the
// faint 11px grey it used to be, which vanished against the copy.
export function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: BODY, margin: "0 0 9px" }}>
      {children}
    </div>
  );
}

// The CCOS kicker: small, accent, uppercase, tracked. One to three plain words.
export function H({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: ACCENT, marginBottom: 16 }}>
      {children}
    </div>
  );
}

// One section = one card. `first` is kept for call-site compatibility; every card spaces the same.
export function Section({ children }: { children: React.ReactNode; first?: boolean }) {
  return (
    <section style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: "22px 24px", marginBottom: 16 }}>
      {children}
    </section>
  );
}

// The branded page header — accent kicker over the creator's name.
export function PageHeader({ title, kicker = "Content Studio", right }: { title: string; kicker?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 20 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: ACCENT }}>{kicker}</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: INK, margin: "3px 0 0", letterSpacing: "-0.01em" }}>{title}</h1>
      </div>
      <span style={{ flex: 1 }} />
      {right}
    </div>
  );
}

// Tabs read as plain text links — the active one is simply darker and heavier.
export function Tabs<T extends string>({ tabs, active, onPick }: { tabs: readonly (readonly [T, string])[]; active: T; onPick: (k: T) => void }) {
  return (
    <nav style={{ display: "flex", gap: 22, marginBottom: 20, borderBottom: `1px solid ${BORDER}`, paddingBottom: 14 }}>
      {tabs.map(([k, label]) => (
        <button
          key={k}
          onClick={() => onPick(k)}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 14.5, fontFamily: "inherit", color: active === k ? INK : MUTED, fontWeight: active === k ? 700 : 500 }}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

// Everything that isn't ready yet says the same calm thing.
export function Empty() {
  return <p style={{ fontSize: 15, color: MUTED, lineHeight: 1.6, margin: 0 }}>Being built. Check back soon.</p>;
}

// A quiet text button — the only coloured, clickable thing inside a card.
export function TextButton({ onClick, children }: { onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: ACCENT, fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}
    >
      {children}
    </button>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <TextButton
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? "Copied" : label}
    </TextButton>
  );
}
