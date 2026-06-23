"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

type Theme = "dark" | "light";

const LAST_KEY = "ccos-theme:last";

function userKey(email: string | null): string {
  return email ? `ccos-theme:${email.toLowerCase()}` : "ccos-theme:guest";
}

function readTheme(key: string): Theme | null {
  try {
    const v = localStorage.getItem(key);
    if (v === "light" || v === "dark") return v;
  } catch {
    // ignore storage errors
  }
  return null;
}

/**
 * Applies the signed-in user's saved theme on EVERY page — not just Settings,
 * where the visible ThemeToggle lives. Without this, the per-user choice was only
 * ever reconciled on the Settings page, so every other tab (and reloads) showed
 * the shared `ccos-theme:last` cache, which drifted from the real choice. That was
 * the "reverts to dark on reload / sidebar dark but app light / Settings flips it"
 * bug.
 *
 * It prefers the user's explicit saved choice; if they have none yet it keeps
 * whatever the no-flash loader already painted (never flips). Either way it
 * re-syncs `ccos-theme:last`, which the no-flash loader AND the embedded ads/dms
 * iframes both read (and the iframes listen for its storage event), so the whole
 * app — chrome and iframes — stays on one consistent theme.
 */
export default function ThemeInit() {
  const { data, status } = useSession();
  const email = data?.user?.email ?? null;

  useEffect(() => {
    if (status === "loading") return;
    const key = userKey(email);
    const painted: Theme = document.documentElement.classList.contains("light")
      ? "light"
      : "dark";
    const resolved = readTheme(key) ?? painted;
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
    try {
      localStorage.setItem(key, resolved);
      localStorage.setItem(LAST_KEY, resolved);
    } catch {
      // ignore storage errors
    }
  }, [email, status]);

  return null;
}
