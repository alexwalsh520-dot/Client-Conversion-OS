"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Moon, Sun } from "lucide-react";

type Theme = "dark" | "light";

// Per-user key so each signed-in person keeps their own choice on a shared
// browser. "ccos-theme:last" caches the most recent pick so the no-flash
// loader in layout.tsx can paint the right mode before the session resolves.
function userKey(email: string | null): string {
  return email ? `ccos-theme:${email.toLowerCase()}` : "ccos-theme:guest";
}

const LAST_KEY = "ccos-theme:last";

function readTheme(key: string): Theme {
  try {
    const v = localStorage.getItem(key);
    if (v === "light" || v === "dark") return v;
  } catch {
    // ignore storage errors (private mode, etc.)
  }
  return "dark";
}

function applyTheme(theme: Theme, key: string) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  try {
    localStorage.setItem(key, theme);
    localStorage.setItem(LAST_KEY, theme);
  } catch {
    // ignore storage errors
  }
}

/**
 * Appearance toggle. Switches the whole app between dark and light by adding
 * a class on <html>; every page follows because styles read CSS variables.
 * The choice is saved against the signed-in user's account email.
 */
export default function ThemeToggle() {
  const { data: session, status } = useSession();
  const email = session?.user?.email ?? null;
  const [theme, setTheme] = useState<Theme>("dark");

  // Once we know who's signed in, load that person's saved theme and apply it.
  useEffect(() => {
    if (status === "loading") return;
    const key = userKey(email);
    const saved = readTheme(key);
    setTheme(saved);
    applyTheme(saved, key);
  }, [email, status]);

  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next, userKey(email));
  }

  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "dark", label: "Dark", icon: Moon },
    { value: "light", label: "Light", icon: Sun },
  ];

  return (
    <div
      role="group"
      aria-label="Theme"
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 4,
        borderRadius: 12,
        border: "1px solid var(--border-primary)",
        background: "var(--bg-glass)",
      }}
    >
      {options.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            onClick={() => choose(value)}
            aria-pressed={active}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid transparent",
              background: active ? "var(--accent-soft)" : "transparent",
              color: active ? "var(--accent)" : "var(--text-muted)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "color 0.15s ease, background 0.15s ease",
            }}
          >
            <Icon size={15} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
