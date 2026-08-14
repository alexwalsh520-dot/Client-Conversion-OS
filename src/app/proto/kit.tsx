"use client";

/**
 * The prototype's component vocabulary.
 *
 * Everything is styled from the --p-* tokens and the flags in theme.tsx, and
 * from nothing else. That is what makes one dial restyle every screen at once —
 * the moment a component hardcodes a colour or a radius, the prototype starts
 * lying about what a change would actually look like.
 */

import type { CSSProperties, ReactNode } from "react";
import { useProtoTheme } from "./theme";

export function useSurface(): CSSProperties {
  const { flags } = useProtoTheme();
  const base: CSSProperties = { borderRadius: "var(--p-radius)", backdropFilter: "blur(var(--p-blur))" };
  if (flags.surface === "shadow") {
    return { ...base, background: "var(--p-surface-solid)", border: "1px solid transparent", boxShadow: "0 1px 3px rgba(0,0,0,.28), 0 6px 18px rgba(0,0,0,.14)" };
  }
  if (flags.surface === "filled") {
    return { ...base, background: "var(--p-surface-solid)", border: "1px solid transparent", boxShadow: "none", filter: "brightness(1.06)" };
  }
  return { ...base, background: "var(--p-surface)", border: "1px solid var(--p-border)", boxShadow: "var(--p-shadow)" };
}

export function Card({ children, style, pad = true }: { children: ReactNode; style?: CSSProperties; pad?: boolean }) {
  return <div style={{ ...useSurface(), padding: pad ? "var(--p-pad)" : 0, ...style }}>{children}</div>;
}

/** Small caps micro-label. Honours the uppercase flag. */
export function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const { flags } = useProtoTheme();
  return (
    <span
      style={{
        fontSize: flags.upperLabels ? 11 : 12,
        color: "var(--p-muted)",
        textTransform: flags.upperLabels ? "uppercase" : "none",
        letterSpacing: flags.upperLabels ? ".07em" : "0",
        fontWeight: 500,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function PageHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: "var(--p-gap)" }}>
      <h1 style={{ fontFamily: "var(--p-font-head)", fontSize: "var(--p-title)", fontWeight: 650, color: "var(--p-text)", letterSpacing: "-0.02em", margin: 0 }}>
        {title}
      </h1>
      {sub && <p style={{ fontSize: "var(--p-font)", color: "var(--p-muted)", marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

export function StatRow({ items }: { items: { label: string; value: string; sub?: string }[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: "var(--p-gap)", marginBottom: "var(--p-gap)" }}>
      {items.map((s) => (
        <Card key={s.label}>
          <Label>{s.label}</Label>
          <div style={{ fontFamily: "var(--p-font-mono)", fontVariantNumeric: "var(--p-nums)", fontSize: 25, fontWeight: 620, color: "var(--p-text)", letterSpacing: "-0.02em", margin: "6px 0 2px" }}>
            {s.value}
          </div>
          {s.sub && <div style={{ fontSize: 12, color: "var(--p-muted)" }}>{s.sub}</div>}
        </Card>
      ))}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 style={{ fontFamily: "var(--p-font-head)", fontSize: 15, fontWeight: 620, color: "var(--p-text)", margin: "calc(var(--p-gap) * 1.4) 0 calc(var(--p-gap) * 0.6)" }}>
      {children}
    </h2>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  const { flags } = useProtoTheme();
  const rule = flags.rows === "lined" ? "1px solid var(--p-border)" : "none";
  return (
    <Card pad={false} style={{ overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--p-font)" }}>
          <thead>
            <tr>
              {head.map((h, i) => (
                <th
                  key={h}
                  style={{
                    textAlign: i === 0 ? "left" : "right",
                    padding: "calc(var(--p-pad) * 0.6) var(--p-pad)",
                    borderBottom: "1px solid var(--p-border)", whiteSpace: "nowrap", fontWeight: 500,
                  }}
                >
                  <Label>{h}</Label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} style={{ background: flags.rows === "zebra" && ri % 2 === 1 ? "var(--p-accent-soft)" : "transparent" }}>
                {r.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      textAlign: ci === 0 ? "left" : "right",
                      padding: "calc(var(--p-pad) * 0.6) var(--p-pad)",
                      color: ci === 0 ? "var(--p-text)" : "var(--p-text-2)",
                      borderBottom: ri === rows.length - 1 ? "none" : rule,
                      whiteSpace: "nowrap",
                      // Numbers get the mono face and aligned digits; the first
                      // column is a name, so it stays in the body face.
                      fontFamily: ci === 0 ? "inherit" : "var(--p-font-mono)",
                      fontVariantNumeric: "var(--p-nums)",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Colour carries meaning here and nowhere else. */
export function Pill({ kind, children }: { kind: "good" | "bad" | "warn" | "flat"; children: ReactNode }) {
  const palette = {
    good: { fg: "#4ade80", bg: "rgba(74,222,128,0.12)" },
    bad: { fg: "#f87171", bg: "rgba(248,113,113,0.12)" },
    warn: { fg: "#fbbf24", bg: "rgba(251,191,36,0.12)" },
    flat: { fg: "var(--p-muted)", bg: "var(--p-accent-soft)" },
  }[kind];
  return (
    <span style={{ fontFamily: "var(--p-font-body)", color: palette.fg, background: palette.bg, borderRadius: 999, padding: "3px 9px", fontSize: 11.5, fontWeight: 600 }}>
      {children}
    </span>
  );
}

export function Spark({ points }: { points: number[] }) {
  const max = Math.max(...points, 1);
  return (
    <span style={{ display: "inline-flex", alignItems: "flex-end", gap: 2, height: 22 }}>
      {points.map((p, i) => (
        <span key={i} style={{ width: 4, height: `${Math.max(10, (p / max) * 100)}%`, background: "var(--p-accent)", opacity: 0.35 + (i / points.length) * 0.65, borderRadius: 1 }} />
      ))}
    </span>
  );
}

export function SampleBanner({ text }: { text: string }) {
  return (
    <div style={{ ...useSurface(), borderLeft: "3px solid var(--p-accent)", padding: "10px var(--p-pad)", marginBottom: "var(--p-gap)", fontSize: 12.5, color: "var(--p-muted)" }}>
      {text}
    </div>
  );
}
