"use client";

// The shared look for the creator-facing views (Playbook, Buyers, My Content) — used by both the
// public token page and the operator /content tab, which render the identical components.
//
// The rule is less: white page, near-black text, one typeface, one column, generous space, hairline
// rules. No cards inside cards, no glass, no chips, no badges, no icons in the content, no uppercase
// tracking. Colour is reserved for things you can interact with. Values are literal rather than theme
// vars because both surfaces render this content light.

import { useState } from "react";

export const PAPER = "#ffffff";
export const INK = "#141414"; // headings, hooks — the words that matter
export const BODY = "#3d3d40"; // sentences
export const MUTED = "#8c8c88"; // asides, counts, notes
export const RULE = "#e7e7e3"; // hairlines
export const ACCENT = "#a9823f"; // interactive only
export const COLUMN = 680;

export function Column({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: COLUMN, margin: "0 auto" }}>{children}</div>;
}

// A section heading: one to three plain words, no rule above it, plenty of air.
export function H({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 15, fontWeight: 600, color: MUTED, margin: "0 0 18px", letterSpacing: 0 }}>{children}</h2>
  );
}

export function Section({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <section style={{ borderTop: first ? "none" : `1px solid ${RULE}`, paddingTop: first ? 0 : 44, marginTop: first ? 0 : 44 }}>
      {children}
    </section>
  );
}

// Everything that isn't ready yet says the same calm thing.
export function Empty() {
  return <p style={{ fontSize: 16, color: MUTED, lineHeight: 1.6, margin: 0 }}>Being built. Check back soon.</p>;
}

// A quiet text button — the only coloured, clickable thing in the content.
export function TextButton({ onClick, children }: { onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: ACCENT, fontSize: 13, fontWeight: 500, font: "inherit", fontFamily: "inherit" }}
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
