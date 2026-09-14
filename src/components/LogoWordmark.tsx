"use client";

import { useSyncExternalStore, type CSSProperties } from "react";
import { useSession } from "next-auth/react";

/**
 * The CCOS wordmark in the sidebar, with an easter egg: clicking it cycles
 * through a set of display fonts. Each signed-in person keeps their own pick
 * in localStorage, the same way the theme does.
 *
 * The fonts are loaded once in layout.tsx via a Google Fonts <link>.
 */
type LogoFont = {
  name: string;
  family: string;
  text: string; // what the expanded wordmark says
  mark: string; // what the collapsed square says
  style: CSSProperties;
  markStyle: CSSProperties;
};

export const LOGO_FONTS: LogoFont[] = [
  {
    name: "Outfit",
    family: "'Outfit', sans-serif",
    text: "CCOS",
    mark: "C",
    style: { fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em" },
    markStyle: { fontWeight: 800, fontSize: 18 },
  },
  {
    name: "Sixtyfour",
    family: "'Sixtyfour', monospace",
    text: "CCOS",
    mark: "C",
    style: { fontSize: 13, letterSpacing: "0.02em" },
    markStyle: { fontSize: 13 },
  },
  {
    name: "Mono in brackets",
    family: "'JetBrains Mono', monospace",
    text: "[CCOS]",
    mark: "[C]",
    style: { fontWeight: 800, fontSize: 16 },
    markStyle: { fontWeight: 800, fontSize: 11 },
  },
  {
    name: "Dot matrix",
    family: "'Doto', sans-serif",
    text: "CCOS",
    mark: "C",
    style: { fontWeight: 900, fontSize: 22, letterSpacing: "0.02em" },
    markStyle: { fontWeight: 900, fontSize: 20 },
  },
  {
    name: "Pixel",
    family: "'Silkscreen', monospace",
    text: "CCOS",
    mark: "C",
    style: { fontWeight: 700, fontSize: 15 },
    markStyle: { fontWeight: 700, fontSize: 14 },
  },
  {
    name: "Jersey 10",
    family: "'Jersey 10', sans-serif",
    text: "CCOS",
    mark: "C",
    style: { fontSize: 28, letterSpacing: "0.02em" },
    markStyle: { fontSize: 24 },
  },
  {
    name: "Workbench",
    family: "'Workbench', monospace",
    text: "CCOS",
    mark: "C",
    style: { fontSize: 17, letterSpacing: "0.02em" },
    markStyle: { fontSize: 16 },
  },
];

const LAST_KEY = "ccos-logo-font:last";

function userKey(email: string | null): string {
  return email ? `ccos-logo-font:${email.toLowerCase()}` : "ccos-logo-font:guest";
}

function readIndex(key: string): number | null {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n < LOGO_FONTS.length ? n : null;
  } catch {
    return null;
  }
}

const CHANGE_EVENT = "ccos-logo-font-change";

function subscribe(cb: () => void) {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export default function LogoWordmark({ collapsed }: { collapsed: boolean }) {
  const { data: session } = useSession();
  const email = session?.user?.email ?? null;

  // Read the saved pick straight from storage. The server snapshot is always
  // the first font, so hydration matches, then the client re-renders with the
  // person's own pick (or the last one used on this browser).
  const index = useSyncExternalStore(
    subscribe,
    () => readIndex(userKey(email)) ?? readIndex(LAST_KEY) ?? 0,
    () => 0
  );

  const next = () => {
    const n = (index + 1) % LOGO_FONTS.length;
    try {
      localStorage.setItem(userKey(email), String(n));
      localStorage.setItem(LAST_KEY, String(n));
    } catch {
      // ignore storage errors
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  const font = LOGO_FONTS[index];

  return (
    <button
      type="button"
      className="sidebar-logo-btn"
      onClick={next}
      title={`${font.name}. Click to change.`}
      aria-label={`CCOS wordmark, ${font.name}. Click to change the font.`}
    >
      {collapsed ? (
        <span
          className="sidebar-logo-mark"
          style={{ fontFamily: font.family, ...font.markStyle }}
        >
          {font.mark}
        </span>
      ) : (
        <span
          className="sidebar-logo-text"
          style={{ fontFamily: font.family, ...font.style }}
        >
          {font.text}
        </span>
      )}
    </button>
  );
}
